/* Renderer-side type surface.
 *
 * These types are *structurally* the same as the main-process types in
 * src/core/types.ts and src/update/self-updater.ts, but duplicated here
 * deliberately: tsconfig.renderer.json's rootDir is src/renderer, and
 * the renderer cannot import from outside its tree without rootDir
 * violations. The boundary is a process boundary anyway — keep the two
 * surfaces in sync manually when the IPC contract changes.
 */

export type BuildId = string;

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

export interface DownloadProgress {
  totalBytes: number;
  downloadedBytes: number;
  filesDone: number;
  filesTotal: number;
  current?: string;
  speed?: number;
}

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

export interface BrandingManifest {
  video: string;
  playButton: string;
  optionsButton: string;
  replaceButton: string;
}

export type Modloader = 'fabric' | 'neoforge';

export interface BuildState {
  id: BuildId;
  displayName: string;
  shortName: string;
  accentColor: string;
  installed: boolean;
  installedVersion: string | null;
  availableVersion?: string;
  updateNeeded: boolean | null;
  branding: BrandingManifest | null;
  minecraft?: string;
  modloader?: Modloader;
  loaderVersion?: string;
  lastError?: string;
}

export interface PerBuildConfig {
  ramMb: number;
  installPath: string | null;
}

export interface LauncherConfig {
  schemaVersion: 2;
  buildsRegistryUrl: string;
  activeBuildId: BuildId;
  developerMode: boolean;
  signaturePublicKey?: string;
  downloadConcurrency: number;
  downloadRetries: number;
  requireValidSignature: boolean;
  perBuild: Record<BuildId, PerBuildConfig>;
}

export type NewsEntryType = 'changelog' | 'event' | 'notice';

export interface NewsEntry {
  id: string;
  date: string;
  type: NewsEntryType;
  title: string;
  body: string;
  eventStart?: string;
  eventEnd?: string;
  url?: string;
}

export type SelfUpdateStatus =
  | 'idle' | 'checking' | 'not-available' | 'available'
  | 'downloading' | 'ready' | 'error';

export interface SelfUpdateState {
  status: SelfUpdateStatus;
  version?: string;
  percent?: number;
  error?: string;
}

export interface BuildsListResponse {
  registry: BuildsRegistry;
  states: BuildState[];
  activeBuildId: BuildId;
}

export interface UpdateCheckResult {
  buildVersion: string;
  uiVersion: string;
  needsUpdate: boolean;
  recommendedRamMb?: number;
  minRamMb?: number;
  error?: string;
}

export interface RendererApi {
  getConfig(): Promise<LauncherConfig>;
  saveConfig(patch: Partial<LauncherConfig>): Promise<LauncherConfig>;
  saveBuildConfig(id: BuildId, patch: Partial<PerBuildConfig>): Promise<PerBuildConfig>;

  listBuilds(): Promise<BuildsListResponse>;
  setActiveBuild(id: BuildId): Promise<BuildState>;
  refreshBuilds(): Promise<BuildsRegistry>;

  getInstalledVersion(id?: BuildId): Promise<string | null>;
  checkForUpdates(id?: BuildId): Promise<UpdateCheckResult>;
  runUpdate(id?: BuildId): Promise<void>;

  launchGame(id?: BuildId): Promise<{ ok: boolean; profileId: string }>;

  fetchNews(id: BuildId): Promise<{ entries: NewsEntry[]; fromCache: boolean }>;

  pickInstallPath(): Promise<string | null>;
  getInstallInfo(id?: BuildId): Promise<{
    path: string; isCustomPath: boolean; exists: boolean;
    counts: Record<string, number>; totalBytes: number;
  }>;
  openInstallFolder(id?: BuildId): Promise<string>;
  resolveAssetUrl(id: BuildId, name: string): Promise<string>;

  devMode: {
    unlock(password: string): Promise<boolean>;
    isUnlocked(): Promise<boolean>;
    resetUiCache(id?: BuildId): Promise<void>;
    resetManifestLock(id?: BuildId): Promise<void>;
  };

  selfUpdate: {
    check(): Promise<void>;
    install(): Promise<void>;
    state(): Promise<SelfUpdateState>;
  };

  onUpdateState(cb: (s: UpdateState) => void): () => void;
  onLog(cb: (entry: LogEntry) => void): () => void;
  onNewsUpdated(cb: (msg: { buildId: BuildId; entries: NewsEntry[] }) => void): () => void;
  onRegistryChanged(cb: (reg: BuildsRegistry) => void): () => void;
  onActiveChanged(cb: (msg: { id: BuildId }) => void): () => void;
  onSelfUpdate(cb: (s: SelfUpdateState) => void): () => void;
}
