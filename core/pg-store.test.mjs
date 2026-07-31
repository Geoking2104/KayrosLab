import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasDatabaseUrl } from './pg-store.mjs';

test('I. hasDatabaseUrl detects env', () => {
  assert.equal(hasDatabaseUrl({}), false);
  assert.equal(hasDatabaseUrl({ DATABASE_URL: 'postgres://x' }), true);
  assert.equal(hasDatabaseUrl({ KAYROS_DATABASE_URL: 'postgres://y' }), true);
});
