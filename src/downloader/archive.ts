import { promises as fs } from 'fs';
import * as path from 'path';
import extractZip from 'extract-zip';
import { logger } from '../core/logger';

/**
 * Extracts an archive to `destDir`. Currently supports ZIP only — 7z support
 * is intentionally a stub: shipping a 7z extractor adds a native dependency,
 * and the build pipeline can repackage to ZIP. If a .7z is encountered the
 * launcher fails loud rather than silently producing a broken instance.
 *
 * After extraction, if every top-level entry sits inside a single directory
 * (a common shape when authors zip their modpack folder rather than its
 * contents), that directory is unwrapped so files land directly in `destDir`.
 * That way the manifest can list paths as `mods/x.jar` regardless of how the
 * source archive was assembled.
 */
export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.zip')) {
    logger.info('archive', `Extracting ZIP ${path.basename(archivePath)} -> ${destDir}`);
    await extractZip(archivePath, { dir: path.resolve(destDir) });
    await unwrapSingleRoot(destDir);
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

/**
 * If `destDir` contains exactly one entry and that entry is a directory,
 * move its contents up one level and delete the now-empty wrapper. Used to
 * normalise modpack archives that wrap everything in `<modpack name>/`.
 */
async function unwrapSingleRoot(destDir: string): Promise<void> {
  const entries = await fs.readdir(destDir, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) return;
  const wrapper = path.join(destDir, entries[0].name);
  const inner = await fs.readdir(wrapper);
  logger.info('archive', `Unwrapping single root "${entries[0].name}" (${inner.length} items)`);
  for (const name of inner) {
    await fs.rename(path.join(wrapper, name), path.join(destDir, name));
  }
  await fs.rmdir(wrapper);
}
