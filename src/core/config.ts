import { promises as fs } from 'fs';
import * as path from 'path';
import type { LauncherConfig } from './types';
import { logger } from './logger';

const DEFAULT_CONFIG: LauncherConfig = {
  name: 'EclipseFantasy',
  version: '0.1.0',
  buildManifestUrl: 'http://141.98.189.63/build_manifest.json',
  uiManifestUrl: 'http://141.98.189.63/ui_manifest.json',
  signaturePublicKey: undefined,
  ramMb: 4096,
  installPath: null,
  downloadConcurrency: 4,
  downloadRetries: 5,
  requireValidSignature: false,
};

/**
 * Loads launcher config from (in order): bundled defaults -> user override file.
 * The user override file is what the UI mutates via saveConfig().
 *
 * Why two files: bundled config can be replaced by re-installing the launcher
 * (e.g. a new release ships a new default URL), while the user file persists
 * across upgrades and only contains explicit overrides.
 */
export class ConfigStore {
  private config: LauncherConfig = { ...DEFAULT_CONFIG };
  private loaded = false;

  constructor(
    private readonly settingsFile: string,
    private readonly bundledConfigDir: string,
  ) {}

  async load(): Promise<LauncherConfig> {
    if (this.loaded) return this.config;
    const bundled = await this.tryRead(path.join(this.bundledConfigDir, 'launcher.config.json'));
    const userRaw = await this.tryRead(this.settingsFile);
    const user = this.migrateStaleUrls(userRaw);
    this.config = this.merge(DEFAULT_CONFIG, bundled, user);
    this.loaded = true;
    // Persist if migration changed anything, so the user file stays clean.
    if (userRaw && JSON.stringify(userRaw) !== JSON.stringify(user)) {
      await fs.writeFile(this.settingsFile, JSON.stringify(this.config, null, 2), 'utf8').catch(() => undefined);
    }
    logger.info('config', `Loaded config (RAM=${this.config.ramMb}MiB, installPath=${this.config.installPath ?? '<default>'})`);
    return this.config;
  }

  /**
   * Strip URL fields from a user config when they match a value we know is
   * stale (e.g. early builds shipped GitHub Releases URLs that got broken
   * once the launcher binary release became "latest"). Removing them lets
   * the bundled / default URL win on the next merge.
   */
  private migrateStaleUrls(user: Partial<LauncherConfig> | null): Partial<LauncherConfig> | null {
    if (!user) return null;
    const stalePatterns = [
      // Pre-VPS modpack manifest URLs lived on GitHub Releases /latest.
      'github.com/MelQ29/mc-launcher/releases/latest/download/build_manifest.json',
      'github.com/MelQ29/mc-launcher/releases/latest/download/ui_manifest.json',
      // Older placeholder.
      'eclipsefantasy/launcher-assets',
    ];
    const out = { ...user };
    let changed = false;
    for (const key of ['buildManifestUrl', 'uiManifestUrl'] as const) {
      const v = out[key];
      if (typeof v === 'string' && stalePatterns.some((p) => v.includes(p))) {
        delete out[key];
        changed = true;
        logger.warn('config', `Migrating away from stale ${key}: ${v}`);
      }
    }
    return changed ? out : user;
  }

  get current(): LauncherConfig {
    if (!this.loaded) throw new Error('ConfigStore.load() must be called first');
    return this.config;
  }

  async save(patch: Partial<LauncherConfig>): Promise<LauncherConfig> {
    if (!this.loaded) await this.load();
    this.config = this.sanitize({ ...this.config, ...patch });
    await fs.mkdir(path.dirname(this.settingsFile), { recursive: true });
    await fs.writeFile(this.settingsFile, JSON.stringify(this.config, null, 2), 'utf8');
    logger.info('config', 'User config saved');
    return this.config;
  }

  private async tryRead(file: string): Promise<Partial<LauncherConfig> | null> {
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw) as Partial<LauncherConfig>;
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== 'ENOENT') logger.warn('config', `Failed to read ${file}: ${e?.message}`);
      return null;
    }
  }

  private merge(...layers: Array<Partial<LauncherConfig> | null>): LauncherConfig {
    let out: LauncherConfig = { ...DEFAULT_CONFIG };
    for (const layer of layers) {
      if (!layer) continue;
      out = { ...out, ...layer };
    }
    return this.sanitize(out);
  }

  /** Clamp numeric ranges and strip empty strings so downstream code can trust the values. */
  private sanitize(c: LauncherConfig): LauncherConfig {
    const ram = Number.isFinite(c.ramMb) ? c.ramMb : DEFAULT_CONFIG.ramMb;
    return {
      ...c,
      ramMb: Math.max(512, Math.min(ram, 65536)),
      downloadConcurrency: Math.max(1, Math.min(c.downloadConcurrency || 4, 16)),
      downloadRetries: Math.max(0, Math.min(c.downloadRetries ?? 5, 20)),
      installPath: c.installPath && c.installPath.trim() ? c.installPath : null,
      buildManifestUrl: (c.buildManifestUrl || DEFAULT_CONFIG.buildManifestUrl).trim(),
      uiManifestUrl: (c.uiManifestUrl || DEFAULT_CONFIG.uiManifestUrl).trim(),
    };
  }
}

export const DEFAULTS = DEFAULT_CONFIG;
