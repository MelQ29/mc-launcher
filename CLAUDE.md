# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build         # clean + build main (CommonJS) + renderer (ES2020) + copy renderer static assets
npm run dev           # build then launch electron with --dev (opens DevTools detached)
npm run lint          # tsc --noEmit for BOTH tsconfig.main.json and tsconfig.renderer.json
npm test          # node:test runner; covers config, migration, registry, news, paths, dev-password
npm run dist:win      # NSIS installer + portable EXE → release/
npm run dist:linux    # AppImage → release/ (requires Linux/WSL; will not run on pure Windows)
```

"Lint" is type-checking only — there is no ESLint configured.

`scripts/build-manifest.js`, `scripts/release-ui.js`, `scripts/release-build.js`, `scripts/release-news.js`, `scripts/update-registry.js`, `scripts/sign-manifest.js` are operator tools for publishing modpack/UI releases and managing the build registry. Not part of the build. See README and `FORUPDATE.md` before invoking them. Admin-only — none are run in CI.

## Architecture

### Two-source distribution

The launcher pulls from two distinct origins, and a lot of the code only makes sense once you know this split:

- **Launcher binary** → GitHub Releases (`launcher-v*` tag triggers `.github/workflows/build.yml` → publishes EXE/AppImage + `latest.yml` for `electron-updater`).
- **Modpack content + UI assets** → an HTTP VPS (default `141.98.189.63`). The 2.4 GB modpack archive can't live in GitHub Releases, and UI images need to hot-swap without rebuilding the EXE.

Hence two completely separate update paths inside the app: `src/update/self-updater.ts` (electron-updater, updates the EXE) and `src/update/updater.ts` (custom flow, updates the modpack instance). Don't conflate them.

### Multi-build registry

Лаунчер поддерживает несколько модпак-сборок одновременно. Реестр живёт в `builds.json`
на VPS (`/var/www/eclipsefantasy/builds.json`); каждая сборка имеет свою папку
`<id>/` с `build_manifest.json`, `ui_manifest.json`, `news.json`, и `ui/`. Локально
лаунчер хранит per-build данные в `~/.config/EclipseFantasy/builds/<id>/`.

Главный процесс держит `BuildRegistry` с `Map<id, BuildInstance>`; каждый
`BuildInstance` владеет своими `Updater`, `ManifestService`, `NewsService`,
`GameLauncher`. IPC-команды принимают опциональный `buildId` (null = активная сборка).

### Multiple modloaders (Fabric + NeoForge)

`build_manifest.json` имеет поля `modloader: 'fabric' | 'neoforge'` и `loaderVersion`.
Старые манифесты с `fabricLoader` всё ещё работают (fallback на fabric).

- **Fabric**: `GameLauncher.ensureFabricVersion` качает profile JSON с
  `meta.fabricmc.net` и кладёт в `<.minecraft>/versions/fabric-loader-<v>-<mc>/`.
  Mojang Launcher дальше всё качает сам через `inheritsFrom`.
- **NeoForge**: нет аналога Fabric Meta — installer JAR обязан запускаться,
  процессоры трансформируют ванильный Minecraft JAR байт-в-байт (см.
  `notes.highlysuspect.agency/neoforge-installer.html`). `ensureNeoForgeVersion`:
  1. Качает installer JAR. По умолчанию из `loaderInstallerUrl` в манифесте
     (наш VPS mirror — `141.98.189.63/loaders/neoforge-<v>-installer.jar`),
     иначе computes maven URL.
  2. Спавнит `java -Djava.awt.headless=true -jar installer --install-client <.minecraft>`.
  3. Post-install verify: проверяет, что `versions/neoforge-<v>/neoforge-<v>.json`
     создан И `libraries/.../neoforge-<v>-client.jar` > 1 KiB. Иначе — re-install
     при следующем PLAY (детектит партиал-инсталлы).
  4. Если installer лог содержит `SocketTimeoutException` — surface VPN hint
     (maven.neoforged.net блокируется у части провайдеров, NeoForge#1813).

`findJava()` ищет Java в этом порядке: `JAVA_HOME` → `java` на PATH →
Mojang Launcher's bundled JREs под `<.minecraft>/runtime/<runtime>/<os>/<runtime>/bin/java`.

### Install state validation

`BuildInstance.installedVersion()` НЕ возвращает версию из `manifest.lock`
напрямую — сначала проверяет, что первые 5 файлов из `lock.managedFiles.instance`
реально существуют в текущем `instancePath`. Если хотя бы один отсутствует — null
(= не установлено). Это защищает от случая, когда пользователь сменил `installPath`
после установки: lock остаётся в `userData/builds/<id>/`, но файлы на новом
пути отсутствуют. Без этой проверки Mojang Launcher запускался бы с пустым
gameDir и фоллбекал на ваниль.
См. `docs/superpowers/specs/2026-05-12-multi-modpack-design.md`.

При запуске свежего лаунчера на старой установке (`userData/instance/`) выполняется
одноразовая миграция в `userData/builds/eclipse/instance/` — игроки ничего не
перекачивают. Логика в `src/core/migration.ts`.

### Main / renderer / preload boundary

Renderer runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. It has zero access to `fs`, `child_process`, or `net` — it can only call into `window.eclipseApi`, which is a typed wrapper around `ipcRenderer.invoke` defined in `src/main/preload.ts`. Every privileged operation is registered in `src/main/ipc.ts`. Streaming state (update progress, log entries, self-update progress) flows main → renderer via `webContents.send`, fanned out to listener sets in the preload.

The renderer code in `src/renderer/` is plain TS + HTML + CSS (no React/Vue). `scripts/copy-renderer-assets.js` runs as part of `build:renderer` to copy `index.html`/`styles.css` into `dist/renderer/`. The two `tsconfig.*.json` files are strictly separate roots: main TS cannot import renderer TS and vice versa.

### Update flow (`src/update/updater.ts`)

The atomic update is the most important invariant in the project. Order matters:

1. Fetch `build_manifest.json` and `ui_manifest.json` from the VPS. On network failure, fall back to the on-disk cached copy under `<userData>` so the launcher works offline if a build is already installed.
2. Optionally verify ed25519 signature (`src/manifest/signature.ts`) — canonical body is the manifest JSON minus `signature`, with keys sorted recursively. Signing scripts must use the same canonicalisation.
3. Compare manifest against `manifest.lock`. Download archive only if version OR `archiveSha256` differs.
4. Download archive (resumable via HTTP Range to `dest.part`, hash-verified, retried with backoff). 4xx errors except 408/429 are treated as non-retryable.
5. Extract into `os.tmpdir()/eclipsefantasy-stage-<ts>/`, hash-verify EVERY extracted file against the manifest, only then `copyFile` into the live instance. A bad archive never touches the live instance.
6. Remove orphans: ONLY files that were in `manifestLock.managedFiles` but are not in the new manifest. User files (worlds, screenshots, personal configs) are never touched — this is enforced by `diffAgainstManifest` in `src/manifest/differ.ts`. Treat this guarantee as load-bearing.
7. Write the new `manifest.lock`.

`extractArchive` (`src/downloader/archive.ts`) unwraps a single top-level directory if the archive happens to wrap everything in `<modpack-name>/`. 7z is intentionally unsupported — re-pack as ZIP.

### Game launch (`src/launcher/launcher.ts`)

The launcher does NOT implement Microsoft OAuth or run Minecraft itself. It hands off to the official Minecraft Launcher:

1. Pre-install the Fabric loader version JSON by fetching `https://meta.fabricmc.net/v2/versions/loader/<mc>/<loader>/profile/json` into `<.minecraft>/versions/fabric-loader-<loader>-<mc>/<id>.json`. Without this, MS Launcher fails with REQUEST_FAILED on fresh PCs — this was a real shipping bug, do not remove. Idempotent — runs on every launch as self-heal.
2. Write/update the `eclipsefantasy` profile in `launcher_profiles.json` with `gameDir` = our instance and `lastVersionId` = `fabric-loader-<loader>-<mc>`.
3. Spawn the official launcher binary if found, else `minecraft://` URI, else UWP `shell:AppsFolder` route. Each method works for a different launcher edition (standalone / Xbox / MS Store).

### Config layering

`src/core/config.ts` merges three layers: hard-coded `DEFAULT_CONFIG` → bundled `config/launcher.config.json` (shipped with the EXE, replaced on reinstall) → `<userData>/settings.json` (user overrides via UI). `migrateStaleUrls` strips known-bad URLs (e.g. old GitHub-Releases manifest URLs from pre-VPS builds) from the user file so the bundled/default wins on next merge — when changing manifest URLs in defaults, add the old URL to the stale patterns list so existing installs migrate.

### Paths (`src/core/paths.ts`)

`<userData>` is `%APPDATA%/EclipseFantasy` (Win) / `~/.config/EclipseFantasy` (Linux). Resources path differs between dev (`__dirname/../../..` — the project tree) and packaged (`process.resourcesPath`) — see the `app.isPackaged` branch in `src/main/main.ts`. The `ef-asset://<buildId>/<name>` protocol handler in `main.ts` uses Electron's modern `protocol.handle` API (not deprecated `registerFileProtocol`) with `protocol.registerSchemesAsPrivileged` set up BEFORE `app.whenReady()` — the `stream: true` privilege is mandatory for `<video>`/`<audio>` to request HTTP Range and treat responses as streaming; without it `<video>` silently fails on files > a few MB. Resolution order: UI cache (`userData/builds/<id>/ui/<name>`) → bundled `assets/Iss_<name>` → bundled `assets/<name>` → 404. Keep this fallback chain — the renderer relies on it for first-launch with no UI sync yet.

### CI / release

`.github/workflows/build.yml` runs on push/PR to main and on tags. The `release` job only runs for `v*` or `launcher-v*` tags and uploads `*.exe`, `*.AppImage`, `*.zip`, `latest*.yml`, `*.blockmap`. The `.yml` and `.blockmap` files are required by `electron-updater` for delta updates — do not strip them from the upload globs.

To ship a new launcher version: bump `package.json` version, commit, `git tag launcher-vX.Y.Z`, push tag. CI does the rest. Installed copies auto-update via `electron-updater`. See `FORUPDATE.md` for the full release runbook including the modpack and UI release flows (which go to the VPS, not GitHub).

## Conventions worth knowing

- Logger is a streaming `EventEmitter` (`src/core/logger.ts`) — main process logs are forwarded to the renderer via IPC for the in-app log viewer. Use it instead of `console.*`.
- All manifest paths are stored as POSIX (`/`) regardless of platform; `normalize()` helpers in `differ.ts` / `updater.ts` enforce this when comparing against on-disk paths.
- Renderer never sees absolute filesystem paths in URLs — assets are addressed as `ef-asset://<buildId>/<name>`, resolved via `assets:resolve` IPC. Cache-busting query string `?t=<ts>` is appended at `<video>`/`<img>` `src` set time; the main-side protocol handler strips `?...` before path resolution. This avoids Chromium reusing a previously cached 404 from a pre-UI-sync request.
- Numeric config fields are clamped in `ConfigStore.sanitize` (RAM 512–65536, concurrency 1–16, retries 0–20). Trust those bounds downstream.
