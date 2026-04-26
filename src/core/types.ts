// Shared types used across main process modules and exposed to the renderer
// via the preload IPC bridge. Renderer-only types live next to the renderer.

export interface ManagedFileEntry {
  /** POSIX-style relative path inside the managed root (instance or ui). */
  path: string;
  /** Lowercase hex SHA-256 of the file contents. */
  sha256: string;
  /** Optional size in bytes — used for progress estimation only. */
  size?: number;
  /** Optional direct download URL for individual asset files (UI manifest). */
  url?: string;
}

export interface BuildManifest {
  /** Human-readable build version, e.g. "2026.04.26-1". */
  version: string;
  /** Minecraft release this build targets, e.g. "1.20.1". */
  minecraft: string;
  /** Fabric loader version, e.g. "0.16.14". */
  fabricLoader: string;
  /** Direct URL to the modpack archive (zip or 7z). */
  archiveUrl: string;
  /** SHA-256 of the archive itself. */
  archiveSha256: string;
  /** Optional archive size in bytes. */
  archiveSize?: number;
  /** Files contained in the archive AFTER extraction. Used for hash verification. */
  files: ManagedFileEntry[];
  /** Optional ed25519 signature over the canonical manifest body (hex). */
  signature?: string;
  /** ISO timestamp when manifest was generated. */
  generatedAt?: string;
}

export interface UiManifest {
  /** Manifest schema version. */
  version: string;
  /** Files to download into the local UI cache. */
  files: ManagedFileEntry[];
  signature?: string;
  generatedAt?: string;
}

export interface ManifestLock {
  /** Currently installed build version. */
  buildVersion: string;
  /** Currently installed UI manifest version. */
  uiVersion: string;
  /** SHA-256 of last installed archive. */
  archiveSha256: string;
  /** Files we know we are managing — only these may be removed during cleanup. */
  managedFiles: { instance: string[]; ui: string[] };
  installedAt: string;
}

export interface LauncherConfig {
  name: string;
  version: string;
  buildManifestUrl: string;
  uiManifestUrl: string;
  /** Optional public key (hex, ed25519) to verify manifest signatures. */
  signaturePublicKey?: string;
  /** RAM allocation in MiB. */
  ramMb: number;
  /** Override install path. If null, defaults to userData/instance. */
  installPath: string | null;
  /** Maximum concurrent file downloads. */
  downloadConcurrency: number;
  /** Maximum retry attempts for a single file. */
  downloadRetries: number;
  /** Refuse to launch if manifest signature is missing/invalid. */
  requireValidSignature: boolean;
}

export interface DownloadProgress {
  totalBytes: number;
  downloadedBytes: number;
  /** Number of files completed (downloaded + verified). */
  filesDone: number;
  filesTotal: number;
  /** Currently active file (relative path). */
  current?: string;
  /** Bytes per second, smoothed. */
  speed?: number;
}

export type UpdateStage =
  | 'idle'
  | 'check'
  | 'download-archive'
  | 'extract'
  | 'verify'
  | 'download-ui'
  | 'cleanup'
  | 'ready'
  | 'launching'
  | 'error';

export interface UpdateState {
  stage: UpdateStage;
  message: string;
  progress?: DownloadProgress;
  error?: string;
}

export interface LogEntry {
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
}

/** Public surface of the API exposed to the renderer via contextBridge. */
export interface RendererApi {
  getConfig(): Promise<LauncherConfig>;
  saveConfig(patch: Partial<LauncherConfig>): Promise<LauncherConfig>;
  getInstalledVersion(): Promise<string | null>;
  checkForUpdates(): Promise<{
    buildVersion: string;
    uiVersion: string;
    needsUpdate: boolean;
    error?: string;
  }>;
  runUpdate(): Promise<void>;
  launchGame(): Promise<{ ok: boolean; profileId: string }>;
  pickInstallPath(): Promise<string | null>;
  resolveAssetUrl(name: string): Promise<string>;
  /** Subscribe to update state events. Returns an unsubscribe function. */
  onUpdateState(cb: (state: UpdateState) => void): () => void;
  /** Subscribe to streaming log entries. Returns an unsubscribe function. */
  onLog(cb: (entry: LogEntry) => void): () => void;
}
