export type {
  LauncherConfig, PerBuildConfig, UpdateState, LogEntry,
  BuildsRegistry, BuildEntry, BuildId, BuildState, NewsEntry,
} from '../core/types';
import type {
  LauncherConfig, PerBuildConfig, UpdateState, LogEntry,
  BuildsRegistry, BuildEntry, BuildId, BuildState, NewsEntry,
} from '../core/types';
export type { SelfUpdateState } from '../update/self-updater';
import type { SelfUpdateState } from '../update/self-updater';

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
