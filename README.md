# EclipseFantasy Launcher

Кроссплатформенный лаунчер для модпака **EclipseFantasy** на Minecraft 1.20.1 + Fabric 0.16.14.

Лаунчер скачивает модпак и UI-ассеты с удалённых источников (по умолчанию — GitHub Releases),
проверяет SHA-256 каждого файла, поддерживает retry / resume / параллельные загрузки,
и передаёт запуск официальному Minecraft Launcher (через профиль в `launcher_profiles.json`),
чтобы не реализовывать собственную авторизацию Microsoft.

## Возможности

- **Удалённая сборка**: один архив модпака (ZIP) + отдельный UI-манифест с прямыми ссылками на ассеты.
- **Атомарное обновление**: архив распаковывается в staging-директорию, каждый файл проверяется по SHA-256, и только потом промоутится в живую папку instance.
- **Безопасная очистка**: удаляются только файлы, отмеченные в предыдущем `manifest.lock`. Пользовательские файлы (миры, скриншоты, личные конфиги) никогда не трогаются.
- **Оффлайн-режим**: если сеть недоступна, но манифест и сборка уже закэшированы, лаунчер запускает игру из кэша.
- **Hot-swap UI**: лого/фон/кнопка читаются из удалённого `ui_manifest.json` — обновили картинки на хостинге, лаунчер подхватил без пересборки EXE.
- **Fallback assets**: если UI-манифест недоступен, используются локальные `Iss_*` файлы.
- **Подпись манифестов** (опционально): ed25519, проверяется в `src/manifest/signature.ts`.

## Технологии

- Electron 30 + TypeScript 5
- electron-builder для сборки `.exe` (NSIS + portable) и `.AppImage`
- Минимум зависимостей в runtime: `extract-zip` для распаковки

## Архитектура

```
src/
├── core/          # Общие типы, логгер, конфиг, пути
├── downloader/    # SHA-256, многопоточный загрузчик, распаковка архивов
├── manifest/      # Парсинг build/UI manifest, подпись, diff
├── storage/       # Папка instance, staging, settings
├── update/        # Updater — оркестрирует весь цикл обновления
├── launcher/      # Запуск через официальный Minecraft Launcher + OAuth stub
├── main/          # Electron main process, IPC, preload
└── renderer/      # UI: HTML + CSS + TypeScript (без фреймворков)
```

UI отделён от бизнес-логики через preload IPC bridge (`window.eclipseApi`).
Renderer ничего не знает о файловой системе или сети — только зовёт типизированный API.

## Установка и разработка

```bash
# 1. Установка зависимостей
npm install

# 2. Сборка main + renderer
npm run build

# 3. Запуск в dev-режиме (с DevTools)
npm run dev

# 4. Сборка установщиков
npm run dist:win      # Windows: NSIS + portable EXE
npm run dist:linux    # Linux:   AppImage
```

Готовые артефакты появятся в `release/`.

## Конфигурация

Настройки лежат в `config/launcher.config.json` (дефолты, шипятся с лаунчером)
и `<userData>/settings.json` (пользовательские оверрайды, заполняется через UI).

| Поле | Назначение |
| --- | --- |
| `name` | Отображаемое имя профиля в Minecraft Launcher |
| `version` | Версия лаунчера (для логов) |
| `buildManifestUrl` | URL `build_manifest.json` |
| `uiManifestUrl` | URL `ui_manifest.json` |
| `signaturePublicKey` | (опционально) ed25519 publickey, hex или PEM |
| `requireValidSignature` | Если `true`, неподписанный/невалидный манифест → ошибка |
| `ramMb` | RAM для JVM (передаётся как `-Xmx`) |
| `installPath` | Путь к instance. `null` → `<userData>/instance` |
| `downloadConcurrency` | Сколько файлов качать параллельно (1..16) |
| `downloadRetries` | Сколько раз повторять загрузку при ошибке |

`<userData>` — это `%APPDATA%/EclipseFantasy` на Windows и `~/.config/EclipseFantasy` на Linux.

## Подготовка релиза модпака

1. Собрать модпак в директории `modpack-source/` (`mods/`, `config/`, `resourcepacks/`).
2. Заархивировать в ZIP:
   ```bash
   cd modpack-source
   zip -r ../EclipseFantasy-modpack.zip .
   ```
3. Сгенерировать манифест:
   ```bash
   node scripts/build-manifest.js \
     --instance ./modpack-source \
     --archive  ./EclipseFantasy-modpack.zip \
     --version  2026.04.26-1 \
     --minecraft 1.20.1 \
     --fabric 0.16.14 \
     --archive-url https://github.com/MelQ29/mc-launcher/releases/download/build-2026.04.26-1/EclipseFantasy-modpack.zip \
     --out build_manifest.json
   ```
4. (Опционально) подписать:
   ```bash
   openssl genpkey -algorithm ed25519 -out private.pem
   openssl pkey -in private.pem -pubout -outform DER | xxd -p -c 256 | tail -c 65
   node scripts/sign-manifest.js --in build_manifest.json --key private.pem --out build_manifest.json
   ```
5. Загрузить `EclipseFantasy-modpack.zip`, `build_manifest.json` и UI-ассеты в GitHub Release.

## Подготовка релиза UI

1. Собрать ассеты (`logo.png`, `background.png`).
2. Сгенерировать `ui_manifest.json` (см. `manifests/ui_manifest.example.json`).
3. Загрузить в GitHub Release.

UI-манифест и build-манифест **независимы** — можно обновить только картинки без пересборки модпака.

## Тестирование

| Сценарий | Как проверить |
| --- | --- |
| Чистая установка | Удалить `<userData>/EclipseFantasy`, запустить, нажать «Обновить и запустить» |
| Повторный запуск без обновления | Запустить второй раз — должен сразу включиться режим «Запуск» |
| Битый архив | Подменить `archiveSha256` в манифесте на неправильный — лаунчер должен 3 раза попытаться скачать и упасть |
| Битый файл в распакованной сборке | Изменить любой файл в `instance/`, запустить → диф найдёт расхождение и заархивит заново |
| Оффлайн | Отключить интернет → если сборка уже стоит, лаунчер запустит её |
| Hot-swap UI | Поменять файл в `ui_manifest.json`, перезапустить — картинка обновится |
| Пустые fallback-ассеты | Удалить `assets/Iss_logo.png`, переименовать `ui_manifest.json` URL в нерабочий → должна показаться сломанная картинка, но без падения |

Логи: `<userData>/logs/launcher-*.log` (последние 10 файлов хранятся, остальные ротируются).

## Запуск игры

Лаунчер пишет/обновляет профиль `EclipseFantasy` в `launcher_profiles.json` официального
Minecraft Launcher с `gameDir` равным нашей папке instance и `lastVersionId =
fabric-loader-0.16.14-1.20.1`. Затем пытается запустить `MinecraftLauncher.exe` (Windows)
или `minecraft-launcher` (Linux). Если бинарник не найден, пользователь получает
сообщение в UI и открывает официальный лаунчер вручную — профиль уже на месте.

**Предусловия для пользователя**:
- Установлен официальный Minecraft Launcher.
- В нём хотя бы один раз запущен Minecraft 1.20.1.
- Установлен Fabric 0.16.14 для 1.20.1 (это можно сделать через Fabric Installer или
  любым другим способом — главное, чтобы версия `fabric-loader-0.16.14-1.20.1` была в
  списке доступных).

## Безопасность

- Renderer работает с `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Все привилегированные операции проходят через типизированный IPC bridge в `preload.ts`.
- Подпись манифестов опциональна, но рекомендуется для production-релизов.
- Лаунчер никогда не удаляет файлы вне списка `managedFiles` из текущего `manifest.lock`.

## Кастомизация

Чтобы сделать форк под другой модпак — достаточно:
1. Поменять `productName` и `appId` в `package.json`.
2. Поменять URLs в `config/launcher.config.json`.
3. Заменить `assets/Iss_logo.png` и `assets/Iss_background.png`.
4. Опубликовать релизы на своём GitHub.

Никаких изменений в коде не требуется.

## Лицензия

MIT.
