import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEnvFileDefaults, parseEnvFile } from '../lib/env-file.mjs';

test('env file defaults fill missing and empty values without overriding explicit secrets', () => {
  const env = { DATABASE_URL: '', KAYROS_AUTH_SECRET: 'injected' };
  const contents = [
    '# production',
    'DATABASE_URL=postgres://local/kayros',
    'KAYROS_AUTH_SECRET=from-file',
    'KAYROS_CONSOLE_URL="https://www.kayroslab.com/console/"',
  ].join('\n');
  assert.equal(applyEnvFileDefaults({ env, read: () => contents }), true);
  assert.equal(env.DATABASE_URL, 'postgres://local/kayros');
  assert.equal(env.KAYROS_AUTH_SECRET, 'injected');
  assert.equal(env.KAYROS_CONSOLE_URL, 'https://www.kayroslab.com/console/');
});

test('env parser ignores comments and malformed names', () => {
  assert.deepEqual(parseEnvFile('# x\nOK=yes\n1BAD=no\nEMPTY='), { OK: 'yes', EMPTY: '' });
});
