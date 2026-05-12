import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { verifyDevPassword } from '../../src/core/dev-password';

test('verifyDevPassword: правильный пароль принимается', () => {
  assert.equal(verifyDevPassword('DEVmc6767gol'), true);
});

test('verifyDevPassword: неправильный пароль отвергается', () => {
  assert.equal(verifyDevPassword('wrong'), false);
  assert.equal(verifyDevPassword(''), false);
  assert.equal(verifyDevPassword('DEVmc6767gol '), false);  // лишний пробел
});

test('verifyDevPassword: timing-safe — равные длины не падают', () => {
  // Не падает на сравнении одинаково длинных строк
  assert.doesNotThrow(() =>
    verifyDevPassword('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  );
});
