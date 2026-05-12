import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { migrateLegacyUserData } from '../../src/core/migration';

async function tmpDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'ef-mig-'));
}

test('migrateLegacyUserData: переезжает старый instance в builds/eclipse', async () => {
  const u = await tmpDir();
  await fs.mkdir(path.join(u, 'instance', 'mods'), { recursive: true });
  await fs.writeFile(path.join(u, 'instance', 'mods', 'foo.jar'), 'X');
  await fs.writeFile(path.join(u, 'manifest.lock'), '{}');
  await fs.writeFile(path.join(u, 'build_manifest.json'), '{"v":1}');
  await fs.writeFile(path.join(u, 'ui_manifest.json'), '{"v":1}');
  await fs.mkdir(path.join(u, 'ui'), { recursive: true });
  await fs.writeFile(path.join(u, 'ui', 'bg.png'), 'PNG');
  await fs.mkdir(path.join(u, 'cache'), { recursive: true });

  const result = await migrateLegacyUserData(u);
  assert.equal(result.migrated, true);
  assert.equal(result.targetBuildId, 'eclipse');

  // Старые папки исчезли.
  assert.equal(await exists(path.join(u, 'instance')), false);
  assert.equal(await exists(path.join(u, 'manifest.lock')), false);
  assert.equal(await exists(path.join(u, 'build_manifest.json')), false);

  // Новые на месте.
  assert.equal(await exists(path.join(u, 'builds', 'eclipse', 'instance', 'mods', 'foo.jar')), true);
  assert.equal(await exists(path.join(u, 'builds', 'eclipse', 'manifest.lock')), true);
  assert.equal(await exists(path.join(u, 'builds', 'eclipse', 'ui', 'bg.png')), true);
});

test('migrateLegacyUserData: ничего не делает если старого нет', async () => {
  const u = await tmpDir();
  await fs.mkdir(path.join(u, 'builds', 'eclipse'), { recursive: true });
  const result = await migrateLegacyUserData(u);
  assert.equal(result.migrated, false);
});

test('migrateLegacyUserData: идемпотентна (повторный вызов = no-op)', async () => {
  const u = await tmpDir();
  await fs.mkdir(path.join(u, 'instance'), { recursive: true });
  await fs.writeFile(path.join(u, 'instance', 'foo'), 'x');
  const r1 = await migrateLegacyUserData(u);
  assert.equal(r1.migrated, true);
  const r2 = await migrateLegacyUserData(u);
  assert.equal(r2.migrated, false);
});

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
