import { autoUpdater } from 'electron-updater';
import { EventEmitter } from 'events';
import { logger } from '../core/logger';

export interface SelfUpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'not-available' | 'error';
  /** Version available on the server. Set when status is `available` or later. */
  version?: string;
  /** 0..100 download progress. Set when status is `downloading`. */
  percent?: number;
  /** Bytes per second (smoothed by electron-updater). */
  bytesPerSecond?: number;
  error?: string;
}

/**
 * Wraps electron-updater so the renderer only sees a typed event stream.
 *
 * Defaults:
 *   - autoDownload = true → start fetching immediately when an update is found
 *   - autoInstallOnAppQuit = true → if the user closes the app without
 *     clicking "restart now", the update is applied next launch
 *
 * The renderer can still ask for an explicit `quitAndInstall()` once the
 * download is ready (see ipc.ts).
 */
export class SelfUpdater extends EventEmitter {
  private state: SelfUpdateState = { status: 'idle' };
  private wired = false;

  get currentState(): SelfUpdateState { return this.state; }

  init(): void {
    if (this.wired) return;
    this.wired = true;

    autoUpdater.logger = {
      // Pipe electron-updater's chatter into our streaming logger.
      debug: (msg: string) => logger.debug('self-update', String(msg)),
      info:  (msg: string) => logger.info('self-update', String(msg)),
      warn:  (msg: string) => logger.warn('self-update', String(msg)),
      error: (msg: string) => logger.error('self-update', String(msg)),
    };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }));
    autoUpdater.on('update-available', (info) => this.set({ status: 'available', version: info.version }));
    autoUpdater.on('update-not-available', (info) => this.set({ status: 'not-available', version: info?.version }));
    autoUpdater.on('error', (err) => this.set({ status: 'error', error: err?.message ?? String(err) }));
    autoUpdater.on('download-progress', (p) => this.set({
      status: 'downloading',
      percent: p.percent,
      bytesPerSecond: p.bytesPerSecond,
    }));
    autoUpdater.on('update-downloaded', (info) => this.set({ status: 'ready', version: info.version }));
  }

  /** Trigger a check. Safe to call multiple times — electron-updater dedupes. */
  async check(): Promise<void> {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      this.set({ status: 'error', error: (err as Error).message });
    }
  }

  /** Quit the app and run the bundled installer. Only call after status === 'ready'. */
  installNow(): void {
    if (this.state.status !== 'ready') {
      logger.warn('self-update', `installNow() called in state=${this.state.status} — ignoring`);
      return;
    }
    // false, true → don't be silent, force run after install
    autoUpdater.quitAndInstall(false, true);
  }

  private set(s: Partial<SelfUpdateState>): void {
    this.state = { ...this.state, ...s };
    this.emit('state', this.state);
  }
}

export const selfUpdater = new SelfUpdater();
