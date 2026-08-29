import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPgPool, hasDatabaseUrl } from './pg-store.mjs';

test('I. hasDatabaseUrl detects env', () => {
  assert.equal(hasDatabaseUrl({}), false);
  assert.equal(hasDatabaseUrl({ DATABASE_URL: 'postgres://x' }), true);
  assert.equal(hasDatabaseUrl({ KAYROS_DATABASE_URL: 'postgres://y' }), true);
});

test('createPgPool accepts a driver injected by the backend package boundary', async () => {
  const calls = [];
  class Pool {
    constructor(options) { calls.push(options); }
    async query(sql) { calls.push(sql); return { rows: [{ ok: 1 }] }; }
  }
  const pool = await createPgPool({ DATABASE_URL: 'postgres://injected/test', KAYROS_PG_POOL_MAX: '3' }, { pg: { Pool } });
  assert.ok(pool instanceof Pool);
  assert.equal(calls[0].connectionString, 'postgres://injected/test');
  assert.equal(calls[0].max, 3);
  assert.equal(calls[1], 'select 1');
});
