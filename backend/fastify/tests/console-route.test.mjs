import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';

async function buildApp() {
  const swarm = new SwarmService();
  const hybridGateway = new HybridAgentGateway({ swarm });
  const connectorConfig = new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() });
  const app = Fastify();
  app.decorate('kayrosContext', {
    hybridGateway, connectorConfig, engine: { swarm },
    crystalKnowsConfigured: false, connectorEncryptionConfigured: false,
  });
  app.decorate('requireAuth', async () => ({ sub: 'u1', email: 'owner@kayros.test', role: 'comex', tenantId: 'tenant-a' }));
  await app.register(consoleRoute);
  return { app, swarm, hybridGateway };
}

test('console overview exposes agents, connections and tenant sessions', async (t) => {
  const { app, hybridGateway } = await buildApp();
  t.after(() => app.close());
  await hybridGateway.createRoom({ platform: 'console', external_room_id: 'session-a', name: 'Launch' }, { tenantId: 'tenant-a' });
  await hybridGateway.createRoom({ platform: 'console', external_room_id: 'session-b', name: 'Other' }, { tenantId: 'tenant-b' });
  const response = await app.inject({ method: 'GET', url: '/v1/console/overview' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.summary.sessions, 1);
  assert.equal(body.summary.agents, 3);
  assert.equal(body.sessions[0].name, 'Launch');
  assert.ok(Array.isArray(body.sessions[0].collective.active_agents));
  assert.equal(body.connections.length, 3);
  assert.equal(body.rooms, undefined);
});

test('console opens a harness session and runs a governed mission', async (t) => {
  const { app, swarm } = await buildApp();
  t.after(() => app.close());
  const created = await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: {
    name: 'COMEX', active_agents: ['cfo', 'cto'],
  } });
  assert.equal(created.statusCode, 201);
  const sessionId = created.json().session.session_id;
  assert.equal(created.json().session.collective.active_agents.length, 2);
  swarm.run = async (_swarmId, options) => ({
    run_id: 'run-console', swarm_name: 'COMEX', question: options.question, analyses: [],
    consensus: { verdict: 'GO', rationale: 'Majorité favorable.', requires_human_arbitration: true },
  });
  const response = await app.inject({ method: 'POST', url: `/v1/console/sessions/${sessionId}/run`, payload: { question: 'Lancer maintenant ?' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().summary.verdict, 'GO');
  assert.ok(response.json().thread.thread_id);
  assert.equal(response.json().session_id, sessionId);
  // Le vocabulaire de l'application dérivée n'apparaît jamais dans la console.
  const detail = await app.inject({ method: 'GET', url: `/v1/console/sessions/${sessionId}` });
  assert.equal(detail.statusCode, 200);
  assert.ok(!/salon/i.test(JSON.stringify(detail.json())));
});

test('console rejects an unknown session run with a harness error', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  const missing = await app.inject({ method: 'POST', url: '/v1/console/sessions/session_absent/run', payload: { question: 'Rien ?' } });
  assert.equal(missing.statusCode, 404);
  assert.match(missing.json().error, /session introuvable/);
});

test('console creates and updates a fully described agent', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  const created = await app.inject({ method: 'POST', url: '/v1/console/agents', payload: {
    agent_id: 'product_lead', role_name: 'Product Lead', department: 'Product', seniority: 'senior',
    primary_focus: 'Challenge product-market fit.', mission: 'Verify the launch evidence.',
    instructions: 'Be explicit.', constraints: ['No invented metrics'], provider: 'mock',
    tools: ['portfolio'], connectors: ['console'], enabled: true,
  } });
  assert.equal(created.statusCode, 201);
  const updated = await app.inject({ method: 'PATCH', url: '/v1/console/agents/product_lead', payload: { enabled: false, model: 'test-model' } });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().agent.enabled, false);
  assert.equal(updated.json().agent.model, 'test-model');
});
