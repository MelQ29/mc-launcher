import { test } from 'node:test';
import * as assert from 'node:assert/strict';

test('sanity: node:test работает', () => {
  assert.equal(2 + 2, 4);
});
