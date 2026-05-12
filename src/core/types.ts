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
  /** ID of the build from builds.json (matches BuildEntry.id). */
  buildId?: string;
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
  /** Recommended JVM heap (MiB) for this modpack. Surfaced in the UI. */
  recommendedRamMb?: number;
  /** Minimum JVM heap (MiB). Below this the launch warns the user. */
  minRamMb?: number;
  /** UI assets referenced by the renderer via ef-asset://<id>/<file>. */
  branding?: BrandingManifest;
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
  schemaVersion: 2;
  buildsRegistryUrl: string;
  activeBuildId: BuildId;
  developerMode: boolean;
  /** Optional public key (hex, ed25519) to verify manifest signatures. */
  signaturePublicKey?: string;
  /** Maximum concurrent file downloads. */
  downloadConcurrency: number;
  /** Maximum retry attempts for a single file. */
  downloadRetries: number;
  /** Refuse to launch if manifest signature is missing/invalid. */
  requireValidSignature: boolean;
  /** Per-build configuration (RAM allocation, install path). */
  perBuild: Record<BuildId, PerBuildConfig>;
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
  buildId: BuildId;
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

/** Public surface of the API exposed to the renderer via contextBridge. */
export interface RendererApi {
  getConfig(): Promise<LauncherConfig>;
  saveConfig(patch: Partial<LauncherConfig>): Promise<LauncherConfig>;
  getInstalledVersion(): Promise<string | null>;
  checkForUpdates(): Promise<{
    buildVersion: string;
    uiVersion: string;
    needsUpdate: boolean;
    recommendedRamMb?: number;
    minRamMb?: number;
    error?: string;
  }>;
  runUpdate(): Promise<void>;
  launchGame(): Promise<{ ok: boolean; profileId: string }>;
  pickInstallPath(): Promise<string | null>;
  getInstallInfo(): Promise<{
    path: string;
    isCustomPath: boolean;
    exists: boolean;
    counts: Record<string, number>;
    totalBytes: number;
  }>;
  openInstallFolder(): Promise<string>;
  resolveAssetUrl(name: string): Promise<string>;
  /** Subscribe to update state events. Returns an unsubscribe function. */
  onUpdateState(cb: (state: UpdateState) => void): () => void;
  /** Subscribe to streaming log entries. Returns an unsubscribe function. */
  onLog(cb: (entry: LogEntry) => void): () => void;
}
