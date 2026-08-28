import test from 'node:test';
import assert from 'node:assert/strict';

import { PgCollaborationStore, PgSwarmStore } from './pg-store.mjs';

function fakePool(respond = () => ({ rows: [], rowCount: 0 })) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return respond(sql, params, calls.length);
    },
  };
}

test('PgSwarmStore persiste les objets par tenant et compte les arbitrages', async () => {
  const pool = fakePool((sql) => sql.includes('count(*)')
    ? { rows: [{ n: 3 }] }
    : { rows: [], rowCount: 1 });
  const store = new PgSwarmStore(pool);

  await store.saveAgent({ agent_id: 'agent-1', role: 'critic' }, { tenantId: 'tenant-a' });
  await store.saveConfiguration({ swarm_id: 'swarm-1' }, { tenantId: 'tenant-a' });
  await store.saveRun({ run_id: 'run-1', swarm_id: 'swarm-1', status: 'pending_human_arbitration' }, { tenantId: 'tenant-a' });

  assert.match(pool.calls[0].sql, /on conflict \(tenant_id, agent_id\)/);
  assert.match(pool.calls[1].sql, /on conflict \(tenant_id, swarm_id\)/);
  assert.match(pool.calls[2].sql, /on conflict \(tenant_id, run_id\)/);
  assert.deepEqual(pool.calls.map(({ params }) => params[0]), ['tenant-a', 'tenant-a', 'tenant-a']);
  assert.equal(await store.countPendingRuns('tenant-a'), 3);
});

test('PgCollaborationStore revendique un message avec un bail recuperable', async () => {
  const pool = fakePool(() => ({ rows: [{ status: 'processing', result: null }], rowCount: 1 }));
  const store = new PgCollaborationStore(pool, { messageLeaseSeconds: 90 });
  const claim = await store.claimMessage({ platform: 'slack', messageId: 'm-1', tenantId: 't-1', roomId: 'r-1' });

  assert.deepEqual(claim, { claimed: true, result: null });
  assert.match(pool.calls[0].sql, /on conflict \(tenant_id, platform, message_id\)/);
  assert.match(pool.calls[0].sql, /lease_until < now\(\)/);
  assert.match(pool.calls[0].sql, /status = 'processing'[\s\S]+lease_until < now\(\)/);
  assert.match(pool.calls[0].sql, /status = 'failed'/);
  assert.deepEqual(pool.calls[0].params, ['slack', 'm-1', 't-1', 'r-1', 90]);
});

test('PgCollaborationStore retourne le resultat d’un webhook deja traite', async () => {
  const result = { run_id: 'run-1' };
  const pool = fakePool((sql, _params, call) => call === 1
    ? { rows: [], rowCount: 0 }
    : { rows: [{ status: 'completed', result }], rowCount: 1 });
  const store = new PgCollaborationStore(pool);

  assert.deepEqual(
    await store.claimMessage({ platform: 'teams', messageId: 'm-2', tenantId: 't-1', roomId: 'r-1' }),
    { claimed: false, completed: true, result },
  );
  assert.equal(pool.calls.length, 2);
});

test('le verrou de salon utilise la meme connexion et la libere meme en erreur', async () => {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, params) { queries.push({ sql, params }); return { rows: [] }; },
    release() { released = true; },
  };
  const store = new PgCollaborationStore({ async connect() { return client; } });

  await assert.rejects(
    () => store.withRoomLock('room-42', async () => { throw new Error('boom'); }),
    /boom/,
  );
  assert.match(queries[0].sql, /pg_advisory_lock/);
  assert.match(queries[1].sql, /pg_advisory_unlock/);
  assert.deepEqual(queries.map(({ params }) => params), [['room-42'], ['room-42']]);
  assert.equal(released, true);
});
