import { app, BrowserWindow, dialog, protocol, shell } from 'electron';
import * as path from 'path';
import { promises as fs } from 'fs';
import { logger } from '../core/logger';
import { Paths } from '../core/paths';
import { ConfigStore } from '../core/config';
import { ManifestService } from '../manifest/manifest';
import { InstanceStorage } from '../storage/instance';
import { Updater } from '../update/updater';
import { selfUpdater } from '../update/self-updater';
import { GameLauncher } from '../launcher/launcher';
import { registerIpc } from './ipc';

/**
 * Electron main process entry. Wires up:
 *   - userData paths and logger
 *   - config store, manifests, updater, launcher
 *   - IPC bridge (in ipc.ts) consumed by the preload script
 *   - the main BrowserWindow
 */

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData');
  // In packaged builds, extraResources lands under process.resourcesPath; in
  // dev we read straight from the project tree (dist/main/main -> ../../..).
  const resourcesDir = app.isPackaged
    ? process.resourcesPath
    : path.resolve(__dirname, '..', '..', '..');
  const paths = new Paths(userData, resourcesDir);
  await fs.mkdir(paths.root, { recursive: true });
  await logger.init(paths.logs);
  logger.info('main', `EclipseFantasy starting (userData=${userData})`);

  const config = new ConfigStore(paths.settingsFile, paths.bundledConfig);
  await config.load();
  const instance = new InstanceStorage(paths.instanceRoot(config.current.installPath));
  await paths.ensureDirs(instance.path);

  const manifests = new ManifestService(paths.buildManifestCache, paths.uiManifestCache, paths.manifestLockFile);
  const updater = new Updater(paths, manifests, instance);
  const launcher = new GameLauncher(paths);

  selfUpdater.init();
  registerIpc({ paths, config, manifests, updater, launcher, instance, selfUpdater, getWindow: () => mainWindow });

  // Kick off a self-update check shortly after the window is ready so it
  // doesn't compete with the modpack manifest fetch on startup. Errors are
  // swallowed; nothing should block the user from launching the modpack
  // because the launcher itself can't reach the update server.
  setTimeout(() => { void selfUpdater.check(); }, 4000);

  // Custom protocol so the renderer can address bundled and downloaded UI
  // assets uniformly via "ef-asset://logo.png" — the main process routes the
  // request to the on-disk file (UI cache first, then bundled fallback).
  protocol.registerFileProtocol('ef-asset', async (request, callback) => {
    const url = decodeURIComponent(request.url.replace(/^ef-asset:\/\//, ''));
    const safeRel = url.replace(/^[\\/]+/, '').replace(/\?.*$/, '');
    const fromCache = path.join(paths.uiCache, safeRel);
    const fromBundle = path.join(paths.bundledAssets, `Iss_${safeRel}`);
    try { await fs.access(fromCache); callback({ path: fromCache }); return; } catch { /* try fallback */ }
    try { await fs.access(fromBundle); callback({ path: fromBundle }); return; } catch { /* try fallback */ }
    const generic = path.join(paths.bundledAssets, safeRel);
    callback({ path: generic });
  });

  await app.whenReady();
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}

async function createWindow(): Promise<void> {
  // Look up the icon both in dev (project tree) and packaged (resourcesPath/build)
  // — electron-builder copies build/ implicitly only as the app icon, not as
  // an extraResource, so we point at the project tree explicitly during dev.
  const iconCandidates = [
    path.join(__dirname, '..', '..', '..', 'build', 'icon.ico'),
    path.join(process.resourcesPath || '', 'build', 'icon.ico'),
  ];
  const { existsSync } = await import('fs');
  const icon = iconCandidates.find((p) => p && existsSync(p));

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 920,
    minHeight: 600,
    backgroundColor: '#0a0a14',
    title: 'EclipseFantasy',
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  win.on('closed', () => { mainWindow = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });

  const indexPath = path.join(__dirname, '..', '..', 'renderer', 'index.html');
  await win.loadFile(indexPath);
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => logger.error('main', 'uncaughtException', err));
process.on('unhandledRejection', (err) => logger.error('main', 'unhandledRejection', err as Error));

bootstrap().catch((err) => {
  console.error('Fatal startup error', err);
  if (app.isReady()) {
    void dialog.showMessageBox({ type: 'error', message: 'Не удалось запустить лаунчер', detail: String(err) });
  }
  app.exit(1);
});
