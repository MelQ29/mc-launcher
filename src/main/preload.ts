import { contextBridge, ipcRenderer } from 'electron';
import type { LauncherConfig, UpdateState, LogEntry } from '../core/types';
import type { SelfUpdateState } from '../update/self-updater';

/**
 * Bridge between the sandboxed renderer and the main process.
 *
 * Everything privileged crosses this single ipcRenderer.invoke surface so
 * the renderer stays free of node, fs, and child_process — it just sees
 * the typed `eclipseApi` object below.
 */

const updateStateListeners = new Set<(s: UpdateState) => void>();
const logListeners = new Set<(e: LogEntry) => void>();
const selfUpdateListeners = new Set<(s: SelfUpdateState) => void>();

ipcRenderer.on('updater:state', (_evt, state: UpdateState) => {
  for (const cb of updateStateListeners) {
    try { cb(state); } catch { /* swallow listener errors */ }
  }
});
ipcRenderer.on('log:entry', (_evt, entry: LogEntry) => {
  for (const cb of logListeners) {
    try { cb(entry); } catch { /* swallow */ }
  }
});
ipcRenderer.on('self-update:state', (_evt, state: SelfUpdateState) => {
  for (const cb of selfUpdateListeners) {
    try { cb(state); } catch { /* swallow */ }
  }
});

const api = {
  getConfig: (): Promise<LauncherConfig> => ipcRenderer.invoke('config:get'),
  saveConfig: (patch: Partial<LauncherConfig>): Promise<LauncherConfig> =>
    ipcRenderer.invoke('config:save', patch),
  getInstalledVersion: (): Promise<string | null> => ipcRenderer.invoke('updater:installedVersion'),
  checkForUpdates: (): Promise<{
    buildVersion: string;
    uiVersion: string;
    needsUpdate: boolean;
    recommendedRamMb?: number;
    minRamMb?: number;
    error?: string;
  }> => ipcRenderer.invoke('updater:check'),
  runUpdate: (): Promise<void> => ipcRenderer.invoke('updater:run'),
  launchGame: (): Promise<{ ok: boolean; profileId: string }> => ipcRenderer.invoke('launcher:launch'),
  pickInstallPath: (): Promise<string | null> => ipcRenderer.invoke('paths:pickInstallDir'),
  resolveAssetUrl: (name: string): Promise<string> => ipcRenderer.invoke('assets:resolve', name),
  onUpdateState(cb: (state: UpdateState) => void): () => void {
    updateStateListeners.add(cb);
    return () => updateStateListeners.delete(cb);
  },
  onLog(cb: (entry: LogEntry) => void): () => void {
    logListeners.add(cb);
    return () => logListeners.delete(cb);
  },
  selfUpdate: {
    check: (): Promise<void> => ipcRenderer.invoke('self-update:check'),
    install: (): Promise<void> => ipcRenderer.invoke('self-update:install'),
    state: (): Promise<SelfUpdateState> => ipcRenderer.invoke('self-update:state'),
  },
  onSelfUpdate(cb: (s: SelfUpdateState) => void): () => void {
    selfUpdateListeners.add(cb);
    return () => selfUpdateListeners.delete(cb);
  },
};

contextBridge.exposeInMainWorld('eclipseApi', api);
