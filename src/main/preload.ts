import { contextBridge, ipcRenderer } from 'electron';
import type {
  LauncherConfig, PerBuildConfig, UpdateState, LogEntry,
  BuildsRegistry, BuildId, NewsEntry,
} from '../core/types';
import type { SelfUpdateState } from '../update/self-updater';

const listeners = {
  update: new Set<(s: UpdateState) => void>(),
  log: new Set<(e: LogEntry) => void>(),
  news: new Set<(m: { buildId: BuildId; entries: NewsEntry[] }) => void>(),
  registry: new Set<(r: BuildsRegistry) => void>(),
  active: new Set<(m: { id: BuildId }) => void>(),
  self: new Set<(s: SelfUpdateState) => void>(),
};

ipcRenderer.on('updater:state', (_e, s) => listeners.update.forEach((cb) => safeCall(cb, s)));
ipcRenderer.on('log:entry', (_e, e) => listeners.log.forEach((cb) => safeCall(cb, e)));
ipcRenderer.on('news:updated', (_e, m) => listeners.news.forEach((cb) => safeCall(cb, m)));
ipcRenderer.on('registry:builds-changed', (_e, r) => listeners.registry.forEach((cb) => safeCall(cb, r)));
ipcRenderer.on('registry:active-changed', (_e, m) => listeners.active.forEach((cb) => safeCall(cb, m)));
ipcRenderer.on('self-update:state', (_e, s) => listeners.self.forEach((cb) => safeCall(cb, s)));

function safeCall<T>(cb: (x: T) => void, x: T): void {
  try { cb(x); } catch { /* swallow */ }
}

const api = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch: Partial<LauncherConfig>) => ipcRenderer.invoke('config:save', patch),
  saveBuildConfig: (id: BuildId, patch: Partial<PerBuildConfig>) =>
    ipcRenderer.invoke('config:saveBuild', id, patch),

  listBuilds: () => ipcRenderer.invoke('builds:list'),
  setActiveBuild: (id: BuildId) => ipcRenderer.invoke('builds:setActive', id),
  refreshBuilds: () => ipcRenderer.invoke('builds:refresh'),

  getInstalledVersion: (id?: BuildId) => ipcRenderer.invoke('updater:installedVersion', id),
  checkForUpdates: (id?: BuildId) => ipcRenderer.invoke('updater:check', id),
  runUpdate: (id?: BuildId) => ipcRenderer.invoke('updater:run', id),

  launchGame: (id?: BuildId) => ipcRenderer.invoke('launcher:play', id),
  fetchNews: (id: BuildId) => ipcRenderer.invoke('news:fetch', id),

  pickInstallPath: () => ipcRenderer.invoke('paths:pickInstallDir'),
  getInstallInfo: (id?: BuildId) => ipcRenderer.invoke('paths:installInfo', id),
  openInstallFolder: (id?: BuildId) => ipcRenderer.invoke('paths:openInstallFolder', id),
  resolveAssetUrl: (id: BuildId, name: string) => ipcRenderer.invoke('assets:resolve', id, name),

  devMode: {
    unlock: (password: string) => ipcRenderer.invoke('dev-mode:unlock', password),
    isUnlocked: () => ipcRenderer.invoke('dev-mode:isUnlocked'),
    resetUiCache: (id?: BuildId) => ipcRenderer.invoke('dev:resetUiCache', id),
    resetManifestLock: (id?: BuildId) => ipcRenderer.invoke('dev:resetManifestLock', id),
  },
  selfUpdate: {
    check: () => ipcRenderer.invoke('self-update:check'),
    install: () => ipcRenderer.invoke('self-update:install'),
    state: () => ipcRenderer.invoke('self-update:state'),
  },

  onUpdateState(cb: (s: UpdateState) => void) { listeners.update.add(cb); return () => listeners.update.delete(cb); },
  onLog(cb: (e: LogEntry) => void) { listeners.log.add(cb); return () => listeners.log.delete(cb); },
  onNewsUpdated(cb: (m: { buildId: BuildId; entries: NewsEntry[] }) => void) {
    listeners.news.add(cb); return () => listeners.news.delete(cb);
  },
  onRegistryChanged(cb: (r: BuildsRegistry) => void) { listeners.registry.add(cb); return () => listeners.registry.delete(cb); },
  onActiveChanged(cb: (m: { id: BuildId }) => void) { listeners.active.add(cb); return () => listeners.active.delete(cb); },
  onSelfUpdate(cb: (s: SelfUpdateState) => void) { listeners.self.add(cb); return () => listeners.self.delete(cb); },
};

contextBridge.exposeInMainWorld('eclipseApi', api);
