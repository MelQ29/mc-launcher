# EclipseFantasy Launcher

Кроссплатформенный мультисборочный лаунчер для Minecraft. На текущий момент
поддерживает:

- **Eclipse Fantasy** — Minecraft 1.20.1 + Fabric 0.16.14
- **FTB Summermon** — Minecraft 1.21.1 + NeoForge 21.1.226

Лаунчер скачивает модпаки и UI-ассеты с удалённых источников, проверяет SHA-256 каждого
файла, поддерживает retry / resume / параллельные загрузки, автоматически устанавливает
Fabric или NeoForge loader, и передаёт запуск официальному Minecraft Launcher
(через профиль в `launcher_profiles.json`), чтобы не реализовывать собственную
авторизацию Microsoft.

## Скачать

Готовые сборки лежат в [Releases](https://github.com/MelQ29/mc-launcher/releases/latest):

- **Windows:** `EclipseFantasy-Setup-X.Y.Z.exe` — установщик NSIS (рекомендуется,
  автообновление работает только с installer-версией). Или `EclipseFantasy-Portable-X.Y.Z.exe`
  для запуска без установки.
- **Linux:** `EclipseFantasy-X.Y.Z-x86_64.AppImage` — `chmod +x` и запускать.

При первом запуске Windows покажет SmartScreen "приложение от неизвестного издателя" —
жми "Подробнее" → "Выполнить в любом случае" (EXE не подписан).

После установки и первого запуска лаунчер сам будет проверять обновления при каждом
старте — баннер сверху сообщит о новой версии и предложит перезапуск.

Что нового в каждой версии — см. [CHANGELOG.md](./CHANGELOG.md).

## Сборки

Лаунчер поддерживает несколько модпаков. Список доступных сборок берётся из
`builds.json` на VPS — добавление новой сборки не требует пересборки EXE.
В UI сборки отображаются как табы вверху окна; переключение — клик по табу.

Каждая сборка имеет:
- свои файлы в `~/.config/EclipseFantasy/builds/<id>/instance/` (или в кастомной
  папке, выбранной пользователем);
- свой `manifest.lock` — менеджмент файлов изолирован между сборками;
- свой видео-фон, цветовой акцент и кнопки;
- свою ленту новостей (`news.json` на VPS);
- персональные настройки (ОЗУ, путь установки);
- свой modloader: Fabric или NeoForge (поле `modloader` в `build_manifest.json`).

### Требования по системе

- **Windows 10/11**, **macOS 11+**, или **Linux** (Ubuntu 22.04+, Fedora 38+).
- **Установленный Minecraft Launcher** (Mojang/Microsoft). Поддержка Prism
  Launcher запланирована на v0.3.0 — см. issue #1.
- **Java OpenJDK 17+** для сборок на NeoForge (например Summermon). Если на
  машине только bundled-Java от Mojang Launcher — лаунчер её сам найдёт
  под `~/.minecraft/runtime/`. Если нет — нужно поставить, например
  [Adoptium Temurin](https://adoptium.net/). Для сборок на Fabric Java
  устанавливается автоматически Mojang Launcher.

### Известная проблема с NeoForge

Установка NeoForge запускает официальный installer JAR, который качает
~60+ библиотек с `maven.neoforged.net`. Этот сервер бывает недоступен у
части провайдеров (NeoForge#1813). Сам installer JAR мы зеркалируем у себя
на VPS, но библиотеки тянутся напрямую. Если первый PLAY на NeoForge-сборке
зависает на скачивании библиотек — включите VPN (ProtonVPN, Cloudflare WARP)
на время первой установки. После того как NeoForge закешируется локально,
VPN больше не нужен.

Для админов — см. `FORUPDATE.md`.

## Архитектура раздачи

```
┌──────────────────────┐                    ┌────────────────────┐
│ GitHub Releases      │  launcher binary   │ Пользователь       │
│ launcher-v*          │ ─────────────────► │ EclipseFantasy.exe │
│  ├─ *.exe / .AppImage│   electron-updater │                    │
│  └─ latest.yml       │                    │                    │
└──────────────────────┘                    └─────────┬──────────┘
                                                      │ HTTP
┌──────────────────────┐                              │
│ VPS 141.98.189.63    │ ◄────────────────────────────┘
│  ├─ build_manifest.json (метаданные модпака)
│  ├─ ui_manifest.json    (UI-ассеты)
│  ├─ EclipseFantasy-vX.Y.Z.zip (архив модпака, 2.4+ GB)
│  └─ ui/{background.png, play_button.png}
└──────────────────────┘
```

- **Бинарники лаунчера** — на GitHub Releases, поскольку они обновляются редко и
  вписываются в 2 GiB лимит GitHub.
- **Модпак-данные** — на VPS, потому что архив 2.4 GB не влезает на GitHub
  и UI-ассеты должны хот-свопаться без пересборки EXE.

## Возможности

- **Удалённая сборка**: один архив модпака (ZIP) + отдельный UI-манифест с прямыми
  ссылками на ассеты.
- **Атомарное обновление**: архив распаковывается в staging-директорию, каждый файл
  проверяется по SHA-256, и только потом промоутится в живую папку instance.
- **Безопасная очистка**: удаляются только файлы, отмеченные в предыдущем
  `manifest.lock`. Пользовательские файлы (миры, скриншоты, личные конфиги) никогда
  не трогаются.
- **Оффлайн-режим**: если сеть недоступна, но манифест и сборка уже закэшированы,
  лаунчер запускает игру из кэша.
- **Hot-swap UI**: лого/фон/кнопка читаются из удалённого `ui_manifest.json` —
  обновили картинки на хостинге, лаунчер подхватил без пересборки EXE.
- **Auto-update самого лаунчера**: новые launcher-v* релизы прилетают на установленные
  копии автоматически через electron-updater.
- **Fallback assets**: если UI-манифест недоступен, используются локальные `Iss_*` файлы.
- **Подпись манифестов** (опционально): ed25519, проверяется в
  `src/manifest/signature.ts`.

## Технологии

- Electron 30 + TypeScript 5
- electron-builder для сборки `.exe` (NSIS + portable) и `.AppImage`
- electron-updater для авто-обновлений лаунчера
- Минимум зависимостей в runtime: `extract-zip` для распаковки

## Структура проекта

```
src/
├── core/          # Общие типы, логгер, конфиг, пути
├── downloader/    # SHA-256, многопоточный загрузчик, распаковка архивов
├── manifest/      # Парсинг build/UI manifest, подпись, diff
├── storage/       # Папка instance, staging, settings
├── update/        # Updater (модпак) + SelfUpdater (сам лаунчер)
├── launcher/      # Запуск через официальный Minecraft Launcher + OAuth stub
├── main/          # Electron main process, IPC, preload
└── renderer/      # UI: HTML + CSS + TypeScript (без фреймворков)
```

UI отделён от бизнес-логики через preload IPC bridge (`window.eclipseApi`).
Renderer работает с `contextIsolation: true`, `sandbox: true` и ничего не знает
о файловой системе или сети — только зовёт типизированный API.

## Локальная разработка

```bash
git clone git@github.com:MelQ29/mc-launcher.git
cd mc-launcher
npm install

npm run dev          # сборка + запуск с DevTools
npm run lint         # tsc --noEmit для main и renderer
npm run dist:win     # Win NSIS + portable (release/)
npm run dist:linux   # Linux AppImage (нужен Linux/WSL — не работает на чистом Windows)
```

## Конфигурация

Настройки лежат в `config/launcher.config.json` (дефолты, шипятся с лаунчером)
и `<userData>/settings.json` (пользовательские оверрайды, заполняются через UI).

| Поле | Назначение |
| --- | --- |
| `name` | Отображаемое имя профиля в Minecraft Launcher |
| `version` | Версия лаунчера (для логов) |
| `buildManifestUrl` | URL `build_manifest.json` (по умолчанию VPS) |
| `uiManifestUrl` | URL `ui_manifest.json` (по умолчанию VPS) |
| `signaturePublicKey` | (опционально) ed25519 publickey, hex или PEM |
| `requireValidSignature` | Если `true`, неподписанный/невалидный манифест → ошибка |
| `ramMb` | RAM для JVM (передаётся как `-Xmx`) |
| `installPath` | Путь к instance. `null` → `<userData>/instance` |
| `downloadConcurrency` | Сколько файлов качать параллельно (1..16) |
| `downloadRetries` | Сколько раз повторять загрузку при 5xx ошибке (4xx не ретраятся) |

`<userData>` — `%APPDATA%/EclipseFantasy` на Windows, `~/.config/EclipseFantasy` на Linux.

## Релизы и обновления

**Подробная инструкция:** [FORUPDATE.md](FORUPDATE.md) — как обновлять лаунчер,
как обновлять модпак, что нужно второму разработчику, типичные ошибки.

Кратко:

| Что меняем | Что делать |
| --- | --- |
| Код лаунчера | Бамп `package.json` → коммит → `git tag launcher-vX.Y.Z` → `git push --tags`. CI собирает и публикует в Release. Юзеры получают auto-update. |
| Модпак (моды/конфиги) | Перепаковать ZIP, прогнать `scripts/build-manifest.js`, залить архив + manifest на VPS. Юзеры получают обновление при следующем запуске. |
| UI картинки | Заменить `assets/Iss_*.png`, запустить `node scripts/release-ui.js`. Юзеры подхватят при следующем запуске. |

## Запуск игры

Лаунчер пишет/обновляет профиль `EclipseFantasy` в `launcher_profiles.json`
официального Minecraft Launcher с `gameDir` равным нашей папке instance и
`lastVersionId = fabric-loader-0.16.14-1.20.1`. Затем пытается запустить
официальный лаунчер в порядке:

1. Прямой `.exe` (Game Pass / Xbox `C:\XboxGames\...`, standalone в Program Files,
   per-user в `%LOCALAPPDATA%\Programs`)
2. URI-handler `minecraft://`
3. UWP route `shell:AppsFolder\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft`

**Предусловия для пользователя**:
- Установлен официальный Minecraft Launcher.
- В нём хотя бы один раз запущен Minecraft 1.20.1.
- Установлен Fabric 0.16.14 для 1.20.1 (через Fabric Installer или ручной выбор
  версии в официальном лаунчере).

## Безопасность

- Renderer работает с `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Все привилегированные операции проходят через типизированный IPC bridge в `preload.ts`.
- Подпись манифестов опциональна, но рекомендуется для production-релизов.
- Лаунчер никогда не удаляет файлы вне списка `managedFiles` из текущего `manifest.lock`.

## Кастомизация под другой модпак

Чтобы сделать форк под свой модпак — достаточно:
1. Поменять `productName` и `appId` в `package.json`.
2. Поменять URLs в `config/launcher.config.json` и в `DEFAULTS` в `src/core/config.ts`.
3. Заменить `assets/Iss_logo.png` и `assets/Iss_background.png` (плюс `build/icon.ico`).
4. Опубликовать релизы на своём GitHub.

## Лицензия

MIT.
