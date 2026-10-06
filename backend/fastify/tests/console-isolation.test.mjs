// N1 / N2 (B4) : quota de sessions et isolation par propriétaire dans un même tenant.
// Spécification : docs/CAHIER-DES-CHARGES-CONSOLE.md, EF-21, EF-22, ENF-08, S13, S14.
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';

const USERS = {
  alice: { sub: 'u-alice', email: 'alice@kayros.test', role: 'contributeur', tenantId: 'default' },
  bob: { sub: 'u-bob', email: 'bob@kayros.test', role: 'contributeur', tenantId: 'default' },
  carol: { sub: 'u-carol', email: 'carol@kayros.test', role: 'contributeur', tenantId: 'default' },
  boss: { sub: 'u-boss', email: 'boss@kayros.test', role: 'comex', tenantId: 'default' },
};

async function buildApp() {
  const swarm = new SwarmService({ logger: null });
  const hybridGateway = new HybridAgentGateway({ swarm });
  const connectorConfig = new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() });
  const app = Fastify();
  app.decorate('kayrosContext', {
    hybridGateway, connectorConfig, engine: { swarm },
    crystalKnowsConfigured: false, connectorEncryptionConfigured: false,
  });
  app.decorate('requireAuth', async (req) => USERS[req.headers['x-test-user'] || 'alice']);
  await app.register(consoleRoute);
  let runs = 0;
  swarm.run = async (_id, options) => {
    runs += 1;
    const run = {
      run_id: `run-${runs}`, swarm_name: 'S', question: options.question, analyses: [], audit: [],
      consensus: { verdict: 'GO', rationale: 'ok', requires_human_arbitration: true },
      status: 'pending_human_arbitration', human_decision: null,
    };
    swarm.runs.set(swarm._key(options.tenantId, run.run_id), run);
    return JSON.parse(JSON.stringify(run));
  };
  return { app, swarm, hybridGateway, runCount: () => runs };
}
const as = (user, options) => ({ ...options, headers: { ...(options.headers || {}), 'x-test-user': user } });
async function openSession(app, user, name) {
  const res = await app.inject(as(user, { method: 'POST', url: '/v1/console/sessions', payload: { name, active_agents: ['cfo'] } }));
  assert.equal(res.statusCode, 201, res.body);
  return res.json().session;
}

test('S13 / N1 : le quota de sessions est compté par utilisateur, pas par tenant', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  for (const name of ['A1', 'A2', 'A3']) await openSession(app, 'alice', name);
  // Le tenant default contient déjà 3 sessions : un nouvel utilisateur crée quand même la sienne.
  for (const name of ['B1', 'B2', 'B3']) await openSession(app, 'bob', name);
  const fourth = await app.inject(as('bob', { method: 'POST', url: '/v1/console/sessions', payload: { name: 'B4', active_agents: ['cfo'] } }));
  assert.equal(fourth.statusCode, 403);
  assert.match(fourth.json().error, /3 sessions maximum par utilisateur/);
  // Un comex est aussi soumis au quota sur SES sessions, pas sur celles du tenant.
  const boss = await app.inject(as('boss', { method: 'POST', url: '/v1/console/sessions', payload: { name: 'C1', active_agents: ['cfo'] } }));
  assert.equal(boss.statusCode, 201);
});

test('S13 / N1 : impersonator-teams applique le même quota par propriétaire', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  for (const name of ['A1', 'A2', 'A3']) await openSession(app, 'alice', name);
  const team = await app.inject(as('boss', { method: 'POST', url: '/v1/console/impersonator-teams', payload: {
    name: 'Panel', consent_confirmed: true,
    members: [{ name: 'Camille Dubois', source: 'manual' }, { name: 'Marc Petit', source: 'manual' }],
  } }));
  assert.equal(team.statusCode, 201, team.body);
  assert.equal(team.json().session.created_by, 'boss@kayros.test');
});

test('S14 / N2 : un contributeur ne voit ni n’écrit dans la session d’un autre compte (404)', async (t) => {
  const { app, hybridGateway, runCount } = await buildApp(); t.after(() => app.close());
  const bobSession = await openSession(app, 'bob', 'Session de Bob');
  const bobRun = await app.inject(as('bob', { method: 'POST', url: `/v1/console/sessions/${bobSession.session_id}/run`, payload: { question: 'Lancer ?' } }));
  assert.equal(bobRun.statusCode, 200);
  const threadId = bobRun.json().thread.thread_id;
  const runsBefore = runCount();
  const messagesBefore = (await hybridGateway.getThread(threadId, { tenantId: 'default' })).messages.length;

  const list = await app.inject(as('alice', { method: 'GET', url: '/v1/console/sessions' }));
  assert.deepEqual(list.json().sessions, []);
  const detail = await app.inject(as('alice', { method: 'GET', url: `/v1/console/sessions/${bobSession.session_id}` }));
  assert.equal(detail.statusCode, 404);
  const run = await app.inject(as('alice', { method: 'POST', url: `/v1/console/sessions/${bobSession.session_id}/run`, payload: { question: 'Intrusion ?' } }));
  assert.equal(run.statusCode, 404);
  assert.equal(runCount(), runsBefore, 'aucune mission lancée');
  const collective = await app.inject(as('alice', { method: 'PATCH', url: `/v1/console/sessions/${bobSession.session_id}/collective`, payload: { add_agent_ids: ['cto'] } }));
  assert.equal(collective.statusCode, 404);
  const thread = await app.inject(as('alice', { method: 'GET', url: `/v1/console/threads/${threadId}` }));
  assert.equal(thread.statusCode, 404);
  const message = await app.inject(as('alice', { method: 'POST', url: `/v1/console/threads/${threadId}/messages`, payload: { text: 'Je réponds à la place de Bob' } }));
  assert.equal(message.statusCode, 404);
  assert.equal((await hybridGateway.getThread(threadId, { tenantId: 'default' })).messages.length, messagesBefore, 'aucun message enregistré');
  assert.equal(runCount(), runsBefore);
  const threads = await app.inject(as('alice', { method: 'GET', url: '/v1/console/threads' }));
  assert.deepEqual(threads.json().threads, []);
  const scopedThreads = await app.inject(as('alice', { method: 'GET', url: `/v1/console/threads?session_id=${bobSession.session_id}` }));
  assert.equal(scopedThreads.statusCode, 404);
  const activity = await app.inject(as('alice', { method: 'GET', url: '/v1/console/activity' }));
  assert.deepEqual(activity.json().events, []);
  const scopedActivity = await app.inject(as('alice', { method: 'GET', url: `/v1/console/activity?session_id=${bobSession.session_id}` }));
  assert.equal(scopedActivity.statusCode, 404);
  const overview = await app.inject(as('alice', { method: 'GET', url: '/v1/console/overview' }));
  assert.equal(overview.json().summary.sessions, 0);
  assert.equal(overview.json().summary.executions, 0);
  assert.deepEqual(overview.json().activity, []);

  // Bob garde l'accès complet à ses propres ressources.
  const own = await app.inject(as('bob', { method: 'POST', url: `/v1/console/threads/${threadId}/messages`, payload: { text: 'Budget validé' } }));
  assert.equal(own.statusCode, 202);
  const ownActivity = await app.inject(as('bob', { method: 'GET', url: '/v1/console/activity' }));
  assert.ok(ownActivity.json().events.length > 0);
  assert.ok(ownActivity.json().events.every((event) => event.room_id === bobSession.session_id));
});

test('N2 : comex et admin conservent la vue tenant ; l’arbitrage reste réservé à comex/admin', async (t) => {
  const { app } = await buildApp(); t.after(() => app.close());
  const bobSession = await openSession(app, 'bob', 'Session de Bob');
  await openSession(app, 'alice', 'Session d’Alice');
  const bobRun = await app.inject(as('bob', { method: 'POST', url: `/v1/console/sessions/${bobSession.session_id}/run`, payload: { question: 'Lancer ?' } }));
  const threadId = bobRun.json().thread.thread_id;
  const list = await app.inject(as('boss', { method: 'GET', url: '/v1/console/sessions' }));
  assert.equal(list.json().sessions.length, 2);
  const thread = await app.inject(as('boss', { method: 'GET', url: `/v1/console/threads/${threadId}` }));
  assert.equal(thread.statusCode, 200);
  const refused = await app.inject(as('bob', { method: 'POST', url: `/v1/console/threads/${threadId}/arbitrate`, payload: { action: 'accept_consensus' } }));
  assert.equal(refused.statusCode, 403, 'droits serveur inchangés');
  const arbitrated = await app.inject(as('boss', { method: 'POST', url: `/v1/console/threads/${threadId}/arbitrate`, payload: { action: 'accept_consensus' } }));
  assert.equal(arbitrated.statusCode, 200, arbitrated.body);
  assert.equal(arbitrated.json().thread.status, 'resolved');
});

test('N2 : anciennes sessions — `created_by` fait foi, une session sans propriétaire est invisible aux contributeurs', async (t) => {
  const { app, hybridGateway } = await buildApp(); t.after(() => app.close());
  // Sessions créées avant `owner_id` : seul `created_by` (e-mail serveur) est présent.
  const legacyAlice = await hybridGateway.createRoom({ platform: 'console', external_room_id: 'legacy-a', name: 'Ancienne Alice', mode: 'always', active_agents: ['cfo'] }, { tenantId: 'default', by: 'alice@kayros.test' });
  const orphan = await hybridGateway.createRoom({ platform: 'console', external_room_id: 'legacy-x', name: 'Orpheline', mode: 'always', active_agents: ['cfo'] }, { tenantId: 'default' });
  assert.equal(legacyAlice.owner_id, null);
  const alice = await app.inject(as('alice', { method: 'GET', url: '/v1/console/sessions' }));
  assert.deepEqual(alice.json().sessions.map((session) => session.session_id), [legacyAlice.room_id]);
  const orphanDetail = await app.inject(as('alice', { method: 'GET', url: `/v1/console/sessions/${orphan.room_id}` }));
  assert.equal(orphanDetail.statusCode, 404);
  const bob = await app.inject(as('bob', { method: 'GET', url: '/v1/console/sessions' }));
  assert.deepEqual(bob.json().sessions, []);
  const boss = await app.inject(as('boss', { method: 'GET', url: '/v1/console/sessions' }));
  assert.equal(boss.json().sessions.length, 2);
  // Les sessions héritées comptent dans le quota de leur créateur.
  await openSession(app, 'alice', 'A2');
  await openSession(app, 'alice', 'A3');
  const fourth = await app.inject(as('alice', { method: 'POST', url: '/v1/console/sessions', payload: { name: 'A4', active_agents: ['cfo'] } }));
  assert.equal(fourth.statusCode, 403);
});

test('N2 : le propriétaire est fixé par le serveur (owner_id = identifiant du jeton)', async (t) => {
  const { app, hybridGateway } = await buildApp(); t.after(() => app.close());
  const res = await app.inject(as('carol', { method: 'POST', url: '/v1/console/sessions', payload: { name: 'Carol', active_agents: ['cfo'], owner_id: 'u-bob', created_by: 'bob@kayros.test' } }));
  assert.equal(res.statusCode, 201);
  const room = await hybridGateway.getRoom(res.json().session.session_id, { tenantId: 'default' });
  assert.equal(room.owner_id, 'u-carol');
  assert.equal(room.created_by, 'carol@kayros.test');
});

test('EF-28 / EF-29 : option de simulation de personnalité et compteur « Profils hybrides »', async (t) => {
  const { app, swarm } = await buildApp(); t.after(() => app.close());
  swarm.createAgent({
    agent_id: 'client_cfo', role_name: 'CFO client', department: 'Comex', seniority: 'executive', primary_focus: 'Client.',
    human_profile: { assigned_name: 'Alex Martin', consent_confirmed: true },
  }, { tenantId: 'default', by: 'boss@kayros.test' });
  const auto = await app.inject(as('alice', { method: 'POST', url: '/v1/console/sessions', payload: { name: 'Auto', active_agents: ['client_cfo'] } }));
  assert.equal(auto.json().session.collective.personality_simulation_enabled, true);
  const off = await app.inject(as('alice', { method: 'POST', url: '/v1/console/sessions', payload: { name: 'Off', active_agents: ['client_cfo'], personality_simulation_enabled: false } }));
  assert.equal(off.json().session.collective.personality_simulation_enabled, false);
  const team = await app.inject(as('boss', { method: 'POST', url: '/v1/console/impersonator-teams', payload: {
    name: 'Panel', consent_confirmed: true, personality_simulation_enabled: false,
    members: [{ name: 'Camille Dubois', source: 'manual' }, { name: 'Marc Petit', source: 'manual' }],
  } }));
  assert.equal(team.statusCode, 201, team.body);
  assert.equal(team.json().session.collective.personality_simulation_enabled, false);
  const defaultTeam = await app.inject(as('boss', { method: 'POST', url: '/v1/console/impersonator-teams', payload: {
    name: 'Panel 2', consent_confirmed: true,
    members: [{ name: 'Lea Martin', source: 'manual' }, { name: 'Paul Durand', source: 'manual' }],
  } }));
  assert.equal(defaultTeam.json().session.collective.personality_simulation_enabled, true);
  const overview = await app.inject(as('boss', { method: 'GET', url: '/v1/console/overview' }));
  // client_cfo (user_defined) + 4 impersonators, tous avec un profil humain consenti.
  assert.equal(overview.json().summary.hybrid_agents, 5);
  assert.equal(overview.json().summary.impersonators, 4);
});
