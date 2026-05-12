# Multi-Modpack Launcher — Design

**Date:** 2026-05-12
**Status:** Approved (pending final review)
**Author:** brainstormed with Claude

---

## 1. Цель и контекст

Сейчас EclipseFantasy Launcher однопрофильный: одна сборка (`EclipseFantasy-v1.0.5`), один `instance/`, одна правая колонка под кнопку запуска. На VPS уже лежит второй модпак (`ftb_summermon-v1.0.0.zip`, ~1.4 GiB) и комплект новых брендированных ассетов (background-видео, кнопки) в `/var/www/eclipsefantasy/ui_new/`.

Нужно:

1. **Поддержка нескольких сборок** с переключателем в UI. Игрок выбирает таб (ECLIPSE / SUMMERMON), фон/кнопки/моды подсасываются под выбранную.
2. **Панель новостей и чейнджлога справа** — события, обновления, эвенты сборки. Публикуется админом через скрипт без пересборки лаунчера.
3. **Ползунок скачивания** при первичной загрузке и при обновлении — встроен в правую панель.
4. **Брендинг под сборку** — каждая своя видео-фон, своя цветовая палитра, свои графические кнопки.

## 2. Не в скоупе

- Параллельная загрузка нескольких сборок одновременно.
- Установка модпаков от сторонних сборщиков (CurseForge/Modrinth API).
- OAuth Microsoft / запуск Minecraft без официального лаунчера (хэндофф остаётся).
- Markdown в новостях (только plain text, ~120 символов на запись).
- Локализация интерфейса (UI остаётся русским).

## 3. Архитектура

### 3.1 Объектная модель

Подход: **класс `BuildInstance` + регистр**.

Все рантайм-операции, привязанные к одной сборке, инкапсулируются в `BuildInstance`. `BuildRegistry` держит мапу `Map<buildId, BuildInstance>` в главном процессе.

```
main.ts
  └─ BuildRegistry
       ├─ Map<buildId, BuildInstance>
       │     ├─ Paths (per-build)
       │     ├─ ManifestService (per-build)
       │     ├─ Updater extends EventEmitter
       │     ├─ NewsService extends EventEmitter
       │     └─ GameLauncher
       ├─ load()           — fetch builds.json, прогреть BuildInstance-ы
       ├─ get(id)          — доступ к одной сборке
       ├─ setActive(id)    — обновить settings.activeBuildId
       └─ refresh()        — форс-перечитать builds.json
```

`BuildInstance` при создании НЕ дёргает сеть — он только знает свои пути и URLы. Манифесты/новости подтягиваются по запросу из UI или при PLAY.

### 3.2 Ивент-стримы (main → renderer)

| Канал | Payload |
|---|---|
| `registry:builds-changed` | `BuildsRegistry` (свежий состав сборок) |
| `registry:active-changed` | `{ id }` |
| `updater:state` | `{ buildId, state }` — стрим всех стадий обновления |
| `news:updated` | `{ buildId, entries }` |
| `log:entry` | `LogEntry` (как сейчас) |
| `self-update:state` | `SelfUpdateState` (electron-updater, без изменений) |

Логгер остаётся синглтоном, `scope` становится `updater:<id>`, `launcher:<id>` и т.п.

## 4. Файловая раскладка

### 4.1 VPS (`/var/www/eclipsefantasy/`)

```
builds.json                              ← реестр сборок
EclipseFantasy-v1.0.5.zip                ← архив, URL не меняется
ftb_summermon-v1.0.0.zip                 ← архив, URL не меняется
eclipse/
  build_manifest.json
  ui_manifest.json
  news.json
  ui/
    background.mkv
    play_button.png
    options_button.png
    replace_button.png
summermon/
  build_manifest.json
  ui_manifest.json
  news.json
  ui/
    background.mp4
    play_button.png
    options_button.png
    replace_button.png
```

Старые `build_manifest.json` и `ui_manifest.json` на верхнем уровне остаются временно, для пред-релизных лаунчеров. Снести через релиз-другой после раскатки.

### 4.2 userData

Linux: `~/.config/EclipseFantasy/`, Windows: `%APPDATA%/EclipseFantasy/`.

```
settings.json                            ← schemaVersion: 2
logs/
builds-registry.json                     ← кеш builds.json
builds/
  eclipse/
    instance/                            ← модпак-файлы
    ui/                                  ← UI-кеш сборки
    cache/                               ← архив + .part
    manifest.lock
    build_manifest.json                  ← кеш
    ui_manifest.json                     ← кеш
    news.json                            ← кеш
  summermon/
    (та же структура)
```

Кастомный `installPath` остаётся per-build: только папка `instance/` переезжает по пути; служебные файлы (ui, cache, manifest.lock, news.json) всегда живут в `userData/builds/<id>/`.

### 4.3 Протокол `ef-asset://`

`ef-asset://<buildId>/<name>` резолвится в порядке:

1. `userData/builds/<id>/ui/<name>` — свежий UI-кеш сборки.
2. `resources/assets/Iss_<name>` — bundled fallback (для случая «лаунчер запустили без сети, UI-манифест ни разу не качали»).
3. `resources/assets/<name>` — общий bundled fallback.

Рендерер на табе Eclipse запрашивает `ef-asset://eclipse/background.mkv`, на табе Summermon — `ef-asset://summermon/background.mp4`.

## 5. Схемы данных

### 5.1 `builds.json` (реестр на VPS)

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-12T20:00:00Z",
  "defaultBuildId": "eclipse",
  "builds": [
    {
      "id": "eclipse",
      "displayName": "Eclipse Fantasy",
      "shortName": "ECLIPSE",
      "buildManifestUrl": "http://141.98.189.63/eclipse/build_manifest.json",
      "uiManifestUrl":    "http://141.98.189.63/eclipse/ui_manifest.json",
      "newsUrl":          "http://141.98.189.63/eclipse/news.json",
      "accentColor": "#ffd144",
      "enabled": true,
      "order": 1
    },
    {
      "id": "summermon",
      "displayName": "FTB Summermon",
      "shortName": "SUMMERMON",
      "buildManifestUrl": "http://141.98.189.63/summermon/build_manifest.json",
      "uiManifestUrl":    "http://141.98.189.63/summermon/ui_manifest.json",
      "newsUrl":          "http://141.98.189.63/summermon/news.json",
      "accentColor": "#f54c40",
      "enabled": true,
      "order": 2
    }
  ],
  "signature": null
}
```

- `id` — kebab-case, используется для путей в userData и в `launcher_profiles.json` (`eclipsefantasy-<id>`).
- `shortName` — что пишется на табе вверху.
- `accentColor` — подсвечивает активный таб, конечный стоп градиента кнопки PLAY, бордер карточек новостей.
- `enabled: false` — сборка временно скрыта из табов, но её локальная установка не удаляется.
- `order` — сортировка табов слева-направо.
- `signature` — ed25519 hex поверх каноничного JSON минус само поле `signature` (переиспользует `src/manifest/signature.ts`).

### 5.2 `news.json` (per-build лента)

```json
{
  "schemaVersion": 1,
  "buildId": "eclipse",
  "generatedAt": "2026-05-12T20:00:00Z",
  "entries": [
    {
      "id": "2026-05-12-105",
      "date": "2026-05-12",
      "type": "changelog",
      "title": "Обновление 1.0.5 — баланс боссов",
      "body": "Изменены тайминги боссов · добавлено 12 модов"
    },
    {
      "id": "2026-05-04-luna-event",
      "date": "2026-05-04",
      "type": "event",
      "title": "Эвент: Лунное затмение",
      "body": "17–20 мая, ивент-сервер",
      "eventStart": "2026-05-17T18:00:00+03:00",
      "eventEnd":   "2026-05-20T22:00:00+03:00"
    }
  ]
}
```

- `type ∈ { "changelog" | "event" | "notice" }`.
- `body` — plain text, до ~120 символов на запись.
- `eventStart/eventEnd` — опционально, только для `event`. Лаунчер подсвечивает «идёт сейчас» / «через N дней».
- `id` — стабильный, для дедупликации при будущих расширениях.
- Сортировка по `date desc`, в UI первые 5 + кнопка «показать все» если их больше.

### 5.3 `build_manifest.json` — правки

```diff
 {
+  "buildId": "eclipse",
   "version": "1.0.5",
   "minecraft": "1.20.1",
   "fabricLoader": "0.16.14",
   ...
+  "branding": {
+    "video": "background.mkv",
+    "playButton": "play_button.png",
+    "optionsButton": "options_button.png",
+    "replaceButton": "replace_button.png"
+  }
 }
```

`BuildInstance` проверяет, что `build_manifest.buildId === registryEntry.id`. Расхождение → ошибка `BUILD_ID_MISMATCH`, скачивание не запускается.

`branding.*` — имена файлов в UI-кеше этой сборки (соответствуют записям в её `ui_manifest.json`). Рендерер подставляет их в `<video src>` и `<img src>` после переключения таба.

### 5.4 `settings.json` v2

```json
{
  "schemaVersion": 2,
  "buildsRegistryUrl": "http://141.98.189.63/builds.json",
  "activeBuildId": "eclipse",
  "developerMode": false,
  "downloadConcurrency": 4,
  "downloadRetries": 5,
  "requireValidSignature": false,
  "signaturePublicKey": null,
  "perBuild": {
    "eclipse":   { "ramMb": 6144, "installPath": null },
    "summermon": { "ramMb": 4096, "installPath": null }
  }
}
```

- Глобальные операционные настройки (concurrency, retries, registry URL, signature) — на верхнем уровне, видимы только в режиме разработчика.
- `perBuild` — мапа по id. Если для сборки записи нет, используется `recommendedRamMb` из её манифеста (или 4096 как hard-fallback) и дефолтный путь.

### 5.5 `manifest.lock` — без изменений

Структура поля та же, лежит per-build (`userData/builds/<id>/manifest.lock`).

## 6. Поток данных и IPC

### 6.1 Bootstrap

```
main.ts
  └─ BuildRegistry.load()
       ├─ fetch builds.json → cache to userData/builds-registry.json
       ├─ verify signature (если есть и requireValidSignature=true)
       ├─ run one-time migration (если userData/instance ещё существует)
       ├─ для каждого build → создать BuildInstance(id, regEntry, paths, config)
       └─ activeBuildId = settings.activeBuildId ?? defaultBuildId
window → broadcast { type: 'registry:ready', builds, activeBuildId }
```

### 6.2 Переключение таба

```
renderer        main
   │── builds:setActive(id) ──▶
   │              │ settings.activeBuildId = id; persist
   │◀── BuildState ──
   │   { id, displayName, accentColor, installed, lastNews, updateNeeded? }
   │
   │ renderer: tab highlight, swap video src, swap PLAY image,
   │           render newsByBuild[id], swap version chip
   │
   │── news:fetch(id) ──▶ (async)
   │◀── news:updated { id, entries }
   │
   │── updater:check(id) ──▶ (async)
   │◀── updater:state { id, stage: 'check'|'idle' } stream ──
```

Переключение НЕ запускает скачивание модпака. Скачивание — только по кнопке PLAY.

### 6.3 PLAY

```
renderer
   │── launcher:play(activeId) ──▶
                    │
                    │ const inst = registry.get(activeId)
                    │ if (inst.needsUpdate()) await inst.updater.runUpdate(perBuildConfig)
                    │   → stream updater:state { id, stage, progress } ─▶ renderer
                    │ const { manifest } = await inst.manifests.fetchBuildManifest()
                    │ result = await inst.launcher.launch(perBuildConfig, ...)
                    │ → пишет профиль eclipsefantasy-<id> в launcher_profiles.json
   ◀── { ok, profileId } ──
```

Рендерер на стриме `updater:state` фильтрует по `state.buildId === activeBuildId` — фоновые операции другой сборки не показываются в текущем UI, но логируются.

### 6.3.1 Конкурентные PLAY-операции

`Updater.runUpdate` в каждом `BuildInstance` — re-entrant-safe: повторный вызов на той же сборке во время уже идущего обновления возвращает текущий `Promise`, а не запускает второй. Между разными сборками одновременные обновления технически возможны, но UI-кнопка PLAY блокируется глобально пока **любой** `BuildInstance.updater.state.stage !== 'idle' && !== 'ready'`. Это даёт детерминированное поведение «одно скачивание за раз» без жёсткого мьютекса в backend.

Рендерер держит `progressByBuild: Map<buildId, UpdateState>` — состояние не теряется при переключении табов, обратное переключение возвращает корректный прогресс.

### 6.4 Полный список IPC-каналов (request/response)

| Канал | Параметры | Ответ |
|---|---|---|
| `config:get` | — | `LauncherConfig` (v2-схема) |
| `config:save` | `Partial<LauncherConfig>` | `LauncherConfig` |
| `config:saveBuild` | `(buildId, Partial<PerBuildConfig>)` | `PerBuildConfig` |
| `builds:list` | — | `BuildsRegistry` |
| `builds:setActive` | `buildId` | `BuildState` |
| `builds:refresh` | — | `BuildsRegistry` |
| `updater:check` | `buildId?` (null = active) | `{ buildVersion, uiVersion, needsUpdate, recommendedRamMb, minRamMb, error? }` |
| `updater:run` | `buildId?` | `void` (прогресс через стрим) |
| `updater:installedVersion` | `buildId?` | `string \| null` |
| `news:fetch` | `buildId` | `{ entries, fromCache }` |
| `launcher:play` | `buildId?` | `{ ok, profileId }` |
| `paths:installInfo` | `buildId?` | `{ path, isCustomPath, exists, counts, totalBytes }` |
| `paths:openInstallFolder` | `buildId?` | `string` |
| `paths:pickInstallDir` | — | `string \| null` |
| `assets:resolve` | `(buildId, name)` | `ef-asset://<id>/<name>` |
| `dev-mode:unlock` | `password: string` | `boolean` |
| `dev-mode:isUnlocked` | — | `boolean` |
| `dev:resetUiCache` | `buildId` | `void` (удаляет `userData/builds/<id>/ui/*` и `ui_manifest.json` кеш) |
| `dev:resetManifestLock` | `buildId` | `void` (удаляет `manifest.lock`, при следующем PLAY будет полный апдейт) |
| `self-update:*` | — | без изменений |

`buildId?` со знаком вопроса — если не передан, бэк берёт `activeBuildId`.

### 6.5 Расширение `UpdateState`

```ts
interface UpdateState {
  buildId: string;          // НОВОЕ
  stage: UpdateStage;       // как сейчас
  message: string;
  progress?: DownloadProgress;
  error?: string;
}
```

Существующие стадии (`idle | check | download-archive | extract | verify | download-ui | cleanup | ready | launching | error`) не меняются.

## 7. UI / Рендерер

### 7.1 Layout — Variant D1

```
┌────────────────────────────────────────────────────────────┐
│ ← self-update banner (без изменений)                        │
├────────────────────────────────────────────────────────────┤
│ [ECLIPSE]  [SUMMERMON]                  [v1.0.5] [📜] [⚙]   │  ← tabs + tools
├──────────────────────────────────────┬─────────────────────┤
│                                      │ ЧЕЙНДЖЛОГ           │
│                                      │ ┌─────────────────┐ │
│         ┌──────────────────┐         │ │ 12 мая  1.0.5   │ │
│         │                  │         │ │ Баланс боссов   │ │
│         │  <video>         │         │ └─────────────────┘ │
│         │   background.mkv │         │ ┌─────────────────┐ │
│         │                  │         │ │ 04 мая  Эвент   │ │
│         │                  │         │ └─────────────────┘ │
│         │                  │         │ ...                 │
│         │                  │         │ ─────────────────── │
│         │                  │         │ v1.0.5 · MC 1.20.1  │
│         │                  │         │ ┌─────────────────┐ │
│         └──────────────────┘         │ │ Скачиваю архив  │ │  ← progress (D1)
│                                      │ │ 1.5/2.4G · 62%  │ │  (visible only
│                                      │ └─────────────────┘ │   when stage≠idle)
│                                      │ ┌─────────────────┐ │
│                                      │ │     PLAY        │ │
│                                      │ └─────────────────┘ │
└──────────────────────────────────────┴─────────────────────┘
```

### 7.2 HTML структура

```html
<self-update-banner />

<header>
  <tab-row id="tabRow">
    <button data-build-id="eclipse"   class="tab active">ECLIPSE</button>
    <button data-build-id="summermon" class="tab">SUMMERMON</button>
  </tab-row>
  <header-tools>
    <chip id="versionChip">1.0.5</chip>
    <icon-btn id="logsBtn">📜</icon-btn>
    <icon-btn id="settingsBtn">⚙</icon-btn>
  </header-tools>
</header>

<main>
  <section id="videoBlock">
    <video id="bgVideo" autoplay loop muted playsinline preload="auto"></video>
    <img id="bgFallback" hidden />
  </section>

  <aside id="newsPanel">
    <h2>Чейнджлог</h2>
    <ul id="newsList"></ul>
    <div id="versionInfo">—</div>
    <div id="progressBlock" hidden>
      <div class="status" id="progressStatus">—</div>
      <div class="pbar"><i id="progressFill"></i></div>
      <div class="meta">
        <span id="progressText">—</span>
        <span id="progressSpeed">—</span>
      </div>
    </div>
    <button id="launchBtn"><img id="launchBtnImg" /></button>
    <div id="launchSubLabel">—</div>
  </aside>
</main>

<self-update-banner />
<settings-modal />
<logs-modal />
```

### 7.3 Бренд-переключение

При `builds:setActive` рендерер делает:

```ts
function applyBuildBranding(reg: BuildEntry, manifest: BuildManifest): void {
  document.documentElement.style.setProperty('--build-accent', reg.accentColor);
  document.documentElement.style.setProperty('--play-grad-end', shade(reg.accentColor, -20));

  bgVideo.pause();
  bgVideo.src = `ef-asset://${reg.id}/${manifest.branding.video}`;
  bgVideo.load();
  bgVideo.play().catch(showFallbackImage);

  launchBtnImg.src = `ef-asset://${reg.id}/${manifest.branding.playButton}`;
}
```

`accentColor` подкрашивает:
- Подчёркивание активного таба.
- Border-left у карточек новостей type=changelog.
- Конечный стоп градиента кнопки PLAY (начало `#d23a8b` остаётся фирменным).
- Стоп прогресс-бара: `linear-gradient(90deg, #d23a8b, var(--build-accent))`.

### 7.4 Состояния панели прогресса

| Stage | Видимость `#progressBlock` | Содержимое |
|---|---|---|
| `idle` | hidden | — |
| `check` | visible, indeterminate | «Проверка обновлений…» |
| `download-archive` | visible | «Скачиваю архив сборки · X / Y · 62% · ETA» |
| `extract` | visible, indeterminate | «Распаковка архива…» |
| `verify` | visible, indeterminate | «Проверка целостности…» |
| `download-ui` | visible | «Загрузка UI · n/m файлов» |
| `cleanup` | visible, indeterminate | «Очистка…» |
| `ready` | hidden (fade-out) | — |
| `launching` | hidden | (`#launchSubLabel` = «Запущено») |
| `error` | visible, красная полоса | текст ошибки |

### 7.5 Текст под кнопкой PLAY (`#launchSubLabel`)

| Условие | Текст |
|---|---|
| Сборка установлена и актуальна | `Запуск` |
| Сборка установлена, есть апдейт | `Обновить и запустить` |
| Сборка не установлена | `Скачать и запустить` |
| Манифест недоступен, установка есть | `Запуск (оффлайн)` |
| Манифест недоступен, установки нет | `Нет соединения` (disabled) |

### 7.6 Новости — рендеринг

```html
<li class="news-item news-type-event" data-id="2026-05-04-luna-event">
  <div class="date">04 мая</div>
  <div class="title">Эвент: Лунное затмение</div>
  <div class="body">17–20 мая, ивент-сервер</div>
  <div class="event-tag">через 5 дней</div>
</li>
```

Цвет полоски `border-left`:

| type | Цвет |
|---|---|
| `changelog` | `var(--build-accent)` |
| `event` | `#f5c84a` (жёлтый) |
| `notice` | `#7878a0` (серый) |

`event-tag` — рассчитывается на лету из `eventStart/eventEnd`:
- `eventStart` в будущем → `«через N дней»` или `«сегодня в HH:MM»`.
- Сейчас идёт → `«идёт сейчас»` (зелёный бейдж).
- Прошёл → не показывать (или серый «завершён», если undated).

### 7.7 Settings-модал

```
[ Настройки сборки: ECLIPSE FANTASY ]
─────────────────────────────────────
ОЗУ:              [▭▭▭▭▭▭▭▬▬▬▬]  6144 MB
                  Рекомендуется: 6144 MB · применить

Папка установки:  [ /home/melq/EF/eclipse  ]  [ Обзор ]
                  Сейчас: 1 247 файлов, 4.2 GiB · [Открыть в проводнике]

─────────────────────────────────────
[ ] Режим разработчика

(если включён, ниже раскрывается:)
🛠  Расширенные настройки (требует режим разработчика)
    Параллельные загрузки:        [ 4 ]
    Повторы при ошибках:          [ 5 ]
    URL реестра сборок:           [ http://141.98.189.63/builds.json ]
    [ ] Требовать валидную подпись манифеста
    Public key (ed25519, hex):    [ ... ]
    [ Сбросить кеш UI этой сборки ] [ Сбросить manifest.lock ]
```

Per-build настройки (ОЗУ, путь) — наверху. Operational — в свёрнутой секции, доступной только в режиме разработчика.

### 7.7.1 Смена `installPath` уже установленной сборки

Если пользователь меняет путь установки сборки, у которой уже есть `instance/` (по старому пути), показываем диалог:

```
Сборка ECLIPSE уже установлена в <старый путь>.
[ Переместить ]  [ Начать заново ]  [ Отмена ]
```

- `Переместить` — копирует `<старый>/instance/` в `<новый>/instance/`, удаляет старую папку, апдейтит `perBuild.<id>.installPath`. Прогресс показывается как обычный update-state с новой стадией `move`.
- `Начать заново` — апдейтит путь, старую папку оставляет с предупреждением «осиротевшая папка: <путь>, удалите вручную если не нужна». Следующий PLAY скачает сборку в новый путь с нуля.
- `Отмена` — путь не меняется.

### 7.8 Файловая декомпозиция renderer

```
src/renderer/
  index.html
  styles.css
  api.ts                  ← типы IPC (расширены)
  renderer.ts             ← boot, события, оркестрация
  ui/
    tabs.ts               ← рендер табов, клики
    news-panel.ts         ← рендер новостей, фильтр type
    progress.ts           ← рендер прогресс-блока
    settings-modal.ts     ← форма настроек + расширенные
    dev-prompt.ts         ← компонент ввода пароля разработчика
    branding.ts           ← применение accentColor, swap video/buttons
```

## 8. Режим разработчика

### 8.1 Модель

Галка «Режим разработчика» в нижней части settings-модала. По умолчанию `false`.

- Выкл → вкл: открывается inline-форма ввода пароля. При корректном пароле — флаг сохраняется в `settings.json`, под галкой раскрывается расширенный блок.
- Вкл → выкл: пароль не запрашивается, флаг просто снимается, блок схлопывается.

### 8.2 Хранение пароля

`src/main/dev-mode.ts`:

```ts
// SHA-256 of the developer password (see internal docs for plaintext).
// Not cryptographic security — anyone can read source. Guard against
// accidental toggling by regular users.
const DEV_PASSWORD_SHA256 =
  'f80511865de9af3705eef57c9f0b6477d89d0ceff84f1c3bd03c2f80f94b81ec';

export function verifyDevPassword(input: string): boolean {
  const got = crypto.createHash('sha256').update(input, 'utf8').digest('hex');
  return timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(DEV_PASSWORD_SHA256, 'hex'));
}
```

Пароль (plaintext) **не упоминается в коде, не упоминается в этом документе** и не пишется в логи. Изначальное значение хранится у админа в его обычном password-manager.

### 8.3 Безопасные диапазоны

Текущий `ConfigStore.sanitize` (RAM 512–65536, concurrency 1–16, retries 0–20) остаётся. Это значит: даже если опытный пользователь вручную правит `settings.json` — значения возвращаются в безопасный диапазон при следующем старте. Поведение per-build настроек тоже клампится теми же границами.

## 9. Миграция со старого лаунчера

При первом запуске нового лаунчера `BuildRegistry.load()` обнаруживает старую раскладку и однократно переезжает:

| Старое (`userData/...`) | Новое (`userData/builds/eclipse/...`) |
|---|---|
| `instance/` | `instance/` |
| `manifest.lock` | `manifest.lock` |
| `build_manifest.json` | `build_manifest.json` |
| `ui_manifest.json` | `ui_manifest.json` |
| `ui/` | `ui/` |
| `cache/` | `cache/` |

Алгоритм:
1. Проверяем, существует ли `userData/instance/`. Если нет — миграция уже сделана или установки не было; идём дальше.
2. Создаём `userData/builds/eclipse/`.
3. Для каждой пары переезжаем через `fs.rename` (атомарно на одной FS). При `ENOTSUP`/`EXDEV` — fallback на `cp -r` + `rm -rf`.
4. Если в старом `settings.json` был кастомный `installPath` — переносим как `perBuild.eclipse.installPath`. Физического переезда папки не делаем (там уже лежит).
5. Пишем новый `settings.json` со `schemaVersion: 2`.

Старые URL-ключи (`buildManifestUrl`, `uiManifestUrl` указывающие на топ-левел манифесты) попадают в существующий `migrateStaleUrls` в `config.ts` — расширяем патернами:
- `http://141.98.189.63/build_manifest.json`
- `http://141.98.189.63/ui_manifest.json`

### 9.1 Failure mode

Если миграция упала на полпути (например, нет места на диске):
1. Логируем ошибку с конкретным шагом.
2. Откатываем уже переехавшие папки обратно (best-effort).
3. Показываем диалог: «Не удалось мигрировать установку. Папка osobnaya: `<path>`. Повторить?» с кнопками `Повторить` / `Продолжить как новая установка`.
4. `Продолжить как новая` оставляет старый `userData/instance/` нетронутым и стартует с пустой `builds/eclipse/`.

## 10. Тулинг публикации

### 10.1 Изменения в существующих скриптах

| Файл | Изменение |
|---|---|
| `scripts/build-manifest.js` | + флаг `--build-id`, пишет поле `buildId` и блок `branding` |
| `scripts/release-ui.js` | + флаг `--build-id`, заливает в `/var/www/eclipsefantasy/<id>/ui/`, пишет `<id>/ui_manifest.json`. Параметризуется списком ассетов через `--assets <dir>` |
| `scripts/sign-manifest.js` | Без изменений (универсален) |

### 10.2 Новые скрипты

**`scripts/release-build.js`** — атомарный релиз одной сборки:

```bash
node scripts/release-build.js \
  --build-id eclipse \
  --instance ./eclipse-source \
  --archive ./EclipseFantasy-v1.0.5.zip \
  --version 1.0.5 \
  --minecraft 1.20.1 \
  --fabric 0.16.14 \
  --archive-url http://141.98.189.63/EclipseFantasy-v1.0.5.zip \
  --recommended-ram 6144
```

Делает:
1. Запускает `build-manifest.js` внутренне.
2. Опционально загружает архив (`--upload-archive`).
3. Подписывает (если `EF_SIGNING_KEY` в env).
4. SFTP в `/var/www/eclipsefantasy/<id>/build_manifest.json`.

Не трогает `builds.json` и `ui_manifest.json`.

**`scripts/release-news.js`** — новости:

```bash
node scripts/release-news.js add     --build-id eclipse                        # интерактивно
node scripts/release-news.js publish --build-id eclipse --from ./draft.json    # batch
node scripts/release-news.js remove  --build-id eclipse --id 2026-05-04-luna-event
node scripts/release-news.js init    --build-id <id>                           # пустой news.json
```

Логика: скачивает текущий `news.json`, применяет операцию, сортирует, валидирует, подписывает, SFTP-заливает. Локальный бекап в `manifests/news-<id>.last.json` (gitignored).

**`scripts/update-registry.js`** — `builds.json`:

```bash
node scripts/update-registry.js add \
  --id summermon \
  --display-name "FTB Summermon" \
  --short-name SUMMERMON \
  --accent "#f54c40" \
  --order 2

node scripts/update-registry.js disable    --id summermon
node scripts/update-registry.js set-default --id eclipse
```

URL'ы конструируются из шаблона `http://<host>/<id>/{build_manifest,ui_manifest,news}.json` по умолчанию, можно переопределить флагами.

### 10.2.1 Нормализация имён ассетов на VPS

Текущая стейдж-папка `/var/www/eclipsefantasy/ui_new/` содержит файлы с суффиксами сборок (`background_eclipse.mkv`, `play_summermon_button.png`, файл `replace_summerm_buttonon.png` с опечаткой). При публикации в per-build путь `release-ui.js` принимает локальную папку `--assets <dir>` с **чистыми** именами (без суффикса):

```
assets/eclipse-ui/
  background.mkv         ← было background_eclipse.mkv
  play_button.png
  options_button.png
  replace_button.png

assets/summermon-ui/
  background.mp4
  play_button.png
  options_button.png
  replace_button.png     ← опечатка исправлена
```

Перед первым релизом админ копирует ассеты из `ui_new/` в локальные `assets/<id>-ui/`, переименовывая. `release-ui.js` дальше ничего не знает про суффиксы — он использует имена файлов как есть, и они попадают в `build_manifest.branding.*` буквально.

### 10.3 Bootstrap (one-time, перед раскаткой нового лаунчера)

```bash
# Создать структуру на VPS
ssh darkfantasy_vps "mkdir -p /var/www/eclipsefantasy/eclipse/ui /var/www/eclipsefantasy/summermon/ui"

# Залить UI ассеты
node scripts/release-ui.js --build-id eclipse  --assets ./assets/eclipse-ui/
node scripts/release-ui.js --build-id summermon --assets ./assets/summermon-ui/

# Залить build_manifests
node scripts/release-build.js --build-id eclipse   ...
node scripts/release-build.js --build-id summermon ...

# Создать пустые news
node scripts/release-news.js init --build-id eclipse
node scripts/release-news.js init --build-id summermon

# Зарегистрировать в builds.json
node scripts/update-registry.js add --id eclipse   ...
node scripts/update-registry.js add --id summermon ...
```

### 10.4 Документация

- `FORUPDATE.md` — переписать под мультисборку: разделы «Релиз сборки», «Публикация новостей», «Управление реестром». «Как обновить EXE лаунчера» — без изменений.
- `README.md` — апдейт раздела «архитектура»: описать `builds.json`, per-build файлы, режим разработчика.
- `manifests/` — добавить `builds.example.json`, `news.example.json`, обновить `build_manifest.example.json` (поля `buildId`, `branding`).

### 10.5 CI

`.github/workflows/build.yml` — без изменений. CI собирает только лаунчер-EXE; модпак-релизы остаются ручными через VPS.

## 11. Открытые вопросы / будущая работа

- **Параллельная фоновая загрузка** другой сборки, пока пользователь играет — не в скоупе, но архитектура `BuildInstance` это позволит без переписывания.
- **i18n** — UI пока только на русском, как сейчас.
- **Markdown в новостях** — намеренно не делаем; если потребуется длинная новость, прикладываем ссылку через будущее поле `entry.url`.
- **Сторонние модпаки** (CurseForge/Modrinth) — не в скоупе. Если когда-нибудь понадобятся, у `BuildInstance` есть точка расширения для разных `ManifestSource` реализаций.
- **GUI для управления реестром и новостями** — пока CLI-скрипты. Web-админка не в скоупе.
