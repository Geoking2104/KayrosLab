import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedDataPaths, applySharedDataEnv } from './shared-data.mjs';

test('H. sharedDataPaths layout', () => {
  const p = sharedDataPaths('/data/kayros');
  assert.equal(p.users, '/data/kayros/users.json');
  assert.equal(p.gates, '/data/kayros/gates.json');
  assert.equal(p.memory, '/data/kayros/memory.json');
});

test('H. applySharedDataEnv fills missing paths only', () => {
  const env = { KAYROS_SHARED_DATA_DIR: '/opt/data' };
  const paths = applySharedDataEnv(env);
  assert.equal(env.KAYROS_GATES_FILE, '/opt/data/gates.json');
  assert.equal(env.KAYROS_IDEAS_FILE, '/opt/data/ideas.json');
  env.KAYROS_USERS_FILE = '/custom/users.json';
  applySharedDataEnv(env);
  assert.equal(env.KAYROS_USERS_FILE, '/custom/users.json');
  assert.ok(paths.root.includes('opt') || paths.root.includes('data'));
});
