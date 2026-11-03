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

test('page persona : GET overview en lecture seule, 404 inconnu', async (t) => {
  const { app, swarm } = await buildApp('facilitateur'); t.after(() => app.close());
  const agent = swarm.createAgent({ agent_id: 'imp_alex', display_name: 'Alex', role_name: 'R', department: 'D', primary_focus: 'F', mission: 'Mission de test', veto_power: true }, { tenantId: 'tenant-a', by: 't' });
  swarm.runs.set(swarm._key('tenant-a', 'r1'), { run_id: 'r1', question: 'Q', created_at: '2026-11-01T10:00:00Z', status: 'rejected_human', consensus: { verdict: 'NO_GO' },
    analyses: [{ agent_id: agent.agent_id, verdict: 'NO_GO', veto_power: true, primary_reason: 'Trop risqué' }],
    human_decision: { action: 'accept_consensus', verdict: 'NO_GO', by: 'ceo@x', justification: '', decided_at: '2026-11-01T11:00:00Z' } });
  const out = await app.inject({ method: 'GET', url: '/v1/console/agents/imp_alex/overview' });
  assert.equal(out.statusCode, 200, out.body);
  assert.equal(out.json().vetoes.length, 1);
  assert.equal(out.json().decisionsTimeline[0].decision, 'NO_GO');
  assert.equal((await app.inject({ method: 'GET', url: '/v1/console/agents/nope/overview' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/agents/imp_alex/overview' })).statusCode, 404);
});
