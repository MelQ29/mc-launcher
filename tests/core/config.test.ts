import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { migrateConfig } from '../../src/core/config';

test('migrateConfig: v1 без schemaVersion переезжает в v2 perBuild.eclipse', () => {
  const v1 = {
    name: 'EclipseFantasy',
    version: '0.1.0',
    buildManifestUrl: 'http://141.98.189.63/build_manifest.json',
    uiManifestUrl: 'http://141.98.189.63/ui_manifest.json',
    ramMb: 6144,
    installPath: '/home/u/EF',
    downloadConcurrency: 4,
    downloadRetries: 5,
    requireValidSignature: false,
  };
  const v2 = migrateConfig(v1);
  assert.equal(v2.schemaVersion, 2);
  assert.equal(v2.activeBuildId, 'eclipse');
  assert.equal(v2.buildsRegistryUrl, 'http://141.98.189.63/builds.json');
  assert.equal(v2.developerMode, false);
  assert.equal(v2.perBuild.eclipse.ramMb, 6144);
  assert.equal(v2.perBuild.eclipse.installPath, '/home/u/EF');
  // Старые URL-ключи не должны попасть в новый объект.
  assert.equal((v2 as unknown as Record<string, unknown>).buildManifestUrl, undefined);
});

test('migrateConfig: v2 не трогается', () => {
  const v2input = {
    schemaVersion: 2 as const,
    buildsRegistryUrl: 'http://x/builds.json',
    activeBuildId: 'summermon',
    developerMode: true,
    downloadConcurrency: 8,
    downloadRetries: 3,
    requireValidSignature: true,
    signaturePublicKey: 'abc',
    perBuild: {
      eclipse: { ramMb: 6144, installPath: null },
      summermon: { ramMb: 4096, installPath: '/d/games' },
    },
  };
  const out = migrateConfig(v2input);
  assert.deepEqual(out, v2input);
});

test('migrateConfig: пустой/null возвращает дефолт', () => {
  const out = migrateConfig(null);
  assert.equal(out.schemaVersion, 2);
  assert.equal(out.activeBuildId, 'eclipse');
  assert.deepEqual(out.perBuild, {});
});
