import { BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import { promises as fs } from 'fs';
import type { ConfigStore } from '../core/config';
import type { ManifestService } from '../manifest/manifest';
import type { Updater } from '../update/updater';
import type { SelfUpdater, SelfUpdateState } from '../update/self-updater';
import type { GameLauncher } from '../launcher/launcher';
import type { Paths } from '../core/paths';
import type { InstanceStorage } from '../storage/instance';
import type { LogEntry, UpdateState } from '../core/types';
import { logger } from '../core/logger';

export interface IpcDeps {
  paths: Paths;
  config: ConfigStore;
  manifests: ManifestService;
  updater: Updater;
  launcher: GameLauncher;
  instance: InstanceStorage;
  selfUpdater: SelfUpdater;
  getWindow: () => BrowserWindow | null;
}

/**
 * Wires up all IPC channels exposed to the renderer. The renderer never
 * touches the file system or network directly — every privileged operation
 * goes through this layer, which is what lets us keep contextIsolation on
 * and sandbox the renderer.
 */
export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle('config:get', async () => deps.config.current);
  ipcMain.handle('config:save', async (_evt, patch: Record<string, unknown>) => {
    const updated = await deps.config.save(patch);
    return updated;
  });

  ipcMain.handle('updater:installedVersion', async () => deps.updater.installedVersion());
  ipcMain.handle('updater:check', async () => {
    const cfg = deps.config.current;
    try {
      return await deps.updater.checkForUpdates(cfg);
    } catch (err) {
      // First-run with no GitHub release yet, or no network: surface as a
      // structured "unknown" response so the renderer can show a friendly
      // state instead of an error toast in the main console.
      const message = (err as Error).message;
      logger.warn('ipc', `check failed: ${message}`);
      return { buildVersion: 'unknown', uiVersion: 'unknown', needsUpdate: false, error: message };
    }
  });
  ipcMain.handle('updater:run', async () => {
    const cfg = deps.config.current;
    await deps.updater.runUpdate(cfg);
  });

  ipcMain.handle('launcher:launch', async () => {
    const cfg = deps.config.current;
    const { manifest } = await deps.manifests.fetchBuildManifest(
      cfg.buildManifestUrl, cfg.signaturePublicKey, cfg.requireValidSignature,
    );
    const result = await deps.launcher.launch(cfg, deps.instance.path, manifest.minecraft, manifest.fabricLoader);
    logger.info('launcher', `launch result: ok=${result.ok} profile=${result.profileId}`);
    return result;
  });

  ipcMain.handle('paths:pickInstallDir', async () => {
    const win = deps.getWindow();
    const r = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Выберите папку установки',
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return r.filePaths[0];
  });

  ipcMain.handle('assets:resolve', async (_evt, name: string) => {
    const safeRel = String(name).replace(/^[\\/]+/, '').replace(/\?.*$/, '');
    const candidates = [
      path.join(deps.paths.uiCache, safeRel),
      path.join(deps.paths.bundledAssets, `Iss_${safeRel}`),
      path.join(deps.paths.bundledAssets, safeRel),
    ];
    for (const c of candidates) {
      try { await fs.access(c); return `ef-asset://${safeRel}`; }
      catch { /* try next */ }
    }
    return `ef-asset://${safeRel}`; // protocol handler will return whatever exists / 404
  });

  ipcMain.handle('self-update:check', async () => deps.selfUpdater.check());
  ipcMain.handle('self-update:install', async () => deps.selfUpdater.installNow());
  ipcMain.handle('self-update:state', async () => deps.selfUpdater.currentState);

  // Streams: forward updater state and log entries to the active window.
  deps.updater.on('state', (state: UpdateState) => {
    deps.getWindow()?.webContents.send('updater:state', state);
  });
  deps.selfUpdater.on('state', (state: SelfUpdateState) => {
    deps.getWindow()?.webContents.send('self-update:state', state);
  });
  logger.on('entry', (entry: LogEntry) => {
    deps.getWindow()?.webContents.send('log:entry', entry);
  });
}
