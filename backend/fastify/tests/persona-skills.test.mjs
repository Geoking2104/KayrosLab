import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { ToolRegistry } from '../../../core/tool-registry.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';

function testTools() {
  const r = new ToolRegistry();
  r.register({ name: 'estimate_resources', description: 'Estime', sideEffect: 'read', handler: async () => ({}) });
  r.register({ name: 'send_email', description: 'Envoie', sideEffect: 'write', gate: true, handler: async () => ({}) });
  return r;
}

async function buildApp(role = 'comex', llm = null) {
  const swarm = new SwarmService({});
  if (llm) swarm.llm = llm;
  const app = Fastify();
  app.decorate('kayrosContext', {
    hybridGateway: new HybridAgentGateway({ swarm }), connectorConfig: new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() }), engine: { swarm, tools: testTools() }, personaSkills: [{ id: 'roi', name: 'ROI', instructions: 'Exiger un ROI', tools: ['estimate_resources'] }],
    publicSourceVisitor: async (urls) => urls.map((url) => ({ url, status: 200, title: 'T', excerpt: 'E', fetched_at: '2026-11-03T14:00:00.000Z' })),
    crystalKnowsConfigured: false, connectorEncryptionConfigured: false, xBearerToken: '',
  });
  app.decorate('requireAuth', async () => ({ sub: 'u1', email: 'owner@kayros.test', role, tenantId: 'tenant-a' }));
  await app.register(consoleRoute);
  return { app, swarm };
}

test('skills : catalogue, création avec skills, outils effectifs = ∩ allowlist (vide par défaut)', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  const cat = await app.inject({ method: 'GET', url: '/v1/console/persona-skills' });
  assert.equal(cat.json().skills[0].id, 'roi');
  const saved = await app.inject({ method: 'POST', url: '/v1/console/impersonators', payload: { name: 'Alex Martin', source: 'public', public_sources: ['https://example.com/a'], skills: ['roi'] } });
  assert.equal(saved.statusCode, 201, saved.body);
  const id = saved.json().agent.agent_id;
  const eff = await app.inject({ method: 'GET', url: `/v1/console/agents/${id}/skill-tools` });
  assert.equal(eff.statusCode, 200, eff.body);
  assert.deepEqual(eff.json().skills, ['roi']);
  assert.deepEqual(eff.json().granted, []);
  assert.equal(eff.json().denied[0].tool, 'estimate_resources');
  const bad = await app.inject({ method: 'POST', url: '/v1/console/impersonators', payload: { name: 'Bob', source: 'public', public_sources: ['https://example.com/b'], skills: ['inconnu'] } });
  assert.equal(bad.statusCode, 400);
});

test('outils persona : catalogue, réglage manager validé et audité, aperçu effectif mis à jour', async (t) => {
  const { app, swarm } = await buildApp(); t.after(() => app.close());
  const events = []; const orig = swarm._audit.bind(swarm); swarm._audit = (e) => { events.push(e); return orig(e); };
  const cat = (await app.inject({ method: 'GET', url: '/v1/console/persona-tools' })).json().tools;
  assert.equal(cat.find((x) => x.name === 'send_email').assignable, false);
  const saved = await app.inject({ method: 'POST', url: '/v1/console/impersonators', payload: { name: 'Alex Martin', source: 'public', public_sources: ['https://example.com/a'], skills: ['roi'], tools: ['estimate_resources'] } });
  assert.equal(saved.statusCode, 201, saved.body);
  const id = saved.json().agent.agent_id;
  assert.deepEqual((await app.inject({ method: 'GET', url: `/v1/console/agents/${id}/skill-tools` })).json().granted.map((g) => g.tool ?? g), ['estimate_resources']);
  const put = (tools) => app.inject({ method: 'PUT', url: `/v1/console/agents/${id}/tools`, payload: { tools } });
  const cleared = await put([]);
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.deepEqual(cleared.json().granted, []);
  assert.equal((await put(['send_email'])).statusCode, 400);
  assert.equal((await put(['inconnu'])).statusCode, 400);
  assert.equal((await put(['*'])).statusCode, 400);
  const audit = events.filter((e) => e.type === 'swarm.agent.tools_updated');
  assert.equal(audit.length, 2);
  assert.deepEqual(audit[1].before, ['estimate_resources']);
  assert.deepEqual(audit[1].after, []);
  assert.equal(audit[1].by, 'owner@kayros.test');
  const bad = await app.inject({ method: 'POST', url: '/v1/console/impersonators', payload: { name: 'Bob', source: 'public', public_sources: ['https://example.com/b'], tools: ['send_email'] } });
  assert.equal(bad.statusCode, 400);
});

test('outils persona : réservé aux managers (RBAC)', async (t) => {
  const { app } = await buildApp('facilitateur'); t.after(() => app.close());
  const out = await app.inject({ method: 'PUT', url: '/v1/console/agents/x/tools', payload: { tools: [] } });
  assert.ok(out.statusCode >= 401 && out.statusCode <= 403, `${out.statusCode}`);
});
