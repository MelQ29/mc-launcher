import { promises as fs } from 'fs';
import * as path from 'path';
import { logger } from './logger';

export interface MigrationResult {
  migrated: boolean;
  targetBuildId?: string;
  movedPaths?: string[];
  error?: string;
}

const LEGACY_ENTRIES = [
  'instance',
  'manifest.lock',
  'build_manifest.json',
  'ui_manifest.json',
  'ui',
  'cache',
];

/**
 * Detect a pre-multi-build userData layout and move it under builds/eclipse.
 * Idempotent — safe to call on every launch.
 */
export async function migrateLegacyUserData(userData: string): Promise<MigrationResult> {
  const moved: string[] = [];
  const buildId = 'eclipse';
  const targetDir = path.join(userData, 'builds', buildId);

  // Detect: any legacy entry exists at top level?
  const present: string[] = [];
  for (const name of LEGACY_ENTRIES) {
    if (await exists(path.join(userData, name))) present.push(name);
  }
  if (present.length === 0) return { migrated: false };

  logger.info('migration', `Legacy layout detected (${present.join(', ')}); migrating → builds/${buildId}`);
  await fs.mkdir(targetDir, { recursive: true });

  for (const name of present) {
    const from = path.join(userData, name);
    const to = path.join(targetDir, name);
    try {
      if (await exists(to)) {
        logger.warn('migration', `Target already exists, skipping: ${to}`);
        continue;
      }
      await moveTree(from, to);
      moved.push(name);
    } catch (err) {
      logger.error('migration', `Failed to migrate ${name}`, err);
      return { migrated: false, error: (err as Error).message, movedPaths: moved };
    }
  }
  logger.info('migration', `Migrated ${moved.length} entries: ${moved.join(', ')}`);
  return { migrated: true, targetBuildId: buildId, movedPaths: moved };
}

async function moveTree(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
    return;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'EXDEV' && e.code !== 'ENOTSUP') throw err;
  }
  // Fallback for cross-device renames.
  await copyTree(from, to);
  await fs.rm(from, { recursive: true, force: true });
}

async function copyTree(from: string, to: string): Promise<void> {
  const stat = await fs.stat(from);
  if (stat.isDirectory()) {
    await fs.mkdir(to, { recursive: true });
    for (const ent of await fs.readdir(from)) {
      await copyTree(path.join(from, ent), path.join(to, ent));
    }
  } else {
    await fs.copyFile(from, to);
  }
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
