import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseBuildsRegistry } from '../../src/builds/registry-fetch';

test('parseBuildsRegistry: валидный JSON парсится', () => {
  const reg = parseBuildsRegistry(JSON.stringify({
    schemaVersion: 1,
    defaultBuildId: 'eclipse',
    builds: [
      { id: 'eclipse', displayName: 'Eclipse', shortName: 'ECLIPSE',
        buildManifestUrl: 'http://x/eclipse/build_manifest.json',
        uiManifestUrl: 'http://x/eclipse/ui_manifest.json',
        newsUrl: 'http://x/eclipse/news.json',
        accentColor: '#ffd144', enabled: true, order: 1 },
    ],
  }));
  assert.equal(reg.defaultBuildId, 'eclipse');
  assert.equal(reg.builds.length, 1);
  assert.equal(reg.builds[0].id, 'eclipse');
});

test('parseBuildsRegistry: невалидная схема падает', () => {
  assert.throws(() => parseBuildsRegistry('{"schemaVersion":2}'));
  assert.throws(() => parseBuildsRegistry('{"schemaVersion":1,"builds":[]}'));
  assert.throws(() => parseBuildsRegistry('not json'));
});

test('parseBuildsRegistry: defaultBuildId должен быть среди builds', () => {
  assert.throws(() =>
    parseBuildsRegistry(JSON.stringify({
      schemaVersion: 1,
      defaultBuildId: 'missing',
      builds: [{ id: 'eclipse', displayName: 'E', shortName: 'E',
        buildManifestUrl: 'x', uiManifestUrl: 'x', newsUrl: 'x',
        accentColor: '#fff', enabled: true, order: 1 }],
    })),
  );
});

test('parseBuildsRegistry: сортирует по order', () => {
  const reg = parseBuildsRegistry(JSON.stringify({
    schemaVersion: 1,
    defaultBuildId: 'a',
    builds: [
      { id: 'b', displayName: 'B', shortName: 'B', buildManifestUrl: 'x', uiManifestUrl: 'x', newsUrl: 'x', accentColor: '#fff', enabled: true, order: 2 },
      { id: 'a', displayName: 'A', shortName: 'A', buildManifestUrl: 'x', uiManifestUrl: 'x', newsUrl: 'x', accentColor: '#fff', enabled: true, order: 1 },
    ],
  }));
  assert.equal(reg.builds[0].id, 'a');
  assert.equal(reg.builds[1].id, 'b');
});
