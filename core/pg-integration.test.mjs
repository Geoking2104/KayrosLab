// KayrosLab -- PgRunStore contre un vrai Postgres.
//
// Les tests voisins (pg-run-store.test.mjs) observent le SQL emis avec un pool
// simule : ils prouvent le filtrage tenant et la forme des requetes, pas que
// le schema s'applique ni que jsonb se comporte comme attendu. Ceux-ci
// touchent une base reelle.
//
// Sans DATABASE_URL la suite est ignoree plutot qu'echouee : un poste de
// developpement sans Postgres ne doit pas voir une suite rouge. La CI, elle,
// fournit un service Postgres (.github/workflows/pg-tests.yml), donc ces
// tests s'executent a chaque push touchant le store.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPgPool, applySchema, PgRunStore } from './pg-store.mjs';
import { createWorkflowState, applyWorkflowEvent } from './workflow-state.mjs';

const DB = process.env.DATABASE_URL || process.env.KAYROS_DATABASE_URL || '';
const skip = DB ? false : 'DATABASE_URL absent : integration Postgres ignoree';

function suspended({ runId, ideaId = 'idea-1', tenantHint } = {}) {
  const state = createWorkflowState({
    runId,
    traceId: `trace-${runId}`,
    ideaId,
    input: { request: 'Arbitrer', context: tenantHint ? { tenantId: tenantHint } : {} },
  });
  return applyWorkflowEvent(state, {
    type: 'gate', gateId: `g-${runId}`, gateType: 'decision_arbitrage', nodeId: 'decision-gate',
  });
}

/** Chaque test travaille sur ses propres runId : la table est partagee. */
const uniq = (label) => `it-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test('le schema s applique sur une base reelle et reste idempotent', { skip }, async () => {
  const pool = await createPgPool({ DATABASE_URL: DB });
  assert.ok(pool, 'la connexion doit aboutir');
  try {
    assert.equal(await applySchema(pool), true, 'premiere application');
    // Le backend l'applique a chaque demarrage : le rejouer doit etre anodin.
    assert.equal(await applySchema(pool), true, 'seconde application');

    const { rows } = await pool.query(
      `select column_name, data_type from information_schema.columns
       where table_name = 'kayros_runs_suspended' order by ordinal_position`,
    );
    const shape = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
    assert.equal(shape.run_id, 'text');
    assert.equal(shape.payload, 'jsonb', 'le snapshot est stocke en jsonb, pas en texte');
    assert.equal(shape.tenant_id, 'text');
  } finally { await pool.end(); }
});

test('un snapshot fait un aller-retour sans perte a travers jsonb', { skip }, async () => {
  const pool = await createPgPool({ DATABASE_URL: DB });
  await applySchema(pool);
  const store = new PgRunStore(pool);
  const runId = uniq('roundtrip');
  try {
    const state = suspended({ runId });
    await store.save(state, { tenantId: 't1' });

    const back = await store.get(runId, { tenantId: 't1' });
    assert.equal(back.runId, runId);
    assert.equal(back.status, 'pending_review');
    assert.equal(back.gate.nodeId, 'decision-gate');
    // L'egalite structurelle est le vrai critere : jsonb reordonne les cles,
    // donc une comparaison de chaines serait un faux negatif.
    assert.deepEqual(back, JSON.parse(JSON.stringify(state)));
  } finally {
    await store.delete(runId);
    await pool.end();
  }
});

test('l isolation tenant tient en base, pas seulement en memoire', { skip }, async () => {
  const pool = await createPgPool({ DATABASE_URL: DB });
  await applySchema(pool);
  const store = new PgRunStore(pool);
  const runId = uniq('tenant');
  try {
    await store.save(suspended({ runId }), { tenantId: 'tenant-a' });

    assert.equal(await store.get(runId, { tenantId: 'tenant-b' }), null, 'lecture croisee refusee');
    assert.equal(await store.delete(runId, { tenantId: 'tenant-b' }), false, 'suppression croisee refusee');
    assert.ok(await store.get(runId, { tenantId: 'tenant-a' }), 'le proprietaire lit toujours');

    const autres = await store.list({ tenantId: 'tenant-b' });
    assert.equal(autres.some((r) => r.runId === runId), false);
  } finally {
    await store.delete(runId);
    await pool.end();
  }
});

test('resauvegarder le meme run met a jour au lieu de dupliquer', { skip }, async () => {
  const pool = await createPgPool({ DATABASE_URL: DB });
  await applySchema(pool);
  const store = new PgRunStore(pool);
  const runId = uniq('upsert');
  try {
    await store.save(suspended({ runId }), { tenantId: 't1' });
    let state = await store.get(runId, { tenantId: 't1' });
    state = applyWorkflowEvent(state, {
      type: 'review', nodeId: 'verifier', agent: 'Verifier', status: 'KO', comments: ['incomplet'],
    });
    await store.save(state, { tenantId: 't1' });

    const { rows } = await pool.query(
      'select count(*)::int as n from kayros_runs_suspended where run_id = $1', [runId],
    );
    assert.equal(rows[0].n, 1, 'un seul enregistrement par run');
    const back = await store.get(runId, { tenantId: 't1' });
    assert.equal(back.review.status, 'KO', 'la derniere version gagne');
  } finally {
    await store.delete(runId);
    await pool.end();
  }
});

test('le listing remonte le gate sans traverser le payload complet', { skip }, async () => {
  const pool = await createPgPool({ DATABASE_URL: DB });
  await applySchema(pool);
  const store = new PgRunStore(pool);
  const runId = uniq('list');
  try {
    await store.save(suspended({ runId, ideaId: 'idea-list' }), { tenantId: 't1' });
    const rows = await store.list({ tenantId: 't1', ideaId: 'idea-list' });
    const mine = rows.find((r) => r.runId === runId);
    assert.ok(mine, 'le run est liste');
    assert.equal(mine.gate.nodeId, 'decision-gate', 'le gate est extrait du jsonb');
    assert.equal(mine.status, 'pending_review');
    assert.ok(mine.updatedAt, 'la date vient du snapshot');
    assert.equal(mine.payload, undefined, 'le payload complet ne remonte pas');
    assert.equal(mine.state, undefined);
  } finally {
    await store.delete(runId);
    await pool.end();
  }
});

test('delete dit la verite sur ce qu il a supprime', { skip }, async () => {
  const pool = await createPgPool({ DATABASE_URL: DB });
  await applySchema(pool);
  const store = new PgRunStore(pool);
  const runId = uniq('delete');
  try {
    await store.save(suspended({ runId }), { tenantId: 't1' });
    assert.equal(await store.delete(runId, { tenantId: 't1' }), true);
    assert.equal(await store.delete(runId, { tenantId: 't1' }), false, 'deuxieme suppression sans effet');
    assert.equal(await store.get(runId, { tenantId: 't1' }), null);
  } finally { await pool.end(); }
});
