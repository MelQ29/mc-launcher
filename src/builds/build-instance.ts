import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import type {
  BuildEntry, BuildId, BuildState, PerBuildConfig,
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
    this.updater = new Updater(
      this.id, deps.paths, this.manifests, this.instanceRoot(),
      deps.entry.buildManifestUrl, deps.entry.uiManifestUrl,
    );
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
    let manifest: BuildManifest | null = this.cachedBuildManifest;
    if (!manifest) {
      try {
        const raw = await fs.readFile(this.deps.paths.buildManifestCache(this.id), 'utf8');
        manifest = JSON.parse(raw) as BuildManifest;
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
      branding: manifest?.branding ?? null,
      minecraft: manifest?.minecraft,
      modloader: manifest?.modloader ?? (manifest?.fabricLoader ? 'fabric' : undefined),
      loaderVersion: manifest?.loaderVersion ?? manifest?.fabricLoader,
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
