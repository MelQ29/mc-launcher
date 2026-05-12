import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseNewsFeed } from '../../src/news/news-service';

test('parseNewsFeed: валидный JSON парсится и сортируется по date desc', () => {
  const raw = JSON.stringify({
    schemaVersion: 1,
    buildId: 'eclipse',
    entries: [
      { id: 'a', date: '2026-04-01', type: 'changelog', title: 'A', body: '' },
      { id: 'b', date: '2026-05-01', type: 'event', title: 'B', body: '' },
    ],
  });
  const feed = parseNewsFeed(raw);
  assert.equal(feed.entries[0].id, 'b');  // newer first
  assert.equal(feed.entries[1].id, 'a');
});

test('parseNewsFeed: неверная схема падает', () => {
  assert.throws(() => parseNewsFeed('{"schemaVersion":2}'));
  assert.throws(() => parseNewsFeed('{"schemaVersion":1,"entries":"x"}'));
});

test('parseNewsFeed: неизвестный type → falls back to notice', () => {
  const feed = parseNewsFeed(JSON.stringify({
    schemaVersion: 1, buildId: 'eclipse',
    entries: [{ id: 'a', date: '2026-01-01', type: 'weird', title: 'X', body: '' }],
  }));
  assert.equal(feed.entries[0].type, 'notice');
});
