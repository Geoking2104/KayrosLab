import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractJlist, databaseDiagnostic } from '../deploy/ovh-vps/pm2-jlist.mjs';

const list = JSON.stringify([{ name: 'directus', pm2_env: {} }, { name: 'kayros-api', pm2_env: { DATABASE_URL: 'postgres://u:p@h/db' } }]);
const warning = '>>>> In-memory PM2 is out-of-date, do:\n>>>> $ pm2 update\nIn memory PM2 version: 7.0.1\nLocal PM2 version: 7.1.1\n';

test('JSON pur', () => { assert.equal(extractJlist(list).length, 2); });
test('avertissement PM2 avant le JSON (incident du 3 nov. 2026)', () => {
  assert.equal(databaseDiagnostic(warning + list), 'PM2 database environment: configured=true length=19');
});
test('jamais de valeur secrète, jamais d’exception', () => {
  assert.doesNotMatch(databaseDiagnostic(list), /postgres:/);
  assert.match(databaseDiagnostic('garbage'), /illisible/);
  assert.match(databaseDiagnostic('[]'), /introuvable/);
  assert.match(databaseDiagnostic(''), /illisible/);
});
test('deploy-backend.sh utilise le parseur robuste et non bloquant', async () => {
  const sh = await readFile(new URL('../deploy/ovh-vps/deploy-backend.sh', import.meta.url), 'utf8');
  assert.match(sh, /pm2 jlist 2>\/dev\/null \| node "\$\{APP_DIR\}\/deploy\/ovh-vps\/pm2-jlist\.mjs" \|\|/);
  assert.doesNotMatch(sh, /JSON\.parse\(input\)/);
});
