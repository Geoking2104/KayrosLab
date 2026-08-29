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
import { randomBytes } from 'node:crypto';

import {
  createPgPool,
  applySchema,
  PgRunStore,
  PgSwarmStore,
  PgCollaborationStore,
} from './pg-store.mjs';
import { createWorkflowState, applyWorkflowEvent } from './workflow-state.mjs';
import { ConnectorConfigurationService, PgConnectorConfigStore } from './connector-config.mjs';

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

test('les agents, configurations et runs swarm font un aller-retour par tenant', { skip }, async () => {
  const pool = await createPgPool({ DATABASE_URL: DB });
  await applySchema(pool);
  const store = new PgSwarmStore(pool);
  const tenantId = uniq('swarm-tenant');
  const agentId = uniq('agent');
  const swarmId = uniq('swarm');
  const runId = uniq('swarm-run');
  try {
    const agent = { agent_id: agentId, role: 'critic', rules: ['challenge assumptions'] };
    const configuration = {
      swarm_id: swarmId,
      tenant_id: tenantId,
      swarm_name: 'Postgres integration swarm',
      active_agents: [agentId],
    };
    const run = {
      run_id: runId,
      swarm_id: swarmId,
      tenant_id: tenantId,
      status: 'pending_human_arbitration',
      consensus: { verdict: 'CONDITIONAL_GO' },
    };

    await store.saveAgent(agent, { tenantId });
    await store.saveConfiguration(configuration, { tenantId });
    await store.saveRun(run, { tenantId });

    const snapshot = await store.loadTenant(tenantId);
    assert.deepEqual(snapshot.agents, [agent]);
    assert.deepEqual(snapshot.configurations, [configuration]);
    assert.deepEqual(snapshot.runs, [run]);
    assert.equal(await store.countPendingRuns(tenantId), 1);
    assert.deepEqual(await store.loadTenant(`${tenantId}-other`), {
      agents: [], configurations: [], runs: [],
    });
  } finally {
    await pool.query('delete from kayros_swarm_runs where tenant_id = $1', [tenantId]);
    await pool.query('delete from kayros_swarm_configurations where tenant_id = $1', [tenantId]);
    await pool.query('delete from kayros_swarm_agents where tenant_id = $1', [tenantId]);
    await pool.end();
  }
});

test('les salons, evenements et claims restent partages et idempotents', { skip }, async () => {
  const pool = await createPgPool({ DATABASE_URL: DB });
  await applySchema(pool);
  const store = new PgCollaborationStore(pool, { messageLeaseSeconds: 30 });
  const tenantId = uniq('collab-tenant');
  const roomId = uniq('room');
  const externalRoomId = uniq('external-room');
  const messageId = uniq('message');
  const timestamp = new Date().toISOString();
  const room = {
    room_id: roomId,
    tenant_id: tenantId,
    name: 'Integration room',
    platform: 'slack',
    external_room_id: externalRoomId,
    status: 'active',
    created_at: timestamp,
    updated_at: timestamp,
  };
  try {
    await store.createRoom(room, { configuration: { swarm_id: 'swarm-integration' } });
    assert.equal((await store.getRoom(roomId, { tenantId })).room.name, 'Integration room');
    assert.equal(await store.getRoom(roomId, { tenantId: `${tenantId}-other` }), null);
    assert.equal((await store.findRoom('slack', externalRoomId)).room.room_id, roomId);

    const firstEvent = await store.appendEvent({
      tenant_id: tenantId, room_id: roomId, type: 'integration.first', ts: timestamp,
    });
    const secondEvent = await store.appendEvent({
      tenant_id: tenantId, room_id: roomId, type: 'integration.second', ts: timestamp,
    });
    const activity = await store.activity({ tenantId, roomId, after: firstEvent.sequence - 1 });
    assert.deepEqual(activity.map((event) => event.type), ['integration.first', 'integration.second']);
    assert.ok(secondEvent.sequence > firstEvent.sequence);

    assert.deepEqual(
      await store.claimMessage({ platform: 'slack', messageId, tenantId, roomId }),
      { claimed: true, result: null },
    );
    assert.deepEqual(
      await store.claimMessage({ platform: 'slack', messageId, tenantId, roomId }),
      { claimed: false, completed: false, result: null },
    );
    const result = { run_id: 'run-integration', verdict: 'GO' };
    await store.completeMessage('slack', messageId, result, tenantId);
    assert.deepEqual(
      await store.claimMessage({ platform: 'slack', messageId, tenantId, roomId }),
      { claimed: false, completed: true, result },
      'un message termine ne doit jamais etre repris lorsque son bail est expire',
    );

    await pool.query(
      `update kayros_collaboration_messages
       set status = 'processing', result = null, lease_until = now() - interval '1 second'
       where tenant_id = $1 and platform = 'slack' and message_id = $2`,
      [tenantId, messageId],
    );
    assert.deepEqual(
      await store.claimMessage({ platform: 'slack', messageId, tenantId, roomId }),
      { claimed: true, result: null },
      'un traitement abandonne doit etre repris apres expiration du bail',
    );
  } finally {
    await pool.query('delete from kayros_collaboration_messages where tenant_id = $1', [tenantId]);
    await pool.query('delete from kayros_collaboration_events where tenant_id = $1', [tenantId]);
    await pool.query('delete from kayros_collaboration_rooms where tenant_id = $1', [tenantId]);
    await pool.end();
  }
});

test('le verrou advisory serialise deux noeuds sur le meme salon', { skip }, async () => {
  const pool = await createPgPool({ DATABASE_URL: DB });
  const storeA = new PgCollaborationStore(pool);
  const storeB = new PgCollaborationStore(pool);
  const roomId = uniq('locked-room');
  let releaseFirst;
  let signalFirstEntered;
  let secondEntered = false;
  const firstEntered = new Promise((resolve) => { signalFirstEntered = resolve; });
  const holdFirst = new Promise((resolve) => { releaseFirst = resolve; });
  try {
    const first = storeA.withRoomLock(roomId, async () => {
      signalFirstEntered();
      await holdFirst;
    });
    await firstEntered;
    const second = storeB.withRoomLock(roomId, async () => { secondEntered = true; });

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(secondEntered, false, 'le second noeud attend le verrou du premier');
    releaseFirst();
    await Promise.all([first, second]);
    assert.equal(secondEntered, true, 'le second noeud reprend apres liberation');
  } finally {
    releaseFirst?.();
    await pool.end();
  }
});

test('les fils de decision et secrets connecteurs font un aller-retour PostgreSQL', { skip }, async () => {
  const pool = await createPgPool({ DATABASE_URL: DB });
  await applySchema(pool);
  const tenantId = uniq('console-v2');
  const roomId = uniq('room');
  const threadId = uniq('thread');
  const timestamp = new Date().toISOString();
  const collaboration = new PgCollaborationStore(pool);
  const connectorStore = new PgConnectorConfigStore(pool);
  const connectors = new ConnectorConfigurationService({
    store: connectorStore,
    encryptionKey: randomBytes(32).toString('base64'),
    publicApiUrl: 'https://api.example.test',
  });
  try {
    await collaboration.createRoom({
      room_id: roomId, tenant_id: tenantId, name: 'Console V2', platform: 'console',
      external_room_id: roomId, status: 'active', created_at: timestamp, updated_at: timestamp,
    }, {});
    await collaboration.createThread({
      thread_id: threadId, tenant_id: tenantId, room_id: roomId, root_run_id: 'run-1',
      current_run_id: 'run-1', status: 'needs_clarification', question: 'Quel budget ?',
      created_at: timestamp, updated_at: timestamp,
    });
    await collaboration.appendThreadMessage(threadId, {
      role: 'human', kind: 'answer', author_id: 'u1', text: '50 k€', created_at: timestamp,
    }, { tenantId });
    const thread = await collaboration.getThread(threadId, { tenantId });
    assert.equal(thread.messages[0].text, '50 k€');
    assert.equal((await collaboration.listThreads({ tenantId })).length, 1);

    const publicView = await connectors.configure(tenantId, 'slack', {
      secrets: { bot_token: 'xoxb-postgres-secret', signing_secret: 'signing-secret' },
    });
    assert.equal(JSON.stringify(publicView).includes('xoxb-postgres-secret'), false);
    const { rows } = await pool.query('select encrypted_secrets from kayros_connector_configurations where tenant_id=$1', [tenantId]);
    assert.equal(rows[0].encrypted_secrets.includes('xoxb-postgres-secret'), false);
    assert.equal((await connectorStore.getByConnectionId(publicView.connection_id)).tenant_id, tenantId);
  } finally {
    await pool.query('delete from kayros_connector_configurations where tenant_id=$1', [tenantId]);
    await pool.query('delete from kayros_collaboration_rooms where tenant_id=$1', [tenantId]);
    await pool.end();
  }
});
