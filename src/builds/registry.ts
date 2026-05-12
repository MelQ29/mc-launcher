import { EventEmitter } from 'events';
import type { BuildsRegistry, BuildEntry, BuildId, BuildState } from '../core/types';
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

    // 5. background pre-warm UI assets for each build so ef-asset:// resolves
    //    to real per-build files (video, buttons) on first launch — without
    //    requiring the user to click PLAY first.
    for (const entry of registry.builds) {
      const inst = this.instances.get(entry.id);
      if (!inst) continue;
      void inst.updater.runUiSync(cfg).catch((err) =>
        logger.warn('build-registry', `Background UI sync failed for ${entry.id}: ${(err as Error).message}`),
      );
    }
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
