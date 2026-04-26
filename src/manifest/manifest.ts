import { promises as fs } from 'fs';
import * as path from 'path';
import type { BuildManifest, UiManifest, ManifestLock } from '../core/types';
import { fetchText } from '../downloader/downloader';
import { logger } from '../core/logger';
import { verifyManifestSignature } from './signature';

export class ManifestService {
  constructor(
    private readonly buildCachePath: string,
    private readonly uiCachePath: string,
    private readonly lockPath: string,
  ) {}

  /**
   * Fetch + validate a remote manifest. On network failure, fall back to the
   * cached copy on disk so the launcher can run offline if a build is already
   * installed.
   */
  async fetchBuildManifest(
    url: string,
    publicKey: string | undefined,
    required: boolean,
  ): Promise<{ manifest: BuildManifest; offline: boolean }> {
    return this.fetchManifest<BuildManifest>(url, this.buildCachePath, publicKey, required, 'build');
  }

  async fetchUiManifest(
    url: string,
    publicKey: string | undefined,
    required: boolean,
  ): Promise<{ manifest: UiManifest; offline: boolean }> {
    return this.fetchManifest<UiManifest>(url, this.uiCachePath, publicKey, required, 'ui');
  }

  private async fetchManifest<T extends { signature?: string }>(
    url: string,
    cachePath: string,
    publicKey: string | undefined,
    required: boolean,
    label: string,
  ): Promise<{ manifest: T; offline: boolean }> {
    let manifest: T | null = null;
    let offline = false;
    try {
      const raw = await fetchText(url);
      manifest = JSON.parse(raw) as T;
      const check = verifyManifestSignature(manifest as Record<string, unknown>, publicKey, required);
      if (!check.ok) throw new Error(`${label} manifest signature: ${check.reason}`);
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, raw, 'utf8');
    } catch (err) {
      logger.warn('manifest', `Could not fetch remote ${label} manifest (${(err as Error).message}); trying cache`);
      try {
        const cached = await fs.readFile(cachePath, 'utf8');
        manifest = JSON.parse(cached) as T;
        offline = true;
      } catch (cacheErr) {
        throw new Error(
          `Failed to fetch ${label} manifest and no cached copy exists: ${(err as Error).message}`,
        );
      }
    }
    if (!manifest) throw new Error(`Empty ${label} manifest`);
    return { manifest, offline };
  }

  async readLock(): Promise<ManifestLock | null> {
    try {
      const raw = await fs.readFile(this.lockPath, 'utf8');
      return JSON.parse(raw) as ManifestLock;
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e?.code !== 'ENOENT') logger.warn('manifest', `Lock read failed: ${e?.message}`);
      return null;
    }
  }

  async writeLock(lock: ManifestLock): Promise<void> {
    await fs.mkdir(path.dirname(this.lockPath), { recursive: true });
    await fs.writeFile(this.lockPath, JSON.stringify(lock, null, 2), 'utf8');
  }
}
