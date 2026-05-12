import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import type {
  BuildManifest,
  UiManifest,
  LauncherConfig,
  UpdateState,
  ManagedFileEntry,
  DownloadProgress,
} from '../core/types';
import { ManifestService } from '../manifest/manifest';
import { Downloader } from '../downloader/downloader';
import { extractArchive, discardArchive } from '../downloader/archive';
import { sha256File, verifyFile } from '../downloader/hash';
import { diffAgainstManifest, removeManaged, makeLock } from '../manifest/differ';
import { logger } from '../core/logger';
import type { Paths } from '../core/paths';

/**
 * Orchestrates the full update flow:
 *   1. fetch manifests (with cache fallback for offline mode)
 *   2. compare against manifest.lock + on-disk hashes
 *   3. download archive (resumable, retried, hash-verified)
 *   4. extract into a staging directory and verify every file by hash
 *   5. promote staging into the live instance and remove orphaned managed files
 *   6. sync UI assets independently from build assets
 *
 * Steps 3 and 4 are isolated so a corrupted archive forces re-download instead
 * of polluting the live instance.
 */
export class Updater extends EventEmitter {
  private state: UpdateState;

  constructor(
    private readonly buildId: string,
    private readonly paths: Paths,
    private readonly manifests: ManifestService,
    private readonly instancePath: string,
    private readonly buildManifestUrl: string,
    private readonly uiManifestUrl: string,
  ) {
    super();
    this.state = { buildId, stage: 'idle', message: 'idle' };
  }

  get currentState(): UpdateState { return this.state; }

  /**
   * Public hook used by GameLauncher to surface launch-time progress
   * (e.g. "Скачиваю NeoForge installer", "Устанавливаю NeoForge...").
   * Emits a regular `state` event that the renderer's progress block
   * already listens to — no extra wiring needed.
   */
  publishLaunchingState(message: string): void {
    this.setState({ stage: 'launching', message, progress: undefined });
  }

  /** Reset to idle from the renderer-visible stream (e.g. after launch). */
  publishIdleState(): void {
    this.setState({ stage: 'idle', message: 'idle', progress: undefined });
  }

  private setState(s: Partial<UpdateState>): void {
    this.state = { ...this.state, ...s, buildId: this.buildId };
    this.emit('state', this.state);
  }

  /** Reads the lock and tells the UI what's installed without doing any I/O outside the launcher dir. */
  async installedVersion(): Promise<string | null> {
    const lock = await this.manifests.readLock();
    return lock?.buildVersion ?? null;
  }

  /** Fetch manifests and report whether any update would be applied. */
  async checkForUpdates(config: LauncherConfig): Promise<{
    buildVersion: string;
    uiVersion: string;
    needsUpdate: boolean;
    recommendedRamMb?: number;
    minRamMb?: number;
  }> {
    this.setState({ stage: 'check', message: 'Проверка обновлений...' });
    const [{ manifest: build }, { manifest: ui }] = await Promise.all([
      this.manifests.fetchBuildManifest(this.buildManifestUrl, config.signaturePublicKey, config.requireValidSignature),
      this.manifests.fetchUiManifest(this.uiManifestUrl, config.signaturePublicKey, config.requireValidSignature),
    ]);
    const lock = await this.manifests.readLock();
    const needsUpdate =
      !lock ||
      lock.buildVersion !== build.version ||
      lock.uiVersion !== ui.version ||
      lock.archiveSha256 !== build.archiveSha256;
    this.setState({ stage: 'idle', message: needsUpdate ? 'Доступно обновление' : 'Сборка актуальна' });
    return {
      buildVersion: build.version,
      uiVersion: ui.version,
      needsUpdate,
      recommendedRamMb: build.recommendedRamMb,
      minRamMb: build.minRamMb,
    };
  }

  /**
   * Download UI assets only (no archive, no instance changes). Used at startup
   * to pre-warm `ef-asset://` lookups so video/buttons render before the user
   * runs a full update.
   */
  async runUiSync(config: LauncherConfig): Promise<void> {
    try {
      await fs.mkdir(this.paths.uiCache(this.buildId), { recursive: true });
      this.setState({ stage: 'download-ui', message: 'Загружаю UI-ассеты...' });
      // Fetch both manifests so branding (build_manifest.branding.video etc.)
      // is cached on disk for BuildInstance.state() to read.
      await this.manifests.fetchBuildManifest(
        this.buildManifestUrl, config.signaturePublicKey, config.requireValidSignature,
      );
      const { manifest: ui } = await this.manifests.fetchUiManifest(
        this.uiManifestUrl, config.signaturePublicKey, config.requireValidSignature,
      );
      const lock = await this.manifests.readLock();
      await this.syncUi(ui, lock?.managedFiles.ui ?? [], config);
      this.setState({ stage: 'ready', message: 'UI готов' });
    } catch (err) {
      const msg = (err as Error).message;
      logger.warn('updater', `UI-only sync failed: ${msg}`);
      this.setState({ stage: 'idle', message: 'idle' });
    }
  }

  async runUpdate(config: LauncherConfig): Promise<void> {
    try {
      await fs.mkdir(this.paths.cache(this.buildId), { recursive: true });
      await fs.mkdir(this.paths.uiCache(this.buildId), { recursive: true });

      this.setState({ stage: 'check', message: 'Загружаю манифест сборки...' });
      const { manifest: build, offline } = await this.manifests.fetchBuildManifest(
        this.buildManifestUrl, config.signaturePublicKey, config.requireValidSignature,
      );
      const { manifest: ui } = await this.manifests.fetchUiManifest(
        this.uiManifestUrl, config.signaturePublicKey, config.requireValidSignature,
      );

      const lock = await this.manifests.readLock();
      if (offline && lock && lock.buildVersion === build.version) {
        logger.info('updater', 'Offline mode: cached manifest matches lock, skipping download');
        await this.syncUi(ui, lock?.managedFiles.ui ?? [], config);
        await this.persistLock(build, ui, lock?.managedFiles.ui ?? []);
        this.setState({ stage: 'ready', message: 'Готово (оффлайн)' });
        return;
      }

      const archiveNeeded =
        !lock || lock.buildVersion !== build.version || lock.archiveSha256 !== build.archiveSha256;

      if (archiveNeeded) {
        await this.downloadAndExtractArchive(build, config);
      } else {
        // Same archive recorded in the lock, but verify files are still on
        // disk at the current instancePath. If they're missing (e.g. user
        // changed installPath since last install, or wiped the folder),
        // verifyInstance throws RetryWithArchive — catch it and re-extract
        // from the cached archive (downloadAndExtractArchive reuses the
        // local copy when its sha matches, no re-download).
        try {
          await this.verifyInstance(build);
        } catch (err) {
          if (err instanceof RetryWithArchive) {
            logger.info('updater', 'Instance files drifted/missing — re-extracting archive');
            await this.downloadAndExtractArchive(build, config);
          } else {
            throw err;
          }
        }
      }

      // Remove files that were in the previous manifest but not the new one.
      this.setState({ stage: 'cleanup', message: 'Очистка устаревших файлов сборки...' });
      const orphans = (lock?.managedFiles.instance ?? []).filter(
        (p) => !build.files.some((f) => normalize(f.path) === normalize(p)),
      );
      if (orphans.length > 0) {
        logger.info('updater', `Removing ${orphans.length} orphaned managed files`);
        await removeManaged(this.instancePath, orphans);
      }

      await this.syncUi(ui, lock?.managedFiles.ui ?? [], config);
      await this.persistLock(build, ui, lock?.managedFiles.ui ?? []);
      this.setState({ stage: 'ready', message: 'Готово к запуску' });
    } catch (err) {
      const msg = (err as Error).message;
      logger.error('updater', 'Update failed', err);
      this.setState({ stage: 'error', message: 'Ошибка обновления', error: msg });
      throw err;
    }
  }

  /** Download archive (with retry), extract to staging, hash-verify, then promote. */
  private async downloadAndExtractArchive(build: BuildManifest, config: LauncherConfig): Promise<void> {
    const archiveName = path.basename(new URL(build.archiveUrl).pathname) || 'modpack.zip';
    const archivePath = path.join(this.paths.cache(this.buildId), archiveName);
    const downloader = new Downloader(config.downloadConcurrency);

    // Try cached archive first.
    let archiveOk = await verifyFile(archivePath, build.archiveSha256);
    if (archiveOk) {
      logger.info('updater', 'Reusing cached archive (hash matches)');
    }

    let archiveAttempts = 0;
    while (!archiveOk) {
      archiveAttempts++;
      if (archiveAttempts > 3) {
        throw new Error('Archive download/verification failed 3 times — giving up');
      }
      this.setState({
        stage: 'download-archive',
        message: `Скачиваю архив сборки (попытка ${archiveAttempts}/3)...`,
        progress: emptyProgress(build.archiveSize ?? 0),
      });
      await downloader.downloadOne({
        url: build.archiveUrl,
        dest: archivePath,
        sha256: build.archiveSha256,
        size: build.archiveSize,
        retries: config.downloadRetries,
        onProgress: (delta) => this.bumpArchiveProgress(delta, build.archiveSize ?? 0),
      });
      archiveOk = await verifyFile(archivePath, build.archiveSha256);
      if (!archiveOk) {
        logger.warn('updater', 'Archive hash mismatch after download — discarding and retrying');
        await discardArchive(archivePath);
      }
    }

    // Extract to staging dir, verify, then merge into instance.
    const staging = path.join(os.tmpdir(), `eclipsefantasy-stage-${Date.now()}`);
    try {
      this.setState({ stage: 'extract', message: 'Распаковка архива...' });
      await fs.rm(staging, { recursive: true, force: true });
      await fs.mkdir(staging, { recursive: true });
      await extractArchive(archivePath, staging);

      this.setState({ stage: 'verify', message: 'Проверка целостности файлов сборки...' });
      const bad = await this.verifyExtractedAgainstManifest(staging, build.files);
      if (bad.length > 0) {
        await discardArchive(archivePath);
        throw new Error(`Archive contents do not match manifest (${bad.length} mismatched files): ${bad.slice(0, 3).join(', ')}...`);
      }

      // Promote: copy staging files into the instance directory. Files that
      // exist in the manifest will be overwritten; everything else is left alone.
      this.setState({ stage: 'verify', message: 'Применяю файлы сборки...' });
      for (const entry of build.files) {
        const src = path.join(staging, entry.path);
        const dst = path.join(this.instancePath, entry.path);
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.copyFile(src, dst);
      }
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Re-hash currently-installed instance files; if any drift, re-extract. */
  private async verifyInstance(build: BuildManifest): Promise<void> {
    this.setState({ stage: 'verify', message: 'Проверка существующих файлов...' });
    const diff = await diffAgainstManifest(this.instancePath, build.files, []);
    if (diff.toDownload.length === 0) {
      logger.info('updater', 'Instance verified, no changes needed');
      return;
    }
    logger.warn('updater', `${diff.toDownload.length} instance files drifted; will re-extract archive`);
    // Force re-download path by recursing.
    throw new RetryWithArchive();
  }

  private async verifyExtractedAgainstManifest(stagingDir: string, files: ManagedFileEntry[]): Promise<string[]> {
    const bad: string[] = [];
    for (const f of files) {
      const abs = path.join(stagingDir, f.path);
      try {
        const actual = await sha256File(abs);
        if (actual.toLowerCase() !== f.sha256.toLowerCase()) bad.push(f.path);
      } catch {
        bad.push(f.path);
      }
    }
    return bad;
  }

  private async syncUi(ui: UiManifest, previouslyManagedUi: string[], config: LauncherConfig): Promise<void> {
    this.setState({ stage: 'download-ui', message: 'Синхронизация UI-ассетов...' });
    const diff = await diffAgainstManifest(this.paths.uiCache(this.buildId), ui.files, previouslyManagedUi);
    if (diff.toRemove.length > 0) await removeManaged(this.paths.uiCache(this.buildId), diff.toRemove);
    if (diff.toDownload.length === 0) return;

    const items = diff.toDownload.map((f) => ({
      id: f.path,
      url: f.url ?? '',
      dest: path.join(this.paths.uiCache(this.buildId), f.path),
      sha256: f.sha256,
      size: f.size,
    }));
    const missingUrl = items.find((it) => !it.url);
    if (missingUrl) {
      throw new Error(`UI manifest entry missing url: ${missingUrl.id}`);
    }
    const downloader = new Downloader(config.downloadConcurrency);
    await downloader.downloadBatch(
      items,
      (p) => this.setState({ stage: 'download-ui', message: 'Загружаю UI-ассеты...', progress: p }),
      config.downloadRetries,
    );
  }

  private async persistLock(build: BuildManifest, ui: UiManifest, _previousUi: string[]): Promise<void> {
    await this.manifests.writeLock(makeLock({
      buildVersion: build.version,
      uiVersion: ui.version,
      archiveSha256: build.archiveSha256,
      instanceFiles: build.files,
      uiFiles: ui.files,
    }));
  }

  private bumpArchiveProgress(delta: number, total: number): void {
    const prev = this.state.progress ?? emptyProgress(total);
    const downloaded = Math.min(prev.downloadedBytes + delta, total || prev.downloadedBytes + delta);
    this.setState({
      progress: {
        ...prev,
        downloadedBytes: downloaded,
        totalBytes: total || downloaded,
        filesDone: 0,
        filesTotal: 1,
        current: 'modpack archive',
      },
    });
  }
}

/** Internal sentinel: forces the calling flow to re-enter the archive path. */
class RetryWithArchive extends Error {}

function emptyProgress(total: number): DownloadProgress {
  return { totalBytes: total, downloadedBytes: 0, filesDone: 0, filesTotal: 1 };
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}
