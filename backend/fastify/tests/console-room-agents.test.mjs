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

test('room collective accepts new agents without recreating the salon', async (t) => {
  const { app, swarm } = await buildApp();
  t.after(() => app.close());
  await swarm.createAgent({
    agent_id: 'auteur_hugo', role_name: 'Victor Hugo — écrivain', department: 'Bibliothèque du domaine public',
    seniority: 'executive', primary_focus: 'Incarner Victor Hugo.', connectors: ['console'], enabled: true,
    metadata: { literary: { author_id: 'hugo', name: 'Victor Hugo' } },
  }, { tenantId: 'tenant-a', by: 'test' });
  const created = await app.inject({ method: 'POST', url: '/v1/console/rooms', payload: {
    name: 'COMEX', platform: 'console', external_room_id: 'local-comex', active_agents: ['cfo', 'cto'],
  } });
  assert.equal(created.statusCode, 201);
  const roomId = created.json().room.room_id;

  const patched = await app.inject({ method: 'PATCH', url: `/v1/console/rooms/${roomId}/agents`, payload: { add_agent_ids: ['auteur_hugo'] } });
  assert.equal(patched.statusCode, 200);
  const configuration = patched.json().room;
  const swarmConfig = swarm.getConfiguration(configuration.swarm_id, { tenantId: 'tenant-a' });
  assert.deepEqual(swarmConfig.active_agents, ['cfo', 'cto', 'auteur_hugo']);

  // Le salon hydrate son collectif depuis le runtime_bundle mis à jour : la mission voit le nouvel agent.
  swarm.run = async (_swarmId, options) => ({
    run_id: 'run-console', swarm_name: options.question, question: options.question, analyses: [],
    consensus: { verdict: 'GO', rationale: 'OK.', requires_human_arbitration: true },
  });
  const mission = await app.inject({ method: 'POST', url: `/v1/console/rooms/${roomId}/messages`, payload: { text: 'Lancer maintenant ?' } });
  assert.equal(mission.statusCode, 200);

  // Refus d'un collectif vide.
  const emptied = await app.inject({ method: 'PATCH', url: `/v1/console/rooms/${roomId}/agents`, payload: { remove_agent_ids: ['cfo', 'cto', 'auteur_hugo'] } });
  assert.equal(emptied.statusCode, 400);

  // Agent inconnu refusé.
  const unknown = await app.inject({ method: 'PATCH', url: `/v1/console/rooms/${roomId}/agents`, payload: { add_agent_ids: ['auteur_inconnu'] } });
  assert.equal(unknown.statusCode, 400);

  // Salon inexistant -> 404.
  const missing = await app.inject({ method: 'PATCH', url: '/v1/console/rooms/room_absent/agents', payload: { add_agent_ids: ['cfo'] } });
  assert.equal(missing.statusCode, 404);
});

test('built-agents per-room limit is enforced when adding literary agents', async (t) => {
  const { app, swarm } = await buildApp();
  t.after(() => app.close());
  for (const id of ['auteur_a', 'auteur_b', 'auteur_c', 'auteur_d']) {
    await swarm.createAgent({
      agent_id: id, role_name: `${id} — agent auteur`, department: 'Bibliothèque du domaine public',
      seniority: 'executive', primary_focus: `Incarner ${id}.`, connectors: ['console'], enabled: true,
      metadata: { literary: { name: id } },
    }, { tenantId: 'tenant-a', by: 'test' });
  }
  const created = await app.inject({ method: 'POST', url: '/v1/console/rooms', payload: {
    name: 'Salon des auteurs', platform: 'console', external_room_id: 'console-auteurs', active_agents: ['auteur_a', 'auteur_b', 'auteur_c'],
  } });
  assert.equal(created.statusCode, 201);
  const roomId = created.json().room.room_id;
  const limited = await app.inject({ method: 'PATCH', url: `/v1/console/rooms/${roomId}/agents`, payload: { add_agent_ids: ['auteur_d'] } });
  assert.equal(limited.statusCode, 403);
  assert.match(limited.json().error, /Limite de la version en ligne/);
});
