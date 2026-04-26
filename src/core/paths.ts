import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';

/**
 * Resolves all paths the launcher uses. Centralised so we never sprinkle
 * platform-specific path joining across modules. The userData root is
 * supplied by the Electron main process at startup.
 */
export class Paths {
  constructor(private readonly userData: string, private readonly resourcesDir: string) {}

  /** Root for everything the launcher manages locally. */
  get root(): string { return this.userData; }
  /** Streaming log files. */
  get logs(): string { return path.join(this.userData, 'logs'); }
  /** Cache directory for downloaded archives, partial files, etc. */
  get cache(): string { return path.join(this.userData, 'cache'); }
  /** Persisted user settings + computed config. */
  get settingsFile(): string { return path.join(this.userData, 'settings.json'); }
  /** Lockfile describing what the launcher currently has installed. */
  get manifestLockFile(): string { return path.join(this.userData, 'manifest.lock'); }
  /** Cached copies of the most recent remote manifests. */
  get buildManifestCache(): string { return path.join(this.userData, 'build_manifest.json'); }
  get uiManifestCache(): string { return path.join(this.userData, 'ui_manifest.json'); }
  /** Local UI cache populated from ui_manifest.json. */
  get uiCache(): string { return path.join(this.userData, 'ui'); }
  /** Resource path bundled with the app. Holds fallback Iss_* assets. */
  get bundledAssets(): string { return path.join(this.resourcesDir, 'assets'); }
  /** Bundled default config (read-only). */
  get bundledConfig(): string { return path.join(this.resourcesDir, 'config'); }

  /** Where the modpack instance lives. May be overridden via config. */
  instanceRoot(override: string | null): string {
    return override && override.trim().length > 0
      ? path.resolve(override)
      : path.join(this.userData, 'instance');
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

  async ensureDirs(instancePath: string): Promise<void> {
    const dirs = [
      this.logs,
      this.cache,
      this.uiCache,
      instancePath,
      path.join(instancePath, 'mods'),
      path.join(instancePath, 'config'),
      path.join(instancePath, 'resourcepacks'),
      path.join(instancePath, 'cache'),
    ];
    await Promise.all(dirs.map((d) => fs.mkdir(d, { recursive: true })));
  }
}
