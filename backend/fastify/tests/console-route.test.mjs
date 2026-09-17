import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import { HybridAgentGateway, SwarmService, ConnectorOAuthService } from '../../../core/index.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';

function oauth() {
  return new ConnectorOAuthService({
    config: {
      slack: { clientId: 'cid', clientSecret: 'sec', signingSecret: 'sig', scopes: 'app_mentions:read,chat:write' },
      discord: { clientId: '', clientSecret: '', botToken: '', publicKey: '', permissions: '0', scopes: 'bot' },
      teams: { appId: '', botPassword: '', tenant: 'organizations' },
    },
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, access_token: 'tok', team: { id: 'T1', name: 'Team' } }) }),
  });
}

async function buildApp() {
  const swarm = new SwarmService();
  const hybridGateway = new HybridAgentGateway({ swarm });
  const connectorConfig = new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() });
  const app = Fastify();
  app.decorate('kayrosContext', {
    hybridGateway, connectorConfig, engine: { swarm }, connectorOAuth: oauth(),
    connectorOAuthConfigured: { slack: true, discord: false, teams: false },
    publicApiUrl: 'https://api.kayros.test', consoleUrl: 'https://console.kayros.test/console/',
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

test('console creates a hybrid agent and attaches a consented human profile', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  const created = await app.inject({ method: 'POST', url: '/v1/console/agents', payload: {
    agent_id: 'client_cfo', role_name: 'CFO client', department: 'Comité de direction', seniority: 'executive',
    primary_focus: 'Rejouer le point de vue du client.', connectors: ['console'], enabled: true,
  } });
  assert.equal(created.statusCode, 201);
  const imported = await app.inject({ method: 'POST', url: '/v1/console/agents/client_cfo/personality', payload: {
    consent_confirmed: true,
    manual_profile: { assigned_name: 'Alex Martin', disc_type: 'D/C', consent_confirmed: true, communication_style: { tone: 'direct' } },
  } });
  assert.equal(imported.statusCode, 200);
  assert.equal(imported.json().agent.human_profile.assigned_name, 'Alex Martin');
  assert.equal(imported.json().agent.human_profile.consent_confirmed, true);
  assert.ok((imported.json().agent.human_profile.profile_sources || []).length > 0);
});

test('console rejects a human profile without explicit consent', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  await app.inject({ method: 'POST', url: '/v1/console/agents', payload: {
    agent_id: 'no_consent', role_name: 'R', department: 'D', seniority: 'senior', primary_focus: 'F', connectors: ['console'], enabled: true,
  } });
  const refused = await app.inject({ method: 'PUT', url: '/v1/console/agents/no_consent/human-profile', payload: { assigned_name: 'X' } });
  assert.equal(refused.statusCode, 400);
  assert.match(refused.json().error, /consentement/);
});

test('console exposes one-click connector connection and reports unavailable platforms', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  const slack = await app.inject({ method: 'POST', url: '/v1/console/connectors/slack/connect' });
  assert.equal(slack.statusCode, 200);
  const body = slack.json();
  assert.equal(body.mode, 'oauth');
  assert.match(body.url, /^https:\/\/slack\.com\/oauth\/v2\/authorize\?/);
  assert.match(body.url, /state=/);
  assert.equal(body.redirect_uri, 'https://api.kayros.test/v1/connectors/slack/oauth/callback');

  const teams = await app.inject({ method: 'POST', url: '/v1/console/connectors/teams/connect' });
  assert.equal(teams.statusCode, 409);
  assert.match(teams.json().error, /indisponible/);

  const overview = await app.inject({ method: 'GET', url: '/v1/console/overview' });
  assert.equal(overview.json().capabilities.connector_oauth.slack, true);
  assert.equal(overview.json().capabilities.connector_oauth.teams, false);
});

test('console builds an impersonator agent from clues and wires its guardrails', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  const created = await app.inject({ method: 'POST', url: '/v1/console/impersonators', payload: {
    name: 'Camille Dubois', role: 'VP Procurement', company: 'Northwind', source: 'manual',
    clues: ['décide vite', 'exige des preuves chiffrées'], purpose: 'idea_test', consent_confirmed: true,
  } });
  assert.equal(created.statusCode, 201);
  const body = created.json();
  assert.equal(body.agent.agent_id, 'imposteur_camille_dubois');
  assert.equal(body.agent.metadata.impersonator.persona_name, 'Camille Dubois');
  assert.equal(body.agent.human_profile.consent_confirmed, true);
  assert.equal(body.guardrails.length, 5);
  assert.match(body.agent.effective_context, /PERSONA SIMULATION/);
  assert.ok(body.agent.effective_rules.some((rule) => rule.origin === 'impersonator'));
  const overview = await app.inject({ method: 'GET', url: '/v1/console/overview' });
  assert.ok(overview.json().agents.some((agent) => agent.agent_id === 'imposteur_camille_dubois'));
});

test('console rejects an impersonator without explicit consent', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  const bad = await app.inject({ method: 'POST', url: '/v1/console/impersonators', payload: { name: 'X', source: 'manual' } });
  assert.equal(bad.statusCode, 400);
});

test('console creates an impersonator TEAM session with several personas', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  const created = await app.inject({ method: 'POST', url: '/v1/console/impersonator-teams', payload: {
    name: 'Panel achats 2026', consent_confirmed: true, voting_threshold: 'majority', veto_power: true,
    members: [
      { name: 'Camille Dubois', role: 'VP Procurement', company: 'Northwind', source: 'manual', clues: ['décide vite'] },
      { name: 'Marc Petit', role: 'DSI', company: 'Northwind', source: 'manual' },
    ],
  } });
  assert.equal(created.statusCode, 201);
  const body = created.json();
  assert.equal(body.agents.length, 2);
  assert.deepEqual(body.agents.map((agent) => agent.agent_id), ['imposteur_camille_dubois', 'imposteur_marc_petit']);
  assert.deepEqual(body.agents.map((agent) => agent.metadata.impersonator.persona_name), ['Camille Dubois', 'Marc Petit']);
  assert.equal(body.session.name, 'Panel achats 2026');
  assert.equal(body.session.collective.active_agents.length, 2);
  assert.equal(body.session.collective.voting_threshold, 'majority');
  // The team is a real session: it appears in the sessions list.
  const sessions = await app.inject({ method: 'GET', url: '/v1/console/sessions' });
  assert.ok(sessions.json().sessions.some((session) => session.session_id === body.session.session_id));

  const few = await app.inject({ method: 'POST', url: '/v1/console/impersonator-teams', payload: {
    name: 'Trop petit', consent_confirmed: true, members: [{ name: 'Seul', source: 'manual' }],
  } });
  assert.equal(few.statusCode, 400);
});
