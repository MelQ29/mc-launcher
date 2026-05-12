import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { Paths } from '../../src/core/paths';

test('Paths.buildRoot строит userData/builds/<id>', () => {
  const p = new Paths('/u', '/r');
  assert.equal(p.buildRoot('eclipse'), path.join('/u', 'builds', 'eclipse'));
});

test('Paths.instanceRoot без override — userData/builds/<id>/instance', () => {
  const p = new Paths('/u', '/r');
  assert.equal(p.instanceRoot('eclipse', null), path.join('/u', 'builds', 'eclipse', 'instance'));
});

test('Paths.instanceRoot с override использует абсолютный путь', () => {
  const p = new Paths('/u', '/r');
  assert.equal(p.instanceRoot('eclipse', '/d/games/EF'), path.resolve('/d/games/EF'));
});

test('Paths.buildCacheFiles даёт правильные имена', () => {
  const p = new Paths('/u', '/r');
  assert.equal(p.buildManifestCache('eclipse'), path.join('/u', 'builds', 'eclipse', 'build_manifest.json'));
  assert.equal(p.uiManifestCache('eclipse'),    path.join('/u', 'builds', 'eclipse', 'ui_manifest.json'));
  assert.equal(p.newsCache('eclipse'),          path.join('/u', 'builds', 'eclipse', 'news.json'));
  assert.equal(p.manifestLockFile('eclipse'),   path.join('/u', 'builds', 'eclipse', 'manifest.lock'));
  assert.equal(p.uiCache('eclipse'),            path.join('/u', 'builds', 'eclipse', 'ui'));
  assert.equal(p.cache('eclipse'),              path.join('/u', 'builds', 'eclipse', 'cache'));
});

test('Paths.buildsRegistryCache — userData/builds-registry.json (один на лаунчер)', () => {
  const p = new Paths('/u', '/r');
  assert.equal(p.buildsRegistryCache, path.join('/u', 'builds-registry.json'));
});
