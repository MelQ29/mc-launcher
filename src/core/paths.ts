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

  /** Detect the official Minecraft launcher directory across platforms. */
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
