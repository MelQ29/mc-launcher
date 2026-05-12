import { app, BrowserWindow, dialog, net, protocol, shell } from 'electron';
import { pathToFileURL } from 'url';
import * as path from 'path';
import { promises as fs } from 'fs';
import { logger } from '../core/logger';
import { Paths } from '../core/paths';
import { ConfigStore } from '../core/config';
import { selfUpdater } from '../update/self-updater';
import { registerIpc } from './ipc';
import { BuildRegistry } from '../builds/registry';
import { BuildInstance } from '../builds/build-instance';

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
  const resourcesDir = app.isPackaged
    ? process.resourcesPath
    : path.resolve(__dirname, '..', '..', '..');
  const paths = new Paths(userData, resourcesDir);
  await fs.mkdir(paths.root, { recursive: true });
  await logger.init(paths.logs);
  logger.info('main', `EclipseFantasy starting (userData=${userData})`);

  const config = new ConfigStore(paths.settingsFile, paths.bundledConfig);
  await config.load();

  const registry = new BuildRegistry({
    paths, config,
    createInstance: (entry) => new BuildInstance({ paths, config, entry }),
  });
  await registry.load();

  selfUpdater.init();
  registerIpc({ paths, config, registry, selfUpdater, getWindow: () => mainWindow });

  setTimeout(() => { void selfUpdater.check(); }, 4000);

  // Use the modern protocol.handle API (vs deprecated registerFileProtocol)
  // because net.fetch supports HTTP Range requests, which the <video> element
  // requires to play files larger than a few megabytes — registerFileProtocol
  // returned the whole file as a single response and silently failed for the
  // 86 MB Summermon mp4.
  protocol.handle('ef-asset', async (request) => {
    // ef-asset://<buildId>/<name> — strip query string before path resolution.
    const url = decodeURIComponent(request.url.replace(/^ef-asset:\/\//, ''));
    const bare = url.replace(/\?.*$/, '');
    const m = bare.match(/^([a-z0-9-]+)\/(.+)$/i);
    let resolved: string | null = null;
    if (!m) {
      const candidate = path.join(paths.bundledAssets, bare);
      try { await fs.access(candidate); resolved = candidate; } catch { /* fall through */ }
    } else {
      const [, bid, rel] = m;
      const safeRel = rel.replace(/^[\\/]+/, '');
      for (const c of [
        path.join(paths.uiCache(bid), safeRel),
        path.join(paths.bundledAssets, `Iss_${safeRel}`),
        path.join(paths.bundledAssets, safeRel),
      ]) {
        try { await fs.access(c); resolved = c; break; } catch { /* next */ }
      }
    }
    if (!resolved) return new Response('Not found', { status: 404 });
    // Hand off to Electron's net.fetch for file:// — handles Range, MIME,
    // streaming. Propagate the original request headers (especially Range).
    return net.fetch(pathToFileURL(resolved).toString(), { headers: request.headers });
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
