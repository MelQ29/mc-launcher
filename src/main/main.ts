import { app, BrowserWindow, dialog, protocol, shell } from 'electron';
import * as path from 'path';
import { promises as fs } from 'fs';
import { logger } from '../core/logger';
import { Paths } from '../core/paths';
import { ConfigStore } from '../core/config';
import { ManifestService } from '../manifest/manifest';
import { InstanceStorage } from '../storage/instance';
import { Updater } from '../update/updater';
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

  registerIpc({ paths, config, manifests, updater, launcher, instance, getWindow: () => mainWindow });

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
  const win = new BrowserWindow({
    width: 980,
    height: 620,
    minWidth: 860,
    minHeight: 540,
    backgroundColor: '#0b0b15',
    title: 'EclipseFantasy',
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
