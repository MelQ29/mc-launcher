# Инструкция по обновлению EclipseFantasy

Этот документ описывает **все** сценарии обновления — от исправления одной строчки
в коде лаунчера до выкладки новой версии модпака. Цель — чтобы любой человек с
доступом мог опубликовать обновление без вопросов.

## Релиз новой версии сборки

### Fabric-сборка (как Eclipse Fantasy)

```bash
# 1. Распаковать архив локально
mkdir -p tmp/<id>-source && unzip -q -o /path/to/<id>-v<X.Y.Z>.zip -d tmp/<id>-source

# 2. Залить архив на VPS (если ещё не там)
scp /path/to/<id>-v<X.Y.Z>.zip darkfantasy_vps:/var/www/eclipsefantasy/

# 3. Сгенерировать и залить build_manifest
node scripts/release-build.js \
  --build-id <id> \
  --instance tmp/<id>-source \
  --archive /path/to/<id>-v<X.Y.Z>.zip \
  --version <X.Y.Z> --minecraft <MC> --fabric <FAB> \
  --modloader fabric \
  --loader-version <FAB> \
  --archive-url http://141.98.189.63/<id>-v<X.Y.Z>.zip \
  --recommended-ram <MB>
```

### NeoForge-сборка (как FTB Summermon)

```bash
# 1-2. Те же что для Fabric

# 3. Сгенерировать build_manifest с указанием modloader
node scripts/release-build.js \
  --build-id <id> \
  --instance tmp/<id>-source \
  --archive /path/to/<id>-v<X.Y.Z>.zip \
  --version <X.Y.Z> --minecraft 1.21.1 --fabric 21.1.226 \
  --modloader neoforge \
  --loader-version 21.1.226 \
  --archive-url http://141.98.189.63/<id>-v<X.Y.Z>.zip \
  --recommended-ram <MB>

# 4. Залить NeoForge installer JAR на наш VPS (один раз на версию loader-а)
#    Скачать вручную: https://maven.neoforged.net/releases/net/neoforged/neoforge/<VER>/neoforge-<VER>-installer.jar
ssh darkfantasy_vps "mkdir -p /var/www/eclipsefantasy/loaders"
scp neoforge-<VER>-installer.jar darkfantasy_vps:/var/www/eclipsefantasy/loaders/

# 5. Пропатчить manifest, добавив loaderInstallerUrl, чтобы лаунчер качал
#    с нашего VPS, а не с maven.neoforged.net (часть провайдеров его блокирует)
ssh darkfantasy_vps "python3 -c \"
import json
m = json.load(open('/var/www/eclipsefantasy/<id>/build_manifest.json'))
m['loaderInstallerUrl'] = 'http://141.98.189.63/loaders/neoforge-<VER>-installer.jar'
json.dump(m, open('/var/www/eclipsefantasy/<id>/build_manifest.json','w'), indent=2)
\""
```

**Важно про NeoForge installer**: он на стороне пользователя САМ качает 60+ библиотек
с `maven.neoforged.net`. Наш VPS mirror — только installer JAR (~7 MB), не либы.
Пользователи с заблокированным maven.neoforged.net увидят VPN-хинт в лаунчере при
ошибке install — у нас в коде есть детектор `SocketTimeoutException`. После одного
успешного запуска NeoForge кешируется в `~/.minecraft/libraries/` и VPN больше
не нужен.

## Публикация новостей

```bash
# Добавить запись интерактивно
node scripts/release-news.js add --build-id <id>

# Опубликовать draft.json целиком (заменяет всю ленту)
node scripts/release-news.js publish --build-id <id> --from ./draft.json

# Удалить запись по id
node scripts/release-news.js remove --build-id <id> --id <entry-id>
```

## Управление реестром сборок

```bash
node scripts/update-registry.js add --id <id> --display-name "..." --short-name <SHORT> --accent "#rrggbb" --order N
node scripts/update-registry.js disable    --id <id>
node scripts/update-registry.js enable     --id <id>
node scripts/update-registry.js set-default --id <id>
```

## Релиз UI-ассетов сборки

```bash
# assets/<id>-ui/ — локальная папка с background.{mkv,mp4}, play_button.png,
# options_button.png, replace_button.png
node scripts/release-ui.js --build-id <id>
```

---

## Содержание

- [Где что лежит и кто куда стучится](#где-что-лежит-и-кто-куда-стучится)
- [Какие доступы нужны](#какие-доступы-нужны)
- [Подключение второго разработчика](#подключение-второго-разработчика)
- [Сценарий A — Изменения в коде лаунчера](#сценарий-a--изменения-в-коде-лаунчера)
- [Сценарий B — Новая версия модпака](#сценарий-b--новая-версия-модпака)
- [Сценарий C — Только UI (картинки)](#сценарий-c--только-ui-картинки)
- [Сценарий D — Hotfix манифеста без перезаливки архива](#сценарий-d--hotfix-манифеста-без-перезаливки-архива)
- [Часто встречающиеся ошибки](#часто-встречающиеся-ошибки)
- [Откат](#откат)
- [Полезное](#полезное)

---

## Где что лежит и кто куда стучится

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GitHub: MelQ29/mc-launcher                  │
│                                                                     │
│  Тэги вида launcher-vX.Y.Z  →  Release с EXE/AppImage/latest.yml    │
│  └─ откуда electron-updater тянет обновления лаунчера               │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         VPS  141.98.189.63                          │
│                         /var/www/eclipsefantasy/                    │
│                                                                     │
│  build_manifest.json          ← манифест модпака (что качать)       │
│  ui_manifest.json             ← манифест UI-ассетов                 │
│  EclipseFantasy-vX.Y.Z.zip    ← архив модпака (2.4+ GB)             │
│  ui/                                                                │
│    ├─ background.png                                                │
│    └─ play_button.png                                               │
└─────────────────────────────────────────────────────────────────────┘
```

**Что лаунчер запрашивает при старте:**

1. Свой собственный `latest.yml` с GitHub Releases — узнать, есть ли новая версия лаунчера.
2. `http://141.98.189.63/build_manifest.json` — есть ли новый модпак.
3. `http://141.98.189.63/ui_manifest.json` — есть ли новые картинки.
4. Если что-то изменилось — соответствующие файлы скачиваются с того же сервера.

**Куда писать какие изменения:**

| Что меняешь | Куда пушить | Кто потребляет |
| --- | --- | --- |
| Код лаунчера (TS, CSS, HTML) | git tag `launcher-vX.Y.Z` → GitHub | electron-updater на стороне юзера |
| Модпак (моды, конфиги, ресурспаки) | VPS + GitHub backup | лаунчер при запуске |
| UI картинки (фон, кнопка, лого) | VPS + GitHub backup | лаунчер при запуске |
| Минорный фикс манифеста (опечатка в URL и т.п.) | только VPS | лаунчер при запуске |

---

## Какие доступы нужны

| Доступ | Зачем | Как получить |
| --- | --- | --- |
| GitHub write на `MelQ29/mc-launcher` | пушить код, тэги, релизы | владелец репы (`MelQ29`) добавляет в Collaborators |
| SSH на VPS `141.98.189.63` (root) | заливать архив и манифесты | владелец VPS добавляет публичный ключ в `~/.ssh/authorized_keys` |
| `gh` CLI логин | удобный git-flow для GitHub релизов | `gh auth login` локально |
| Python 3 + paramiko | работа `scripts/sftp-upload.py` | `pip install paramiko` |
| Node.js 20+ + npm | сборка проекта | nodejs.org |

Опционально (если будут поддерживать Windows-сборку с подписью):
- code signing certificate — пока не используется, EXE не подписан.

---

## Подключение второго разработчика

**Полный чек-лист.** Все шаги обязательны если человек будет публиковать обновления.
Если он только пишет код, а пушит/релизит другой — пункты 4–7 можно пропустить.

### 1. Клонирование репо

```bash
git clone git@github.com:MelQ29/mc-launcher.git
cd mc-launcher
npm install
```

`npm install` поставит electron, electron-builder, electron-updater, extract-zip
и dev-зависимости. ~314 пакетов, ~30 секунд.

### 2. Проверка сборки

```bash
npm run dev          # должно открыться окно лаунчера
npm run lint         # должно молча отработать
```

Если запускается — окружение готово.

### 3. Git identity для коммитов

В `git_identity.md` (память) задано: для этой репы локально стоит
`user.email=MelQQ29@gmail.com`, `user.name=MelQ29`. Новому разработчику нужно
выставить **свою** identity:

```bash
git config --local user.email "ваш@email.com"
git config --local user.name "Ваш Ник"
```

Это влияет только на эту репу, глобальный config не трогается.

### 4. SSH-ключ к GitHub

Если нет — генерим:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_github -N "" -C "ваш@email.com"
```

Содержимое `~/.ssh/id_ed25519_github.pub` загрузить в [GitHub SSH keys](https://github.com/settings/keys).

`~/.ssh/config`:

```
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes
```

### 5. SSH-ключ к VPS

Сгенерить отдельный ключ под VPS:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_eclipse_vps -N ""
```

Содержимое `~/.ssh/id_ed25519_eclipse_vps.pub` отправить владельцу VPS — он добавит
в `/root/.ssh/authorized_keys` командой:

```bash
echo 'ssh-ed25519 AAAA...' >> /root/.ssh/authorized_keys
```

⚠️ **Не передавать публичный ключ через PowerShell `cat | ssh ...`** — кодировка
коверкает байты. Использовать Git Bash или `Get-Content -Raw` + интерполяция.

`~/.ssh/config` дополнить:

```
Host eclipse-vps 141.98.189.63
    HostName 141.98.189.63
    User root
    IdentityFile ~/.ssh/id_ed25519_eclipse_vps
    IdentitiesOnly yes
```

Проверка:

```bash
ssh eclipse-vps "echo OK"
# должно вернуть OK без запроса пароля
```

### 6. `gh` CLI

```bash
gh auth login
# выбрать GitHub.com → SSH → Login with web browser
```

### 7. Python + paramiko (для VPS-загрузок)

```bash
pip install paramiko
python -c "import paramiko; print(paramiko.__version__)"   # должно напечатать версию
```

После всего этого — оба сценария B и C работают локально без вопросов.

---

## Сценарий A — Изменения в коде лаунчера

**Когда применять:** правишь TypeScript, HTML, CSS, добавляешь фичу, фиксишь баг.

### Шаги

#### 1. Внести и проверить изменения

```bash
# меняешь код в src/
npm run lint                      # type check
npm run dev                       # руками проверить что работает
```

#### 2. Бампнуть версию

`package.json`:

```json
"version": "0.1.X"   // увеличить: 0.1.2 → 0.1.3
```

Семантика:
- `MAJOR.MINOR.PATCH`
- patch bump для багфиксов и косметики (не меняет API)
- minor для новых фич без слома совместимости
- major для несовместимых изменений (никогда у нас не было)

#### 3. Закоммитить и запушить

```bash
git add -A
git commit -m "Описание что изменилось"
git push
```

#### 4. Создать и запушить тэг

```bash
git tag launcher-v0.1.X
git push origin launcher-v0.1.X
```

**Этот шаг — триггер.** Как только тэг приходит на GitHub:
- `.github/workflows/build.yml` стартует
- На `windows-latest` собирает `npm run dist:win` → 2 EXE + latest.yml + blockmap
- На `ubuntu-latest` собирает `npm run dist:linux` → AppImage + latest-linux.yml
- Job `release` создаёт GitHub Release с тэгом `launcher-v0.1.X` и прикрепляет
  все артефакты

#### 5. Дождаться CI (~3 минуты)

```bash
gh run watch --repo MelQ29/mc-launcher    # реалтайм лог
# или
gh run list --repo MelQ29/mc-launcher --limit 3
```

#### 6. Проверить релиз

Открыть https://github.com/MelQ29/mc-launcher/releases/tag/launcher-v0.1.X — должны
быть 7 файлов:

```
EclipseFantasy-Setup-0.1.X.exe          ← Win installer
EclipseFantasy-Portable-0.1.X.exe       ← Win portable
EclipseFantasy-Setup-0.1.X.exe.blockmap ← дельта-обновления
EclipseFantasy-0.1.X-x86_64.AppImage    ← Linux
latest.yml                              ← auto-update метаданные Win
latest-linux.yml                        ← auto-update метаданные Linux
+ Source code (zip/tar.gz, авто-генерируется)
```

#### 7. Дальше — само

Уже установленные у пользователей лаунчеры (≥0.1.1) при следующем запуске:
1. Через 4 секунды после открытия проверят `latest.yml`
2. Скачают новую версию в фоне
3. Покажут красный баннер "Готово к установке: лаунчер v0.1.X" с кнопкой
4. Юзер жмёт → перезапуск → обновлено

Если юзер закроет лаунчер не нажав — обновление применится при следующем запуске
автоматически (`autoInstallOnAppQuit`).

⚠️ **Auto-update работает только для Setup-версии (NSIS).** Portable EXE не может
перезаписать сам себя. Юзеры на portable придётся вручную скачивать новые версии.

---

## Сценарий B — Новая версия модпака

**Когда применять:** добавили мод, обновили версию мода, поменяли конфиг,
обновили ресурспак, что угодно в наполнении модпака.

### Шаги

#### 1. Подготовить локальную папку модпака

Структура должна быть как `.minecraft/`:

```
modpack-source/
├── mods/
│   ├── fabric-api-0.92.0.jar
│   └── ...
├── config/
│   └── ...
├── resourcepacks/
├── shaderpacks/
├── datapacks/
└── options.txt
```

Можно либо вытащить из существующей рабочей сборки на своём компе, либо
распаковать предыдущую версию из `EclipseFantasy-vX.Y.Z.zip` и поправить.

#### 2. Создать ZIP

```bash
cd modpack-source
# на Windows можно через 7-Zip, на Linux/Mac:
zip -r ../EclipseFantasy-v1.0.6.zip .
cd ..
```

⚠️ **Важно:** zip'уем **содержимое** папки (`zip -r ../X.zip .`), а не саму папку.
Если запаковать саму папку, контент окажется внутри `EclipseFantasy v1.0.6/mods/...`.
Лаунчер умеет распознавать единую обёрточную папку и распаковывать без неё, но
лучше не полагаться.

#### 3. Сгенерировать манифест

```bash
node scripts/build-manifest.js \
  --instance ./modpack-source \
  --archive  ./EclipseFantasy-v1.0.6.zip \
  --version  1.0.6 \
  --minecraft 1.20.1 \
  --fabric 0.16.14 \
  --archive-url http://141.98.189.63/EclipseFantasy-v1.0.6.zip \
  --out build_manifest.json
```

Скрипт:
- Хеширует через SHA-256 каждый файл из `--instance`
- Хеширует архив целиком (стримом, чтобы не упасть на больших файлах)
- Записывает результат в `build_manifest.json` с полями `version`,
  `archiveUrl`, `archiveSha256`, `archiveSize`, `files[]`

Посмотреть содержимое:

```bash
node -e "const m=require('./build_manifest.json'); console.log({version:m.version, files:m.files.length, archiveSize:m.archiveSize, sha:m.archiveSha256})"
```

#### 4. (Опционально) Указать рекомендуемую RAM

Открыть `build_manifest.json`, добавить:

```json
{
  ...,
  "recommendedRamMb": 9504,
  "minRamMb": 4096
}
```

Лаунчер покажет это в настройках под слайдером.

#### 5. Залить архив на VPS

```bash
MSYS_NO_PATHCONV=1 python -u scripts/sftp-upload.py \
  eclipse-vps \
  ./EclipseFantasy-v1.0.6.zip \
  /var/www/eclipsefantasy/EclipseFantasy-v1.0.6.zip
```

(`MSYS_NO_PATHCONV=1` — обход бага Git Bash, который превращает `/var/...` в
`C:\Program Files\Git\var\...`. Обязательно при работе с Linux-путями из Git Bash.)

Скрипт показывает прогресс каждые 2 секунды и поддерживает большие файлы.
2.4 GB заливается ~3-5 минут на хорошем апстриме.

⚠️ **Имя файла в URL `--archive-url` должно совпадать с именем на VPS.** Например,
если переименовываешь архив на VPS в `EclipseFantasy-v1.0.6.zip`, в манифесте
URL должен заканчиваться на `EclipseFantasy-v1.0.6.zip`. Иначе лаунчер 404.

#### 6. Залить манифест на VPS

```bash
MSYS_NO_PATHCONV=1 python -u scripts/sftp-upload.py \
  eclipse-vps \
  ./build_manifest.json \
  /var/www/eclipsefantasy/build_manifest.json
```

Это заменяет старый манифест **атомарно** — пользователь, который как раз сейчас
открыл лаунчер, либо увидит старую версию (и все хеши совпадут со старым архивом),
либо новую (и хеши совпадут с новым). Промежуточного "битого" состояния нет, потому
что SFTP `put` пишет в новый файл и переименовывает поверх.

#### 7. (Опционально, но рекомендуется) Backup в GitHub Release

```bash
gh release upload v1.0.5 build_manifest.json --clobber --repo MelQ29/mc-launcher
```

Не обязательно, но если VPS упадёт, старые версии лаунчера (до миграции на VPS)
смогут найти манифест по этому fallback.

#### 8. Проверить с реального лаунчера

Запустить установленный лаунчер:
- Кнопка станет «Обновить и запустить» (значит лаунчер увидел разницу с
  `manifest.lock`)
- По нажатию — скачивание архива (~3-5 мин), распаковка, проверка хешей всех
  файлов, замена `instance/`
- Запуск Minecraft Launcher с обновлённым профилем

Если хеши не сходятся → лаунчер удалит архив и перекачает (до 3 раз). Если ничего
не помогает — манифест расходится с архивом, см. [Часто встречающиеся ошибки](#часто-встречающиеся-ошибки).

#### 9. (Опционально) Удалить старый архив с VPS

После того, как все юзеры перешли (можно подождать неделю-две):

```bash
ssh eclipse-vps "rm -f /var/www/eclipsefantasy/EclipseFantasy-v1.0.5.zip"
```

Освободит место. Хранить можно, чтобы можно было откатиться (см. ниже).

---

## Сценарий C — Только UI (картинки)

**Когда применять:** заменили лого, фон, кнопку запуска. Без изменений в модпаке.

Для этого есть один скрипт `scripts/release-ui.js`, который делает всё.

### Шаги

#### 1. Заменить файлы

В `assets/` лежат локальные fallback-картинки с префиксом `Iss_`:

```
assets/Iss_background.png    # фон
assets/Iss_play_button.png   # кнопка запуска
assets/Iss_logo.png          # верхний баннер (опционально, 1×1 placeholder = скрыт)
```

Кладёшь новые PNG поверх старых, **сохраняя имена**.

#### 2. Запустить релиз

```bash
node scripts/release-ui.js
```

Скрипт сделает за тебя:

1. Захэширует SHA-256 каждой картинки.
2. Загрузит картинки на VPS (`/var/www/eclipsefantasy/ui/<file>`).
3. Сгенерирует новый `ui_manifest.json` с обновлёнными хешами и версией
   формата `YYYY-MM-DD-N` (например `2026-04-26-3`).
4. Загрузит сам `ui_manifest.json` на VPS.
5. Также загрузит `build_manifest.json` на VPS если он есть локально (синк).
6. Зальёт `ui_manifest.json` в GitHub Release `v1.0.5` как backup.

#### 3. Проверить с реального лаунчера

Перезапустить лаунчер. Должен:
- На старте увидеть новую `version` в `ui_manifest.json` (отличается от записанной
  в `manifest.lock.uiVersion`)
- Скачать новые картинки с VPS (быстро, мегабайты)
- Применить новый UI без перезапуска модпака

⚠️ **Если ничего не поменялось:** скорее всего юзер уже на актуальной `uiVersion`,
а `release-ui.js` бампит версию только если контент изменился. Чтобы насильно
перепродёрнуть — увеличить `version` в `ui_manifest.json` руками и залить.

---

## Сценарий D — Hotfix манифеста без перезаливки архива

**Когда применять:** опечатался в `archiveUrl`, забыл `recommendedRamMb`, нужно
отключить старый архив, не меняя его содержимое.

```bash
# отредактировать локальный build_manifest.json
nano build_manifest.json

# залить на VPS
MSYS_NO_PATHCONV=1 python -u scripts/sftp-upload.py \
  eclipse-vps \
  ./build_manifest.json \
  /var/www/eclipsefantasy/build_manifest.json
```

Если ты не менял хеши/архив — лаунчеры юзеров увидят, что `archiveSha256` тот же,
не будут перекачивать архив, но подхватят новые поля (например `recommendedRamMb`).

---

## Часто встречающиеся ошибки

### `HTTP 404` при попытке скачать манифест

**Причина:** настроенный URL не существует.
- Проверить: `curl -I http://141.98.189.63/build_manifest.json` — должен ответить 200.
- Проверить: имя файла в URL точно совпадает с именем на VPS (case-sensitive).

### `SHA-256 mismatch for X: expected ..., got ...`

**Причина:** содержимое файла на сервере не совпадает с тем, что прописано в манифесте.
- Скорее всего — обновили архив но забыли перегенерить манифест.
- Лечится: запустить `node scripts/build-manifest.js ...` заново против актуального архива и манифеста.

### `Archive download/verification failed 3 times`

**Причина:** архив на сервере "битый" с точки зрения манифеста (хеш расходится),
лаунчер 3 раза пытался перекачать.
- Та же причина что выше — манифест говорит про один архив, а на сервере другой.
- Сверить локально: `sha256sum EclipseFantasy-vX.Y.Z.zip` ↔ `archiveSha256` в манифесте.

### `Tester видит старый GitHub URL вместо VPS`

**Причина:** в `<userData>/settings.json` юзера осталась старая URL от первой версии лаунчера.
- В лаунчере ≥0.1.2 есть автомиграция, при первом запуске старые URL чистятся.
- Workaround для 0.1.0/0.1.1: тестер удаляет `%APPDATA%/EclipseFantasy/settings.json`.

### `Cannot fetch ui manifest` + черный фон в лаунчере

**Причина:** VPS недоступен и UI-кэш пуст.
- Лаунчер должен упасть на bundled fallback `Iss_*.png` — они вшиты в EXE.
- Если фон всё равно черный — проверить `assets/Iss_background.png` в установленной
  директории.

### CI run failed с `HttpError: 403 Forbidden`

**Причина:** electron-builder с `GH_TOKEN` пытается auto-publish, конфликтует с
существующим релизом.
- В наших scripts стоит `--publish=never`, должно работать. Если кто-то добавил
  `GH_TOKEN: ${{ secrets... }}` к Package step — убрать.

### `mksquashfs: file does not exist` при локальной сборке Linux на Windows

**Причина:** electron-builder скачал Linux ELF binary который Windows не может
выполнить.
- Решение: собирать AppImage только в CI (ubuntu-latest runner) или из WSL.
- Локально на Windows — только `npm run dist:win`.

### Auto-update не подхватывается на установленной версии

**Причина:** одна из:
1. Установлена portable-версия (не умеет self-update).
2. Версия лаунчера ≥ опубликованной (электрон-апдейтер не делает downgrade).
3. `latest.yml` не попал в Release (если тэг был перетащен и CI не отработал).
4. Юзер заблокировал интернет / антивирус режет electron-updater.

Проверить: открыть лаунчер с `--dev` или посмотреть `<userData>/logs/launcher-*.log`.
Должны быть строки `[self-update] Checking for update` и далее.

---

## Откат

### Откат модпака на предыдущую версию

Если хранится старый ZIP на VPS (рекомендуется хранить минимум 1-2 предыдущие версии):

1. Подготовить старый `build_manifest.json` с `archiveUrl` указывающим на старый архив.
   Самый простой способ — взять из GitHub Release `v1.0.5` или предыдущего тэга.
2. Залить старый манифест на VPS как `build_manifest.json` (см. Сценарий B шаг 6).
3. Юзеры при следующем запуске увидят, что версия "поднялась" → лаунчер скачает
   старый архив, проверит, заменит instance.

⚠️ Лаунчер делает diff против `manifest.lock`. Если в новом (старом) манифесте
файлов меньше, чем было — **лишние файлы из старой установки удалятся**, но только
из тех, что были в `managedFiles`. Пользовательские файлы (миры, скриншоты) не
трогаются.

### Откат лаунчера на предыдущую версию

Auto-updater не делает downgrade — `Update for version X.Y.Z is not available
(latest version: A.B.C, downgrade is disallowed)`.

Откат вручную:
1. Удалить установленную версию через "Программы и компоненты".
2. Скачать старую версию из [Releases](https://github.com/MelQ29/mc-launcher/releases) → выбрать предыдущий тэг.
3. Установить.

После этого `userData` сохраняется (settings.json, instance, кэш) — игре не
требуется переустанавливать модпак.

---

## Полезное

### Просмотр логов лаунчера

```bash
# Windows
explorer "%APPDATA%\EclipseFantasy\logs"

# Linux
xdg-open ~/.config/EclipseFantasy/logs

# или через консоль
tail -F ~/AppData/Roaming/EclipseFantasy/logs/launcher-*.log
```

Хранятся последние 10 лог-файлов, остальные ротируются автоматически.

### Статус CI

```bash
gh run list --repo MelQ29/mc-launcher --limit 5
gh run watch --repo MelQ29/mc-launcher           # последний run в реалтайме
gh run view <run-id> --log-failed                # подробный лог упавшего job
```

### Проверка raw-манифестов с сервера

```bash
curl -s http://141.98.189.63/build_manifest.json | jq '.version, (.files | length), .archiveSize'
curl -s http://141.98.189.63/ui_manifest.json | jq '.version, (.files | length)'
curl -sI http://141.98.189.63/EclipseFantasy-v1.0.5.zip | head -5
```

### Список всех опубликованных тэгов

```bash
git fetch --tags
git tag -l 'launcher-v*' | sort -V
```

### Что лежит на VPS прямо сейчас

```bash
ssh eclipse-vps 'ls -lah /var/www/eclipsefantasy/'
```

### Прямая проверка SSH-доступа

```bash
ssh eclipse-vps "echo OK; uptime; df -h /"
```

### Очистка стейла

Если на тестовой машине лаунчер ведёт себя странно (например, после миграции URL):

```powershell
# Windows
Remove-Item "$env:APPDATA\EclipseFantasy\settings.json" -Force -ErrorAction Ignore
Remove-Item "$env:APPDATA\EclipseFantasy\manifest.lock" -Force -ErrorAction Ignore
```

```bash
# Linux
rm -f ~/.config/EclipseFantasy/settings.json ~/.config/EclipseFantasy/manifest.lock
```

При следующем запуске лаунчер пересоздаст всё с нуля по дефолтным значениям и
актуальному манифесту.
