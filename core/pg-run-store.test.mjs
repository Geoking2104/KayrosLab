// KayrosLab -- PgRunStore : la persistance des runs suspendus quand il y a
// plus d'une instance.
//
// FileRunStore reecrit tout le fichier a chaque changement : derriere un load
// balancer, deux instances se marchent dessus et une decision humaine peut
// disparaitre. Ces tests tiennent le contrat sans base reelle, en observant
// le SQL emis -- ce qui compte ici est le filtrage tenant et la forme du
// listing, pas le moteur.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PgRunStore, applySchema } from './pg-store.mjs';
import { createWorkflowState, applyWorkflowEvent } from './workflow-state.mjs';

function fakePool(rowsFor = () => ({ rows: [], rowCount: 0 })) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return rowsFor(sql, params);
    },
  };
}

function suspended({ runId = 'run-1', ideaId = 'idea-1' } = {}) {
  const state = createWorkflowState({
    runId, traceId: `trace-${runId}`, ideaId, input: { request: 'Arbitrer' },
  });
  return applyWorkflowEvent(state, {
    type: 'gate', gateId: 'g1', gateType: 'decision_arbitrage', nodeId: 'decision-gate',
  });
}

test('save fait un upsert avec le tenant, l’idée et le statut', async () => {
  const pool = fakePool();
  const store = new PgRunStore(pool);
  const row = await store.save(suspended(), { tenantId: 't1' });

  assert.equal(pool.calls.length, 1);
  const { sql, params } = pool.calls[0];
  assert.match(sql, /insert into kayros_runs_suspended/);
  assert.match(sql, /on conflict \(run_id\) do update/, 'un run resauvegarde ne duplique pas');
  assert.deepEqual(params.slice(0, 4), ['run-1', 't1', 'idea-1', 'pending_review']);
  assert.equal(JSON.parse(params[4]).gate.nodeId, 'decision-gate');
  // Le resume retourne reste leger : pas de payload complet.
  assert.equal(row.runId, 'run-1');
  assert.equal(row.state, undefined);
});

test('save refuse un snapshot sans runId', async () => {
  const store = new PgRunStore(fakePool());
  await assert.rejects(() => store.save({ status: 'pending_review' }), /runId/);
  await assert.rejects(() => store.save(null), /state requis/);
});

test('le filtrage tenant est dans la requête, pas après', async () => {
  const pool = fakePool(() => ({ rows: [], rowCount: 0 }));
  const store = new PgRunStore(pool);

  await store.get('run-1', { tenantId: 't1' });
  assert.match(pool.calls[0].sql, /where run_id = \$1 and tenant_id = \$2/);
  assert.deepEqual(pool.calls[0].params, ['run-1', 't1']);

  await store.delete('run-1', { tenantId: 't1' });
  assert.match(pool.calls[1].sql, /delete from .* where run_id = \$1 and tenant_id = \$2/s);
  assert.deepEqual(pool.calls[1].params, ['run-1', 't1']);
});

test('sans tenant, la requête n’en invente pas un', async () => {
  const pool = fakePool();
  const store = new PgRunStore(pool);
  await store.get('run-1');
  assert.equal(/tenant_id/.test(pool.calls[0].sql), false);
  assert.deepEqual(pool.calls[0].params, ['run-1']);
});

test('get renvoie null plutôt qu’un objet vide quand rien ne correspond', async () => {
  const store = new PgRunStore(fakePool(() => ({ rows: [], rowCount: 0 })));
  assert.equal(await store.get('absent', { tenantId: 't1' }), null);
});

test('list reste léger et compose ses filtres', async () => {
  const pool = fakePool(() => ({
    rows: [{
      run_id: 'run-1', tenant_id: 't1', idea_id: 'idea-1', status: 'pending_review',
      trace_id: 'trace-run-1', gate: { id: 'g1', nodeId: 'decision-gate' },
      updated_at: '2026-08-13T06:00:00.000Z',
    }],
  }));
  const store = new PgRunStore(pool);
  const rows = await store.list({ tenantId: 't1', ideaId: 'idea-1' });

  const { sql, params } = pool.calls[0];
  assert.match(sql, /tenant_id = \$1 and idea_id = \$2/);
  assert.deepEqual(params, ['t1', 'idea-1']);
  // Ni brouillon ni journaux : le listing doit rester peu couteux a poller.
  assert.equal(/select \*/.test(sql), false);
  assert.match(sql, /order by updated_at desc limit 1000/, 'listing borne');
  assert.deepEqual(rows[0], {
    runId: 'run-1', traceId: 'trace-run-1', ideaId: 'idea-1', tenantId: 't1',
    status: 'pending_review', gate: { id: 'g1', nodeId: 'decision-gate' },
    updatedAt: '2026-08-13T06:00:00.000Z',
  });
});

test('delete signale s’il a réellement supprimé quelque chose', async () => {
  const absent = new PgRunStore(fakePool(() => ({ rowCount: 0 })));
  assert.equal(await absent.delete('run-1', { tenantId: 't1' }), false);
  const present = new PgRunStore(fakePool(() => ({ rowCount: 1 })));
  assert.equal(await present.delete('run-1', { tenantId: 't1' }), true);
});

test('applySchema execute le fichier et reste anodin a rejouer', async () => {
  const pool = fakePool();
  const logs = [];
  const logger = { info: (m) => logs.push(m), warn: (m) => logs.push(m) };
  assert.equal(await applySchema(pool, { logger }), true);
  assert.equal(await applySchema(pool, { logger }), true, 'rejouable a chaque demarrage');
  assert.equal(pool.calls.length, 2);
  assert.match(pool.calls[0].sql, /create table if not exists kayros_runs_suspended/);
  // Idempotence : chaque objet est cree conditionnellement.
  const creations = pool.calls[0].sql.match(/create (table|index)/g) || [];
  const conditionnelles = pool.calls[0].sql.match(/create (table|index) if not exists/g) || [];
  assert.equal(creations.length, conditionnelles.length, 'aucune creation inconditionnelle');
});

test('un schema non applicable ne bloque pas le demarrage', async () => {
  // La base peut etre geree par un DBA, ou les droits DDL refuses : l'echec
  // est signale, pas fatal. La premiere ecriture dira le reste.
  const pool = { async query() { throw new Error('permission denied for schema public'); } };
  const warns = [];
  assert.equal(await applySchema(pool, { logger: { warn: (...a) => warns.push(a.join(' ')) } }), false);
  assert.match(warns.join(' '), /permission denied/);
  assert.equal(await applySchema(null), false, 'sans pool, rien a faire');
});

test('le schéma déclare la table et ses index', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('./sql/schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists kayros_runs_suspended/);
  assert.match(sql, /run_id text primary key/);
  for (const idx of ['tenant', 'idea', 'updated']) {
    assert.match(sql, new RegExp(`kayros_runs_suspended_${idx}`), `index ${idx}`);
  }
});
