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
  const ramMb = typeof obj.ramMb === 'number' ? obj.ramMb : 4096;
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
