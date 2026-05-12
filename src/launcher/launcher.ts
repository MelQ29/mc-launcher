import { promises as fs } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { logger } from '../core/logger';
import { Paths } from '../core/paths';
import { fetchText } from '../downloader/downloader';
import type { Modloader, PerBuildConfig } from '../core/types';

/**
 * Hands off launch to the official Minecraft Launcher by registering a
 * profile in launcher_profiles.json. This avoids embedding Microsoft OAuth
 * and complies with Mojang's auth flow — the user's existing session in the
 * official launcher is reused.
 *
 * Flow:
 *   1. Locate .minecraft directory.
 *   2. Ensure the modloader version JSON exists in versions/<id>/<id>.json.
 *      For Fabric: download the profile JSON from Fabric Meta. For NeoForge:
 *      run the official installer JAR (the only supported way — its
 *      output is byte-for-byte sensitive and cannot be replicated client-side).
 *   3. Insert/update a per-build profile in launcher_profiles.json with the
 *      gameDir and lastVersionId.
 *   4. Spawn the Minecraft Launcher executable if we can find it; otherwise
 *      tell the renderer to ask the user to open it manually.
 *
 * The user must have run the official launcher at least once.
 * Prism Launcher / MultiMC are not supported yet (see issue #1).
 */
export class GameLauncher {
  private readonly profileId: string;

  constructor(private readonly buildId: string, private readonly paths: Paths) {
    this.profileId = `eclipsefantasy-${buildId}`;
  }

  async launch(
    perBuildCfg: PerBuildConfig,
    instancePath: string,
    minecraft: string,
    loaderVersion: string,
    buildDisplayName: string,
    modloader: Modloader = 'fabric',
    onStatus: (message: string) => void = () => {},
    loaderInstallerUrlOverride?: string,
  ): Promise<{ ok: boolean; profileId: string }> {
    const dotMc = Paths.defaultDotMinecraft();
    const lastVersionId = this.lastVersionIdFor(modloader, minecraft, loaderVersion);

    await this.ensureLoaderVersion(dotMc, minecraft, modloader, loaderVersion, onStatus, loaderInstallerUrlOverride);
    onStatus('Готовлю профиль Minecraft Launcher…');
    await this.writeProfile(dotMc, instancePath, perBuildCfg, lastVersionId, buildDisplayName);
    onStatus('Открываю Minecraft Launcher…');

    // Try, in order: a known .exe path → minecraft:// URI handler → UWP shell
    // appsFolder route. The first one that doesn't throw wins. Each method
    // works on a different launcher edition (standalone / Xbox / MS Store).
    const exe = await this.findOfficialLauncher();
    if (exe) {
      logger.info('launcher', `Spawning official launcher: ${exe}`);
      try {
        const child = spawn(exe, [], { detached: true, stdio: 'ignore' });
        child.unref();
        return { ok: true, profileId: this.profileId };
      } catch (err) {
        logger.warn('launcher', `Could not spawn ${exe}: ${(err as Error).message}`);
      }
    }

    if (process.platform === 'win32') {
      const tryStart = async (target: string, label: string): Promise<boolean> => {
        try {
          const child = spawn('cmd.exe', ['/c', 'start', '""', target], { detached: true, stdio: 'ignore', shell: false });
          child.unref();
          logger.info('launcher', `Launched via ${label}: ${target}`);
          return true;
        } catch (err) {
          logger.warn('launcher', `${label} failed: ${(err as Error).message}`);
          return false;
        }
      };
      if (await tryStart('minecraft://', 'protocol handler')) return { ok: true, profileId: this.profileId };
      if (await tryStart('shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft', 'AppsFolder UWP route'))
        return { ok: true, profileId: this.profileId };
    }

    logger.info('launcher', 'Profile written; user must open Minecraft Launcher manually');
    return { ok: false, profileId: this.profileId };
  }

  private lastVersionIdFor(modloader: Modloader, minecraft: string, loaderVersion: string): string {
    if (modloader === 'neoforge') return `neoforge-${loaderVersion}`;
    return `fabric-loader-${loaderVersion}-${minecraft}`;
  }

  private async ensureLoaderVersion(
    dotMc: string,
    minecraft: string,
    modloader: Modloader,
    loaderVersion: string,
    onStatus: (message: string) => void,
    installerUrlOverride?: string,
  ): Promise<void> {
    if (modloader === 'neoforge') {
      await this.ensureNeoForgeVersion(dotMc, minecraft, loaderVersion, onStatus, installerUrlOverride);
      return;
    }
    onStatus(`Готовлю Fabric ${loaderVersion}…`);
    await this.ensureFabricVersion(dotMc, minecraft, loaderVersion);
  }

  /**
   * Fabric: pull the profile JSON from Fabric Meta and write it into
   * versions/<id>/<id>.json. Idempotent — re-fetches every launch so a
   * deleted file gets healed.
   */
  private async ensureFabricVersion(dotMc: string, minecraft: string, loaderVersion: string): Promise<void> {
    const id = `fabric-loader-${loaderVersion}-${minecraft}`;
    const dir = path.join(dotMc, 'versions', id);
    const file = path.join(dir, `${id}.json`);
    const url = `https://meta.fabricmc.net/v2/versions/loader/${minecraft}/${loaderVersion}/profile/json`;
    try {
      const body = await fetchText(url);
      const parsed = JSON.parse(body) as { id?: string };
      if (parsed.id !== id) {
        throw new Error(`Fabric Meta returned id="${parsed.id}", expected "${id}"`);
      }
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, body, 'utf8');
      logger.info('launcher', `Fabric version JSON installed: ${file}`);
    } catch (err) {
      logger.error('launcher', `Could not install Fabric version ${id}`, err);
    }
  }

  /**
   * NeoForge: download the installer JAR from Maven and run it with
   * --install-client, which generates versions/neoforge-<ver>/neoforge-<ver>.json
   * plus the processed libraries. The installer's processor chain must run
   * locally — its outputs are byte-for-byte sensitive and cannot be
   * reproduced without it. See notes.highlysuspect.agency/neoforge-installer.html
   *
   * Idempotent: skipped if the version JSON already exists.
   */
  private async ensureNeoForgeVersion(
    dotMc: string,
    minecraft: string,
    loaderVersion: string,
    onStatus: (message: string) => void,
    installerUrlOverride?: string,
  ): Promise<void> {
    const id = `neoforge-${loaderVersion}`;
    const versionJson = path.join(dotMc, 'versions', id, `${id}.json`);
    // Also verify the main NeoForge client JAR is present + non-empty.
    // A partial install (e.g. earlier attempt under blocked network) leaves
    // versions/neoforge-<ver>/neoforge-<ver>.json on disk but truncated or
    // missing libraries in libraries/net/neoforged/. FML then loads, scans
    // mods, but fails with "missing mod 'neoforge'/'minecraft' [MISSING]"
    // because the core JAR didn't register itself. Re-run the installer.
    const neoforgeJar = path.join(
      dotMc, 'libraries', 'net', 'neoforged', 'neoforge', loaderVersion,
      `neoforge-${loaderVersion}-client.jar`,
    );
    let prevInstallLooksOk = false;
    try {
      await fs.access(versionJson);
      const jarStat = await fs.stat(neoforgeJar);
      if (jarStat.size > 1024) prevInstallLooksOk = true;
      else logger.warn('launcher', `NeoForge core JAR is suspiciously small (${jarStat.size} bytes) — reinstalling`);
    } catch { /* either file missing — re-install */ }
    if (prevInstallLooksOk) {
      logger.info('launcher', `NeoForge ${loaderVersion} already installed (${versionJson})`);
      return;
    }

    // Prefer the per-build override (typically pointing at our own VPS
    // mirror — maven.neoforged.net is known-flaky on some ISPs:
    // https://github.com/neoforged/NeoForge/issues/1813).
    const installerUrl = installerUrlOverride ?? this.neoForgeInstallerUrl(minecraft, loaderVersion);
    const cacheDir = this.paths.cache(this.buildId);
    await fs.mkdir(cacheDir, { recursive: true });
    const installerPath = path.join(cacheDir, `neoforge-${loaderVersion}-installer.jar`);

    // Download installer if not cached. Use Electron's net.fetch (Chromium
    // network stack) instead of our Node-https-based Downloader: maven.neoforged.net
    // is well-known for ECONNRESET/TLS issues on some networks
    // (https://github.com/neoforged/NeoForge/issues/1813) and Chromium's net
    // stack handles keep-alive + TLS retries more reliably than Node.
    try {
      await fs.access(installerPath);
      logger.info('launcher', `Reusing cached NeoForge installer: ${installerPath}`);
    } catch {
      onStatus(`Скачиваю NeoForge ${loaderVersion} installer…`);
      logger.info('launcher', `Downloading NeoForge installer ${loaderVersion} from ${installerUrl}`);
      await fetchInstallerWithRetry(installerUrl, installerPath, onStatus);
    }

    onStatus('Ищу Java…');
    const java = await findJava();
    if (!java) {
      throw new Error(
        'Java не найден на этом компьютере. Установи OpenJDK 17+ (https://adoptium.net/) и перезапусти лаунчер.',
      );
    }
    onStatus(`Устанавливаю NeoForge ${loaderVersion} (1–5 мин, качает либы и патчит Minecraft)…`);
    logger.info('launcher', `Running NeoForge installer with ${java} ...`);
    let installerStdout = '';
    let installerStderr = '';
    await new Promise<void>((resolve, reject) => {
      // -Djava.awt.headless=true suppresses the installer's GUI window so
      // the user doesn't see a stray "OK" dialog mid-launch; combined with
      // --install-client the installer runs to completion non-interactively.
      const child = spawn(
        java,
        ['-Djava.awt.headless=true', '-jar', installerPath, '--install-client', dotMc],
        { stdio: 'pipe' },
      );
      child.stderr?.on('data', (b) => { installerStderr += String(b); });
      child.stdout?.on('data', (b) => {
        const s = String(b);
        installerStdout += s;
        for (const line of s.split(/\r?\n/)) {
          if (line.trim()) logger.debug('launcher', `neoforge: ${line.trim()}`);
        }
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`NeoForge installer exited ${code}: ${installerStderr.slice(-500)}`));
      });
    });

    // Post-install verify: the installer prints "SocketTimeoutException" for
    // each library it failed to fetch from maven.neoforged.net, then often
    // continues and exits 0 anyway, leaving a broken install. Insist on the
    // version JSON existing — if it doesn't, the install effectively failed.
    try {
      await fs.access(versionJson);
    } catch {
      const timeoutCount = (installerStdout.match(/SocketTimeoutException/g) ?? []).length;
      const hint = timeoutCount > 0
        ? `Установщик не смог скачать ${timeoutCount}+ библиотек с maven.neoforged.net. ` +
          'Этот сервер бывает недоступен у некоторых провайдеров — попробуй VPN (ProtonVPN, Cloudflare WARP) ' +
          'и перезапусти лаунчер. После одного успешного запуска NeoForge закешируется локально ' +
          'и VPN больше не понадобится.'
        : 'NeoForge installer завершился, но не создал versions/neoforge-' + loaderVersion + '/neoforge-' +
          loaderVersion + '.json. Проверь лог выше.';
      throw new Error(hint);
    }
    logger.info('launcher', `NeoForge ${loaderVersion} installed`);
  }

  /**
   * NeoForge maven uses different artifact paths between MC versions:
   *   - 1.20.1: net.neoforged:forge:<mc>-<loader>   (legacy fork point)
   *   - 1.20.2+: net.neoforged:neoforge:<loader>
   */
  private neoForgeInstallerUrl(minecraft: string, loaderVersion: string): string {
    if (minecraft === '1.20.1') {
      const ver = `1.20.1-${loaderVersion}`;
      return `https://maven.neoforged.net/releases/net/neoforged/forge/${ver}/forge-${ver}-installer.jar`;
    }
    return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
  }

  private async writeProfile(
    dotMc: string,
    instancePath: string,
    perBuildCfg: PerBuildConfig,
    lastVersionId: string,
    buildDisplayName: string,
  ): Promise<void> {
    await fs.mkdir(dotMc, { recursive: true });
    const profilesPath = path.join(dotMc, 'launcher_profiles.json');
    let data: Record<string, unknown> = { profiles: {}, settings: {}, version: 3 };
    try {
      const raw = await fs.readFile(profilesPath, 'utf8');
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== 'ENOENT') logger.warn('launcher', `launcher_profiles.json unreadable, recreating: ${e?.message}`);
    }
    if (typeof data.profiles !== 'object' || data.profiles === null) data.profiles = {};
    const javaArgs = `-Xmx${perBuildCfg.ramMb}M -Xms${Math.max(512, Math.floor(perBuildCfg.ramMb / 4))}M`;
    const profiles = data.profiles as Record<string, Record<string, unknown>>;
    profiles[this.profileId] = {
      ...profiles[this.profileId],
      name: buildDisplayName,
      type: 'custom',
      created: profiles[this.profileId]?.created ?? new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      gameDir: instancePath,
      lastVersionId,
      javaArgs,
      icon: 'Furnace',
    };
    await fs.writeFile(profilesPath, JSON.stringify(data, null, 2), 'utf8');
    logger.info('launcher', `Wrote profile "${this.profileId}" -> gameDir=${instancePath}, version=${lastVersionId}`);
  }

  private async findOfficialLauncher(): Promise<string | null> {
    const platform = process.platform;
    const candidates: string[] = [];
    if (platform === 'win32') {
      candidates.push(
        'C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe',
        path.join(process.env['SystemDrive'] ?? 'C:', '\\XboxGames', 'Minecraft Launcher', 'Content', 'Minecraft.exe'),
        path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
        path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
        path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Minecraft', 'MinecraftLauncher.exe'),
        path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
      );
    } else if (platform === 'darwin') {
      candidates.push('/Applications/Minecraft.app/Contents/MacOS/launcher');
    } else {
      candidates.push('/usr/bin/minecraft-launcher', '/opt/minecraft-launcher/minecraft-launcher', '/snap/bin/mc-installer');
    }
    for (const c of candidates) {
      try {
        const stat = await fs.stat(c);
        if (stat.isFile()) return c;
      } catch {
        /* try next */
      }
    }
    return null;
  }
}

/**
 * Download the NeoForge installer JAR using Electron's net.fetch (Chromium
 * net stack). Retries up to 8 times with exponential backoff + jitter.
 * Throws a user-readable error suggesting a VPN if all attempts fail —
 * maven.neoforged.net is known to be flaky for some ISPs.
 */
async function fetchInstallerWithRetry(
  url: string,
  dest: string,
  onStatus: (msg: string) => void,
): Promise<void> {
  // Lazy-load to keep this file usable in non-electron contexts.
  const { net } = await import('electron');
  const maxAttempts = 8;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await net.fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      // Installer is ~7 MB; buffer in memory is fine and avoids stream-to-file plumbing.
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(dest, buf);
      logger.info('launcher', `NeoForge installer downloaded (${buf.length} bytes, attempt ${attempt})`);
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt >= maxAttempts) break;
      // Exp backoff with jitter: 500ms, 1s, 2s, 4s, 8s, 16s, 30s capped, ±20% jitter.
      const base = Math.min(30000, 500 * Math.pow(2, attempt - 1));
      const delay = base * (0.8 + Math.random() * 0.4);
      logger.warn(
        'launcher',
        `NeoForge installer download attempt ${attempt} failed (${lastErr.message}); retrying in ${Math.round(delay)}ms`,
      );
      onStatus(`Скачиваю NeoForge installer (попытка ${attempt + 1}/${maxAttempts})…`);
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }
  throw new Error(
    `Не удалось скачать NeoForge installer после ${maxAttempts} попыток (${lastErr?.message ?? 'unknown'}). ` +
    'Сервер maven.neoforged.net известен проблемами с некоторыми провайдерами — ' +
    'попробуй VPN (ProtonVPN/Cloudflare WARP) и перезапусти лаунчер.',
  );
}

/**
 * Locate a Java runtime suitable for running the NeoForge installer.
 * Tries (in order): JAVA_HOME, plain `java` on PATH, Mojang Launcher's
 * bundled runtimes under <.minecraft>/runtime/. Returns null if none works.
 */
async function findJava(): Promise<string | null> {
  const candidates: string[] = [];
  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'));
  }
  candidates.push(process.platform === 'win32' ? 'java.exe' : 'java');
  // Mojang bundles JREs at <.minecraft>/runtime/<name>/<os>/<name>/bin/java.
  // Pick anything we find with executable bit.
  try {
    const runtimeRoot = path.join(Paths.defaultDotMinecraft(), 'runtime');
    const entries = await fs.readdir(runtimeRoot, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      // Two levels deep: runtime/<name>/<os>/<name>/bin/java
      const inner = path.join(runtimeRoot, e.name);
      const osEntries = await fs.readdir(inner, { withFileTypes: true }).catch(() => []);
      for (const os of osEntries) {
        if (!os.isDirectory()) continue;
        const javaPath = path.join(inner, os.name, e.name, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
        candidates.push(javaPath);
      }
    }
  } catch { /* ignore */ }

  for (const c of candidates) {
    try {
      const ok = await new Promise<boolean>((res) => {
        const child = spawn(c, ['-version'], { stdio: 'ignore' });
        child.on('error', () => res(false));
        child.on('exit', (code) => res(code === 0));
      });
      if (ok) return c;
    } catch { /* next */ }
  }
  return null;
}
