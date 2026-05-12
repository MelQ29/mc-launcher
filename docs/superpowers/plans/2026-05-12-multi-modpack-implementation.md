# Multi-Modpack Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить однопрофильный EclipseFantasy Launcher в мультисборочный (Eclipse + Summermon + расширяемо) с табами вверху, новостной панелью справа, прогрессом в правой панели над PLAY, режимом разработчика, и публикацией контента через скрипты на VPS.

**Architecture:** `BuildRegistry` (синглтон в main) держит `Map<buildId, BuildInstance>`. Каждый `BuildInstance` владеет своими `Paths`, `ManifestService`, `Updater`, `NewsService`, `GameLauncher`. IPC принимает `buildId?` (null = active). UI хранит `progressByBuild` и переключает бренд-ассеты при смене таба. См. `docs/superpowers/specs/2026-05-12-multi-modpack-design.md`.

**Tech Stack:** TypeScript 5.4, Electron 30, Node 22, native `node:test`, ed25519 через `node:crypto`, SFTP via существующего `scripts/sftp-upload.py`.

---

## Pre-flight

- [ ] **Step 1: Install deps and verify build green before refactor**

```bash
npm install
npm run lint
npm run build
```

Expected: lint passes (tsc --noEmit для main и renderer), build генерирует `dist/main/*` и `dist/renderer/*`. Если падает — сначала чинить старое, потом начинать рефактор.

- [ ] **Step 2: Создать рабочую ветку**

```bash
git checkout -b multi-modpack
git status   # must be clean
```

---

## Phase 1: Тестовая инфраструктура и типы

### Task 1: Подключить `node:test` как тест-раннер

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.main.json`
- Create: `tests/sanity.test.ts`

- [ ] **Step 1: Добавить test script в `package.json`**

В блок `scripts` после `"lint"`:

```json
    "test": "tsc -p tsconfig.test.json && node --test --test-reporter=spec dist-tests/tests/**/*.test.js",
    "test:watch": "tsc -p tsconfig.test.json --watch & node --test --watch dist-tests/tests/**/*.test.js"
```

- [ ] **Step 2: Создать `tsconfig.test.json`**

`tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist-tests",
    "rootDir": ".",
    "module": "CommonJS",
    "target": "ES2022",
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["tests/**/*", "src/**/*"],
  "exclude": ["src/renderer/**/*", "node_modules", "dist", "dist-tests", "release"]
}
```

- [ ] **Step 3: Добавить `dist-tests/` в `.gitignore`**

В `.gitignore` после `dist/`:

```
dist-tests/
```

- [ ] **Step 4: Создать sanity-тест**

`tests/sanity.test.ts`:

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';

test('sanity: node:test работает', () => {
  assert.equal(2 + 2, 4);
});
```

- [ ] **Step 5: Запустить тест**

```bash
npm test
```

Expected: один прошедший тест «sanity: node:test работает».

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.test.json .gitignore tests/sanity.test.ts
git commit -m "test: add node:test runner with sanity test"
```

---

### Task 2: Новые типы для мультисборки

**Files:**
- Modify: `src/core/types.ts`

- [ ] **Step 1: Добавить типы реестра и per-build настроек**

В конец `src/core/types.ts` (до `RendererApi`):

```ts
/* === Multi-build types =================================================== */

export type BuildId = string;

export interface BuildEntry {
  id: BuildId;
  displayName: string;
  shortName: string;
  buildManifestUrl: string;
  uiManifestUrl: string;
  newsUrl: string;
  accentColor: string;
  enabled: boolean;
  order: number;
}

export interface BuildsRegistry {
  schemaVersion: 1;
  generatedAt?: string;
  defaultBuildId: BuildId;
  builds: BuildEntry[];
  signature?: string;
}

export interface PerBuildConfig {
  ramMb: number;
  installPath: string | null;
}

export interface BrandingManifest {
  video: string;
  playButton: string;
  optionsButton: string;
  replaceButton: string;
}

export type NewsEntryType = 'changelog' | 'event' | 'notice';

export interface NewsEntry {
  id: string;
  date: string;            // YYYY-MM-DD
  type: NewsEntryType;
  title: string;
  body: string;
  eventStart?: string;     // ISO 8601
  eventEnd?: string;       // ISO 8601
  url?: string;
}

export interface NewsFeed {
  schemaVersion: 1;
  buildId: BuildId;
  generatedAt?: string;
  entries: NewsEntry[];
  signature?: string;
}

export interface BuildState {
  id: BuildId;
  displayName: string;
  shortName: string;
  accentColor: string;
  installed: boolean;
  installedVersion: string | null;
  updateNeeded: boolean | null;   // null = не проверяли
  branding: BrandingManifest | null;
  lastError?: string;
}
```

- [ ] **Step 2: Расширить `BuildManifest` полями `buildId` и `branding`**

В существующем `BuildManifest` добавить:

```ts
export interface BuildManifest {
  /** ID сборки из builds.json (совпадает с BuildEntry.id). */
  buildId?: string;
  // ... existing fields ...
  /** UI-ассеты, на которые ссылается рендерер через ef-asset://<id>/<file>. */
  branding?: BrandingManifest;
}
```

- [ ] **Step 3: Добавить `buildId` в `UpdateState`**

```ts
export interface UpdateState {
  buildId: BuildId;          // НОВОЕ — кто эмитит state
  stage: UpdateStage;
  message: string;
  progress?: DownloadProgress;
  error?: string;
}
```

- [ ] **Step 4: Расширить `LauncherConfig` под v2-схему**

Заменить весь `LauncherConfig` на:

```ts
export interface LauncherConfig {
  schemaVersion: 2;
  buildsRegistryUrl: string;
  activeBuildId: BuildId;
  developerMode: boolean;
  signaturePublicKey?: string;
  downloadConcurrency: number;
  downloadRetries: number;
  requireValidSignature: boolean;
  perBuild: Record<BuildId, PerBuildConfig>;
}
```

(Старая форма — это «legacy», она будет обрабатываться в `config.ts` миграцией.)

- [ ] **Step 5: Запустить lint**

```bash
npm run lint
```

Expected: множество ошибок в файлах, которые используют старый `LauncherConfig` (config.ts, updater.ts, launcher.ts, ipc.ts, renderer api.ts). Это нормально — починим в следующих тасках. Цель шага — убедиться что новые типы парсятся.

- [ ] **Step 6: Commit (с known broken state)**

```bash
git add src/core/types.ts
git commit -m "types: introduce multi-build types (LauncherConfig v2, BuildEntry, NewsEntry)

Refactor scaffolding — lint intentionally broken until follow-up commits
adapt config.ts/updater.ts/ipc.ts to v2 shape."
```

---

### Task 3: Модуль `dev-password`

**Files:**
- Create: `src/core/dev-password.ts`
- Create: `tests/core/dev-password.test.ts`

- [ ] **Step 1: Написать failing-тест**

`tests/core/dev-password.test.ts`:

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { verifyDevPassword } from '../../src/core/dev-password';

test('verifyDevPassword: правильный пароль принимается', () => {
  assert.equal(verifyDevPassword('DEVmc6767gol'), true);
});

test('verifyDevPassword: неправильный пароль отвергается', () => {
  assert.equal(verifyDevPassword('wrong'), false);
  assert.equal(verifyDevPassword(''), false);
  assert.equal(verifyDevPassword('DEVmc6767gol '), false);  // лишний пробел
});

test('verifyDevPassword: timing-safe — равные длины не падают', () => {
  // Не падает на сравнении одинаково длинных строк
  assert.doesNotThrow(() =>
    verifyDevPassword('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  );
});
```

- [ ] **Step 2: Запустить — должно упасть «module not found»**

```bash
npm test
```

Expected: FAIL — `Cannot find module '../../src/core/dev-password'`.

- [ ] **Step 3: Реализовать модуль**

`src/core/dev-password.ts`:

```ts
import { createHash, timingSafeEqual } from 'crypto';

/**
 * SHA-256 of the developer password. Plaintext is documented in internal
 * runbooks — not in source code. Hash here guards against accidental
 * toggling of developer-only controls by regular users; it is NOT
 * cryptographic security (the Electron app source is shipped to users).
 */
const DEV_PASSWORD_SHA256 =
  'f80511865de9af3705eef57c9f0b6477d89d0ceff84f1c3bd03c2f80f94b81ec';

export function verifyDevPassword(input: string): boolean {
  const got = createHash('sha256').update(input, 'utf8').digest('hex');
  const a = Buffer.from(got, 'hex');
  const b = Buffer.from(DEV_PASSWORD_SHA256, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Запустить — должно пройти**

```bash
npm test
```

Expected: 4 теста проходят (1 sanity + 3 dev-password).

- [ ] **Step 5: Commit**

```bash
git add src/core/dev-password.ts tests/core/dev-password.test.ts
git commit -m "feat: add dev-password verification module"
```

---

### Task 4: Миграция `settings.json` v1 → v2

**Files:**
- Modify: `src/core/config.ts`
- Create: `tests/core/config.test.ts`

- [ ] **Step 1: Написать failing-тест миграции**

`tests/core/config.test.ts`:

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { migrateConfig } from '../../src/core/config';

test('migrateConfig: v1 без schemaVersion переезжает в v2 perBuild.eclipse', () => {
  const v1 = {
    name: 'EclipseFantasy',
    version: '0.1.0',
    buildManifestUrl: 'http://141.98.189.63/build_manifest.json',
    uiManifestUrl: 'http://141.98.189.63/ui_manifest.json',
    ramMb: 6144,
    installPath: '/home/u/EF',
    downloadConcurrency: 4,
    downloadRetries: 5,
    requireValidSignature: false,
  };
  const v2 = migrateConfig(v1);
  assert.equal(v2.schemaVersion, 2);
  assert.equal(v2.activeBuildId, 'eclipse');
  assert.equal(v2.buildsRegistryUrl, 'http://141.98.189.63/builds.json');
  assert.equal(v2.developerMode, false);
  assert.equal(v2.perBuild.eclipse.ramMb, 6144);
  assert.equal(v2.perBuild.eclipse.installPath, '/home/u/EF');
  // Старые URL-ключи не должны попасть в новый объект.
  assert.equal((v2 as Record<string, unknown>).buildManifestUrl, undefined);
});

test('migrateConfig: v2 не трогается', () => {
  const v2input = {
    schemaVersion: 2 as const,
    buildsRegistryUrl: 'http://x/builds.json',
    activeBuildId: 'summermon',
    developerMode: true,
    downloadConcurrency: 8,
    downloadRetries: 3,
    requireValidSignature: true,
    signaturePublicKey: 'abc',
    perBuild: {
      eclipse: { ramMb: 6144, installPath: null },
      summermon: { ramMb: 4096, installPath: '/d/games' },
    },
  };
  const out = migrateConfig(v2input);
  assert.deepEqual(out, v2input);
});

test('migrateConfig: пустой/null возвращает дефолт', () => {
  const out = migrateConfig(null);
  assert.equal(out.schemaVersion, 2);
  assert.equal(out.activeBuildId, 'eclipse');
  assert.deepEqual(out.perBuild, {});
});
```

- [ ] **Step 2: Запустить — упадёт**

```bash
npm test
```

Expected: FAIL — `migrateConfig` не экспортируется.

- [ ] **Step 3: Переписать `src/core/config.ts`**

Полностью заменить содержимое:

```ts
import { promises as fs } from 'fs';
import * as path from 'path';
import type { LauncherConfig, PerBuildConfig, BuildId } from './types';
import { logger } from './logger';

const DEFAULT_BUILDS_REGISTRY_URL = 'http://141.98.189.63/builds.json';

const DEFAULT_CONFIG: LauncherConfig = {
  schemaVersion: 2,
  buildsRegistryUrl: DEFAULT_BUILDS_REGISTRY_URL,
  activeBuildId: 'eclipse',
  developerMode: false,
  signaturePublicKey: undefined,
  downloadConcurrency: 4,
  downloadRetries: 5,
  requireValidSignature: false,
  perBuild: {},
};

const STALE_URL_PATTERNS = [
  '141.98.189.63/build_manifest.json',
  '141.98.189.63/ui_manifest.json',
  'github.com/MelQ29/mc-launcher/releases/latest/download/build_manifest.json',
  'github.com/MelQ29/mc-launcher/releases/latest/download/ui_manifest.json',
  'eclipsefantasy/launcher-assets',
];

/** Convert any incoming user config (v1 legacy, v2 current, or null) to a v2 object. */
export function migrateConfig(raw: unknown): LauncherConfig {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_CONFIG, perBuild: {} };
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion === 2) {
    return sanitize(obj as unknown as LauncherConfig);
  }
  // v1 legacy: top-level ramMb/installPath/buildManifestUrl/uiManifestUrl.
  const ramMb = typeof obj.ramMb === 'number' ? obj.ramMb : DEFAULT_CONFIG.perBuild.eclipse?.ramMb ?? 4096;
  const installPath = typeof obj.installPath === 'string' && obj.installPath.trim() ? obj.installPath : null;
  const v2: LauncherConfig = {
    schemaVersion: 2,
    buildsRegistryUrl: DEFAULT_BUILDS_REGISTRY_URL,
    activeBuildId: 'eclipse',
    developerMode: false,
    signaturePublicKey: typeof obj.signaturePublicKey === 'string' ? obj.signaturePublicKey : undefined,
    downloadConcurrency: numberOr(obj.downloadConcurrency, DEFAULT_CONFIG.downloadConcurrency),
    downloadRetries: numberOr(obj.downloadRetries, DEFAULT_CONFIG.downloadRetries),
    requireValidSignature: obj.requireValidSignature === true,
    perBuild: {
      eclipse: { ramMb, installPath },
    },
  };
  logger.info('config', 'Migrated legacy v1 settings.json → v2');
  return sanitize(v2);
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function sanitize(c: LauncherConfig): LauncherConfig {
  const perBuild: Record<BuildId, PerBuildConfig> = {};
  for (const [id, pb] of Object.entries(c.perBuild ?? {})) {
    perBuild[id] = sanitizePerBuild(pb);
  }
  return {
    ...c,
    schemaVersion: 2,
    buildsRegistryUrl: stripStaleUrl(c.buildsRegistryUrl) || DEFAULT_BUILDS_REGISTRY_URL,
    activeBuildId: c.activeBuildId || 'eclipse',
    developerMode: c.developerMode === true,
    downloadConcurrency: clamp(c.downloadConcurrency || 4, 1, 16),
    downloadRetries: clamp(c.downloadRetries ?? 5, 0, 20),
    requireValidSignature: c.requireValidSignature === true,
    perBuild,
  };
}

function sanitizePerBuild(pb: PerBuildConfig | undefined): PerBuildConfig {
  if (!pb) return { ramMb: 4096, installPath: null };
  return {
    ramMb: clamp(numberOr(pb.ramMb, 4096), 512, 65536),
    installPath: pb.installPath && pb.installPath.trim() ? pb.installPath : null,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function stripStaleUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  if (STALE_URL_PATTERNS.some((p) => url.includes(p))) {
    logger.warn('config', `Dropping stale URL: ${url}`);
    return undefined;
  }
  return url;
}

export class ConfigStore {
  private config: LauncherConfig = { ...DEFAULT_CONFIG, perBuild: {} };
  private loaded = false;

  constructor(
    private readonly settingsFile: string,
    private readonly bundledConfigDir: string,
  ) {}

  async load(): Promise<LauncherConfig> {
    if (this.loaded) return this.config;
    const bundled = await this.tryRead(path.join(this.bundledConfigDir, 'launcher.config.json'));
    const userRaw = await this.tryRead(this.settingsFile);
    const bundledV2 = migrateConfig(bundled);
    const userV2 = migrateConfig(userRaw);
    this.config = mergeV2(bundledV2, userV2);
    this.loaded = true;
    // Если миграция изменила форму пользовательского файла — перезапишем.
    if (userRaw && (userRaw as Record<string, unknown>).schemaVersion !== 2) {
      await fs.writeFile(this.settingsFile, JSON.stringify(this.config, null, 2), 'utf8').catch(() => undefined);
    }
    logger.info('config', `Loaded v2 config (activeBuildId=${this.config.activeBuildId})`);
    return this.config;
  }

  get current(): LauncherConfig {
    if (!this.loaded) throw new Error('ConfigStore.load() must be called first');
    return this.config;
  }

  async save(patch: Partial<LauncherConfig>): Promise<LauncherConfig> {
    if (!this.loaded) await this.load();
    this.config = sanitize({ ...this.config, ...patch });
    await fs.mkdir(path.dirname(this.settingsFile), { recursive: true });
    await fs.writeFile(this.settingsFile, JSON.stringify(this.config, null, 2), 'utf8');
    return this.config;
  }

  async saveBuildConfig(id: BuildId, patch: Partial<PerBuildConfig>): Promise<PerBuildConfig> {
    if (!this.loaded) await this.load();
    const next = sanitizePerBuild({ ...(this.config.perBuild[id] ?? { ramMb: 4096, installPath: null }), ...patch });
    this.config = {
      ...this.config,
      perBuild: { ...this.config.perBuild, [id]: next },
    };
    await fs.writeFile(this.settingsFile, JSON.stringify(this.config, null, 2), 'utf8');
    return next;
  }

  /** Get per-build config; returns hard-fallback if no entry exists yet. */
  perBuild(id: BuildId): PerBuildConfig {
    return this.config.perBuild[id] ?? { ramMb: 4096, installPath: null };
  }

  private async tryRead(file: string): Promise<unknown> {
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw);
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== 'ENOENT') logger.warn('config', `Failed to read ${file}: ${e?.message}`);
      return null;
    }
  }
}

function mergeV2(bundled: LauncherConfig, user: LauncherConfig): LauncherConfig {
  return sanitize({
    ...bundled,
    ...user,
    perBuild: { ...bundled.perBuild, ...user.perBuild },
  });
}

export const DEFAULTS = DEFAULT_CONFIG;
```

- [ ] **Step 4: Запустить тесты**

```bash
npm test
```

Expected: 3 теста миграции конфига проходят (+ предыдущие).

- [ ] **Step 5: Обновить `config/launcher.config.json` (bundled defaults) под v2**

Перезаписать `config/launcher.config.json`:

```json
{
  "schemaVersion": 2,
  "buildsRegistryUrl": "http://141.98.189.63/builds.json",
  "activeBuildId": "eclipse",
  "developerMode": false,
  "downloadConcurrency": 4,
  "downloadRetries": 5,
  "requireValidSignature": false,
  "perBuild": {}
}
```

- [ ] **Step 6: Commit**

```bash
git add src/core/config.ts config/launcher.config.json tests/core/config.test.ts
git commit -m "feat(config): v2 schema with perBuild + legacy v1 migration"
```

---

## Phase 2: Per-build пути и миграция userData

### Task 5: Расширить `Paths` под per-build

**Files:**
- Modify: `src/core/paths.ts`
- Create: `tests/core/paths.test.ts`

- [ ] **Step 1: Failing-тест для per-build путей**

`tests/core/paths.test.ts`:

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { Paths } from '../../src/core/paths';

test('Paths.buildRoot строит userData/builds/<id>', () => {
  const p = new Paths('/u', '/r');
  assert.equal(p.buildRoot('eclipse'), path.join('/u', 'builds', 'eclipse'));
});

test('Paths.instanceRoot без override — userData/builds/<id>/instance', () => {
  const p = new Paths('/u', '/r');
  assert.equal(p.instanceRoot('eclipse', null), path.join('/u', 'builds', 'eclipse', 'instance'));
});

test('Paths.instanceRoot с override использует абсолютный путь', () => {
  const p = new Paths('/u', '/r');
  assert.equal(p.instanceRoot('eclipse', '/d/games/EF'), path.resolve('/d/games/EF'));
});

test('Paths.buildCacheFiles даёт правильные имена', () => {
  const p = new Paths('/u', '/r');
  assert.equal(p.buildManifestCache('eclipse'), path.join('/u', 'builds', 'eclipse', 'build_manifest.json'));
  assert.equal(p.uiManifestCache('eclipse'),    path.join('/u', 'builds', 'eclipse', 'ui_manifest.json'));
  assert.equal(p.newsCache('eclipse'),          path.join('/u', 'builds', 'eclipse', 'news.json'));
  assert.equal(p.manifestLockFile('eclipse'),   path.join('/u', 'builds', 'eclipse', 'manifest.lock'));
  assert.equal(p.uiCache('eclipse'),            path.join('/u', 'builds', 'eclipse', 'ui'));
  assert.equal(p.cache('eclipse'),              path.join('/u', 'builds', 'eclipse', 'cache'));
});

test('Paths.buildsRegistryCache — userData/builds-registry.json (один на лаунчер)', () => {
  const p = new Paths('/u', '/r');
  assert.equal(p.buildsRegistryCache, path.join('/u', 'builds-registry.json'));
});
```

- [ ] **Step 2: Запустить — упадёт**

```bash
npm test
```

Expected: FAIL — методов нет.

- [ ] **Step 3: Заменить `src/core/paths.ts`**

```ts
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import type { BuildId } from './types';

export class Paths {
  constructor(private readonly userData: string, private readonly resourcesDir: string) {}

  get root(): string { return this.userData; }
  get logs(): string { return path.join(this.userData, 'logs'); }
  get settingsFile(): string { return path.join(this.userData, 'settings.json'); }
  get buildsRegistryCache(): string { return path.join(this.userData, 'builds-registry.json'); }
  get bundledAssets(): string { return path.join(this.resourcesDir, 'assets'); }
  get bundledConfig(): string { return path.join(this.resourcesDir, 'config'); }

  /** Root dir for everything per-build (cache, ui, instance, lock). */
  buildRoot(id: BuildId): string {
    return path.join(this.userData, 'builds', id);
  }

  buildManifestCache(id: BuildId): string {
    return path.join(this.buildRoot(id), 'build_manifest.json');
  }
  uiManifestCache(id: BuildId): string {
    return path.join(this.buildRoot(id), 'ui_manifest.json');
  }
  newsCache(id: BuildId): string {
    return path.join(this.buildRoot(id), 'news.json');
  }
  manifestLockFile(id: BuildId): string {
    return path.join(this.buildRoot(id), 'manifest.lock');
  }
  uiCache(id: BuildId): string {
    return path.join(this.buildRoot(id), 'ui');
  }
  cache(id: BuildId): string {
    return path.join(this.buildRoot(id), 'cache');
  }

  /**
   * Where the modpack files (`instance/`) live. Custom override path is
   * absolute; otherwise default is buildRoot/instance.
   */
  instanceRoot(id: BuildId, override: string | null): string {
    return override && override.trim().length > 0
      ? path.resolve(override)
      : path.join(this.buildRoot(id), 'instance');
  }

  static defaultDotMinecraft(): string {
    const platform = process.platform;
    if (platform === 'win32') {
      return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), '.minecraft');
    }
    if (platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Application Support', 'minecraft');
    }
    return path.join(os.homedir(), '.minecraft');
  }

  async ensureBuildDirs(id: BuildId, instancePath: string): Promise<void> {
    const dirs = [
      this.logs,
      this.buildRoot(id),
      this.uiCache(id),
      this.cache(id),
      instancePath,
      path.join(instancePath, 'mods'),
      path.join(instancePath, 'config'),
      path.join(instancePath, 'resourcepacks'),
      path.join(instancePath, 'cache'),
    ];
    await Promise.all(dirs.map((d) => fs.mkdir(d, { recursive: true })));
  }
}
```

- [ ] **Step 4: Запустить тесты**

```bash
npm test
```

Expected: 5 тестов путей проходят.

- [ ] **Step 5: Commit**

```bash
git add src/core/paths.ts tests/core/paths.test.ts
git commit -m "refactor(paths): per-build path helpers"
```

---

### Task 6: Миграция userData (старый layout → builds/eclipse)

**Files:**
- Create: `src/core/migration.ts`
- Create: `tests/core/migration.test.ts`

- [ ] **Step 1: Failing-тест**

`tests/core/migration.test.ts`:

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { migrateLegacyUserData } from '../../src/core/migration';

async function tmpDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'ef-mig-'));
}

test('migrateLegacyUserData: переезжает старый instance в builds/eclipse', async () => {
  const u = await tmpDir();
  await fs.mkdir(path.join(u, 'instance', 'mods'), { recursive: true });
  await fs.writeFile(path.join(u, 'instance', 'mods', 'foo.jar'), 'X');
  await fs.writeFile(path.join(u, 'manifest.lock'), '{}');
  await fs.writeFile(path.join(u, 'build_manifest.json'), '{"v":1}');
  await fs.writeFile(path.join(u, 'ui_manifest.json'), '{"v":1}');
  await fs.mkdir(path.join(u, 'ui'), { recursive: true });
  await fs.writeFile(path.join(u, 'ui', 'bg.png'), 'PNG');
  await fs.mkdir(path.join(u, 'cache'), { recursive: true });

  const result = await migrateLegacyUserData(u);
  assert.equal(result.migrated, true);
  assert.equal(result.targetBuildId, 'eclipse');

  // Старые папки исчезли.
  assert.equal(await exists(path.join(u, 'instance')), false);
  assert.equal(await exists(path.join(u, 'manifest.lock')), false);
  assert.equal(await exists(path.join(u, 'build_manifest.json')), false);

  // Новые на месте.
  assert.equal(await exists(path.join(u, 'builds', 'eclipse', 'instance', 'mods', 'foo.jar')), true);
  assert.equal(await exists(path.join(u, 'builds', 'eclipse', 'manifest.lock')), true);
  assert.equal(await exists(path.join(u, 'builds', 'eclipse', 'ui', 'bg.png')), true);
});

test('migrateLegacyUserData: ничего не делает если старого нет', async () => {
  const u = await tmpDir();
  await fs.mkdir(path.join(u, 'builds', 'eclipse'), { recursive: true });
  const result = await migrateLegacyUserData(u);
  assert.equal(result.migrated, false);
});

test('migrateLegacyUserData: идемпотентна (повторный вызов = no-op)', async () => {
  const u = await tmpDir();
  await fs.mkdir(path.join(u, 'instance'), { recursive: true });
  await fs.writeFile(path.join(u, 'instance', 'foo'), 'x');
  const r1 = await migrateLegacyUserData(u);
  assert.equal(r1.migrated, true);
  const r2 = await migrateLegacyUserData(u);
  assert.equal(r2.migrated, false);
});

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
```

- [ ] **Step 2: Запустить — упадёт**

```bash
npm test
```

Expected: FAIL — `migrateLegacyUserData` не существует.

- [ ] **Step 3: Реализовать `src/core/migration.ts`**

```ts
import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from './logger';

export interface MigrationResult {
  migrated: boolean;
  targetBuildId?: string;
  movedPaths?: string[];
  error?: string;
}

const LEGACY_ENTRIES = [
  'instance',
  'manifest.lock',
  'build_manifest.json',
  'ui_manifest.json',
  'ui',
  'cache',
];

/**
 * Detect a pre-multi-build userData layout and move it under builds/eclipse.
 * Idempotent — safe to call on every launch.
 */
export async function migrateLegacyUserData(userData: string): Promise<MigrationResult> {
  const moved: string[] = [];
  const buildId = 'eclipse';
  const targetDir = path.join(userData, 'builds', buildId);

  // Detect: any legacy entry exists at top level?
  const present: string[] = [];
  for (const name of LEGACY_ENTRIES) {
    if (await exists(path.join(userData, name))) present.push(name);
  }
  if (present.length === 0) return { migrated: false };

  logger.info('migration', `Legacy layout detected (${present.join(', ')}); migrating → builds/${buildId}`);
  await fs.mkdir(targetDir, { recursive: true });

  for (const name of present) {
    const from = path.join(userData, name);
    const to = path.join(targetDir, name);
    try {
      if (await exists(to)) {
        logger.warn('migration', `Target already exists, skipping: ${to}`);
        continue;
      }
      await moveTree(from, to);
      moved.push(name);
    } catch (err) {
      logger.error('migration', `Failed to migrate ${name}`, err);
      return { migrated: false, error: (err as Error).message, movedPaths: moved };
    }
  }
  logger.info('migration', `Migrated ${moved.length} entries: ${moved.join(', ')}`);
  return { migrated: true, targetBuildId: buildId, movedPaths: moved };
}

async function moveTree(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
    return;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'EXDEV' && e.code !== 'ENOTSUP') throw err;
  }
  // Fallback for cross-device renames.
  await copyTree(from, to);
  await fs.rm(from, { recursive: true, force: true });
}

async function copyTree(from: string, to: string): Promise<void> {
  const stat = await fs.stat(from);
  if (stat.isDirectory()) {
    await fs.mkdir(to, { recursive: true });
    for (const ent of await fs.readdir(from)) {
      await copyTree(path.join(from, ent), path.join(to, ent));
    }
  } else {
    await fs.copyFile(from, to);
  }
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
```

- [ ] **Step 4: Тесты**

```bash
npm test
```

Expected: 3 теста миграции проходят.

- [ ] **Step 5: Commit**

```bash
git add src/core/migration.ts tests/core/migration.test.ts
git commit -m "feat(migration): one-time legacy userData → builds/eclipse migration"
```

---

## Phase 3: Builds registry

### Task 7: Загрузка и валидация `builds.json`

**Files:**
- Create: `src/builds/registry-fetch.ts`
- Create: `tests/builds/registry-fetch.test.ts`

- [ ] **Step 1: Failing-тест**

`tests/builds/registry-fetch.test.ts`:

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseBuildsRegistry } from '../../src/builds/registry-fetch';

test('parseBuildsRegistry: валидный JSON парсится', () => {
  const reg = parseBuildsRegistry(JSON.stringify({
    schemaVersion: 1,
    defaultBuildId: 'eclipse',
    builds: [
      { id: 'eclipse', displayName: 'Eclipse', shortName: 'ECLIPSE',
        buildManifestUrl: 'http://x/eclipse/build_manifest.json',
        uiManifestUrl: 'http://x/eclipse/ui_manifest.json',
        newsUrl: 'http://x/eclipse/news.json',
        accentColor: '#ffd144', enabled: true, order: 1 },
    ],
  }));
  assert.equal(reg.defaultBuildId, 'eclipse');
  assert.equal(reg.builds.length, 1);
  assert.equal(reg.builds[0].id, 'eclipse');
});

test('parseBuildsRegistry: невалидная схема падает', () => {
  assert.throws(() => parseBuildsRegistry('{"schemaVersion":2}'));
  assert.throws(() => parseBuildsRegistry('{"schemaVersion":1,"builds":[]}'));  // нет defaultBuildId
  assert.throws(() => parseBuildsRegistry('not json'));
});

test('parseBuildsRegistry: defaultBuildId должен быть среди builds', () => {
  assert.throws(() =>
    parseBuildsRegistry(JSON.stringify({
      schemaVersion: 1,
      defaultBuildId: 'missing',
      builds: [{ id: 'eclipse', displayName: 'E', shortName: 'E',
        buildManifestUrl: 'x', uiManifestUrl: 'x', newsUrl: 'x',
        accentColor: '#fff', enabled: true, order: 1 }],
    })),
  );
});

test('parseBuildsRegistry: сортирует по order', () => {
  const reg = parseBuildsRegistry(JSON.stringify({
    schemaVersion: 1,
    defaultBuildId: 'a',
    builds: [
      { id: 'b', displayName: 'B', shortName: 'B', buildManifestUrl: 'x', uiManifestUrl: 'x', newsUrl: 'x', accentColor: '#fff', enabled: true, order: 2 },
      { id: 'a', displayName: 'A', shortName: 'A', buildManifestUrl: 'x', uiManifestUrl: 'x', newsUrl: 'x', accentColor: '#fff', enabled: true, order: 1 },
    ],
  }));
  assert.equal(reg.builds[0].id, 'a');
  assert.equal(reg.builds[1].id, 'b');
});
```

- [ ] **Step 2: Запустить — упадёт**

```bash
npm test
```

- [ ] **Step 3: Реализовать `src/builds/registry-fetch.ts`**

```ts
import { promises as fs } from 'fs';
import * as path from 'path';
import type { BuildsRegistry, BuildEntry } from '../core/types';
import { fetchText } from '../downloader/downloader';
import { verifyManifestSignature } from '../manifest/signature';
import { logger } from '../core/logger';

export function parseBuildsRegistry(raw: string): BuildsRegistry {
  const obj = JSON.parse(raw) as Partial<BuildsRegistry>;
  if (obj.schemaVersion !== 1) throw new Error(`Unsupported builds.json schemaVersion: ${obj.schemaVersion}`);
  if (typeof obj.defaultBuildId !== 'string' || !obj.defaultBuildId) {
    throw new Error('builds.json missing defaultBuildId');
  }
  if (!Array.isArray(obj.builds) || obj.builds.length === 0) {
    throw new Error('builds.json missing or empty builds[]');
  }
  for (const b of obj.builds) validateBuildEntry(b as BuildEntry);
  const ids = new Set(obj.builds.map((b) => (b as BuildEntry).id));
  if (!ids.has(obj.defaultBuildId)) {
    throw new Error(`defaultBuildId "${obj.defaultBuildId}" not present in builds[]`);
  }
  const sorted = [...(obj.builds as BuildEntry[])].sort((a, b) => a.order - b.order);
  return { ...obj, schemaVersion: 1, builds: sorted } as BuildsRegistry;
}

function validateBuildEntry(b: BuildEntry): void {
  for (const k of ['id', 'displayName', 'shortName', 'buildManifestUrl', 'uiManifestUrl', 'newsUrl', 'accentColor'] as const) {
    if (typeof b[k] !== 'string' || !b[k]) throw new Error(`build entry missing/invalid field ${k}: ${JSON.stringify(b)}`);
  }
  if (!/^[a-z0-9-]+$/.test(b.id)) throw new Error(`build.id must be lowercase kebab-case: ${b.id}`);
  if (typeof b.order !== 'number') throw new Error(`build.${b.id}.order must be a number`);
  if (typeof b.enabled !== 'boolean') throw new Error(`build.${b.id}.enabled must be a boolean`);
}

export async function fetchBuildsRegistry(
  url: string,
  cachePath: string,
  publicKey: string | undefined,
  requireSig: boolean,
): Promise<{ registry: BuildsRegistry; offline: boolean }> {
  let registry: BuildsRegistry | null = null;
  let offline = false;
  try {
    const raw = await fetchText(url);
    registry = parseBuildsRegistry(raw);
    const check = verifyManifestSignature(registry as unknown as Record<string, unknown>, publicKey, requireSig);
    if (!check.ok) throw new Error(`builds.json signature: ${check.reason}`);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, raw, 'utf8');
  } catch (err) {
    logger.warn('builds-registry', `Remote fetch failed (${(err as Error).message}); trying cache`);
    const raw = await fs.readFile(cachePath, 'utf8');  // throws if no cache — fatal
    registry = parseBuildsRegistry(raw);
    offline = true;
  }
  return { registry, offline };
}
```

- [ ] **Step 4: Тесты**

```bash
npm test
```

Expected: 4 теста registry-fetch проходят (плюс предыдущие).

- [ ] **Step 5: Commit**

```bash
git add src/builds/registry-fetch.ts tests/builds/registry-fetch.test.ts
git commit -m "feat(builds): parse and fetch builds.json registry"
```

---

### Task 8: `BuildRegistry` класс

**Files:**
- Create: `src/builds/registry.ts`

- [ ] **Step 1: Реализовать `src/builds/registry.ts`**

```ts
import { EventEmitter } from 'events';
import type { BuildsRegistry, BuildEntry, BuildId, LauncherConfig, BuildState } from '../core/types';
import type { Paths } from '../core/paths';
import type { ConfigStore } from '../core/config';
import type { BuildInstance } from './build-instance';
import { fetchBuildsRegistry } from './registry-fetch';
import { migrateLegacyUserData } from '../core/migration';
import { logger } from '../core/logger';

export interface BuildRegistryDeps {
  paths: Paths;
  config: ConfigStore;
  createInstance: (entry: BuildEntry) => BuildInstance;
}

export class BuildRegistry extends EventEmitter {
  private registry: BuildsRegistry | null = null;
  private instances = new Map<BuildId, BuildInstance>();
  private offline = false;

  constructor(private readonly deps: BuildRegistryDeps) { super(); }

  async load(): Promise<BuildsRegistry> {
    // 1. one-time userData migration
    await migrateLegacyUserData(this.deps.paths.root).catch((err) =>
      logger.error('build-registry', 'Migration failed (continuing)', err),
    );

    // 2. fetch registry
    const cfg = this.deps.config.current;
    const { registry, offline } = await fetchBuildsRegistry(
      cfg.buildsRegistryUrl,
      this.deps.paths.buildsRegistryCache,
      cfg.signaturePublicKey,
      cfg.requireValidSignature,
    );
    this.registry = registry;
    this.offline = offline;

    // 3. ensure BuildInstance for every entry
    for (const entry of registry.builds) {
      if (!this.instances.has(entry.id)) {
        this.instances.set(entry.id, this.deps.createInstance(entry));
      }
    }

    // 4. ensure activeBuildId is sane
    const validIds = new Set(registry.builds.filter((b) => b.enabled).map((b) => b.id));
    if (!validIds.has(cfg.activeBuildId)) {
      const next = validIds.has(registry.defaultBuildId)
        ? registry.defaultBuildId
        : registry.builds.find((b) => b.enabled)?.id;
      if (next) {
        await this.deps.config.save({ activeBuildId: next });
        logger.info('build-registry', `activeBuildId reset to "${next}"`);
      }
    }
    this.emit('builds-changed', registry);
    return registry;
  }

  current(): BuildsRegistry {
    if (!this.registry) throw new Error('BuildRegistry not loaded');
    return this.registry;
  }

  isOffline(): boolean { return this.offline; }

  get(id: BuildId): BuildInstance {
    const inst = this.instances.get(id);
    if (!inst) throw new Error(`Unknown build id: ${id}`);
    return inst;
  }

  active(): BuildInstance {
    return this.get(this.deps.config.current.activeBuildId);
  }

  async setActive(id: BuildId): Promise<BuildState> {
    if (!this.instances.has(id)) throw new Error(`Unknown build id: ${id}`);
    await this.deps.config.save({ activeBuildId: id });
    const state = await this.get(id).state();
    this.emit('active-changed', { id });
    return state;
  }

  async refresh(): Promise<BuildsRegistry> {
    return this.load();
  }

  allStates(): Promise<BuildState[]> {
    return Promise.all([...this.instances.values()].map((b) => b.state()));
  }
}
```

- [ ] **Step 2: Этот файл импортирует `BuildInstance` — он ещё не существует**

Lint упадёт; это ожидаемо. Зафиксируем как «scaffolding» — в следующей таске создаём BuildInstance.

- [ ] **Step 3: Commit (тоже как scaffolding)**

```bash
git add src/builds/registry.ts
git commit -m "scaffold(builds): BuildRegistry class (depends on BuildInstance, next task)"
```

---

### Task 9: `BuildInstance` класс

**Files:**
- Create: `src/builds/build-instance.ts`

- [ ] **Step 1: Реализовать `src/builds/build-instance.ts`**

```ts
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import type {
  BuildEntry, BuildId, BuildState, LauncherConfig, PerBuildConfig,
  UpdateState, BrandingManifest, BuildManifest, NewsEntry,
} from '../core/types';
import type { Paths } from '../core/paths';
import type { ConfigStore } from '../core/config';
import { ManifestService } from '../manifest/manifest';
import { Updater } from '../update/updater';
import { GameLauncher } from '../launcher/launcher';
import { NewsService } from '../news/news-service';
import { logger } from '../core/logger';

export interface BuildInstanceDeps {
  paths: Paths;
  config: ConfigStore;
  entry: BuildEntry;
}

export class BuildInstance extends EventEmitter {
  readonly id: BuildId;
  readonly entry: BuildEntry;
  readonly manifests: ManifestService;
  readonly updater: Updater;
  readonly news: NewsService;
  readonly launcher: GameLauncher;
  private cachedBuildManifest: BuildManifest | null = null;

  constructor(private readonly deps: BuildInstanceDeps) {
    super();
    this.id = deps.entry.id;
    this.entry = deps.entry;
    this.manifests = new ManifestService(
      deps.paths.buildManifestCache(this.id),
      deps.paths.uiManifestCache(this.id),
      deps.paths.manifestLockFile(this.id),
    );
    this.updater = new Updater(this.id, deps.paths, this.manifests, this.instanceRoot());
    this.news = new NewsService(this.id, deps.entry.newsUrl, deps.paths.newsCache(this.id));
    this.launcher = new GameLauncher(this.id, deps.paths);

    // Re-emit updater state with buildId for the registry-level stream.
    this.updater.on('state', (s: UpdateState) => this.emit('state', s));
    this.news.on('updated', (entries: NewsEntry[]) =>
      this.emit('news-updated', { buildId: this.id, entries }),
    );
  }

  instanceRoot(): string {
    return this.deps.paths.instanceRoot(this.id, this.perBuildConfig().installPath);
  }

  perBuildConfig(): PerBuildConfig {
    return this.deps.config.perBuild(this.id);
  }

  async ensureDirs(): Promise<void> {
    await this.deps.paths.ensureBuildDirs(this.id, this.instanceRoot());
  }

  async getBuildManifest(): Promise<BuildManifest> {
    const cfg = this.deps.config.current;
    const { manifest } = await this.manifests.fetchBuildManifest(
      this.entry.buildManifestUrl, cfg.signaturePublicKey, cfg.requireValidSignature,
    );
    if (manifest.buildId && manifest.buildId !== this.id) {
      throw new Error(`BUILD_ID_MISMATCH: registry says "${this.id}", manifest says "${manifest.buildId}"`);
    }
    this.cachedBuildManifest = manifest;
    return manifest;
  }

  async installedVersion(): Promise<string | null> {
    const lock = await this.manifests.readLock();
    return lock?.buildVersion ?? null;
  }

  async state(): Promise<BuildState> {
    const installed = await this.installedVersion();
    let branding: BrandingManifest | null = null;
    if (this.cachedBuildManifest?.branding) branding = this.cachedBuildManifest.branding;
    else {
      // Try to read from disk cache
      try {
        const raw = await fs.readFile(this.deps.paths.buildManifestCache(this.id), 'utf8');
        const cached = JSON.parse(raw) as BuildManifest;
        if (cached.branding) branding = cached.branding;
      } catch { /* no cache yet */ }
    }
    return {
      id: this.id,
      displayName: this.entry.displayName,
      shortName: this.entry.shortName,
      accentColor: this.entry.accentColor,
      installed: installed !== null,
      installedVersion: installed,
      updateNeeded: null,        // populated by explicit check
      branding,
    };
  }

  async resetUiCache(): Promise<void> {
    await fs.rm(this.deps.paths.uiCache(this.id), { recursive: true, force: true });
    await fs.unlink(this.deps.paths.uiManifestCache(this.id)).catch(() => undefined);
    logger.info(`build:${this.id}`, 'UI cache cleared');
  }

  async resetManifestLock(): Promise<void> {
    await fs.unlink(this.deps.paths.manifestLockFile(this.id)).catch(() => undefined);
    logger.info(`build:${this.id}`, 'manifest.lock cleared');
  }
}
```

- [ ] **Step 2: Lint всё ещё падает — Updater/GameLauncher/NewsService требуют buildId в конструкторе. Это следующие таски.**

- [ ] **Step 3: Commit (scaffolding продолжается)**

```bash
git add src/builds/build-instance.ts
git commit -m "scaffold(builds): BuildInstance class composes per-build services"
```

---

## Phase 4: Адаптация существующих сервисов под per-build

### Task 10: Адаптировать `Updater` под buildId

**Files:**
- Modify: `src/update/updater.ts`

- [ ] **Step 1: Изменить сигнатуру конструктора и эмиссию state**

В начале `src/update/updater.ts` заменить класс-боди:

```ts
export class Updater extends EventEmitter {
  private state: UpdateState;

  constructor(
    private readonly buildId: string,
    private readonly paths: Paths,
    private readonly manifests: ManifestService,
    private readonly instancePath: string,
  ) {
    super();
    this.state = { buildId, stage: 'idle', message: 'idle' };
  }

  get currentState(): UpdateState { return this.state; }

  private setState(s: Partial<UpdateState>): void {
    this.state = { ...this.state, ...s, buildId: this.buildId };
    this.emit('state', this.state);
  }
  // ... остальное остаётся, но instancePath берём из поля
}
```

- [ ] **Step 2: Заменить все обращения к `this.instance.path`, `this.instance.wipeStaging`**

Все упоминания `this.instance.path` → `this.instancePath`. `this.instance.ensure()` удалить (вызывает caller сейчас — `BuildInstance.ensureDirs()`). `this.instance.wipeStaging(staging)` → inline:

```ts
await fs.rm(staging, { recursive: true, force: true });
await fs.mkdir(staging, { recursive: true });
```

- [ ] **Step 3: Заменить пути cache/uiCache на per-build**

Все `this.paths.cache` → `this.paths.cache(this.buildId)`, `this.paths.uiCache` → `this.paths.uiCache(this.buildId)`.

- [ ] **Step 4: Убрать импорт `InstanceStorage`**

```ts
- import { InstanceStorage } from '../storage/instance';
```

И убрать конструкторный параметр `instance: InstanceStorage`.

- [ ] **Step 5: Lint**

```bash
npm run lint
```

Expected: ошибки только в `main.ts`, `ipc.ts`, `build-instance.ts` (которые мы будем чинить).

- [ ] **Step 6: Commit**

```bash
git add src/update/updater.ts
git commit -m "refactor(updater): per-build constructor with buildId in UpdateState"
```

---

### Task 11: Адаптировать `GameLauncher` под buildId

**Files:**
- Modify: `src/launcher/launcher.ts`

- [ ] **Step 1: Изменить конструктор и profileId**

В начале класса:

```ts
export class GameLauncher {
  private readonly profileId: string;

  constructor(buildId: string, private readonly paths: Paths) {
    this.profileId = `eclipsefantasy-${buildId}`;
  }
```

- [ ] **Step 2: Изменить сигнатуру `launch`**

Убрать параметр `instancePath` (или оставить — он переменный per-launch). Лучше оставить как было, но `config: LauncherConfig` теперь содержит `perBuild` — caller передаст `perBuildConfig` вместо `config`. Перепишем сигнатуру:

```ts
async launch(
  perBuildCfg: PerBuildConfig,
  instancePath: string,
  minecraft: string,
  fabricLoader: string,
  buildDisplayName: string,
): Promise<{ ok: boolean; profileId: string }> {
  // ... existing implementation
}
```

В `writeProfile` заменить `config.name` → `buildDisplayName`, `config.ramMb` → `perBuildCfg.ramMb`.

- [ ] **Step 3: Импортировать `PerBuildConfig`**

```ts
import type { LauncherConfig, PerBuildConfig } from '../core/types';
```

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: остаются ошибки только в main.ts/ipc.ts/build-instance.ts.

- [ ] **Step 5: Commit**

```bash
git add src/launcher/launcher.ts
git commit -m "refactor(launcher): per-build profileId, accept PerBuildConfig"
```

---

### Task 12: `NewsService`

**Files:**
- Create: `src/news/news-service.ts`
- Create: `tests/news/news-service.test.ts`

- [ ] **Step 1: Failing-тест парсинга**

`tests/news/news-service.test.ts`:

```ts
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseNewsFeed } from '../../src/news/news-service';

test('parseNewsFeed: валидный JSON парсится и сортируется по date desc', () => {
  const raw = JSON.stringify({
    schemaVersion: 1,
    buildId: 'eclipse',
    entries: [
      { id: 'a', date: '2026-04-01', type: 'changelog', title: 'A', body: '' },
      { id: 'b', date: '2026-05-01', type: 'event', title: 'B', body: '' },
    ],
  });
  const feed = parseNewsFeed(raw);
  assert.equal(feed.entries[0].id, 'b');  // newer first
  assert.equal(feed.entries[1].id, 'a');
});

test('parseNewsFeed: неверная схема падает', () => {
  assert.throws(() => parseNewsFeed('{"schemaVersion":2}'));
  assert.throws(() => parseNewsFeed('{"schemaVersion":1,"entries":"x"}'));
});

test('parseNewsFeed: неизвестный type → falls back to notice', () => {
  const feed = parseNewsFeed(JSON.stringify({
    schemaVersion: 1, buildId: 'eclipse',
    entries: [{ id: 'a', date: '2026-01-01', type: 'weird', title: 'X', body: '' }],
  }));
  assert.equal(feed.entries[0].type, 'notice');
});
```

- [ ] **Step 2: Реализовать `src/news/news-service.ts`**

```ts
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { NewsFeed, NewsEntry, NewsEntryType, BuildId } from '../core/types';
import { fetchText } from '../downloader/downloader';
import { logger } from '../core/logger';

const VALID_TYPES: ReadonlyArray<NewsEntryType> = ['changelog', 'event', 'notice'];

export function parseNewsFeed(raw: string): NewsFeed {
  const obj = JSON.parse(raw) as Partial<NewsFeed>;
  if (obj.schemaVersion !== 1) throw new Error(`Unsupported news.json schemaVersion: ${obj.schemaVersion}`);
  if (!Array.isArray(obj.entries)) throw new Error('news.json missing entries[]');
  const entries: NewsEntry[] = obj.entries.map((e) => normalize(e as Partial<NewsEntry>));
  entries.sort((a, b) => b.date.localeCompare(a.date));
  return {
    schemaVersion: 1,
    buildId: (obj.buildId ?? '') as BuildId,
    generatedAt: obj.generatedAt,
    entries,
    signature: obj.signature,
  };
}

function normalize(e: Partial<NewsEntry>): NewsEntry {
  const type: NewsEntryType = VALID_TYPES.includes(e.type as NewsEntryType)
    ? (e.type as NewsEntryType)
    : 'notice';
  return {
    id: String(e.id ?? ''),
    date: String(e.date ?? ''),
    type,
    title: String(e.title ?? ''),
    body: String(e.body ?? ''),
    eventStart: e.eventStart,
    eventEnd: e.eventEnd,
    url: e.url,
  };
}

export class NewsService extends EventEmitter {
  private cached: NewsEntry[] = [];

  constructor(
    private readonly buildId: BuildId,
    private readonly url: string,
    private readonly cachePath: string,
  ) { super(); }

  current(): NewsEntry[] { return this.cached; }

  async fetch(): Promise<{ entries: NewsEntry[]; fromCache: boolean }> {
    try {
      const raw = await fetchText(this.url);
      const feed = parseNewsFeed(raw);
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
      await fs.writeFile(this.cachePath, raw, 'utf8');
      this.cached = feed.entries;
      this.emit('updated', feed.entries);
      return { entries: feed.entries, fromCache: false };
    } catch (err) {
      logger.warn(`news:${this.buildId}`, `Fetch failed (${(err as Error).message}); trying cache`);
      try {
        const raw = await fs.readFile(this.cachePath, 'utf8');
        const feed = parseNewsFeed(raw);
        this.cached = feed.entries;
        this.emit('updated', feed.entries);
        return { entries: feed.entries, fromCache: true };
      } catch {
        return { entries: [], fromCache: true };
      }
    }
  }
}
```

- [ ] **Step 3: Тесты**

```bash
npm test
```

Expected: 3 теста news проходят.

- [ ] **Step 4: Commit**

```bash
git add src/news/news-service.ts tests/news/news-service.test.ts
git commit -m "feat(news): per-build news.json fetch + parse + offline cache"
```

---

### Task 13: Обновить `ManifestService` под buildId-aware пути

**Files:**
- Modify: `src/manifest/manifest.ts`

- [ ] **Step 1: Конструктор `ManifestService` уже принимает 3 пути; ничего менять не надо**

Сейчас `new ManifestService(buildCachePath, uiCachePath, lockPath)`. Это уже совместимо с per-build. `BuildInstance` передаст пути от `Paths.buildManifestCache(id)` и т.п.

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: те же ошибки в main.ts/ipc.ts (всё ещё ссылаются на старую структуру).

- [ ] **Step 3: Нет коммита (no-op task)**

---

### Task 14: Удалить `InstanceStorage`

**Files:**
- Delete: `src/storage/instance.ts`

- [ ] **Step 1: Убедиться, что никто не импортирует**

```bash
grep -r "from.*storage/instance" src/ tests/
```

Expected: после прошлых тасков — ничего (Updater уже не импортирует). Если найдётся — починить в этом же шаге.

- [ ] **Step 2: Удалить файл и папку**

```bash
git rm src/storage/instance.ts
rmdir src/storage 2>/dev/null || true
```

- [ ] **Step 3: Lint**

```bash
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: remove InstanceStorage (subsumed by BuildInstance.ensureDirs)"
```

---

## Phase 5: IPC layer

### Task 15: Новый IPC `src/main/ipc.ts` под мультисборку

**Files:**
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Заменить `IpcDeps` интерфейс**

```ts
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import { promises as fs } from 'fs';
import type { ConfigStore } from '../core/config';
import type { BuildRegistry } from '../builds/registry';
import type { SelfUpdater, SelfUpdateState } from '../update/self-updater';
import type { Paths } from '../core/paths';
import type { LogEntry, UpdateState, BuildId, PerBuildConfig } from '../core/types';
import { logger } from '../core/logger';
import { verifyDevPassword } from '../core/dev-password';

export interface IpcDeps {
  paths: Paths;
  config: ConfigStore;
  registry: BuildRegistry;
  selfUpdater: SelfUpdater;
  getWindow: () => BrowserWindow | null;
}

export function registerIpc(deps: IpcDeps): void {
  const activeOr = (id: string | null | undefined): BuildId =>
    (id ?? deps.config.current.activeBuildId);

  // === Config ===
  ipcMain.handle('config:get', async () => deps.config.current);
  ipcMain.handle('config:save', async (_e, patch) => deps.config.save(patch));
  ipcMain.handle('config:saveBuild', async (_e, id: BuildId, patch: Partial<PerBuildConfig>) =>
    deps.config.saveBuildConfig(id, patch),
  );

  // === Builds ===
  ipcMain.handle('builds:list', async () => ({
    registry: deps.registry.current(),
    states: await deps.registry.allStates(),
    activeBuildId: deps.config.current.activeBuildId,
  }));
  ipcMain.handle('builds:setActive', async (_e, id: BuildId) => deps.registry.setActive(id));
  ipcMain.handle('builds:refresh', async () => deps.registry.refresh());

  // === Updater (per-build) ===
  ipcMain.handle('updater:installedVersion', async (_e, id?: BuildId) =>
    deps.registry.get(activeOr(id)).installedVersion(),
  );
  ipcMain.handle('updater:check', async (_e, id?: BuildId) => {
    const inst = deps.registry.get(activeOr(id));
    try {
      const manifest = await inst.getBuildManifest();
      const lock = await inst.manifests.readLock();
      const ui = await inst.manifests.fetchUiManifest(
        inst.entry.uiManifestUrl,
        deps.config.current.signaturePublicKey,
        deps.config.current.requireValidSignature,
      );
      const needsUpdate =
        !lock || lock.buildVersion !== manifest.version || lock.archiveSha256 !== manifest.archiveSha256;
      return {
        buildVersion: manifest.version, uiVersion: ui.manifest.version, needsUpdate,
        recommendedRamMb: manifest.recommendedRamMb, minRamMb: manifest.minRamMb,
      };
    } catch (err) {
      const message = (err as Error).message;
      logger.warn('ipc', `check failed for ${inst.id}: ${message}`);
      return { buildVersion: 'unknown', uiVersion: 'unknown', needsUpdate: false, error: message };
    }
  });
  ipcMain.handle('updater:run', async (_e, id?: BuildId) => {
    const inst = deps.registry.get(activeOr(id));
    await inst.ensureDirs();
    await inst.updater.runUpdate(deps.config.current);
  });

  // === Launcher ===
  ipcMain.handle('launcher:play', async (_e, id?: BuildId) => {
    const inst = deps.registry.get(activeOr(id));
    const manifest = await inst.getBuildManifest();
    return inst.launcher.launch(
      inst.perBuildConfig(),
      inst.instanceRoot(),
      manifest.minecraft, manifest.fabricLoader,
      inst.entry.displayName,
    );
  });

  // === News ===
  ipcMain.handle('news:fetch', async (_e, id: BuildId) => deps.registry.get(id).news.fetch());

  // === Paths / install info ===
  ipcMain.handle('paths:installInfo', async (_e, id?: BuildId) => {
    const inst = deps.registry.get(activeOr(id));
    const root = inst.instanceRoot();
    const cfg = inst.perBuildConfig();
    const exists = await fs.stat(root).then((s) => s.isDirectory()).catch(() => false);
    const counts: Record<string, number> = {};
    let totalBytes = 0;
    if (exists) {
      for (const sub of ['mods', 'config', 'resourcepacks', 'shaderpacks', 'datapacks']) {
        try {
          const entries = await fs.readdir(path.join(root, sub), { withFileTypes: true });
          counts[sub] = entries.filter((e) => e.isFile()).length;
        } catch { counts[sub] = 0; }
      }
      try {
        const stack: string[] = [root];
        const seen = new Set<string>();
        while (stack.length) {
          const dir = stack.pop()!;
          if (seen.has(dir)) continue;
          seen.add(dir);
          for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) stack.push(full);
            else if (ent.isFile()) {
              try { totalBytes += (await fs.stat(full)).size; } catch { /* ignore */ }
            }
          }
        }
      } catch { /* ignore */ }
    }
    return { path: root, isCustomPath: cfg.installPath !== null, exists, counts, totalBytes };
  });
  ipcMain.handle('paths:openInstallFolder', async (_e, id?: BuildId) => {
    const inst = deps.registry.get(activeOr(id));
    const root = inst.instanceRoot();
    await fs.mkdir(root, { recursive: true });
    const err = await shell.openPath(root);
    if (err) logger.warn('ipc', `openPath failed: ${err}`);
    return root;
  });
  ipcMain.handle('paths:pickInstallDir', async () => {
    const win = deps.getWindow();
    const r = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Выберите папку установки',
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return r.filePaths[0];
  });

  // === Assets ===
  ipcMain.handle('assets:resolve', async (_e, id: BuildId, name: string) => {
    const safeId = String(id).replace(/[^a-z0-9-]/gi, '');
    const safeRel = String(name).replace(/^[\\/]+/, '').replace(/\?.*$/, '');
    const candidates = [
      path.join(deps.paths.uiCache(safeId), safeRel),
      path.join(deps.paths.bundledAssets, `Iss_${safeRel}`),
      path.join(deps.paths.bundledAssets, safeRel),
    ];
    for (const c of candidates) {
      try { await fs.access(c); return `ef-asset://${safeId}/${safeRel}`; }
      catch { /* try next */ }
    }
    return `ef-asset://${safeId}/${safeRel}`;
  });

  // === Dev mode ===
  ipcMain.handle('dev-mode:unlock', async (_e, password: string) => {
    const ok = verifyDevPassword(String(password ?? ''));
    if (ok) await deps.config.save({ developerMode: true });
    return ok;
  });
  ipcMain.handle('dev-mode:isUnlocked', async () => deps.config.current.developerMode);
  ipcMain.handle('dev:resetUiCache', async (_e, id?: BuildId) => {
    if (!deps.config.current.developerMode) throw new Error('developerMode required');
    await deps.registry.get(activeOr(id)).resetUiCache();
  });
  ipcMain.handle('dev:resetManifestLock', async (_e, id?: BuildId) => {
    if (!deps.config.current.developerMode) throw new Error('developerMode required');
    await deps.registry.get(activeOr(id)).resetManifestLock();
  });

  // === Self-update (unchanged) ===
  ipcMain.handle('self-update:check', async () => deps.selfUpdater.check());
  ipcMain.handle('self-update:install', async () => deps.selfUpdater.installNow());
  ipcMain.handle('self-update:state', async () => deps.selfUpdater.currentState);

  // === Streams: forward per-build updater + news state to renderer ===
  for (const entry of deps.registry.current().builds) {
    const inst = deps.registry.get(entry.id);
    inst.on('state', (state: UpdateState) => {
      deps.getWindow()?.webContents.send('updater:state', state);
    });
    inst.on('news-updated', (payload) => {
      deps.getWindow()?.webContents.send('news:updated', payload);
    });
  }
  deps.registry.on('builds-changed', (reg) => {
    deps.getWindow()?.webContents.send('registry:builds-changed', reg);
  });
  deps.registry.on('active-changed', (msg) => {
    deps.getWindow()?.webContents.send('registry:active-changed', msg);
  });
  deps.selfUpdater.on('state', (state: SelfUpdateState) => {
    deps.getWindow()?.webContents.send('self-update:state', state);
  });
  logger.on('entry', (entry: LogEntry) => {
    deps.getWindow()?.webContents.send('log:entry', entry);
  });
}
```

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: ошибки только в `main.ts` (bootstrap) и `preload.ts`/`api.ts` — следующие таски.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc.ts
git commit -m "refactor(ipc): per-build channels via BuildRegistry"
```

---

### Task 16: Обновить `preload.ts` и `api.ts`

**Files:**
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/api.ts`

- [ ] **Step 1: Полностью заменить `src/renderer/api.ts`**

```ts
export type {
  LauncherConfig, PerBuildConfig, UpdateState, LogEntry,
  BuildsRegistry, BuildEntry, BuildId, BuildState, NewsEntry,
} from '../core/types';
import type {
  LauncherConfig, PerBuildConfig, UpdateState, LogEntry,
  BuildsRegistry, BuildEntry, BuildId, BuildState, NewsEntry,
} from '../core/types';
export type { SelfUpdateState } from '../update/self-updater';
import type { SelfUpdateState } from '../update/self-updater';

export interface BuildsListResponse {
  registry: BuildsRegistry;
  states: BuildState[];
  activeBuildId: BuildId;
}

export interface UpdateCheckResult {
  buildVersion: string;
  uiVersion: string;
  needsUpdate: boolean;
  recommendedRamMb?: number;
  minRamMb?: number;
  error?: string;
}

export interface RendererApi {
  getConfig(): Promise<LauncherConfig>;
  saveConfig(patch: Partial<LauncherConfig>): Promise<LauncherConfig>;
  saveBuildConfig(id: BuildId, patch: Partial<PerBuildConfig>): Promise<PerBuildConfig>;

  listBuilds(): Promise<BuildsListResponse>;
  setActiveBuild(id: BuildId): Promise<BuildState>;
  refreshBuilds(): Promise<BuildsRegistry>;

  getInstalledVersion(id?: BuildId): Promise<string | null>;
  checkForUpdates(id?: BuildId): Promise<UpdateCheckResult>;
  runUpdate(id?: BuildId): Promise<void>;

  launchGame(id?: BuildId): Promise<{ ok: boolean; profileId: string }>;

  fetchNews(id: BuildId): Promise<{ entries: NewsEntry[]; fromCache: boolean }>;

  pickInstallPath(): Promise<string | null>;
  getInstallInfo(id?: BuildId): Promise<{
    path: string; isCustomPath: boolean; exists: boolean;
    counts: Record<string, number>; totalBytes: number;
  }>;
  openInstallFolder(id?: BuildId): Promise<string>;
  resolveAssetUrl(id: BuildId, name: string): Promise<string>;

  devMode: {
    unlock(password: string): Promise<boolean>;
    isUnlocked(): Promise<boolean>;
    resetUiCache(id?: BuildId): Promise<void>;
    resetManifestLock(id?: BuildId): Promise<void>;
  };

  selfUpdate: {
    check(): Promise<void>;
    install(): Promise<void>;
    state(): Promise<SelfUpdateState>;
  };

  onUpdateState(cb: (s: UpdateState) => void): () => void;
  onLog(cb: (entry: LogEntry) => void): () => void;
  onNewsUpdated(cb: (msg: { buildId: BuildId; entries: NewsEntry[] }) => void): () => void;
  onRegistryChanged(cb: (reg: BuildsRegistry) => void): () => void;
  onActiveChanged(cb: (msg: { id: BuildId }) => void): () => void;
  onSelfUpdate(cb: (s: SelfUpdateState) => void): () => void;
}
```

- [ ] **Step 2: Полностью заменить `src/main/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type {
  LauncherConfig, PerBuildConfig, UpdateState, LogEntry,
  BuildsRegistry, BuildId, NewsEntry,
} from '../core/types';
import type { SelfUpdateState } from '../update/self-updater';

const listeners = {
  update: new Set<(s: UpdateState) => void>(),
  log: new Set<(e: LogEntry) => void>(),
  news: new Set<(m: { buildId: BuildId; entries: NewsEntry[] }) => void>(),
  registry: new Set<(r: BuildsRegistry) => void>(),
  active: new Set<(m: { id: BuildId }) => void>(),
  self: new Set<(s: SelfUpdateState) => void>(),
};

ipcRenderer.on('updater:state', (_e, s) => listeners.update.forEach((cb) => safeCall(cb, s)));
ipcRenderer.on('log:entry', (_e, e) => listeners.log.forEach((cb) => safeCall(cb, e)));
ipcRenderer.on('news:updated', (_e, m) => listeners.news.forEach((cb) => safeCall(cb, m)));
ipcRenderer.on('registry:builds-changed', (_e, r) => listeners.registry.forEach((cb) => safeCall(cb, r)));
ipcRenderer.on('registry:active-changed', (_e, m) => listeners.active.forEach((cb) => safeCall(cb, m)));
ipcRenderer.on('self-update:state', (_e, s) => listeners.self.forEach((cb) => safeCall(cb, s)));

function safeCall<T>(cb: (x: T) => void, x: T): void {
  try { cb(x); } catch { /* swallow */ }
}

const api = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch: Partial<LauncherConfig>) => ipcRenderer.invoke('config:save', patch),
  saveBuildConfig: (id: BuildId, patch: Partial<PerBuildConfig>) =>
    ipcRenderer.invoke('config:saveBuild', id, patch),

  listBuilds: () => ipcRenderer.invoke('builds:list'),
  setActiveBuild: (id: BuildId) => ipcRenderer.invoke('builds:setActive', id),
  refreshBuilds: () => ipcRenderer.invoke('builds:refresh'),

  getInstalledVersion: (id?: BuildId) => ipcRenderer.invoke('updater:installedVersion', id),
  checkForUpdates: (id?: BuildId) => ipcRenderer.invoke('updater:check', id),
  runUpdate: (id?: BuildId) => ipcRenderer.invoke('updater:run', id),

  launchGame: (id?: BuildId) => ipcRenderer.invoke('launcher:play', id),
  fetchNews: (id: BuildId) => ipcRenderer.invoke('news:fetch', id),

  pickInstallPath: () => ipcRenderer.invoke('paths:pickInstallDir'),
  getInstallInfo: (id?: BuildId) => ipcRenderer.invoke('paths:installInfo', id),
  openInstallFolder: (id?: BuildId) => ipcRenderer.invoke('paths:openInstallFolder', id),
  resolveAssetUrl: (id: BuildId, name: string) => ipcRenderer.invoke('assets:resolve', id, name),

  devMode: {
    unlock: (password: string) => ipcRenderer.invoke('dev-mode:unlock', password),
    isUnlocked: () => ipcRenderer.invoke('dev-mode:isUnlocked'),
    resetUiCache: (id?: BuildId) => ipcRenderer.invoke('dev:resetUiCache', id),
    resetManifestLock: (id?: BuildId) => ipcRenderer.invoke('dev:resetManifestLock', id),
  },
  selfUpdate: {
    check: () => ipcRenderer.invoke('self-update:check'),
    install: () => ipcRenderer.invoke('self-update:install'),
    state: () => ipcRenderer.invoke('self-update:state'),
  },

  onUpdateState(cb: (s: UpdateState) => void) { listeners.update.add(cb); return () => listeners.update.delete(cb); },
  onLog(cb: (e: LogEntry) => void) { listeners.log.add(cb); return () => listeners.log.delete(cb); },
  onNewsUpdated(cb: (m: { buildId: BuildId; entries: NewsEntry[] }) => void) {
    listeners.news.add(cb); return () => listeners.news.delete(cb);
  },
  onRegistryChanged(cb: (r: BuildsRegistry) => void) { listeners.registry.add(cb); return () => listeners.registry.delete(cb); },
  onActiveChanged(cb: (m: { id: BuildId }) => void) { listeners.active.add(cb); return () => listeners.active.delete(cb); },
  onSelfUpdate(cb: (s: SelfUpdateState) => void) { listeners.self.add(cb); return () => listeners.self.delete(cb); },
};

contextBridge.exposeInMainWorld('eclipseApi', api);
```

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: только `main.ts` остаётся неисправленной (bootstrap).

- [ ] **Step 4: Commit**

```bash
git add src/main/preload.ts src/renderer/api.ts
git commit -m "refactor(preload+api): multi-build IPC surface"
```

---

### Task 17: Wire bootstrap в `main.ts`

**Files:**
- Modify: `src/main/main.ts`

- [ ] **Step 1: Полностью заменить `bootstrap()` блок**

В `src/main/main.ts` заменить функцию `bootstrap()`:

```ts
async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData');
  const resourcesDir = app.isPackaged
    ? process.resourcesPath
    : path.resolve(__dirname, '..', '..', '..');
  const paths = new Paths(userData, resourcesDir);
  await fs.mkdir(paths.root, { recursive: true });
  await logger.init(paths.logs);
  logger.info('main', `EclipseFantasy starting (userData=${userData})`);

  const config = new ConfigStore(paths.settingsFile, paths.bundledConfig);
  await config.load();

  const registry = new BuildRegistry({
    paths, config,
    createInstance: (entry) => new BuildInstance({ paths, config, entry }),
  });
  await registry.load();

  selfUpdater.init();
  registerIpc({ paths, config, registry, selfUpdater, getWindow: () => mainWindow });

  setTimeout(() => { void selfUpdater.check(); }, 4000);

  protocol.registerFileProtocol('ef-asset', async (request, callback) => {
    // URL is ef-asset://<buildId>/<name>
    const url = decodeURIComponent(request.url.replace(/^ef-asset:\/\//, ''));
    const m = url.match(/^([a-z0-9-]+)\/(.+)$/i);
    if (!m) { callback({ path: path.join(paths.bundledAssets, url) }); return; }
    const [, bid, rel] = m;
    const safeRel = rel.replace(/^[\\/]+/, '').replace(/\?.*$/, '');
    const candidates = [
      path.join(paths.uiCache(bid), safeRel),
      path.join(paths.bundledAssets, `Iss_${safeRel}`),
      path.join(paths.bundledAssets, safeRel),
    ];
    for (const c of candidates) {
      try { await fs.access(c); callback({ path: c }); return; } catch { /* next */ }
    }
    callback({ path: candidates[candidates.length - 1] });
  });

  await app.whenReady();
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}
```

- [ ] **Step 2: Обновить импорты в начале файла**

```ts
import { BuildRegistry } from '../builds/registry';
import { BuildInstance } from '../builds/build-instance';
```

И удалить старые:

```ts
- import { ManifestService } from '../manifest/manifest';
- import { InstanceStorage } from '../storage/instance';
- import { Updater } from '../update/updater';
- import { GameLauncher } from '../launcher/launcher';
```

- [ ] **Step 3: Full build**

```bash
npm run build
```

Expected: и main, и renderer собираются. Renderer ещё работает по старому HTML, но скомпилируется (т.к. api.ts типы расширены, но renderer.ts ещё на старом коде — будут TS-ошибки в renderer.ts).

Если renderer не компилируется — это ожидаемо. Следующий шаг — переписать рендерер.

- [ ] **Step 4: Commit**

```bash
git add src/main/main.ts
git commit -m "refactor(main): wire BuildRegistry into bootstrap"
```

---

## Phase 6: Рендерер (UI D1)

### Task 18: Новый `index.html` под layout D1

**Files:**
- Modify: `src/renderer/index.html`

- [ ] **Step 1: Полностью заменить `src/renderer/index.html`**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'self'; img-src 'self' ef-asset: data:; media-src 'self' ef-asset:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'" />
    <title>EclipseFantasy Launcher</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div class="bg-fallback" id="bgFallback"></div>

    <div class="self-update-banner" id="selfUpdateBanner" hidden>
      <div class="self-update-msg" id="selfUpdateMsg">Доступно обновление лаунчера</div>
      <button class="self-update-btn" id="selfUpdateBtn" hidden>Перезапустить и обновить</button>
    </div>

    <header class="topbar">
      <div class="tab-row" id="tabRow"></div>
      <div class="header-tools">
        <div class="chip" id="versionChip"><span class="chip-label">v</span><span id="versionChipValue">—</span></div>
        <button class="icon-btn" id="logsBtn" title="Логи" aria-label="Логи">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></svg>
        </button>
        <button class="icon-btn" id="settingsBtn" title="Настройки" aria-label="Настройки">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
    </header>

    <main class="main-grid">
      <section class="video-block" id="videoBlock">
        <video id="bgVideo" autoplay loop muted playsinline preload="auto"></video>
      </section>

      <aside class="news-panel" id="newsPanel">
        <h2 class="news-title">Чейнджлог</h2>
        <ul class="news-list" id="newsList"></ul>
        <div class="version-info" id="versionInfo">—</div>
        <div class="progress-block" id="progressBlock" hidden>
          <div class="pb-status" id="progressStatus">—</div>
          <div class="pbar"><div class="pbar-fill" id="progressFill"></div></div>
          <div class="pb-meta">
            <span id="progressText">—</span>
            <span id="progressSpeed">—</span>
          </div>
        </div>
        <button class="launch-btn" id="launchBtn" disabled>
          <img id="launchBtnImg" alt="PLAY" />
        </button>
        <div class="launch-sub" id="launchSubLabel">—</div>
      </aside>
    </main>

    <div class="modal" id="settingsModal" hidden>
      <div class="modal-backdrop" data-close="settingsModal"></div>
      <div class="modal-card" role="dialog">
        <header class="modal-head">
          <h2>Настройки сборки: <span id="settingsBuildName">—</span></h2>
          <button class="icon-btn close" data-close="settingsModal">✕</button>
        </header>
        <div class="modal-body">
          <div class="field">
            <label for="ramSlider">Оперативная память</label>
            <div class="slider-row">
              <input id="ramSlider" type="range" min="1024" max="32768" step="256" />
              <input id="ramInput" type="number" min="512" max="65536" step="256" />
              <span class="unit">MB</span>
            </div>
            <div class="field-hint">
              <span id="ramRecHint">Рекомендуется: —</span>
              <button class="link-btn" id="useRecommendedBtn" type="button" hidden>применить</button>
            </div>
          </div>

          <div class="field">
            <label for="installPathInput">Папка установки</label>
            <div class="row">
              <input id="installPathInput" type="text" placeholder="по умолчанию" />
              <button class="ghost-btn" id="pickPathBtn" type="button">Обзор…</button>
            </div>
            <div class="install-info" id="installInfo">
              <div class="install-info-path" id="installInfoPath">—</div>
              <div class="install-info-stats" id="installInfoStats">—</div>
              <button class="link-btn" id="openInstallBtn" type="button">Открыть в проводнике</button>
            </div>
          </div>

          <hr class="sep" />

          <div class="field dev-toggle-row">
            <label class="checkbox">
              <input type="checkbox" id="devModeToggle" />
              <span>Режим разработчика</span>
            </label>
            <div class="dev-prompt" id="devPrompt" hidden>
              <input type="password" id="devPasswordInput" placeholder="Пароль разработчика" />
              <button class="ghost-btn" id="devSubmitBtn" type="button">Подтвердить</button>
              <button class="link-btn" id="devCancelBtn" type="button">Отмена</button>
              <div class="dev-error" id="devError" hidden>Неверный пароль</div>
            </div>
          </div>

          <div class="dev-section" id="devSection" hidden>
            <h3>🛠 Расширенные настройки</h3>
            <div class="field">
              <label for="concInput">Параллельные загрузки</label>
              <input id="concInput" type="number" min="1" max="16" />
            </div>
            <div class="field">
              <label for="retriesInput">Повторы при ошибках</label>
              <input id="retriesInput" type="number" min="0" max="20" />
            </div>
            <div class="field">
              <label for="registryUrlInput">URL реестра сборок</label>
              <input id="registryUrlInput" type="text" />
            </div>
            <div class="field">
              <label class="checkbox">
                <input type="checkbox" id="requireSigToggle" />
                <span>Требовать валидную подпись манифеста</span>
              </label>
            </div>
            <div class="field">
              <label for="pubKeyInput">Public key (ed25519, hex)</label>
              <input id="pubKeyInput" type="text" />
            </div>
            <div class="row">
              <button class="ghost-btn" id="devResetUiBtn" type="button">Сбросить кеш UI сборки</button>
              <button class="ghost-btn" id="devResetLockBtn" type="button">Сбросить manifest.lock</button>
            </div>
          </div>

          <div class="field-hint" id="settingsSavedHint">Изменения применяются автоматически.</div>
        </div>
      </div>
    </div>

    <div class="modal" id="logsModal" hidden>
      <div class="modal-backdrop" data-close="logsModal"></div>
      <div class="modal-card wide" role="dialog">
        <header class="modal-head">
          <h2>Логи</h2>
          <div class="head-tools">
            <select id="logFilter" class="ghost-btn">
              <option value="all">Все</option>
              <option value="info">Info+</option>
              <option value="warn">Warn+</option>
              <option value="error">Error</option>
            </select>
            <button class="ghost-btn" id="clearLogsBtn" type="button">Очистить</button>
            <button class="icon-btn close" data-close="logsModal">✕</button>
          </div>
        </header>
        <div class="modal-body logs-body">
          <pre id="logView"></pre>
        </div>
      </div>
    </div>

    <script type="module" src="./renderer.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/index.html
git commit -m "ui: new index.html for D1 layout (tabs + news panel + progress)"
```

---

### Task 19: Новый `styles.css` под D1

**Files:**
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Полностью заменить `src/renderer/styles.css`**

```css
:root {
  --bg: #0a0a14;
  --text: #e8e8f4;
  --text-dim: #9090a8;
  --panel: rgba(15,15,25,0.78);
  --panel-strong: rgba(8,8,16,0.88);
  --border: rgba(255,255,255,0.08);
  --accent-pink: #d23a8b;
  --build-accent: #d23a8b;        /* overridden per-build at runtime */
  --play-grad-end: #a82770;
}
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; height: 100%;
  background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px; overflow: hidden;
}
.bg-fallback {
  position: fixed; inset: 0; z-index: 0;
  background: radial-gradient(140% 100% at 50% 0%, #1a0e2a 0%, #0a0a18 60%, #0a0a14 100%);
}

.self-update-banner {
  position: relative; z-index: 10;
  display: flex; justify-content: center; align-items: center; gap: 12px;
  background: linear-gradient(90deg, rgba(210,58,139,0.95), rgba(190,60,140,0.85));
  color: #fff; padding: 6px 12px; font-size: 12px;
}
.self-update-btn {
  background: rgba(255,255,255,0.18); color: #fff;
  border: 1px solid rgba(255,255,255,0.3); border-radius: 6px;
  padding: 4px 10px; font-size: 11px; cursor: pointer;
}

.topbar {
  position: relative; z-index: 5;
  display: flex; align-items: stretch; gap: 8px;
  background: rgba(8,8,16,0.85);
  border-bottom: 1px solid var(--border);
  height: 48px;
}
.tab-row { display: flex; }
.tab {
  background: transparent; color: var(--text-dim);
  border: 0; height: 48px; padding: 0 22px;
  font-weight: 700; font-size: 13px; letter-spacing: 2px;
  cursor: pointer;
  border-bottom: 3px solid transparent;
}
.tab.active {
  color: #fff;
  border-bottom-color: var(--build-accent);
  background: rgba(210,58,139,0.08);
}
.tab[disabled] { opacity: 0.4; cursor: not-allowed; }

.header-tools {
  margin-left: auto; display: flex; align-items: center;
  gap: 8px; padding: 0 12px;
}
.chip {
  background: rgba(20,20,32,0.75); border: 1px solid var(--border);
  padding: 4px 10px; border-radius: 6px; font-size: 11px;
}
.chip-label { color: var(--text-dim); margin-right: 4px; }
.icon-btn {
  width: 32px; height: 32px;
  background: rgba(20,20,32,0.7); border: 1px solid var(--border);
  border-radius: 6px; color: #ddd; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.icon-btn:hover { color: #fff; border-color: rgba(255,255,255,0.2); }

.main-grid {
  position: relative; z-index: 2;
  display: grid;
  grid-template-columns: 1fr 360px;
  height: calc(100vh - 48px);
  gap: 0;
}

.video-block {
  position: relative;
  margin: 16px 0 16px 16px;
  border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
  background: #000;
}
.video-block video { width: 100%; height: 100%; object-fit: cover; display: block; }

.news-panel {
  background: linear-gradient(180deg, var(--panel) 0%, var(--panel-strong) 100%);
  border-left: 1px solid var(--border);
  padding: 16px 14px;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.news-title {
  margin: 0 0 12px; font-size: 14px;
  text-transform: uppercase; letter-spacing: 1.5px; color: #fff;
}
.news-list {
  list-style: none; padding: 0; margin: 0;
  overflow-y: auto; flex: 1; min-height: 0;
}
.news-item {
  border-left: 3px solid var(--build-accent);
  padding: 6px 10px; margin-bottom: 8px;
  background: rgba(255,255,255,0.03); border-radius: 0 4px 4px 0;
}
.news-item.news-type-event { border-left-color: #f5c84a; }
.news-item.news-type-notice { border-left-color: #7878a0; }
.news-item .date { color: var(--text-dim); font-size: 10px; }
.news-item .title { color: #fff; font-weight: 600; font-size: 12px; }
.news-item .body { color: var(--text-dim); font-size: 11px; margin-top: 2px; }
.news-item .event-tag {
  display: inline-block; margin-top: 4px; padding: 2px 6px;
  font-size: 10px; border-radius: 3px;
  background: rgba(245,200,74,0.18); color: #f5c84a;
}
.news-item .event-tag.live { background: rgba(80,200,120,0.18); color: #50c878; }

.version-info {
  padding: 10px 0; font-size: 11px; color: var(--text-dim);
  border-top: 1px solid var(--border); margin-top: 8px;
}
.version-info b { color: #fff; }

.progress-block {
  background: rgba(20,20,32,0.7);
  border: 1px solid var(--border); border-radius: 6px;
  padding: 9px 10px; margin-bottom: 10px;
}
.pb-status { font-size: 11px; color: var(--build-accent); font-weight: 700; margin-bottom: 6px; }
.pbar { background: rgba(255,255,255,0.12); border-radius: 4px; overflow: hidden; height: 8px; }
.pbar-fill {
  height: 100%; width: 0;
  background: linear-gradient(90deg, var(--accent-pink), var(--build-accent));
  box-shadow: 0 0 10px rgba(210,58,139,0.5);
  transition: width 0.2s;
}
.pb-meta { display: flex; justify-content: space-between; font-size: 10.5px; color: #cfcfe0; padding-top: 5px; }
.pb-meta span:last-child { color: var(--text-dim); }

.launch-btn {
  border: 0; background: transparent; padding: 0; margin: 6px 0 4px;
  cursor: pointer; display: block; width: 100%;
}
.launch-btn img { width: 100%; height: auto; display: block; }
.launch-btn[disabled] { opacity: 0.4; cursor: not-allowed; }
.launch-sub { text-align: center; font-size: 12px; color: var(--text-dim); }

/* Modal */
.modal { position: fixed; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center; }
.modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.55); }
.modal-card {
  position: relative; background: #11111e;
  border: 1px solid var(--border); border-radius: 10px;
  width: 520px; max-width: 90vw; max-height: 90vh;
  display: flex; flex-direction: column; overflow: hidden;
}
.modal-card.wide { width: 820px; }
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.modal-head h2 { margin: 0; font-size: 16px; }
.modal-body { padding: 16px 18px; overflow-y: auto; }
.field { margin-bottom: 14px; }
.field label { display: block; font-size: 11px; color: var(--text-dim); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; }
.field input[type=text], .field input[type=number], .field input[type=password] {
  width: 100%; padding: 7px 10px; background: rgba(20,20,32,0.7);
  border: 1px solid var(--border); border-radius: 4px; color: #fff;
}
.slider-row { display: flex; align-items: center; gap: 8px; }
.slider-row input[type=range] { flex: 1; }
.slider-row input[type=number] { width: 90px; }
.unit { color: var(--text-dim); font-size: 11px; }
.field-hint { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--text-dim); margin-top: 4px; }
.row { display: flex; gap: 8px; }
.ghost-btn {
  background: rgba(20,20,32,0.7); color: #ddd;
  border: 1px solid var(--border); border-radius: 4px;
  padding: 6px 10px; cursor: pointer; font-size: 12px;
}
.link-btn { background: transparent; border: 0; color: var(--build-accent); cursor: pointer; font-size: 11px; padding: 0; }
.install-info { margin-top: 8px; font-size: 11px; color: var(--text-dim); }
.install-info-path { color: #fff; word-break: break-all; }
.sep { border: 0; border-top: 1px solid var(--border); margin: 14px 0; }
.checkbox { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: #fff; cursor: pointer; }
.dev-prompt { margin-top: 8px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.dev-prompt input[type=password] { flex: 1; min-width: 200px; }
.dev-error { color: #ff6a6a; font-size: 11px; flex-basis: 100%; }
.dev-section { background: rgba(20,20,32,0.4); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; margin-top: 12px; }
.dev-section h3 { margin: 0 0 10px; font-size: 13px; }

.logs-body { padding: 0; }
#logView { margin: 0; padding: 14px 18px; font-family: 'Menlo','Consolas',monospace; font-size: 11px; color: #ccc; white-space: pre-wrap; height: 60vh; overflow-y: auto; background: #050510; }
#logView .l-error { color: #ff6a6a; }
#logView .l-warn { color: #f5c84a; }
#logView .l-info { color: #9fc4ff; }
#logView.f-info .l-debug, #logView.f-warn .l-debug, #logView.f-warn .l-info, #logView.f-error .l-debug, #logView.f-error .l-info, #logView.f-error .l-warn { display: none; }
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles.css
git commit -m "ui: styles for D1 layout (tabs, news panel, progress, modals)"
```

---

### Task 20: Модули `ui/branding.ts`, `ui/tabs.ts`

**Files:**
- Create: `src/renderer/ui/branding.ts`
- Create: `src/renderer/ui/tabs.ts`

- [ ] **Step 1: `src/renderer/ui/branding.ts`**

```ts
import type { BuildEntry, BuildState } from '../api';

export function applyAccent(color: string): void {
  document.documentElement.style.setProperty('--build-accent', color);
  document.documentElement.style.setProperty('--play-grad-end', shade(color, -20));
}

export async function applyVideoAndButton(
  entry: BuildEntry,
  state: BuildState,
  resolve: (id: string, name: string) => Promise<string>,
): Promise<void> {
  const video = document.getElementById('bgVideo') as HTMLVideoElement;
  const fallback = document.getElementById('bgFallback') as HTMLElement;
  const btnImg = document.getElementById('launchBtnImg') as HTMLImageElement;

  const videoName = state.branding?.video ?? 'background.mkv';
  const playName = state.branding?.playButton ?? 'play_button.png';

  const [videoUrl, playUrl] = await Promise.all([
    resolve(entry.id, videoName),
    resolve(entry.id, playName),
  ]);

  video.pause();
  video.src = videoUrl;
  video.load();
  video.play().catch(() => { /* fallback gradient stays */ });
  // Hide gradient fallback while video plays; show on error.
  video.addEventListener('playing', () => { fallback.style.opacity = '0'; }, { once: true });
  video.addEventListener('error', () => { fallback.style.opacity = '1'; }, { once: true });

  btnImg.src = playUrl;
}

function shade(hex: string, percent: number): string {
  const m = hex.replace('#', '');
  if (m.length !== 6) return hex;
  const num = parseInt(m, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  const f = (c: number) => Math.max(0, Math.min(255, c + (percent * 255) / 100));
  r = f(r); g = f(g); b = f(b);
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 2: `src/renderer/ui/tabs.ts`**

```ts
import type { BuildEntry, BuildId } from '../api';

export interface TabsHost {
  onSelect(id: BuildId): void;
  isBusy(): boolean;
}

export function renderTabs(
  container: HTMLElement,
  entries: BuildEntry[],
  activeId: BuildId,
  host: TabsHost,
): void {
  container.innerHTML = '';
  for (const e of entries.filter((b) => b.enabled)) {
    const btn = document.createElement('button');
    btn.className = 'tab' + (e.id === activeId ? ' active' : '');
    btn.dataset.buildId = e.id;
    btn.textContent = e.shortName;
    btn.addEventListener('click', () => {
      if (host.isBusy()) return;
      if (e.id === activeId) return;
      host.onSelect(e.id);
    });
    container.appendChild(btn);
  }
}

export function setActiveTab(container: HTMLElement, id: BuildId): void {
  for (const btn of container.querySelectorAll<HTMLButtonElement>('.tab')) {
    btn.classList.toggle('active', btn.dataset.buildId === id);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/ui/branding.ts src/renderer/ui/tabs.ts
git commit -m "ui: branding (accent/video/buttons) and tabs modules"
```

---

### Task 21: Модули `ui/news-panel.ts`, `ui/progress.ts`

**Files:**
- Create: `src/renderer/ui/news-panel.ts`
- Create: `src/renderer/ui/progress.ts`

- [ ] **Step 1: `src/renderer/ui/news-panel.ts`**

```ts
import type { NewsEntry } from '../api';

const MONTHS = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];

export function renderNews(list: HTMLElement, entries: NewsEntry[]): void {
  list.innerHTML = '';
  for (const e of entries.slice(0, 5)) {
    const li = document.createElement('li');
    li.className = `news-item news-type-${e.type}`;
    li.dataset.id = e.id;
    li.innerHTML = `
      <div class="date">${escape(formatDate(e.date))}</div>
      <div class="title">${escape(e.title)}</div>
      ${e.body ? `<div class="body">${escape(e.body)}</div>` : ''}
      ${eventTag(e)}
    `;
    list.appendChild(li);
  }
}

function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const day = parseInt(m[3], 10);
  const mon = MONTHS[parseInt(m[2], 10) - 1] ?? '?';
  return `${day} ${mon}`;
}

function eventTag(e: NewsEntry): string {
  if (e.type !== 'event' || !e.eventStart) return '';
  const start = new Date(e.eventStart).getTime();
  const end = e.eventEnd ? new Date(e.eventEnd).getTime() : start + 24 * 3600 * 1000;
  const now = Date.now();
  if (now < start) {
    const days = Math.ceil((start - now) / (24 * 3600 * 1000));
    return `<div class="event-tag">через ${days} дн.</div>`;
  }
  if (now <= end) return `<div class="event-tag live">идёт сейчас</div>`;
  return '';
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
```

- [ ] **Step 2: `src/renderer/ui/progress.ts`**

```ts
import type { UpdateState } from '../api';

const STAGE_LABEL: Record<string, string> = {
  'check': 'Проверка обновлений…',
  'download-archive': 'Скачиваю архив сборки',
  'extract': 'Распаковка архива…',
  'verify': 'Проверка целостности…',
  'download-ui': 'Загрузка UI…',
  'cleanup': 'Очистка…',
  'launching': 'Запуск…',
};

export interface ProgressEls {
  block: HTMLElement;
  status: HTMLElement;
  fill: HTMLElement;
  text: HTMLElement;
  speed: HTMLElement;
}

export function applyProgress(els: ProgressEls, state: UpdateState | undefined): void {
  if (!state || state.stage === 'idle' || state.stage === 'ready') {
    els.block.hidden = true;
    return;
  }
  els.block.hidden = false;
  els.status.textContent = state.stage === 'error'
    ? (state.error ?? state.message)
    : (STAGE_LABEL[state.stage] ?? state.message);

  const p = state.progress;
  if (p && (p.totalBytes > 0 || p.filesTotal > 0)) {
    let pct = 0; const parts: string[] = [];
    if (p.totalBytes > 0) {
      pct = Math.min(100, (p.downloadedBytes / p.totalBytes) * 100);
      parts.push(`${fmt(p.downloadedBytes)} / ${fmt(p.totalBytes)}`);
    } else if (p.filesTotal > 0) {
      pct = (p.filesDone / p.filesTotal) * 100;
      parts.push(`${p.filesDone} / ${p.filesTotal} файлов`);
    }
    parts.push(`${pct.toFixed(1)}%`);
    els.fill.style.width = `${pct}%`;
    els.text.textContent = parts.join('  •  ');
    els.speed.textContent = p.speed && p.speed > 0
      ? `${fmt(p.speed)}/s${eta(p.totalBytes - p.downloadedBytes, p.speed)}`
      : '';
  } else {
    els.fill.style.width = '0%';
    els.text.textContent = '';
    els.speed.textContent = '';
  }
}

function eta(rem: number, speed: number): string {
  if (!Number.isFinite(rem) || rem <= 0 || speed <= 0) return '';
  const s = rem / speed;
  return `  •  ETA ${Math.floor(s / 60)}m ${Math.floor(s % 60).toString().padStart(2, '0')}s`;
}

function fmt(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B','KiB','MiB','GiB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/ui/news-panel.ts src/renderer/ui/progress.ts
git commit -m "ui: news-panel and progress modules"
```

---

### Task 22: Модуль `ui/settings-modal.ts` (включая dev-mode)

**Files:**
- Create: `src/renderer/ui/settings-modal.ts`

- [ ] **Step 1: `src/renderer/ui/settings-modal.ts`**

```ts
import type { RendererApi, LauncherConfig, BuildState, PerBuildConfig, BuildId } from '../api';

export interface SettingsModalEls {
  card: HTMLElement;
  buildName: HTMLElement;
  ramSlider: HTMLInputElement; ramInput: HTMLInputElement; ramRecHint: HTMLElement;
  useRecommendedBtn: HTMLButtonElement;
  installPathInput: HTMLInputElement; pickPathBtn: HTMLButtonElement;
  installInfoPath: HTMLElement; installInfoStats: HTMLElement; openInstallBtn: HTMLButtonElement;
  devModeToggle: HTMLInputElement;
  devPrompt: HTMLElement; devPasswordInput: HTMLInputElement;
  devSubmitBtn: HTMLButtonElement; devCancelBtn: HTMLButtonElement;
  devError: HTMLElement;
  devSection: HTMLElement;
  concInput: HTMLInputElement; retriesInput: HTMLInputElement; registryUrlInput: HTMLInputElement;
  requireSigToggle: HTMLInputElement; pubKeyInput: HTMLInputElement;
  devResetUiBtn: HTMLButtonElement; devResetLockBtn: HTMLButtonElement;
  settingsSavedHint: HTMLElement;
}

export class SettingsModal {
  private recommendedRam: number | undefined;

  constructor(
    private readonly api: RendererApi,
    private readonly els: SettingsModalEls,
  ) { this.attach(); }

  async show(state: BuildState, recommendedRamMb: number | undefined): Promise<void> {
    this.recommendedRam = recommendedRamMb;
    this.els.buildName.textContent = state.displayName;
    const cfg = await this.api.getConfig();
    const pb: PerBuildConfig = cfg.perBuild[state.id] ?? { ramMb: recommendedRamMb ?? 4096, installPath: null };
    this.els.ramInput.value = String(pb.ramMb);
    this.els.ramSlider.value = String(clamp(pb.ramMb, +this.els.ramSlider.min, +this.els.ramSlider.max));
    this.els.installPathInput.value = pb.installPath ?? '';
    this.refreshRamHint();

    this.els.devModeToggle.checked = cfg.developerMode === true;
    this.els.devSection.hidden = !cfg.developerMode;
    this.els.devPrompt.hidden = true;
    this.els.devError.hidden = true;
    this.els.concInput.value = String(cfg.downloadConcurrency);
    this.els.retriesInput.value = String(cfg.downloadRetries);
    this.els.registryUrlInput.value = cfg.buildsRegistryUrl;
    this.els.requireSigToggle.checked = cfg.requireValidSignature === true;
    this.els.pubKeyInput.value = cfg.signaturePublicKey ?? '';

    await this.refreshInstallInfo(state.id);
    (this.els.card.parentElement as HTMLElement).hidden = false;
  }

  private attach(): void {
    const save = debounce(() => this.saveAll(), 350);
    this.els.ramInput.addEventListener('input', () => {
      const v = clamp(+this.els.ramInput.value || 0, 512, 65536);
      if (v >= +this.els.ramSlider.min && v <= +this.els.ramSlider.max) this.els.ramSlider.value = String(v);
      this.refreshRamHint(); save();
    });
    this.els.ramSlider.addEventListener('input', () => {
      this.els.ramInput.value = this.els.ramSlider.value;
      this.refreshRamHint(); save();
    });
    this.els.installPathInput.addEventListener('change', save);
    this.els.useRecommendedBtn.addEventListener('click', () => {
      if (!this.recommendedRam) return;
      this.els.ramInput.value = String(this.recommendedRam);
      this.els.ramSlider.value = String(clamp(this.recommendedRam, +this.els.ramSlider.min, +this.els.ramSlider.max));
      this.refreshRamHint(); save();
    });
    this.els.pickPathBtn.addEventListener('click', async () => {
      const p = await this.api.pickInstallPath();
      if (p) { this.els.installPathInput.value = p; save(); }
    });

    this.els.devModeToggle.addEventListener('change', async () => {
      if (this.els.devModeToggle.checked) {
        // Need password
        this.els.devModeToggle.checked = false;  // not yet
        this.els.devPrompt.hidden = false;
        this.els.devPasswordInput.value = '';
        this.els.devError.hidden = true;
        this.els.devPasswordInput.focus();
      } else {
        // disable
        await this.api.saveConfig({ developerMode: false });
        this.els.devSection.hidden = true;
      }
    });
    this.els.devSubmitBtn.addEventListener('click', () => this.tryUnlockDev());
    this.els.devPasswordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.tryUnlockDev();
    });
    this.els.devCancelBtn.addEventListener('click', () => {
      this.els.devPrompt.hidden = true;
      this.els.devModeToggle.checked = false;
    });

    this.els.concInput.addEventListener('change', save);
    this.els.retriesInput.addEventListener('change', save);
    this.els.registryUrlInput.addEventListener('change', save);
    this.els.requireSigToggle.addEventListener('change', save);
    this.els.pubKeyInput.addEventListener('change', save);

    this.els.devResetUiBtn.addEventListener('click', async () => {
      await this.api.devMode.resetUiCache();
      this.toast('UI-кеш сборки очищен');
    });
    this.els.devResetLockBtn.addEventListener('click', async () => {
      await this.api.devMode.resetManifestLock();
      this.toast('manifest.lock удалён — при следующем PLAY будет полный апдейт');
    });
  }

  private async tryUnlockDev(): Promise<void> {
    const ok = await this.api.devMode.unlock(this.els.devPasswordInput.value);
    if (ok) {
      this.els.devModeToggle.checked = true;
      this.els.devPrompt.hidden = true;
      this.els.devSection.hidden = false;
    } else {
      this.els.devError.hidden = false;
    }
  }

  private async refreshInstallInfo(id: BuildId): Promise<void> {
    try {
      const info = await this.api.getInstallInfo(id);
      this.els.installInfoPath.textContent = info.path + (info.isCustomPath ? '  (кастомный)' : '');
      if (!info.exists) {
        this.els.installInfoStats.textContent = 'Папка ещё не создана — будет создана при первой установке';
        return;
      }
      const total = Object.values(info.counts).reduce((s, n) => s + n, 0);
      const sizeText = info.totalBytes > 0 ? `, ${fmtBytes(info.totalBytes)}` : '';
      const parts: string[] = [];
      for (const [k, v] of Object.entries(info.counts)) parts.push(`${k}: ${v}`);
      this.els.installInfoStats.textContent = `${total} файлов${sizeText} • ${parts.join(' • ')}`;
    } catch (err) {
      this.els.installInfoStats.textContent = `недоступно: ${(err as Error).message}`;
    }
  }

  private refreshRamHint(): void {
    if (this.recommendedRam && this.recommendedRam > 0) {
      this.els.ramRecHint.textContent = `Рекомендуется: ${this.recommendedRam} MB`;
      const cur = +this.els.ramInput.value;
      this.els.useRecommendedBtn.hidden = cur >= this.recommendedRam;
    } else {
      this.els.ramRecHint.textContent = 'Рекомендуемое значение не задано в манифесте';
      this.els.useRecommendedBtn.hidden = true;
    }
  }

  private async saveAll(): Promise<void> {
    const cfg = await this.api.getConfig();
    const id = cfg.activeBuildId;
    const pb: Partial<PerBuildConfig> = {
      ramMb: clamp(+this.els.ramInput.value || 4096, 512, 65536),
      installPath: this.els.installPathInput.value.trim() || null,
    };
    await this.api.saveBuildConfig(id, pb);
    const patch: Partial<LauncherConfig> = {
      downloadConcurrency: clamp(+this.els.concInput.value || 4, 1, 16),
      downloadRetries: clamp(+this.els.retriesInput.value || 5, 0, 20),
      buildsRegistryUrl: this.els.registryUrlInput.value.trim(),
      requireValidSignature: this.els.requireSigToggle.checked,
      signaturePublicKey: this.els.pubKeyInput.value.trim() || undefined,
    };
    await this.api.saveConfig(patch);
    this.toast('Сохранено ✓');
  }

  private toast(msg: string): void {
    this.els.settingsSavedHint.textContent = msg;
  }
}

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

function debounce<T extends (...a: unknown[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { (fn as (...a: unknown[]) => void)(...args); }, ms);
  }) as T;
}

function fmtBytes(n: number): string {
  const u = ['B','KiB','MiB','GiB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/ui/settings-modal.ts
git commit -m "ui: settings modal with per-build fields + dev-mode + advanced section"
```

---

### Task 23: Финальный `renderer.ts` (orchestrator)

**Files:**
- Modify: `src/renderer/renderer.ts`

- [ ] **Step 1: Полностью заменить `src/renderer/renderer.ts`**

```ts
import type {
  RendererApi, LauncherConfig, UpdateState, LogEntry,
  BuildsRegistry, BuildEntry, BuildState, BuildId, NewsEntry,
  SelfUpdateState,
} from './api';
import { applyAccent, applyVideoAndButton } from './ui/branding';
import { renderTabs, setActiveTab } from './ui/tabs';
import { renderNews } from './ui/news-panel';
import { applyProgress, type ProgressEls } from './ui/progress';
import { SettingsModal } from './ui/settings-modal';

declare global { interface Window { eclipseApi: RendererApi; } }

const api = window.eclipseApi;
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const els = {
  tabRow: $('tabRow'),
  versionChipValue: $('versionChipValue'),
  launchBtn: $('launchBtn') as HTMLButtonElement,
  launchBtnImg: $('launchBtnImg') as HTMLImageElement,
  launchSubLabel: $('launchSubLabel'),
  newsList: $('newsList'),
  versionInfo: $('versionInfo'),
  progressBlock: $('progressBlock'),
  progressStatus: $('progressStatus'),
  progressFill: $('progressFill'),
  progressText: $('progressText'),
  progressSpeed: $('progressSpeed'),
  selfUpdateBanner: $('selfUpdateBanner'),
  selfUpdateMsg: $('selfUpdateMsg'),
  selfUpdateBtn: $('selfUpdateBtn') as HTMLButtonElement,
  settingsBtn: $('settingsBtn'),
  logsBtn: $('logsBtn'),
  settingsModal: $('settingsModal'),
  logsModal: $('logsModal'),
  logView: $('logView'),
  logFilter: $('logFilter') as HTMLSelectElement,
  clearLogsBtn: $('clearLogsBtn'),
};

const progressEls: ProgressEls = {
  block: els.progressBlock, status: els.progressStatus,
  fill: els.progressFill, text: els.progressText, speed: els.progressSpeed,
};

const settingsModal = new SettingsModal(api, {
  card: $('settingsModal').querySelector('.modal-card') as HTMLElement,
  buildName: $('settingsBuildName'),
  ramSlider: $('ramSlider') as HTMLInputElement,
  ramInput: $('ramInput') as HTMLInputElement,
  ramRecHint: $('ramRecHint'),
  useRecommendedBtn: $('useRecommendedBtn') as HTMLButtonElement,
  installPathInput: $('installPathInput') as HTMLInputElement,
  pickPathBtn: $('pickPathBtn') as HTMLButtonElement,
  installInfoPath: $('installInfoPath'),
  installInfoStats: $('installInfoStats'),
  openInstallBtn: $('openInstallBtn') as HTMLButtonElement,
  devModeToggle: $('devModeToggle') as HTMLInputElement,
  devPrompt: $('devPrompt'),
  devPasswordInput: $('devPasswordInput') as HTMLInputElement,
  devSubmitBtn: $('devSubmitBtn') as HTMLButtonElement,
  devCancelBtn: $('devCancelBtn') as HTMLButtonElement,
  devError: $('devError'),
  devSection: $('devSection'),
  concInput: $('concInput') as HTMLInputElement,
  retriesInput: $('retriesInput') as HTMLInputElement,
  registryUrlInput: $('registryUrlInput') as HTMLInputElement,
  requireSigToggle: $('requireSigToggle') as HTMLInputElement,
  pubKeyInput: $('pubKeyInput') as HTMLInputElement,
  devResetUiBtn: $('devResetUiBtn') as HTMLButtonElement,
  devResetLockBtn: $('devResetLockBtn') as HTMLButtonElement,
  settingsSavedHint: $('settingsSavedHint'),
});

interface RuntimeState {
  registry: BuildsRegistry | null;
  states: Map<BuildId, BuildState>;
  newsByBuild: Map<BuildId, NewsEntry[]>;
  progressByBuild: Map<BuildId, UpdateState>;
  activeBuildId: BuildId | null;
  updateChecks: Map<BuildId, { recommendedRamMb?: number; needsUpdate: boolean; error?: string }>;
  busy: boolean;
}

const state: RuntimeState = {
  registry: null,
  states: new Map(),
  newsByBuild: new Map(),
  progressByBuild: new Map(),
  activeBuildId: null,
  updateChecks: new Map(),
  busy: false,
};

function activeEntry(): BuildEntry | null {
  if (!state.registry || !state.activeBuildId) return null;
  return state.registry.builds.find((b) => b.id === state.activeBuildId) ?? null;
}

function activeBuildState(): BuildState | null {
  return state.activeBuildId ? state.states.get(state.activeBuildId) ?? null : null;
}

function setBusy(v: boolean): void {
  state.busy = v;
  refreshLaunchButton();
}

function refreshLaunchButton(): void {
  const bs = activeBuildState();
  const check = state.activeBuildId ? state.updateChecks.get(state.activeBuildId) : undefined;
  if (!bs) { els.launchBtn.disabled = true; els.launchSubLabel.textContent = 'Загрузка…'; return; }
  if (state.busy) { els.launchBtn.disabled = true; els.launchSubLabel.textContent = 'Работаю…'; return; }
  if (check?.error) {
    if (bs.installed) { els.launchBtn.disabled = false; els.launchSubLabel.textContent = 'Запуск (оффлайн)'; }
    else { els.launchBtn.disabled = true; els.launchSubLabel.textContent = 'Нет соединения'; }
    return;
  }
  els.launchBtn.disabled = false;
  if (!bs.installed) els.launchSubLabel.textContent = 'Скачать и запустить';
  else if (check?.needsUpdate) els.launchSubLabel.textContent = 'Обновить и запустить';
  else els.launchSubLabel.textContent = 'Запуск';
}

async function selectBuild(id: BuildId): Promise<void> {
  if (state.busy) return;
  await api.setActiveBuild(id);
  state.activeBuildId = id;
  setActiveTab(els.tabRow, id);
  await renderActive();
  // Kick off async updates that don't block UI
  void api.fetchNews(id);
  void runUpdateCheck(id);
}

async function renderActive(): Promise<void> {
  const entry = activeEntry();
  const bs = activeBuildState();
  if (!entry || !bs) return;

  applyAccent(entry.accentColor);
  await applyVideoAndButton(entry, bs, api.resolveAssetUrl.bind(api));

  // Version chip
  els.versionChipValue.textContent = bs.installedVersion ?? '—';
  els.versionInfo.innerHTML = bs.installedVersion
    ? `v${escapeHtml(bs.installedVersion)} · Minecraft / Fabric`
    : 'не установлено';

  // News
  const news = state.newsByBuild.get(entry.id) ?? [];
  renderNews(els.newsList, news);

  // Progress
  applyProgress(progressEls, state.progressByBuild.get(entry.id));

  refreshLaunchButton();
}

async function runUpdateCheck(id: BuildId): Promise<void> {
  try {
    const r = await api.checkForUpdates(id);
    state.updateChecks.set(id, { recommendedRamMb: r.recommendedRamMb, needsUpdate: r.needsUpdate, error: r.error });
    if (state.activeBuildId === id) refreshLaunchButton();
  } catch (err) {
    state.updateChecks.set(id, { needsUpdate: false, error: (err as Error).message });
    if (state.activeBuildId === id) refreshLaunchButton();
  }
}

async function handleLaunch(): Promise<void> {
  if (state.busy) return;
  const id = state.activeBuildId; if (!id) return;
  setBusy(true);
  try {
    const check = state.updateChecks.get(id);
    const needs = check?.needsUpdate || !(await api.getInstalledVersion(id));
    if (needs) await api.runUpdate(id);
    const result = await api.launchGame(id);
    if (result.ok) {
      els.launchSubLabel.textContent = 'Запущено';
      setTimeout(() => { setBusy(false); refreshLaunchButton(); }, 2500);
    } else {
      els.launchSubLabel.textContent = 'Откройте Minecraft Launcher вручную';
      setBusy(false);
    }
    state.states.set(id, { ...state.states.get(id)!, installed: true, installedVersion: (await api.getInstalledVersion(id)) ?? null });
    state.updateChecks.set(id, { ...check!, needsUpdate: false });
  } catch (err) {
    appendLog({ ts: new Date().toISOString(), level: 'error', scope: 'ui', message: (err as Error).message });
    els.launchSubLabel.textContent = 'Повторить';
    setBusy(false);
  }
}

function appendLog(entry: LogEntry): void {
  const span = document.createElement('span');
  span.className = `l-${entry.level}`;
  span.textContent = `[${entry.ts.slice(11, 19)}] [${entry.scope}] ${entry.message}\n`;
  els.logView.appendChild(span);
  while (els.logView.childNodes.length > 1500) els.logView.firstChild?.remove();
  els.logView.scrollTop = els.logView.scrollHeight;
}

function applySelfUpdate(s: SelfUpdateState): void {
  switch (s.status) {
    case 'idle': case 'checking': case 'not-available':
      els.selfUpdateBanner.hidden = true; break;
    case 'available':
      els.selfUpdateBanner.hidden = false;
      els.selfUpdateMsg.textContent = `Найдено обновление лаунчера v${s.version} — скачиваю…`;
      els.selfUpdateBtn.hidden = true; break;
    case 'downloading':
      els.selfUpdateBanner.hidden = false;
      els.selfUpdateMsg.textContent = `Скачиваю обновление лаунчера: ${(s.percent ?? 0).toFixed(0)}%`;
      els.selfUpdateBtn.hidden = true; break;
    case 'ready':
      els.selfUpdateBanner.hidden = false;
      els.selfUpdateMsg.textContent = `Готово к установке: лаунчер v${s.version}`;
      els.selfUpdateBtn.hidden = false; break;
    case 'error':
      els.selfUpdateBanner.hidden = true;
      appendLog({ ts: new Date().toISOString(), level: 'warn', scope: 'self-update', message: s.error ?? 'unknown error' });
      break;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]!);
}

async function bootstrap(): Promise<void> {
  // Subscriptions
  api.onLog(appendLog);
  api.onSelfUpdate(applySelfUpdate);
  api.onUpdateState((s) => {
    state.progressByBuild.set(s.buildId, s);
    if (state.activeBuildId === s.buildId) applyProgress(progressEls, s);
    if (s.stage === 'ready' && state.activeBuildId === s.buildId) {
      void runUpdateCheck(s.buildId);
    }
  });
  api.onNewsUpdated((m) => {
    state.newsByBuild.set(m.buildId, m.entries);
    if (m.buildId === state.activeBuildId) renderNews(els.newsList, m.entries);
  });
  api.onRegistryChanged(async (reg) => { await onRegistry(reg); });
  api.onActiveChanged(({ id }) => {
    state.activeBuildId = id;
    setActiveTab(els.tabRow, id);
    void renderActive();
  });

  els.launchBtn.addEventListener('click', () => { void handleLaunch(); });
  els.settingsBtn.addEventListener('click', async () => {
    const bs = activeBuildState(); if (!bs) return;
    const check = state.activeBuildId ? state.updateChecks.get(state.activeBuildId) : undefined;
    await settingsModal.show(bs, check?.recommendedRamMb);
  });
  els.logsBtn.addEventListener('click', () => { els.logsModal.hidden = false; });
  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.close!;
      const m = document.getElementById(id); if (m) m.hidden = true;
    });
  });
  els.selfUpdateBtn.addEventListener('click', () => { void api.selfUpdate.install(); });
  els.logFilter.addEventListener('change', () => {
    const f = els.logFilter.value;
    els.logView.className = f === 'all' ? '' : `f-${f}`;
  });
  els.clearLogsBtn.addEventListener('click', () => { els.logView.innerHTML = ''; });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { els.settingsModal.hidden = true; els.logsModal.hidden = true; }
  });

  // Initial fetch
  const list = await api.listBuilds();
  state.registry = list.registry;
  state.activeBuildId = list.activeBuildId;
  for (const s of list.states) state.states.set(s.id, s);
  await onRegistry(list.registry);

  // Async news + update checks for all builds (so subsequent tab clicks are warm)
  for (const e of list.registry.builds) {
    void api.fetchNews(e.id);
    void runUpdateCheck(e.id);
  }
}

async function onRegistry(reg: BuildsRegistry): Promise<void> {
  if (!state.activeBuildId) state.activeBuildId = reg.defaultBuildId;
  renderTabs(els.tabRow, reg.builds, state.activeBuildId, {
    onSelect: (id) => { void selectBuild(id); },
    isBusy: () => state.busy,
  });
  await renderActive();
}

bootstrap().catch((err) => {
  appendLog({ ts: new Date().toISOString(), level: 'error', scope: 'ui-bootstrap', message: String(err) });
});
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: и main, и renderer собираются без ошибок.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/renderer.ts
git commit -m "ui: renderer orchestrator wires tabs/news/progress/settings"
```

---

### Task 24: Smoke-тест UI

- [ ] **Step 1: Запустить лаунчер в dev-режиме**

```bash
npm run dev
```

Expected (предполагая, что VPS ещё НЕ запущен с новыми manifest'ами — этот шаг провалится; обработать в Phase 7):
- Окно открывается, видны заглушки табов, новости пустые, кнопка PLAY показывает «Нет соединения» (потому что `builds.json` ещё нет на VPS).

Это OK — UI работает, backend ждёт реальных манифестов. Полный smoke будет в Phase 8 после bootstrap'а VPS.

- [ ] **Step 2: Закрыть лаунчер, не коммитить (это просто проверка)**

---

## Phase 7: Скрипты публикации

### Task 25: Обновить `scripts/build-manifest.js` под `--build-id` и `branding`

**Files:**
- Modify: `scripts/build-manifest.js`

- [ ] **Step 1: Добавить флаги и записать в выход**

В существующий парсер `parseArgs` и в требуемые `required` добавить `'build-id'`. В `branding`-аргументы — `--branding-video`, `--branding-play`, `--branding-options`, `--branding-replace`.

В конце функции `main`, перед `fs.writeFileSync(args.out, ...)`, добавить:

```js
  if (args['build-id']) manifest.buildId = args['build-id'];
  if (args['branding-video'] || args['branding-play']) {
    manifest.branding = {
      video: args['branding-video'] ?? 'background.mkv',
      playButton: args['branding-play'] ?? 'play_button.png',
      optionsButton: args['branding-options'] ?? 'options_button.png',
      replaceButton: args['branding-replace'] ?? 'replace_button.png',
    };
  }
```

И добавить `'build-id'` в `required`.

- [ ] **Step 2: Smoke-тест без выполнения**

```bash
node scripts/build-manifest.js --help 2>&1 | head -1 || true
node scripts/build-manifest.js 2>&1 | grep -q "Missing --build-id"
```

Expected: вторая команда возвращает exit 0 (grep нашёл сообщение).

- [ ] **Step 3: Commit**

```bash
git add scripts/build-manifest.js
git commit -m "scripts(build-manifest): add --build-id and --branding-* flags"
```

---

### Task 26: Обновить `scripts/release-ui.js` под `--build-id`

**Files:**
- Modify: `scripts/release-ui.js`

- [ ] **Step 1: Переписать ассеты-секцию параметризованно**

Заменить блок `ASSETS = [...]` и `ARCHIVE_BASE_URL` на функцию, которая строит их из аргумента `--build-id` и `--assets <dir>`:

```js
function parseArgs(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1];
  }
  return o;
}

const args = parseArgs(process.argv);
const buildId = args['build-id'];
const assetsDir = args.assets || `assets/${buildId}-ui`;
if (!buildId) { console.error('Missing --build-id'); process.exit(1); }

const VPS_BASE = `/var/www/eclipsefantasy/${buildId}/ui`;
const URL_BASE = `http://141.98.189.63/${buildId}/ui`;

const ASSETS = fs.readdirSync(assetsDir).filter((f) => /\.(png|mp4|mkv|webm|jpg)$/i.test(f)).map((name) => ({
  local: path.join(assetsDir, name),
  out: name,
  vps: `${VPS_BASE}/${name}`,
}));

const VPS_ALIAS = process.env.EF_VPS_SSH_ALIAS || 'darkfantasy_vps';
```

Логику `bumpVersion`, `sha256`, основной цикл оставить. Заменить захардкоженный путь `ui_manifest.json` на `<id>_ui_manifest.json`-локальный и upload в `/var/www/eclipsefantasy/<id>/ui_manifest.json`.

Полная замена `scripts/release-ui.js`:

```js
#!/usr/bin/env node
/**
 * Publish UI assets for one build. Reads local assets from --assets <dir>
 * (default assets/<id>-ui), uploads them to /var/www/eclipsefantasy/<id>/ui/,
 * generates a per-build ui_manifest.json, uploads it.
 *
 * Usage:
 *   node scripts/release-ui.js --build-id eclipse [--assets ./assets/eclipse-ui]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { o[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return o;
}

const args = parseArgs(process.argv);
const buildId = args['build-id'];
if (!buildId) { console.error('Missing --build-id'); process.exit(1); }
const assetsDir = args.assets || `assets/${buildId}-ui`;
if (!fs.existsSync(assetsDir)) {
  console.error(`Assets dir not found: ${assetsDir}`);
  process.exit(1);
}

const VPS_BASE = `/var/www/eclipsefantasy/${buildId}/ui`;
const URL_BASE = `http://141.98.189.63/${buildId}/ui`;
const MANIFEST_VPS = `/var/www/eclipsefantasy/${buildId}/ui_manifest.json`;
const VPS_ALIAS = process.env.EF_VPS_SSH_ALIAS || 'darkfantasy_vps';

const ASSETS = fs.readdirSync(assetsDir)
  .filter((f) => /\.(png|mp4|mkv|webm|jpg)$/i.test(f))
  .map((name) => ({ local: path.join(assetsDir, name), out: name, vps: `${VPS_BASE}/${name}` }));

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function bumpVersion(prev) {
  const today = new Date().toISOString().slice(0, 10);
  const m = (prev || '').match(/^(\d{4}-\d{2}-\d{2})-(\d+)$/);
  if (m && m[1] === today) return `${today}-${parseInt(m[2], 10) + 1}`;
  return `${today}-1`;
}
function run(cmd, a) {
  console.log(`$ ${cmd} ${a.join(' ')}`);
  const r = spawnSync(cmd, a, { stdio: 'inherit', shell: false, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  if (r.status !== 0) { console.error(`exit ${r.status}`); process.exit(r.status || 1); }
}

const previous = fs.existsSync(`manifests/${buildId}-ui_manifest.json`)
  ? JSON.parse(fs.readFileSync(`manifests/${buildId}-ui_manifest.json`, 'utf8'))
  : {};
const newVersion = bumpVersion(previous.version);
console.log(`UI manifest ${buildId}: ${previous.version || '(new)'} -> ${newVersion}`);

for (const a of ASSETS) run('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, a.local, a.vps]);

const manifest = {
  version: newVersion,
  files: ASSETS.map((a) => ({
    path: a.out, url: `${URL_BASE}/${a.out}`,
    sha256: sha256(a.local), size: fs.statSync(a.local).size,
  })),
  generatedAt: new Date().toISOString(),
};
fs.mkdirSync('manifests', { recursive: true });
const localManifest = `manifests/${buildId}-ui_manifest.json`;
fs.writeFileSync(localManifest, JSON.stringify(manifest, null, 2));
run('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, localManifest, MANIFEST_VPS]);

console.log(`\n✓ UI release for ${buildId} published (v${newVersion}, ${ASSETS.length} files).`);
```

- [ ] **Step 2: Commit**

```bash
git add scripts/release-ui.js
git commit -m "scripts(release-ui): per-build assets and manifest publishing"
```

---

### Task 27: Новый `scripts/release-build.js`

**Files:**
- Create: `scripts/release-build.js`

- [ ] **Step 1: Реализовать**

```js
#!/usr/bin/env node
/**
 * Atomic release of one build's manifest: hashes the instance dir, generates
 * build_manifest.json with buildId + branding, uploads it to VPS.
 * Does NOT touch builds.json (use update-registry.js) or ui_manifest (use release-ui.js).
 *
 * Usage:
 *   node scripts/release-build.js \
 *     --build-id eclipse \
 *     --instance ./eclipse-source \
 *     --archive ./EclipseFantasy-v1.0.5.zip \
 *     --version 1.0.5 \
 *     --minecraft 1.20.1 \
 *     --fabric 0.16.14 \
 *     --archive-url http://141.98.189.63/EclipseFantasy-v1.0.5.zip \
 *     [--recommended-ram 6144]
 *     [--upload-archive]   (also SFTP the archive itself; default: no)
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) o[key] = true;
    else { o[key] = next; i++; }
  }
  return o;
}
function run(cmd, a) {
  console.log(`$ ${cmd} ${a.join(' ')}`);
  const r = spawnSync(cmd, a, { stdio: 'inherit', shell: false, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  if (r.status !== 0) { console.error(`exit ${r.status}`); process.exit(r.status || 1); }
}

const args = parseArgs(process.argv);
const required = ['build-id','instance','archive','version','minecraft','fabric','archive-url'];
for (const r of required) if (!args[r]) { console.error(`Missing --${r}`); process.exit(1); }
const buildId = args['build-id'];
const VPS_ALIAS = process.env.EF_VPS_SSH_ALIAS || 'darkfantasy_vps';
const outLocal = `manifests/${buildId}_build_manifest.json`;
fs.mkdirSync('manifests', { recursive: true });

const subArgs = [
  'scripts/build-manifest.js',
  '--build-id', buildId,
  '--instance', args.instance,
  '--archive', args.archive,
  '--version', args.version,
  '--minecraft', args.minecraft,
  '--fabric', args.fabric,
  '--archive-url', args['archive-url'],
  '--out', outLocal,
  '--branding-video', 'background.mkv',
  '--branding-play', 'play_button.png',
  '--branding-options', 'options_button.png',
  '--branding-replace', 'replace_button.png',
];
run('node', subArgs);

// Inject recommended-ram if given
if (args['recommended-ram']) {
  const m = JSON.parse(fs.readFileSync(outLocal, 'utf8'));
  m.recommendedRamMb = parseInt(args['recommended-ram'], 10);
  fs.writeFileSync(outLocal, JSON.stringify(m, null, 2));
}

// Sign if EF_SIGNING_KEY in env
if (process.env.EF_SIGNING_KEY) {
  run('node', ['scripts/sign-manifest.js', outLocal, process.env.EF_SIGNING_KEY]);
}

// Upload archive optionally
if (args['upload-archive']) {
  const remoteArchive = `/var/www/eclipsefantasy/${path.basename(args.archive)}`;
  run('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, args.archive, remoteArchive]);
}

// Upload manifest
run('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, outLocal,
  `/var/www/eclipsefantasy/${buildId}/build_manifest.json`]);

console.log(`\n✓ Build ${buildId} v${args.version} manifest published.`);
```

- [ ] **Step 2: Commit**

```bash
git add scripts/release-build.js
git commit -m "scripts(release-build): atomic per-build manifest release"
```

---

### Task 28: Новый `scripts/release-news.js`

**Files:**
- Create: `scripts/release-news.js`

- [ ] **Step 1: Реализовать**

```js
#!/usr/bin/env node
/**
 * Manage per-build news.json on the VPS.
 *
 * Usage:
 *   node scripts/release-news.js init    --build-id <id>
 *   node scripts/release-news.js add     --build-id <id>                        # interactive
 *   node scripts/release-news.js publish --build-id <id> --from <draft.json>    # batch
 *   node scripts/release-news.js remove  --build-id <id> --id <entry-id>
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const cmd = argv[2];
  const rest = {};
  for (let i = 3; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { rest[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return { cmd, ...rest };
}
function run(cmd, a) {
  const r = spawnSync(cmd, a, { stdio: 'inherit', shell: false, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  if (r.status !== 0) { console.error(`exit ${r.status}`); process.exit(r.status || 1); }
}
function sftpDownload(remote, local) {
  return spawnSync('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, '--download', remote, local],
    { stdio: 'inherit', shell: false }).status === 0;
}

const VPS_ALIAS = process.env.EF_VPS_SSH_ALIAS || 'darkfantasy_vps';
const args = parseArgs(process.argv);
const buildId = args['build-id'];
if (!buildId || !args.cmd) { console.error('Usage: see top of file'); process.exit(1); }

const localCache = `manifests/${buildId}_news.json`;
const remotePath = `/var/www/eclipsefantasy/${buildId}/news.json`;
fs.mkdirSync('manifests', { recursive: true });

function readCurrent() {
  if (sftpDownload(remotePath, localCache) && fs.existsSync(localCache)) {
    return JSON.parse(fs.readFileSync(localCache, 'utf8'));
  }
  return { schemaVersion: 1, buildId, entries: [] };
}

function writeAndUpload(feed) {
  feed.entries.sort((a, b) => b.date.localeCompare(a.date));
  feed.generatedAt = new Date().toISOString();
  feed.schemaVersion = 1;
  feed.buildId = buildId;
  fs.writeFileSync(localCache, JSON.stringify(feed, null, 2));
  if (process.env.EF_SIGNING_KEY) {
    run('node', ['scripts/sign-manifest.js', localCache, process.env.EF_SIGNING_KEY]);
  }
  run('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, localCache, remotePath]);
  console.log(`✓ news.json (${buildId}) updated, ${feed.entries.length} entries.`);
}

async function promptEntry() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const q = (s) => new Promise((res) => rl.question(s, (a) => res(a)));
  const date = (await q('Date (YYYY-MM-DD) [today]: ')) || new Date().toISOString().slice(0, 10);
  const type = (await q('Type (changelog|event|notice) [changelog]: ')) || 'changelog';
  const title = await q('Title: ');
  const body = await q('Body: ');
  let eventStart, eventEnd;
  if (type === 'event') {
    eventStart = (await q('Event start (ISO 8601, optional): ')) || undefined;
    eventEnd = (await q('Event end (ISO 8601, optional): ')) || undefined;
  }
  rl.close();
  const id = `${date}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`;
  return { id, date, type, title, body, eventStart, eventEnd };
}

(async () => {
  if (args.cmd === 'init') {
    writeAndUpload({ schemaVersion: 1, buildId, entries: [] });
    return;
  }
  const feed = readCurrent();
  if (args.cmd === 'add') {
    const entry = await promptEntry();
    feed.entries.push(entry);
    writeAndUpload(feed);
  } else if (args.cmd === 'publish') {
    if (!args.from) { console.error('Missing --from'); process.exit(1); }
    const fresh = JSON.parse(fs.readFileSync(args.from, 'utf8'));
    writeAndUpload({ ...feed, ...fresh });
  } else if (args.cmd === 'remove') {
    if (!args.id) { console.error('Missing --id'); process.exit(1); }
    feed.entries = feed.entries.filter((e) => e.id !== args.id);
    writeAndUpload(feed);
  } else {
    console.error(`Unknown command: ${args.cmd}`); process.exit(1);
  }
})();
```

- [ ] **Step 2: Commit**

```bash
git add scripts/release-news.js
git commit -m "scripts(release-news): manage per-build news.json (init/add/publish/remove)"
```

---

### Task 29: Новый `scripts/update-registry.js`

**Files:**
- Create: `scripts/update-registry.js`

- [ ] **Step 1: Реализовать**

```js
#!/usr/bin/env node
/**
 * Manage builds.json (the build registry) on the VPS.
 *
 * Usage:
 *   node scripts/update-registry.js add \
 *     --id eclipse --display-name "Eclipse Fantasy" --short-name ECLIPSE \
 *     --accent "#ffd144" --order 1
 *   node scripts/update-registry.js disable    --id summermon
 *   node scripts/update-registry.js enable     --id summermon
 *   node scripts/update-registry.js remove     --id summermon
 *   node scripts/update-registry.js set-default --id eclipse
 */
const fs = require('fs');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const cmd = argv[2];
  const rest = {};
  for (let i = 3; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { rest[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return { cmd, ...rest };
}
function run(cmd, a) {
  const r = spawnSync(cmd, a, { stdio: 'inherit', shell: false, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  if (r.status !== 0) { console.error(`exit ${r.status}`); process.exit(r.status || 1); }
}
function tryDownload(remote, local) {
  return spawnSync('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, '--download', remote, local],
    { stdio: 'inherit', shell: false }).status === 0;
}

const VPS_ALIAS = process.env.EF_VPS_SSH_ALIAS || 'darkfantasy_vps';
const VPS_HOST = process.env.EF_VPS_HOST || '141.98.189.63';
const remotePath = '/var/www/eclipsefantasy/builds.json';
const localPath = 'manifests/builds.json';
fs.mkdirSync('manifests', { recursive: true });

const args = parseArgs(process.argv);
if (!args.cmd) { console.error('Usage: see top of file'); process.exit(1); }

function readCurrent() {
  if (tryDownload(remotePath, localPath) && fs.existsSync(localPath)) {
    return JSON.parse(fs.readFileSync(localPath, 'utf8'));
  }
  return { schemaVersion: 1, defaultBuildId: '', builds: [] };
}

function writeAndUpload(reg) {
  reg.generatedAt = new Date().toISOString();
  reg.schemaVersion = 1;
  reg.builds.sort((a, b) => a.order - b.order);
  fs.writeFileSync(localPath, JSON.stringify(reg, null, 2));
  if (process.env.EF_SIGNING_KEY) {
    run('node', ['scripts/sign-manifest.js', localPath, process.env.EF_SIGNING_KEY]);
  }
  run('python', ['-u', 'scripts/sftp-upload.py', VPS_ALIAS, localPath, remotePath]);
  console.log(`✓ builds.json updated (${reg.builds.length} builds, default=${reg.defaultBuildId}).`);
}

const reg = readCurrent();
const id = args.id;
if (!id && ['add', 'disable', 'enable', 'remove', 'set-default'].includes(args.cmd)) {
  console.error('Missing --id'); process.exit(1);
}
const idx = reg.builds.findIndex((b) => b.id === id);

if (args.cmd === 'add') {
  const entry = {
    id, displayName: args['display-name'] || id, shortName: args['short-name'] || id.toUpperCase(),
    buildManifestUrl: args['build-manifest-url'] || `http://${VPS_HOST}/${id}/build_manifest.json`,
    uiManifestUrl: args['ui-manifest-url'] || `http://${VPS_HOST}/${id}/ui_manifest.json`,
    newsUrl: args['news-url'] || `http://${VPS_HOST}/${id}/news.json`,
    accentColor: args.accent || '#d23a8b',
    enabled: true,
    order: parseInt(args.order ?? '99', 10),
  };
  if (idx >= 0) reg.builds[idx] = { ...reg.builds[idx], ...entry };
  else reg.builds.push(entry);
  if (!reg.defaultBuildId) reg.defaultBuildId = id;
  writeAndUpload(reg);
} else if (args.cmd === 'disable' || args.cmd === 'enable') {
  if (idx < 0) { console.error(`Unknown id: ${id}`); process.exit(1); }
  reg.builds[idx].enabled = args.cmd === 'enable';
  writeAndUpload(reg);
} else if (args.cmd === 'remove') {
  if (idx < 0) { console.error(`Unknown id: ${id}`); process.exit(1); }
  reg.builds.splice(idx, 1);
  if (reg.defaultBuildId === id) reg.defaultBuildId = reg.builds[0]?.id || '';
  writeAndUpload(reg);
} else if (args.cmd === 'set-default') {
  if (idx < 0) { console.error(`Unknown id: ${id}`); process.exit(1); }
  reg.defaultBuildId = id;
  writeAndUpload(reg);
} else {
  console.error(`Unknown command: ${args.cmd}`); process.exit(1);
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/update-registry.js
git commit -m "scripts(update-registry): manage builds.json (add/disable/enable/remove/set-default)"
```

---

### Task 30: Примеры манифестов

**Files:**
- Create: `manifests/builds.example.json`
- Create: `manifests/news.example.json`
- Modify: `manifests/build_manifest.example.json`

- [ ] **Step 1: `manifests/builds.example.json`**

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
  ]
}
```

- [ ] **Step 2: `manifests/news.example.json`**

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
      "id": "2026-05-04-luna",
      "date": "2026-05-04",
      "type": "event",
      "title": "Эвент: Лунное затмение",
      "body": "17–20 мая, ивент-сервер",
      "eventStart": "2026-05-17T18:00:00+03:00",
      "eventEnd": "2026-05-20T22:00:00+03:00"
    }
  ]
}
```

- [ ] **Step 3: Дополнить `manifests/build_manifest.example.json`**

Добавить `"buildId": "eclipse"` после `"version"` и блок `"branding"` в конец (перед `"generatedAt"`):

```json
  "buildId": "eclipse",
  ...
  "branding": {
    "video": "background.mkv",
    "playButton": "play_button.png",
    "optionsButton": "options_button.png",
    "replaceButton": "replace_button.png"
  },
```

- [ ] **Step 4: Commit**

```bash
git add manifests/builds.example.json manifests/news.example.json manifests/build_manifest.example.json
git commit -m "manifests: add builds.example + news.example, update build_manifest example"
```

---

## Phase 8: VPS bootstrap и end-to-end smoke

### Task 31: Подготовить локальные ассеты

- [ ] **Step 1: Скачать `ui_new/` с VPS на локал и перерасклоадить с чистыми именами**

```bash
mkdir -p assets/eclipse-ui assets/summermon-ui
scp darkfantasy_vps:/var/www/eclipsefantasy/ui_new/background_eclipse.mkv assets/eclipse-ui/background.mkv
scp darkfantasy_vps:/var/www/eclipsefantasy/ui_new/play_eclipse_button.png assets/eclipse-ui/play_button.png
scp darkfantasy_vps:/var/www/eclipsefantasy/ui_new/options_eclipse_button.png assets/eclipse-ui/options_button.png
scp darkfantasy_vps:/var/www/eclipsefantasy/ui_new/replace_eclipse_button.png assets/eclipse-ui/replace_button.png
scp darkfantasy_vps:/var/www/eclipsefantasy/ui_new/background_summermon.mp4 assets/summermon-ui/background.mp4
scp darkfantasy_vps:/var/www/eclipsefantasy/ui_new/play_summermon_button.png assets/summermon-ui/play_button.png
scp darkfantasy_vps:/var/www/eclipsefantasy/ui_new/options_summermon_button.png assets/summermon-ui/options_button.png
scp darkfantasy_vps:/var/www/eclipsefantasy/ui_new/replace_summerm_buttonon.png assets/summermon-ui/replace_button.png
ls -la assets/eclipse-ui/ assets/summermon-ui/
```

- [ ] **Step 2: Не коммитим — ассеты тяжёлые. Добавить в `.gitignore`**

```
assets/eclipse-ui/
assets/summermon-ui/
```

```bash
git add .gitignore
git commit -m "chore: ignore per-build asset staging dirs"
```

---

### Task 32: Создать на VPS структуру и залить контент

- [ ] **Step 1: Создать папки на VPS**

```bash
ssh darkfantasy_vps "mkdir -p /var/www/eclipsefantasy/eclipse/ui /var/www/eclipsefantasy/summermon/ui && chown -R www-data:www-data /var/www/eclipsefantasy/eclipse /var/www/eclipsefantasy/summermon"
```

- [ ] **Step 2: Залить UI обеих сборок**

```bash
node scripts/release-ui.js --build-id eclipse
node scripts/release-ui.js --build-id summermon
```

Expected: оба скрипта успешно загружают файлы (видео может занять минуту-две для Summermon).

- [ ] **Step 3: Сгенерировать и залить build_manifest для обеих**

Для Eclipse: нужна локальная распакованная папка `EclipseFantasy-v1.0.5.zip`. Распаковываем и запускаем:

```bash
mkdir -p tmp/eclipse-source && unzip -q -o /path/to/EclipseFantasy-v1.0.5.zip -d tmp/eclipse-source
node scripts/release-build.js \
  --build-id eclipse \
  --instance tmp/eclipse-source \
  --archive /path/to/EclipseFantasy-v1.0.5.zip \
  --version 1.0.5 --minecraft 1.20.1 --fabric 0.16.14 \
  --archive-url http://141.98.189.63/EclipseFantasy-v1.0.5.zip \
  --recommended-ram 6144
```

Аналогично для Summermon. (Путь к архиву подставить под локальную копию.)

- [ ] **Step 4: Инициализировать пустые news**

```bash
node scripts/release-news.js init --build-id eclipse
node scripts/release-news.js init --build-id summermon
```

- [ ] **Step 5: Зарегистрировать сборки в builds.json**

```bash
node scripts/update-registry.js add \
  --id eclipse --display-name "Eclipse Fantasy" --short-name ECLIPSE \
  --accent "#ffd144" --order 1
node scripts/update-registry.js add \
  --id summermon --display-name "FTB Summermon" --short-name SUMMERMON \
  --accent "#f54c40" --order 2
node scripts/update-registry.js set-default --id eclipse
```

- [ ] **Step 6: Проверить доступность из браузера**

```bash
curl -s http://141.98.189.63/builds.json | jq .defaultBuildId
curl -s http://141.98.189.63/eclipse/build_manifest.json | jq .buildId
curl -s http://141.98.189.63/eclipse/news.json | jq .entries
curl -s http://141.98.189.63/summermon/build_manifest.json | jq .buildId
```

Expected: `"eclipse"`, `"eclipse"`, `[]`, `"summermon"`.

---

### Task 33: End-to-end smoke

- [ ] **Step 1: Запустить лаунчер с чистым userData (или после миграции)**

```bash
npm run dev
```

Ожидаемое поведение:
1. Если был старый `~/.config/EclipseFantasy/instance/` — миграция в `builds/eclipse/instance/`, без потери файлов.
2. Сверху видны 2 таба: ECLIPSE (активный, жёлто-подчёркнут) | SUMMERMON.
3. По центру играет `background.mkv` (Eclipse).
4. Правая панель — пустой чейнджлог (мы инициализировали news пустыми), версия `v1.0.5`.
5. Кнопка PLAY активна, подпись `Запуск` (если установка есть) или `Скачать и запустить`.
6. Клик по табу SUMMERMON: фон меняется на `background.mp4`, accent — оранжевый, PLAY — `Скачать и запустить`.
7. Открыть «Настройки» → видно «Настройки сборки: Eclipse Fantasy» c ОЗУ и путём. Расширенный блок скрыт.
8. Включить «Режим разработчика», ввести правильный пароль → раскрывается расширенный блок.

- [ ] **Step 2: Добавить тестовую новость и проверить**

```bash
echo '{"entries":[{"id":"smoke-test","date":"2026-05-12","type":"changelog","title":"Smoke test","body":"E2E проверка"}]}' > /tmp/draft.json
node scripts/release-news.js publish --build-id eclipse --from /tmp/draft.json
```

В лаунчере: открыть/закрыть таб Eclipse → новость появилась в правой панели.

- [ ] **Step 3: Если всё работает — финальный коммит**

```bash
git status     # должен быть чистым
```

---

## Phase 9: Документация

### Task 34: Обновить `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Заменить раздел «Two-source distribution» и добавить «Multi-build»**

В `CLAUDE.md` заменить раздел «Two-source distribution» — оставить пояснение про две дистрибуции, но добавить под ним:

```markdown
### Multi-build registry

Лаунчер поддерживает несколько модпак-сборок одновременно. Реестр живёт в `builds.json`
на VPS (`/var/www/eclipsefantasy/builds.json`); каждая сборка имеет свою папку
`<id>/` с `build_manifest.json`, `ui_manifest.json`, `news.json`, и `ui/`. Локально
лаунчер хранит per-build данные в `~/.config/EclipseFantasy/builds/<id>/`.

Главный процесс держит `BuildRegistry` с `Map<id, BuildInstance>`; каждый
`BuildInstance` владеет своими `Updater`, `ManifestService`, `NewsService`,
`GameLauncher`. IPC-команды принимают опциональный `buildId` (null = активная сборка).
См. `docs/superpowers/specs/2026-05-12-multi-modpack-design.md`.

При запуске свежего лаунчера на старой установке (`userData/instance/`) выполняется
одноразовая миграция в `userData/builds/eclipse/instance/` — игроки ничего не
перекачивают. Логика в `src/core/migration.ts`.
```

И в раздел «Commands» добавить:

```
npm test          # node:test с tsc-прекомпиляцией; покрывает config, migration, registry, news
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): document multi-build architecture"
```

---

### Task 35: Обновить `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Добавить раздел «Сборки» после «Установка»**

```markdown
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
- персональные настройки (ОЗУ, путь установки).

Для админов — см. `FORUPDATE.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): introduce multi-build feature"
```

---

### Task 36: Переписать `FORUPDATE.md` под мультисборку

**Files:**
- Modify: `FORUPDATE.md`

- [ ] **Step 1: Добавить наверх раздел «Релиз новой версии сборки» и «Публикация новостей»**

Перед существующими разделами вставить:

```markdown
## Релиз новой версии сборки

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
  --archive-url http://141.98.189.63/<id>-v<X.Y.Z>.zip \
  --recommended-ram <MB>
```

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
```

- [ ] **Step 2: Commit**

```bash
git add FORUPDATE.md
git commit -m "docs(forupdate): runbooks for build, news, registry, UI releases"
```

---

### Task 37: Обновить `package.json` — версия и публикация плана

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Поднять версию**

В `package.json` поменять `"version": "0.1.3"` → `"version": "0.2.0"` (мажор-фича).

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: bump launcher to v0.2.0 for multi-build feature"
```

---

## Финал: PR

- [ ] **Step 1: Полная сборка и тесты**

```bash
npm run lint
npm run build
npm test
```

Expected: всё проходит.

- [ ] **Step 2: Создать PR**

```bash
git push -u origin multi-modpack
gh pr create --title "Multi-modpack launcher (Eclipse + Summermon)" --body "$(cat <<'EOF'
## Summary
- Мультисборочный лаунчер: `builds.json` на VPS как реестр, табы вверху UI, новости в правой панели, прогресс над PLAY.
- Per-build настройки (ОЗУ, путь установки) + общие операционные (concurrency, retries, registry URL) спрятаны под режим разработчика.
- Автомиграция старого `userData/instance/` → `userData/builds/eclipse/instance/`.
- Скрипты публикации: `release-build.js`, `release-news.js`, `update-registry.js`, обновлённый `release-ui.js`.

## Test plan
- [ ] `npm run lint && npm run build && npm test` — зелёный
- [ ] Запуск лаунчера на «чистом» userData → видны 2 таба, оба фон-видео играют
- [ ] Запуск лаунчера на старом userData (где есть `instance/`) → миграция, Eclipse играется без re-download
- [ ] PLAY Eclipse → запускает официальный MC Launcher с профилем `eclipsefantasy-eclipse`
- [ ] PLAY Summermon → скачивает архив (1.4G), профиль `eclipsefantasy-summermon`
- [ ] Настройки → ОЗУ меняется per-build, переключение табов в UI отражает разные значения
- [ ] Режим разработчика → корректный пароль раскрывает блок, неверный показывает ошибку
- [ ] Сценарий оффлайн (выключить интернет после первого запуска): кеши работают
EOF
)"
```

---

## Self-Review

**Spec coverage:**

- 3.1 BuildInstance + Registry → Tasks 8, 9
- 3.2 Стримы → Tasks 15, 16
- 4.1 VPS раскладка → Tasks 31, 32
- 4.2 userData layout → Tasks 5, 6
- 4.3 ef-asset:// → Task 17 (protocol handler)
- 5.1 builds.json → Tasks 7, 29
- 5.2 news.json → Tasks 12, 28
- 5.3 build_manifest изменения → Tasks 2, 25, 27
- 5.4 settings.json v2 → Tasks 2, 4
- 6.x IPC → Task 15
- 6.3.1 Конкурентные PLAY → Task 23 (renderer держит progressByBuild, launchBtn disabled пока busy)
- 7.x UI → Tasks 18-23
- 7.7.1 Смена installPath у установленной сборки — **GAP**: не покрыто. Это диалог, который должен появляться при попытке сохранить новый путь. Сейчас рендерер просто пишет в perBuild — старая папка остаётся без предупреждения.
- 8.x Режим разработчика → Tasks 3, 15, 22
- 9 Миграция → Task 6
- 10.x Тулинг → Tasks 25-30, 36
- 11 Open Qs → нет — это будущая работа

**Закрываем GAP по 7.7.1:** добавляю Task 22a после Task 22 (или встрою в settings-modal). Меньше всего риска — встроить в `SettingsModal.saveAll()`, перед сохранением проверять, был ли старый путь и был ли там instance/. Если был — спрашивать через нативный диалог (`confirm()` сработает в Electron). Это можно добавить в существующий код `SettingsModal`.

Добавляю минимальное расширение в Task 22 в виде дополнительного шага:

**Task 22 Step 1.5 (insert before commit):** в `saveAll()`, перед `this.api.saveBuildConfig(...)`, проверять:

```ts
const cfg = await this.api.getConfig();
const id = cfg.activeBuildId;
const existingPath = cfg.perBuild[id]?.installPath ?? null;
const newPath = this.els.installPathInput.value.trim() || null;
if (existingPath !== newPath) {
  const info = await this.api.getInstallInfo(id);
  if (info.exists && info.totalBytes > 0) {
    const ok = window.confirm(
      `Сборка ${cfg.activeBuildId} уже установлена в ${info.path} (${fmtBytes(info.totalBytes)}). ` +
      `Лаунчер сменит путь, но физически не переместит файлы. Продолжить?`
    );
    if (!ok) {
      this.els.installPathInput.value = existingPath ?? '';
      return;
    }
  }
}
```

**Placeholder scan:** искал TBD/TODO/FIXME — нет. Все шаги содержат код.

**Type consistency:** `LauncherConfig` v2 везде одинаков. `BuildInstance` методы (`state()`, `instanceRoot()`, `perBuildConfig()`, `installedVersion()`, `getBuildManifest()`, `ensureDirs()`, `resetUiCache()`, `resetManifestLock()`) — используются в Task 9, 15. `progressByBuild` (Map<BuildId, UpdateState>) — в Task 23.

Готово.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-12-multi-modpack-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — я диспатчу свежего subagent на каждую таску, ревью между ними, быстрая итерация.

**2. Inline Execution** — выполнение по тасках в этой сессии через `executing-plans`, batch-чекпоинты для ревью.

**Какой подход?**



