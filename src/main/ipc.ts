import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import { promises as fs } from 'fs';
import type { ConfigStore } from '../core/config';
import type { BuildRegistry } from '../builds/registry';
import type { SelfUpdater, SelfUpdateState } from '../update/self-updater';
import type { Paths } from '../core/paths';
import type { LogEntry, UpdateState, BuildId, PerBuildConfig } from '../core/types';
import { logger } from '../core/logger';
import { verifyDevPassword } from '../core/dev-password';

export interface IpcDeps {
  paths: Paths;
  config: ConfigStore;
  registry: BuildRegistry;
  selfUpdater: SelfUpdater;
  getWindow: () => BrowserWindow | null;
}

export function registerIpc(deps: IpcDeps): void {
  const activeOr = (id: string | null | undefined): BuildId =>
    (id ?? deps.config.current.activeBuildId);

  // === Config ===
  ipcMain.handle('config:get', async () => deps.config.current);
  ipcMain.handle('config:save', async (_e, patch) => deps.config.save(patch));
  ipcMain.handle('config:saveBuild', async (_e, id: BuildId, patch: Partial<PerBuildConfig>) =>
    deps.config.saveBuildConfig(id, patch),
  );

  // === Builds ===
  ipcMain.handle('builds:list', async () => ({
    registry: deps.registry.current(),
    states: await deps.registry.allStates(),
    activeBuildId: deps.config.current.activeBuildId,
  }));
  ipcMain.handle('builds:setActive', async (_e, id: BuildId) => deps.registry.setActive(id));
  ipcMain.handle('builds:refresh', async () => deps.registry.refresh());

  // === Updater (per-build) ===
  ipcMain.handle('updater:installedVersion', async (_e, id?: BuildId) =>
    deps.registry.get(activeOr(id)).installedVersion(),
  );
  ipcMain.handle('updater:check', async (_e, id?: BuildId) => {
    const inst = deps.registry.get(activeOr(id));
    try {
      const manifest = await inst.getBuildManifest();
      const lock = await inst.manifests.readLock();
      const ui = await inst.manifests.fetchUiManifest(
        inst.entry.uiManifestUrl,
        deps.config.current.signaturePublicKey,
        deps.config.current.requireValidSignature,
      );
      const needsUpdate =
        !lock || lock.buildVersion !== manifest.version || lock.archiveSha256 !== manifest.archiveSha256;
      return {
        buildVersion: manifest.version, uiVersion: ui.manifest.version, needsUpdate,
        recommendedRamMb: manifest.recommendedRamMb, minRamMb: manifest.minRamMb,
      };
    } catch (err) {
      const message = (err as Error).message;
      logger.warn('ipc', `check failed for ${inst.id}: ${message}`);
      return { buildVersion: 'unknown', uiVersion: 'unknown', needsUpdate: false, error: message };
    }
  });
  ipcMain.handle('updater:run', async (_e, id?: BuildId) => {
    const inst = deps.registry.get(activeOr(id));
    await inst.ensureDirs();
    await inst.updater.runUpdate(deps.config.current);
  });

  // === Launcher ===
  ipcMain.handle('launcher:play', async (_e, id?: BuildId) => {
    const inst = deps.registry.get(activeOr(id));
    const manifest = await inst.getBuildManifest();
    // Legacy manifests only have `fabricLoader`; new manifests have
    // explicit `modloader` + `loaderVersion`. Default to fabric.
    const modloader = manifest.modloader ?? 'fabric';
    const loaderVersion = manifest.loaderVersion ?? manifest.fabricLoader ?? '';
    return inst.launcher.launch(
      inst.perBuildConfig(),
      inst.instanceRoot(),
      manifest.minecraft, loaderVersion,
      inst.entry.displayName,
      modloader,
    );
  });

  // === News ===
  ipcMain.handle('news:fetch', async (_e, id: BuildId) => deps.registry.get(id).news.fetch());

  // === Paths / install info ===
  ipcMain.handle('paths:installInfo', async (_e, id?: BuildId) => {
    const inst = deps.registry.get(activeOr(id));
    const root = inst.instanceRoot();
    const cfg = inst.perBuildConfig();
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
      try {
        const stack: string[] = [root];
        const seen = new Set<string>();
        while (stack.length) {
          const dir = stack.pop()!;
          if (seen.has(dir)) continue;
          seen.add(dir);
          for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) stack.push(full);
            else if (ent.isFile()) {
              try { totalBytes += (await fs.stat(full)).size; } catch { /* ignore */ }
            }
          }
        }
      } catch { /* ignore */ }
    }
    return { path: root, isCustomPath: cfg.installPath !== null, exists, counts, totalBytes };
  });
  ipcMain.handle('paths:openInstallFolder', async (_e, id?: BuildId) => {
    const inst = deps.registry.get(activeOr(id));
    const root = inst.instanceRoot();
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

  // === Assets ===
  ipcMain.handle('assets:resolve', async (_e, id: BuildId, name: string) => {
    const safeId = String(id).replace(/[^a-z0-9-]/gi, '');
    const safeRel = String(name).replace(/^[\\/]+/, '').replace(/\?.*$/, '');
    const candidates = [
      path.join(deps.paths.uiCache(safeId), safeRel),
      path.join(deps.paths.bundledAssets, `Iss_${safeRel}`),
      path.join(deps.paths.bundledAssets, safeRel),
    ];
    for (const c of candidates) {
      try { await fs.access(c); return `ef-asset://${safeId}/${safeRel}`; }
      catch { /* try next */ }
    }
    return `ef-asset://${safeId}/${safeRel}`;
  });

  // === Dev mode ===
  ipcMain.handle('dev-mode:unlock', async (_e, password: string) => {
    const ok = verifyDevPassword(String(password ?? ''));
    if (ok) await deps.config.save({ developerMode: true });
    return ok;
  });
  ipcMain.handle('dev-mode:isUnlocked', async () => deps.config.current.developerMode);
  ipcMain.handle('dev:resetUiCache', async (_e, id?: BuildId) => {
    if (!deps.config.current.developerMode) throw new Error('developerMode required');
    await deps.registry.get(activeOr(id)).resetUiCache();
  });
  ipcMain.handle('dev:resetManifestLock', async (_e, id?: BuildId) => {
    if (!deps.config.current.developerMode) throw new Error('developerMode required');
    await deps.registry.get(activeOr(id)).resetManifestLock();
  });

  // === Self-update (unchanged) ===
  ipcMain.handle('self-update:check', async () => deps.selfUpdater.check());
  ipcMain.handle('self-update:install', async () => deps.selfUpdater.installNow());
  ipcMain.handle('self-update:state', async () => deps.selfUpdater.currentState);

  // === Streams: forward per-build updater + news state to renderer ===
  for (const entry of deps.registry.current().builds) {
    const inst = deps.registry.get(entry.id);
    inst.on('state', (state: UpdateState) => {
      deps.getWindow()?.webContents.send('updater:state', state);
    });
    inst.on('news-updated', (payload) => {
      deps.getWindow()?.webContents.send('news:updated', payload);
    });
  }
  deps.registry.on('builds-changed', (reg) => {
    deps.getWindow()?.webContents.send('registry:builds-changed', reg);
  });
  deps.registry.on('active-changed', (msg) => {
    deps.getWindow()?.webContents.send('registry:active-changed', msg);
  });
  deps.selfUpdater.on('state', (state: SelfUpdateState) => {
    deps.getWindow()?.webContents.send('self-update:state', state);
  });
  logger.on('entry', (entry: LogEntry) => {
    deps.getWindow()?.webContents.send('log:entry', entry);
  });
}
