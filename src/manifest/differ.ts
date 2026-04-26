import { promises as fs } from 'fs';
import * as path from 'path';
import type { ManagedFileEntry, ManifestLock } from '../core/types';
import { sha256File } from '../downloader/hash';
import { logger } from '../core/logger';

export interface DiffResult {
  /** Files that need (re-)downloading because they're missing or hash mismatches. */
  toDownload: ManagedFileEntry[];
  /** Previously-managed files no longer in the manifest — safe to remove. */
  toRemove: string[];
  /** Files that already match the desired state. */
  upToDate: ManagedFileEntry[];
}

/**
 * Computes a diff between the on-disk state under `root` and a target manifest.
 *
 * Important: only files listed in `previouslyManaged` may appear in `toRemove`.
 * Anything else is treated as user content and never deleted. This keeps user
 * configs, screenshots, world saves, etc. safe even if they live inside the
 * instance directory.
 */
export async function diffAgainstManifest(
  root: string,
  desired: ManagedFileEntry[],
  previouslyManaged: string[],
): Promise<DiffResult> {
  const desiredByPath = new Map<string, ManagedFileEntry>();
  for (const f of desired) desiredByPath.set(normalize(f.path), f);

  const toDownload: ManagedFileEntry[] = [];
  const upToDate: ManagedFileEntry[] = [];

  for (const entry of desired) {
    const abs = path.join(root, entry.path);
    let needs = false;
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) needs = true;
      else if (entry.size != null && entry.size !== stat.size) needs = true;
      else {
        const actual = await sha256File(abs);
        needs = actual.toLowerCase() !== entry.sha256.toLowerCase();
      }
    } catch {
      needs = true;
    }
    if (needs) toDownload.push(entry);
    else upToDate.push(entry);
  }

  // Of the previously-managed files, anything not in the new manifest gets removed.
  const toRemove: string[] = [];
  for (const prev of previouslyManaged) {
    const norm = normalize(prev);
    if (!desiredByPath.has(norm)) toRemove.push(prev);
  }

  logger.info(
    'differ',
    `diff: ${toDownload.length} to download, ${toRemove.length} to remove, ${upToDate.length} up-to-date`,
  );
  return { toDownload, toRemove, upToDate };
}

/** Remove files that were managed by an old manifest but no longer present. */
export async function removeManaged(root: string, files: string[]): Promise<void> {
  for (const rel of files) {
    const abs = path.join(root, rel);
    await fs.unlink(abs).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') logger.warn('differ', `Could not remove ${abs}: ${err.message}`);
    });
  }
  // Best-effort cleanup of empty directories under the root.
  await pruneEmptyDirs(root);
}

async function pruneEmptyDirs(root: string): Promise<void> {
  const stack: string[] = [];
  await collect(root, stack);
  // Process deepest first.
  stack.sort((a, b) => b.length - a.length);
  for (const dir of stack) {
    if (path.resolve(dir) === path.resolve(root)) continue;
    try {
      const entries = await fs.readdir(dir);
      if (entries.length === 0) await fs.rmdir(dir);
    } catch {
      /* ignore */
    }
  }
}

async function collect(dir: string, out: string[]): Promise<void> {
  let entries: import('fs').Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  out.push(dir);
  for (const e of entries) {
    if (e.isDirectory()) await collect(path.join(dir, e.name), out);
  }
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Build a fresh ManifestLock entry from current state. */
export function makeLock(args: {
  buildVersion: string;
  uiVersion: string;
  archiveSha256: string;
  instanceFiles: ManagedFileEntry[];
  uiFiles: ManagedFileEntry[];
}): ManifestLock {
  return {
    buildVersion: args.buildVersion,
    uiVersion: args.uiVersion,
    archiveSha256: args.archiveSha256,
    managedFiles: {
      instance: args.instanceFiles.map((f) => normalize(f.path)),
      ui: args.uiFiles.map((f) => normalize(f.path)),
    },
    installedAt: new Date().toISOString(),
  };
}
