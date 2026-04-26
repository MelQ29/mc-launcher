import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
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

  // Inspection helpers — used by the settings modal so the user can see
  // exactly which directory is being managed and verify a fresh install
  // really landed there.
  ipcMain.handle('paths:installInfo', async () => {
    const cfg = deps.config.current;
    const root = deps.instance.path;
    const exists = await fs.stat(root).then((s) => s.isDirectory()).catch(() => false);
    const counts: Record<string, number> = {};
    let totalBytes = 0;
    if (exists) {
      for (const sub of ['mods', 'config', 'resourcepacks', 'shaderpacks', 'datapacks']) {
        try {
          const entries = await fs.readdir(path.join(root, sub), { withFileTypes: true });
          counts[sub] = entries.filter((e) => e.isFile()).length;
        } catch { counts[sub] = 0; }
      }
      // Walk root for total size (one level — we don't need exact recursion).
      try {
        const stack: string[] = [root];
        const seen = new Set<string>();
        while (stack.length) {
          const dir = stack.pop()!;
          if (seen.has(dir)) continue;
          seen.add(dir);
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) stack.push(full);
            else if (e.isFile()) {
              try { totalBytes += (await fs.stat(full)).size; } catch { /* ignore */ }
            }
          }
        }
      } catch { /* ignore — show what we have */ }
    }
    return {
      path: root,
      isCustomPath: cfg.installPath !== null,
      exists,
      counts,
      totalBytes,
    };
  });
  ipcMain.handle('paths:openInstallFolder', async () => {
    const root = deps.instance.path;
    await fs.mkdir(root, { recursive: true });
    const err = await shell.openPath(root);
    if (err) logger.warn('ipc', `openPath failed: ${err}`);
    return root;
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
