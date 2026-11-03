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
    publicSourceVisitor: async (urls) => urls.map((url) => ({ url, final_url: url, status: 200, title: 'Page publique', excerpt: 'Extrait public.', sha256: 'a'.repeat(64), fetched_at: '2026-11-03T14:00:00.000Z' })),
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

test('autres sources : consentie par défaut, refus explicite → 400', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  const out = await post(app, '/v1/console/impersonators', { name: 'A', source: 'manual', consent_confirmed: false });
  assert.equal(out.statusCode, 400);
  assert.equal((await post(app, '/v1/console/impersonators', { name: 'A0', source: 'manual' })).statusCode, 201);
  assert.equal((await post(app, '/v1/console/impersonators', { name: 'A', source: 'manual', consent_confirmed: true })).statusCode, 201);
});

test('équipe : refus explicite bloquant sauf si tous les membres sont publics', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  const m = (n) => ({ name: n, source: 'public', public_sources: [`https://example.com/${n}`] });
  assert.equal((await post(app, '/v1/console/impersonator-teams', { name: 'Panel', members: [m('a'), m('b')] })).statusCode, 201);
  const mixed = await post(app, '/v1/console/impersonator-teams', { name: 'Panel 2', members: [m('c'), { name: 'd', source: 'manual' }], consent_confirmed: false });
  assert.equal(mixed.statusCode, 400);
});

test('RBAC inchangé : un facilitateur ne crée pas de persona publique', async (t) => {
  const { app } = await buildApp('facilitateur'); t.after(() => app.close());
  const out = await post(app, '/v1/console/impersonators', { name: 'A', source: 'public', public_sources: ['https://example.com'] });
  assert.ok(out.statusCode >= 401 && out.statusCode <= 403, `${out.statusCode}`);
});

test('sources publiques enregistrées, visitées et liées à la persona (visiteur simulé)', async (t) => {
  const { app, swarm } = await buildApp(); t.after(() => app.close());
  const out = await post(app, '/v1/console/impersonators', { name: 'Alex Martin', source: 'public', public_sources: ['https://example.com/alex'] });
  assert.equal(out.statusCode, 201, out.body);
  const imp = out.json().agent.metadata.impersonator;
  assert.equal(imp.consent_confirmed, true);
  assert.deepEqual(imp.public_sources, ['https://example.com/alex']);
  assert.equal(imp.public_evidence[0].status, 200);
  assert.equal(imp.public_evidence[0].title, 'Page publique');
  const stored = swarm.registry.get(out.json().agent.agent_id, { tenantId: 'tenant-a' });
  assert.ok(stored.human_profile.profile_summary.some((s) => /Extrait public/.test(s)));
  const again = await post(app, `/v1/console/impersonators/${stored.agent_id}/public-sources/visit`, {});
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json().public_evidence.length, 1);
});

test('SSRF : URL privée refusée à la création', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  for (const url of ['http://127.0.0.1/x', 'http://localhost/x', 'http://10.0.0.1/']) {
    assert.equal((await post(app, '/v1/console/impersonators', { name: 'A', source: 'public', public_sources: [url] })).statusCode, 400, url);
  }
});
