import { promises as fs } from 'fs';
import * as path from 'path';
import type { BuildsRegistry, BuildEntry } from '../core/types';
import { fetchText } from '../downloader/downloader';
import { verifyManifestSignature } from '../manifest/signature';
import { logger } from '../core/logger';

export function parseBuildsRegistry(raw: string): BuildsRegistry {
  const obj = JSON.parse(raw) as Partial<BuildsRegistry>;
  if (obj.schemaVersion !== 1) throw new Error(`Unsupported builds.json schemaVersion: ${obj.schemaVersion}`);
  if (typeof obj.defaultBuildId !== 'string' || !obj.defaultBuildId) {
    throw new Error('builds.json missing defaultBuildId');
  }
  if (!Array.isArray(obj.builds) || obj.builds.length === 0) {
    throw new Error('builds.json missing or empty builds[]');
  }
  for (const b of obj.builds) validateBuildEntry(b as BuildEntry);
  const ids = new Set(obj.builds.map((b) => (b as BuildEntry).id));
  if (!ids.has(obj.defaultBuildId)) {
    throw new Error(`defaultBuildId "${obj.defaultBuildId}" not present in builds[]`);
  }
  const sorted = [...(obj.builds as BuildEntry[])].sort((a, b) => a.order - b.order);
  return { ...obj, schemaVersion: 1, builds: sorted } as BuildsRegistry;
}

function validateBuildEntry(b: BuildEntry): void {
  for (const k of ['id', 'displayName', 'shortName', 'buildManifestUrl', 'uiManifestUrl', 'newsUrl', 'accentColor'] as const) {
    if (typeof b[k] !== 'string' || !b[k]) throw new Error(`build entry missing/invalid field ${k}: ${JSON.stringify(b)}`);
  }
  if (!/^[a-z0-9-]+$/.test(b.id)) throw new Error(`build.id must be lowercase kebab-case: ${b.id}`);
  if (typeof b.order !== 'number') throw new Error(`build.${b.id}.order must be a number`);
  if (typeof b.enabled !== 'boolean') throw new Error(`build.${b.id}.enabled must be a boolean`);
}

export async function fetchBuildsRegistry(
  url: string,
  cachePath: string,
  publicKey: string | undefined,
  requireSig: boolean,
): Promise<{ registry: BuildsRegistry; offline: boolean }> {
  let registry: BuildsRegistry | null = null;
  let offline = false;
  try {
    const raw = await fetchText(url);
    registry = parseBuildsRegistry(raw);
    const check = verifyManifestSignature(registry as unknown as Record<string, unknown>, publicKey, requireSig);
    if (!check.ok) throw new Error(`builds.json signature: ${check.reason}`);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, raw, 'utf8');
  } catch (err) {
    logger.warn('builds-registry', `Remote fetch failed (${(err as Error).message}); trying cache`);
    const raw = await fs.readFile(cachePath, 'utf8');  // throws if no cache — fatal
    registry = parseBuildsRegistry(raw);
    offline = true;
  }
  return { registry, offline };
}
