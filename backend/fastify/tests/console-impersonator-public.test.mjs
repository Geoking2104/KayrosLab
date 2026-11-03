import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';

async function buildApp(role = 'comex') {
  const swarm = new SwarmService({});
  const hybridGateway = new HybridAgentGateway({ swarm });
  const app = Fastify();
  app.decorate('kayrosContext', {
    hybridGateway, connectorConfig: new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() }), engine: { swarm },
    crystalKnowsConfigured: false, connectorEncryptionConfigured: false, xBearerToken: '',
  });
  app.decorate('requireAuth', async () => ({ sub: 'u1', email: 'owner@kayros.test', role, tenantId: 'tenant-a' }));
  await app.register(consoleRoute);
  return { app, swarm };
}
const post = (app, url, payload) => app.inject({ method: 'POST', url, payload });

test('source public : créé sans consentement, garde-fous et veto conservés', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  const out = await post(app, '/v1/console/impersonators', { name: 'Alex Martin', role: 'CFO', source: 'public', public_sources: ['https://example.com/alex'] });
  assert.equal(out.statusCode, 201, out.body);
  const body = out.json();
  assert.equal(body.agent.veto_power, true);
  assert.equal(body.agent.metadata.impersonator.legal_basis, 'public_data');
  assert.equal(body.guardrails.length, 5);
});

test('source public sans public_sources → 400', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  for (const payload of [{ name: 'A', source: 'public' }, { name: 'A', source: 'public', public_sources: [] }, { name: 'A', source: 'public', public_sources: ['ftp://x'] }]) {
    assert.equal((await post(app, '/v1/console/impersonators', payload)).statusCode, 400);
  }
});

test('autres sources : consentement toujours exigé', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  const out = await post(app, '/v1/console/impersonators', { name: 'A', source: 'manual', public_sources: ['https://example.com'] });
  assert.equal(out.statusCode, 400);
  assert.equal((await post(app, '/v1/console/impersonators', { name: 'A', source: 'manual', consent_confirmed: true })).statusCode, 201);
});

test('équipe : consentement requis sauf si tous les membres sont publics', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  const m = (n) => ({ name: n, source: 'public', public_sources: [`https://example.com/${n}`] });
  assert.equal((await post(app, '/v1/console/impersonator-teams', { name: 'Panel', members: [m('a'), m('b')] })).statusCode, 201);
  const mixed = await post(app, '/v1/console/impersonator-teams', { name: 'Panel 2', members: [m('c'), { name: 'd', source: 'manual' }] });
  assert.equal(mixed.statusCode, 400);
});

test('RBAC inchangé : un facilitateur ne crée pas de persona publique', async (t) => {
  const { app } = await buildApp('facilitateur'); t.after(() => app.close());
  const out = await post(app, '/v1/console/impersonators', { name: 'A', source: 'public', public_sources: ['https://example.com'] });
  assert.ok(out.statusCode >= 401 && out.statusCode <= 403, `${out.statusCode}`);
});
