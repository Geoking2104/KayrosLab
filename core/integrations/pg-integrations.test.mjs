// Stores Postgres des intégrations contre une vraie base (CI : pg-tests.yml).
// Sans DATABASE_URL la suite est ignorée, comme core/pg-integration.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPgPool, applySchema } from '../pg-store.mjs';
import { ApiKeyService, PgApiKeyStore } from './api-keys.mjs';
import { PgMissionQueue } from './mission-queue.mjs';
import { PgWebhookOutbox, PgIntegrationSettingsStore, IntegrationSettingsService } from './webhooks.mjs';
import { PgPublicMissionStore } from './public-missions.mjs';

const DB = process.env.DATABASE_URL || process.env.KAYROS_DATABASE_URL || '';
// Garde-fou : deploy-backend.sh lance `node --test` dans core/ sur le VPS. Ces
// tests réclament des missions en file : ils ne tournent que sur une base de
// test (nom en `_test`, comme en CI) ou sur demande explicite, jamais en production.
function isTestDatabase(url) {
  try { return /_test$/i.test(new URL(url).pathname.replace(/^\//, '')); } catch { return false; }
}
const skip = !DB ? 'DATABASE_URL absent : intégrations Postgres ignorées'
  : (isTestDatabase(DB) || process.env.KAYROS_PG_INTEGRATION_TESTS === '1') ? false
    : 'base non marquée « _test » : intégrations Postgres ignorées (KAYROS_PG_INTEGRATION_TESTS=1 pour forcer)';
const uid = () => randomBytes(4).toString('hex');

async function pool() {
  const p = await createPgPool({ DATABASE_URL: DB });
  assert.ok(p, 'connexion Postgres');
  assert.equal(await applySchema(p, { logger: null }), true);
  assert.equal(await applySchema(p, { logger: null }), true, 'schéma ré-appliquable (idempotent)');
  return p;
}

test('clés d’API en Postgres : création, authentification, révocation', { skip }, async (t) => {
  const p = await pool(); t.after(() => p.end());
  const tenant = `t_${uid()}`;
  const service = new ApiKeyService({ store: new PgApiKeyStore(p) });
  const { key, token } = await service.create({ tenantId: tenant, name: 'n8n', collectiveIds: ['room_a'] });
  const principal = await service.authenticate(token);
  assert.equal(principal.tenantId, tenant);
  assert.deepEqual([...principal.collectiveIds], ['room_a']);
  assert.equal((await service.list(tenant)).length, 1);
  assert.equal((await service.revoke(tenant, key.key_id)).status, 'revoked');
  await assert.rejects(service.authenticate(token), /révoquée/);
});

test('file de missions : SKIP LOCKED, bail expiré repris, arrêt propre', { skip }, async (t) => {
  const p = await pool(); t.after(() => p.end());
  const queue = new PgMissionQueue(p);
  const id = uid();
  await queue.enqueue({ job_id: `job_${id}`, tenant_id: 't', thread_id: `thread_${id}`, run_id: `run_${id}`, kind: 'message', spec: { a: 1 } });
  const [a, b] = await Promise.all([queue.claim({ workerId: 'w1', leaseMs: 300 }), queue.claim({ workerId: 'w2', leaseMs: 300 })]);
  const mine = [a, b].filter((job) => job?.job_id === `job_${id}`);
  assert.equal(mine.length, 1, 'une seule réclamation gagne');
  const owner = mine[0].locked_by;
  assert.equal((await queue.activeForThread(`thread_${id}`)).status, 'running');
  await new Promise((resolve) => setTimeout(resolve, 400));
  let again = null;
  for (let i = 0; i < 20 && again?.job_id !== `job_${id}`; i += 1) again = await queue.claim({ workerId: 'w3', leaseMs: 60000 });
  assert.equal(again.job_id, `job_${id}`, 'bail expiré : mission reprise');
  assert.equal(again.attempts, 2);
  assert.equal(await queue.complete(`job_${id}`, owner), false, 'l’ancien worker ne peut plus terminer');
  assert.equal(await queue.release('w3') >= 1, true);
  const resumed = await queue.claim({ workerId: 'w4', leaseMs: 60000 });
  assert.equal(resumed.attempts, 2, 'un arrêt propre ne consomme pas de tentative');
  assert.equal(await queue.complete(resumed.job_id, 'w4'), true);
  assert.equal(await queue.activeForThread(`thread_${id}`), null);
});

test('boîte d’envoi et réglages webhook', { skip }, async (t) => {
  const p = await pool(); t.after(() => p.end());
  const tenant = `t_${uid()}`;
  const outbox = new PgWebhookOutbox(p);
  const evt = `evt_${uid()}`;
  const first = await outbox.enqueue({ delivery_id: `whd_${uid()}`, tenant_id: tenant, event_id: evt, event_type: 'mission.completed', target_url: 'https://h.example.com', payload: { a: 1 } });
  const dup = await outbox.enqueue({ delivery_id: `whd_${uid()}`, tenant_id: tenant, event_id: evt, event_type: 'mission.completed', target_url: 'https://h.example.com', payload: { a: 1 } });
  assert.equal(dup.delivery_id, first.delivery_id, 'dédoublonnage (event_id, cible)');
  const claimed = (await outbox.claimDue({ workerId: 'w', limit: 50 })).filter((d) => d.tenant_id === tenant);
  assert.equal(claimed.length, 1);
  await outbox.markFailed(first.delivery_id, { status: 500, error: 'HTTP 500', nextAttemptAt: new Date(Date.now() + 60000).toISOString() });
  const [after] = await outbox.list(tenant);
  assert.equal(after.status, 'pending');
  assert.equal(after.attempts, 1);

  const settings = new IntegrationSettingsService({ store: new PgIntegrationSettingsStore(p) });
  const { secret } = await settings.update(tenant, { webhook_url: 'https://h.example.com' }, { by: 'boss' });
  assert.equal((await settings.get(tenant)).webhook_secret, secret);
  assert.equal(await settings.ensureSecret(tenant), secret);
});

test('missions publiques : idempotence par tenant, recherche par référence externe', { skip }, async (t) => {
  const p = await pool(); t.after(() => p.end());
  const store = new PgPublicMissionStore(p);
  const tenant = `t_${uid()}`;
  const base = { tenant_id: tenant, room_id: 'room_a', profile: 'demo', question: 'Q', created_at: new Date().toISOString(), external_ref: { system: 'salesforce', object: 'Opportunity', id: '006X' } };
  const m1 = await store.insert({ ...base, mission_id: `msn_${uid()}`, idempotency_key: 'sf-006X-Proposal', thread_id: `thread_${uid()}` });
  await assert.rejects(store.insert({ ...base, mission_id: `msn_${uid()}`, idempotency_key: 'sf-006X-Proposal' }), (error) => error.code === 'IDEMPOTENCY_CONFLICT' && error.existing.mission_id === m1.mission_id);
  await store.insert({ ...base, tenant_id: `${tenant}_b`, mission_id: `msn_${uid()}`, idempotency_key: 'sf-006X-Proposal' });
  assert.equal((await store.search(tenant, { externalRef: { system: 'salesforce', object: 'Opportunity', id: '006X' } })).length, 1);
  assert.equal((await store.findByThread(m1.thread_id)).mission_id, m1.mission_id);
  assert.equal(await store.countSince(tenant, new Date(Date.now() - 60000).toISOString()), 1);
});
