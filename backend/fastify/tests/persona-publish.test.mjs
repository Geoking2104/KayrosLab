import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';

async function buildApp(role = 'comex', llm = null) {
  const swarm = new SwarmService({});
  if (llm) swarm.llm = llm;
  const app = Fastify();
  app.decorate('kayrosContext', {
    hybridGateway: new HybridAgentGateway({ swarm }), connectorConfig: new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() }), engine: { swarm },
    publicSourceVisitor: async (urls) => urls.map((url) => ({ url, status: 200, title: 'T', excerpt: 'E', fetched_at: '2026-11-03T14:00:00.000Z' })),
    crystalKnowsConfigured: false, connectorEncryptionConfigured: false, xBearerToken: '',
  });
  app.decorate('requireAuth', async () => ({ sub: 'u1', email: 'owner@kayros.test', role, tenantId: 'tenant-a' }));
  await app.register(consoleRoute);
  return { app, swarm };
}

test('publier / révoquer : persona du registre, motif requis, RBAC, agent système refusé', async (t) => {
  const { app, swarm } = await buildApp(); t.after(() => app.close());
  const saved = await app.inject({ method: 'POST', url: '/v1/console/impersonators', payload: { name: 'Alex Martin', source: 'public', public_sources: ['https://example.com/a'] } });
  assert.equal(saved.statusCode, 201, saved.body);
  const id = saved.json().agent.agent_id;
  assert.equal((await app.inject({ method: 'POST', url: `/v1/console/agents/${id}/revoke`, payload: {} })).statusCode, 400);
  const rev = await app.inject({ method: 'POST', url: `/v1/console/agents/${id}/revoke`, payload: { reason: 'source retirée' } });
  assert.equal(rev.statusCode, 200, rev.body);
  assert.equal(rev.json().agent.enabled, false);
  assert.equal(rev.json().publication.status, 'revoked');
  assert.throws(() => swarm.createConfiguration?.({ swarm_name: 'S', active_agents: [id, 'cfo'], voting_threshold: 'majority' }, { tenantId: 'tenant-a', by: 't' }), /désactivé/);
  const pub = await app.inject({ method: 'POST', url: `/v1/console/agents/${id}/publish`, payload: { note: 'source rétablie' } });
  assert.equal(pub.statusCode, 200, pub.body);
  assert.equal(pub.json().agent.enabled, true);
  assert.deepEqual(pub.json().publication.history.map((h) => h.status), ['revoked', 'published']);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/agents/cfo/revoke', payload: { reason: 'x' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/agents/inconnu/publish', payload: {} })).statusCode, 404);
});

test('publier : RBAC inchangé (facilitateur refusé)', async (t) => {
  const { app } = await buildApp('facilitateur'); t.after(() => app.close());
  const out = await app.inject({ method: 'POST', url: '/v1/console/agents/x/revoke', payload: { reason: 'x' } });
  assert.ok(out.statusCode >= 401 && out.statusCode <= 403, `${out.statusCode}`);
});
