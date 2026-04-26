import { promises as fs } from 'fs';
import * as path from 'path';
import extractZip from 'extract-zip';
import { logger } from '../core/logger';

/**
 * Extracts an archive to `destDir`. Currently supports ZIP only — 7z support
 * is intentionally a stub: shipping a 7z extractor adds a native dependency,
 * and the build pipeline can repackage to ZIP. If a .7z is encountered the
 * launcher fails loud rather than silently producing a broken instance.
 */
export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.zip')) {
    logger.info('archive', `Extracting ZIP ${path.basename(archivePath)} -> ${destDir}`);
    await extractZip(archivePath, { dir: path.resolve(destDir) });
    return;
  }
  if (lower.endsWith('.7z')) {
    throw new Error(
      '7z archives are not supported in this build. Repackage the modpack as ZIP, ' +
      'or extend src/downloader/archive.ts with a 7z dependency (e.g. node-7z).',
    );
  }
  throw new Error(`Unsupported archive type: ${path.basename(archivePath)}`);
}

/** Removes an archive that we know is broken so the next run re-downloads cleanly. */
export async function discardArchive(archivePath: string): Promise<void> {
  await fs.unlink(archivePath).catch(() => undefined);
}
