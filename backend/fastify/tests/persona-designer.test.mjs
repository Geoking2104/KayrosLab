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

test('concepteur : brouillon via KayrosLLM.complete, aucune création avant approbation', async (t) => {
  const calls = [];
  const llm = { id: 'nvidia', complete: async (req) => { calls.push(req); return { provider: 'nvidia', text: '{"reply":"OK","draft":{"name":"Alex Martin","source":"public","public_sources":["https://example.com/alex"]}}' }; } };
  const { app, swarm } = await buildApp('comex', llm); t.after(() => app.close());
  const before = swarm.registry.list({ tenantId: 'tenant-a' }).length;
  const out = await app.inject({ method: 'POST', url: '/v1/console/persona-designer/turn', payload: { messages: [{ role: 'user', content: 'Simule Alex Martin' }] } });
  assert.equal(out.statusCode, 200, out.body);
  assert.equal(out.json().valid, true);
  assert.equal(out.json().requires_approval, true);
  assert.equal(calls[0].role, 'persona_designer');
  assert.equal(swarm.registry.list({ tenantId: 'tenant-a' }).length, before);
  // Approbation humaine → seul chemin d'écriture.
  const saved = await app.inject({ method: 'POST', url: '/v1/console/impersonators', payload: out.json().draft });
  assert.equal(saved.statusCode, 201, saved.body);
  assert.equal(saved.json().guardrails.length, 5);
});

test('concepteur : RBAC inchangé (facilitateur refusé)', async (t) => {
  const { app } = await buildApp('facilitateur'); t.after(() => app.close());
  const out = await app.inject({ method: 'POST', url: '/v1/console/persona-designer/turn', payload: { messages: [{ role: 'user', content: 'x' }] } });
  assert.ok(out.statusCode >= 401 && out.statusCode <= 403, `${out.statusCode}`);
});
