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

test('console overview exposes agents, connections and tenant rooms', async (t) => {
  const { app, hybridGateway } = await buildApp();
  t.after(() => app.close());
  await hybridGateway.createRoom({ platform: 'slack', external_room_id: 'C1', name: 'Launch' }, { tenantId: 'tenant-a' });
  await hybridGateway.createRoom({ platform: 'discord', external_room_id: 'D2', name: 'Other' }, { tenantId: 'tenant-b' });
  const response = await app.inject({ method: 'GET', url: '/v1/console/overview' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.summary.rooms, 1);
  assert.equal(body.summary.agents, 3);
  assert.equal(body.rooms[0].name, 'Launch');
  assert.equal(body.connections.length, 3);
});

test('console creates a room and executes a test mission', async (t) => {
  const { app, swarm } = await buildApp();
  t.after(() => app.close());
  const created = await app.inject({ method: 'POST', url: '/v1/console/rooms', payload: {
    name: 'COMEX', platform: 'console', external_room_id: 'local-comex', active_agents: ['cfo', 'cto'],
  } });
  assert.equal(created.statusCode, 201);
  const roomId = created.json().room.room_id;
  swarm.run = async (_swarmId, options) => ({
    run_id: 'run-console', swarm_name: 'COMEX', question: options.question, analyses: [],
    consensus: { verdict: 'GO', rationale: 'Majorité favorable.', requires_human_arbitration: true },
  });
  const response = await app.inject({ method: 'POST', url: `/v1/console/rooms/${roomId}/messages`, payload: { text: 'Lancer maintenant ?' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().summary.verdict, 'GO');
  assert.ok(response.json().thread.thread_id);
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
