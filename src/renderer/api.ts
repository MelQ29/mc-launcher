// Renderer-side type mirror of src/core/types.ts.
//
// We keep a separate copy because the renderer's tsconfig deliberately does
// not pull in main-process modules (no node types, different module target).
// If you change one of these, change the other.

export interface DownloadProgress {
  totalBytes: number;
  downloadedBytes: number;
  filesDone: number;
  filesTotal: number;
  current?: string;
  speed?: number;
}

export type UpdateStage =
  | 'idle' | 'check' | 'download-archive' | 'extract' | 'verify'
  | 'download-ui' | 'cleanup' | 'ready' | 'launching' | 'error';

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

export interface LauncherConfig {
  name: string;
  version: string;
  buildManifestUrl: string;
  uiManifestUrl: string;
  signaturePublicKey?: string;
  ramMb: number;
  installPath: string | null;
  downloadConcurrency: number;
  downloadRetries: number;
  requireValidSignature: boolean;
}

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
  resolveAssetUrl(name: string): Promise<string>;
  onUpdateState(cb: (state: UpdateState) => void): () => void;
  onLog(cb: (entry: LogEntry) => void): () => void;
}
