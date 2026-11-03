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
    hybridGateway: new HybridAgentGateway({ swarm }), connectorConfig: new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() }), engine: { swarm }, personaSkills: [{ id: 'roi', name: 'ROI', instructions: 'Exiger un ROI', tools: ['estimate_resources'] }],
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
