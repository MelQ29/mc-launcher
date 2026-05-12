# Changelog

Все значимые изменения EclipseFantasy Launcher. Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версии — [Semver](https://semver.org/lang/ru/).

## [0.2.0] — 2026-05-13

Большое обновление: лаунчер теперь мультисборочный и поддерживает несколько модлоадеров.

### Добавлено

- **Поддержка нескольких сборок одновременно.** Список доступных сборок берётся из
  `builds.json` на VPS — добавить новую сборку можно без пересборки EXE. В UI
  сборки переключаются табами вверху окна.
- **Сборка FTB Summermon** (Minecraft 1.21.1 + NeoForge 21.1.226) добавлена в реестр.
- **Поддержка NeoForge** — лаунчер автоматически качает и устанавливает NeoForge
  installer, проверяет целостность установки (наличие core JAR + version JSON),
  показывает прогресс установки в правой панели.
  Eclipse продолжает использовать Fabric.
- **Зеркало NeoForge installer на нашем VPS** (`http://141.98.189.63/loaders/`)
  — снимает зависимость от `maven.neoforged.net` для скачивания installer JAR.
- **Панель новостей справа** — чейнджлог, эвенты и анонсы по каждой сборке. Лента
  публикуется админом через `scripts/release-news.js` и хранится как `news.json`
  рядом с манифестом сборки на VPS. UI поддерживает три типа записей:
  `changelog`, `event` (с датами начала/конца), `notice`.
- **Брендирование под сборку**: видео-фон, цветовой акцент, изображение кнопки PLAY.
  Меняются при переключении табов. Ассеты живут в `ui_manifest.json` сборки.
- **Прогресс-бар** во время скачивания архива (с ETA и скоростью), при установке
  NeoForge, при подготовке профиля Minecraft Launcher. Расположен над кнопкой PLAY.
- **Режим разработчика** (галочка в настройках, защищено паролем) — открывает
  расширенные настройки: параллельные загрузки, повторы при ошибках, URL реестра
  сборок, требование валидной подписи манифеста, public key, и кнопки сброса
  UI-кеша / manifest.lock для тестирования.
- **Per-build настройки**: ОЗУ и путь установки сохраняются отдельно для каждой
  сборки. У Eclipse может быть 6144 MB и `D:\Eclipse`, у Summermon — 4096 MB и
  дефолтная папка.
- **Поддержка Java auto-discovery**: `JAVA_HOME` → `java` на PATH → bundled JRE
  под `~/.minecraft/runtime/`. Если ничего не найдено — понятное сообщение с
  ссылкой на Adoptium.
- **Юнит-тесты** через нативный `node:test` (22 теста: config-миграция, paths,
  builds.json парсинг, news, dev-password, миграция userData). Гоняются в CI.
- **CI prod-ready**: bumped Node 22, `npm test` запускается в pipeline,
  `engines.node >= 22` в package.json.

### Изменено

- **`build_manifest.json` schema** расширена полями `modloader` (`'fabric' | 'neoforge'`),
  `loaderVersion`, `loaderInstallerUrl`, `branding` (видео/кнопки), `buildId`,
  `recommendedRamMb`, `minRamMb`. Старые манифесты с `fabricLoader` продолжают
  работать (fallback на fabric).
- **`settings.json` schema v1 → v2**: настройки теперь хранятся в `perBuild.<id>`.
  Автоматическая миграция при первом запуске v0.2.0 — старые значения `ramMb` и
  `installPath` уезжают в `perBuild.eclipse`.
- **Автомиграция файлов**: `userData/instance/` → `userData/builds/eclipse/instance/`
  (плюс `manifest.lock`, `ui/`, `cache/`) при первом запуске v0.2.0. Игроки v0.1.x
  не перекачивают 2.4 GiB Eclipse — установка переезжает целиком.
- **`ef-asset://` протокол** переведён на `protocol.handle` API + `net.fetch`
  (Chromium net stack). Это даёт честную поддержку HTTP Range, благодаря чему
  большие видео (86 MB у Summermon) играют корректно.
- **UI редизайн** под Variant D1: табы сверху, центральное видео, правая колонка
  с новостями + прогрессом + PLAY. Старый одно-колоночный layout удалён.
- **Per-build профили в Minecraft Launcher**: вместо одного `eclipsefantasy` теперь
  `eclipsefantasy-eclipse`, `eclipsefantasy-summermon`, и т.д.
- **Скрипты публикации** разделены: `release-build.js` (атомарный релиз одной
  сборки), `release-news.js` (управление новостями), `update-registry.js`
  (управление `builds.json`), обновлённый `release-ui.js` (per-build ассеты).
- **Detection стейла**: `installedVersion()` теперь проверяет, что первые 5
  файлов из `manifest.lock` реально лежат в текущем `installPath`. Если нет
  (например, пользователь сменил путь установки) — сборка помечается «не
  установлена», кнопка PLAY становится «Скачать и запустить».
- **Логи**: scope теперь включает `buildId` (например, `build:eclipse`,
  `updater:summermon`). Спам про unsigned-манифесты понижен до debug-уровня.

### Исправлено

- **EPERM на Windows** при `fs.mkdir` корня диска (например, `G:\`) теперь
  игнорируется — Node не даёт «создавать» корень даже с `recursive: true`,
  хотя он уже существует. Лаунчер больше не падает при `installPath: G:\`.
- **Частичные NeoForge установки** (когда installer лёг на скачке либ под
  заблокированным maven, оставив битый версионный JSON) теперь детектируются —
  лаунчер проверяет, что `neoforge-<v>-client.jar` существует и > 1 KiB. Если
  битый — re-installs.
- **Tab switching**: после переключения на второй таб клик обратно на первый
  работает (раньше closure захватывал старый `activeId` и `e.id === activeId`
  возвращал в no-op).
- **Cache-busting `ef-asset://`** — `<video>` / `<img>` `src` дополняются
  `?t=<timestamp>` чтобы Chromium не показывал кешированный 404 после того,
  как файлы реально докачались UI-sync'ом.
- **Спам warn про unsigned manifest** понижен до debug (фоновый UI-sync дёргал
  fetchManifest по 8 раз за запуск, лог захлёбывался).
- **Sentinel против ваниль-фоллбэка**: если `installPath` указывает на пустую
  папку (например, после смены пути в настройках), лаунчер больше не запустит
  Mojang Launcher с пустым gameDir → Mojang перестанет тихо качать ваниль и
  делать вид что это модпак.

### Известные ограничения

- **Prism Launcher** ещё не поддерживается — лаунчер всё ещё ожидает Mojang Launcher.
  Tracking issue: [#1](https://github.com/MelQ29/mc-launcher/issues/1). Запланировано
  на v0.3.0.
- **NeoForge installer** на стороне пользователя качает 60+ библиотек с
  `maven.neoforged.net`. Этот сервер бывает недоступен у части провайдеров.
  При ошибке установки лаунчер выводит инструкцию: включить VPN (ProtonVPN /
  Cloudflare WARP) на время первой установки. После кеширования в
  `~/.minecraft/libraries/` VPN больше не нужен.

### Для разработчиков

- 55+ коммитов, +8000/-1300 строк, ~50 файлов.
- Архитектурная спека: `docs/superpowers/specs/2026-05-12-multi-modpack-design.md`
- План реализации: `docs/superpowers/plans/2026-05-12-multi-modpack-implementation.md`
- Брейншторм-макеты UI (4 варианта layout-а + D1 final): `.superpowers/brainstorm/`
  (gitignored).

## [0.1.3] — 2026-04-26

- Авто-установка профиля Fabric loader перед запуском Minecraft (фикс REQUEST_FAILED
  на свежих PC).
- Миграция stale GitHub-Releases URL манифеста из пользовательских `settings.json`.
- CI больше не упаковывает `builder-debug.yml` в release artifacts.

## [0.1.0] — 2026-04-26

Первый публичный релиз.

- Скачка модпака Eclipse Fantasy с VPS (resumable downloads, SHA-256 верификация).
- Запуск через Mojang Launcher с автоматическим профилем.
- Self-update через `electron-updater`.
- Windows (NSIS installer + portable) и Linux (AppImage).
