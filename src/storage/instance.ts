import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from '../core/logger';

/**
 * Helpers around the modpack instance directory. The instance is the only
 * location the launcher writes Minecraft files; user data outside it is
 * never touched.
 */
export class InstanceStorage {
  constructor(private readonly root: string) {}

  get path(): string { return this.root; }

  /** Standard subdirectories the launcher relies on existing. */
  get mods(): string { return path.join(this.root, 'mods'); }
  get config(): string { return path.join(this.root, 'config'); }
  get resourcepacks(): string { return path.join(this.root, 'resourcepacks'); }
  get cache(): string { return path.join(this.root, 'cache'); }

  async ensure(): Promise<void> {
    const dirs = [this.root, this.mods, this.config, this.resourcepacks, this.cache];
    await Promise.all(dirs.map((d) => fs.mkdir(d, { recursive: true })));
  }

  /**
   * Wipe ONLY the staging area used during extraction. Never invoked on the
   * live instance — that would risk deleting user data.
   */
  async wipeStaging(stagingDir: string): Promise<void> {
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir, { recursive: true });
    logger.debug('instance', `Cleared staging dir ${stagingDir}`);
  }
}
