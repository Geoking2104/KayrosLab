// Missions console asynchrones : 202 + fil `running`, polling jusqu'au statut
// final, `failed` lisible, isolation sur un fil en cours, reprise au
// redémarrage, mode `?wait=true` conservé. Aucun appel LLM : run simulé.
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import { consoleRunTimeoutMs } from '../lib/context.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { InMemoryCollaborationStore } from '../../../core/collaboration-store.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';

const USERS = {
  alice: { sub: 'u-alice', email: 'alice@kayros.test', role: 'contributeur', tenantId: 'default' },
  bob: { sub: 'u-bob', email: 'bob@kayros.test', role: 'contributeur', tenantId: 'default' },
  boss: { sub: 'u-boss', email: 'boss@kayros.test', role: 'comex', tenantId: 'default' },
};
const as = (user, options) => ({ ...options, headers: { ...(options.headers || {}), 'x-test-user': user } });
function deferred() { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }

async function buildApp({ store = new InMemoryCollaborationStore(), swarm = new SwarmService({ logger: null }) } = {}) {
  const hybridGateway = new HybridAgentGateway({ swarm, store });
  const connectorConfig = new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() });
  const app = Fastify();
  app.decorate('kayrosContext', { hybridGateway, connectorConfig, engine: { swarm }, crystalKnowsConfigured: false, connectorEncryptionConfigured: false });
  app.decorate('requireAuth', async (req) => USERS[req.headers['x-test-user'] || 'bob']);
  await app.register(consoleRoute);
  return { app, swarm, hybridGateway, store };
}
/** Run simulé contrôlable : progression x/total puis attente de `gate`. */
function controllableRun(swarm, { gate = null, fail = null, verdict = 'GO' } = {}) {
  const calls = [];
  swarm.run = async (_id, options) => {
    calls.push(options);
    await options.onProgress?.({ completed: 1, total: 3, agent_id: 'cfo' });
    if (gate) await gate.promise;
    if (fail) throw new Error(fail);
    await options.onProgress?.({ completed: 3, total: 3, agent_id: 'legal_counsel' });
    const run = {
      run_id: options.runId || `run-${calls.length}`, swarm_name: 'S', question: options.question,
      analyses: [{ agent_id: 'cfo', verdict }, { agent_id: 'cto', verdict }, { agent_id: 'legal_counsel', verdict }],
      consensus: { verdict, rationale: 'Majorité favorable.', requires_human_arbitration: true },
      status: 'pending_human_arbitration', human_decision: null, audit: [],
    };
    swarm.runs.set(swarm._key(options.tenantId, run.run_id), run);
    return run;
  };
  return calls;
}
async function openSession(app, user = 'bob', name = 'Comex') {
  const res = await app.inject(as(user, { method: 'POST', url: '/v1/console/sessions', payload: { name, active_agents: ['cfo', 'cto', 'legal_counsel'] } }));
  assert.equal(res.statusCode, 201, res.body);
  return res.json().session;
}
const getThread = (app, user, id) => app.inject(as(user, { method: 'GET', url: `/v1/console/threads/${id}` }));

test('POST /run répond 202 (fil `running`) puis le polling voit le statut final', async (t) => {
  const { app, swarm, hybridGateway } = await buildApp(); t.after(() => app.close());
  const session = await openSession(app);
  const gate = deferred();
  const calls = controllableRun(swarm, { gate });
  const res = await app.inject(as('bob', { method: 'POST', url: `/v1/console/sessions/${session.session_id}/run`, payload: { question: 'Lancer maintenant ?' } }));
  assert.equal(res.statusCode, 202, res.body);
  const body = res.json();
  assert.equal(body.status, 'running');
  assert.ok(body.thread_id && body.run_id);
  assert.equal(body.run.run_id, body.run_id);
  assert.equal(body.thread.status, 'running');
  assert.equal(body.poll, `/v1/console/threads/${body.thread_id}`);
  assert.deepEqual(body.thread.progress, { completed: 0, total: 3 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[0].runId, body.run_id);

  // Polling pendant l'exécution : statut + progression exposés.
  const during = await getThread(app, 'bob', body.thread_id);
  assert.equal(during.statusCode, 200);
  assert.equal(during.json().thread.status, 'running');
  assert.deepEqual(during.json().thread.progress, { completed: 1, total: 3 });
  const sessionDuring = await app.inject(as('bob', { method: 'GET', url: `/v1/console/sessions/${session.session_id}` }));
  const execution = sessionDuring.json().session.executions.find((item) => item.thread_id === body.thread_id);
  assert.equal(execution.status, 'running');
  assert.deepEqual(execution.progress, { completed: 1, total: 3 });
  const overview = await app.inject(as('bob', { method: 'GET', url: '/v1/console/overview' }));
  assert.equal(overview.json().summary.running_executions, 1);
  assert.equal(overview.json().summary.pending_human_decisions, 0, 'une mission en cours n’attend pas d’arbitrage');

  gate.resolve();
  await hybridGateway.waitForThread(body.thread_id);
  const after = (await getThread(app, 'bob', body.thread_id)).json().thread;
  assert.equal(after.status, 'awaiting_arbitration');
  assert.deepEqual(after.progress, { completed: 3, total: 3 });
  assert.equal(after.current_run_id, body.run_id);
  assert.equal(after.messages.find((message) => message.kind === 'run').run.consensus.verdict, 'GO');
  const finalOverview = await app.inject(as('bob', { method: 'GET', url: '/v1/console/overview' }));
  assert.equal(finalOverview.json().summary.pending_human_decisions, 1);
  assert.equal(finalOverview.json().summary.running_executions, 0);
});

test('échec du collectif : le fil passe `failed` avec un message lisible', async (t) => {
  const { app, swarm, hybridGateway } = await buildApp(); t.after(() => app.close());
  const session = await openSession(app);
  controllableRun(swarm, { fail: 'nvidia http 504' });
  const res = await app.inject(as('bob', { method: 'POST', url: `/v1/console/sessions/${session.session_id}/run`, payload: { question: 'Lancer ?' } }));
  assert.equal(res.statusCode, 202);
  await hybridGateway.waitForThread(res.json().thread_id);
  const thread = (await getThread(app, 'bob', res.json().thread_id)).json().thread;
  assert.equal(thread.status, 'failed');
  assert.equal(thread.error, 'nvidia http 504');
  assert.match(thread.messages.at(-1).text, /n’a pas abouti/);
  // La session n'est pas bloquée : une nouvelle mission peut partir.
  controllableRun(swarm);
  const again = await app.inject(as('bob', { method: 'POST', url: `/v1/console/sessions/${session.session_id}/run`, payload: { question: 'Relancer ?' } }));
  assert.equal(again.statusCode, 202);
  await hybridGateway.idle();
});

test('isolation et verrou sur un fil en cours : 404 pour autrui, 409 pour le propriétaire', async (t) => {
  const { app, swarm, hybridGateway } = await buildApp(); t.after(() => app.close());
  const session = await openSession(app, 'bob');
  const gate = deferred();
  const calls = controllableRun(swarm, { gate });
  const res = await app.inject(as('bob', { method: 'POST', url: `/v1/console/sessions/${session.session_id}/run`, payload: { question: 'Lancer ?' } }));
  const threadId = res.json().thread_id;
  // Alice (autre contributeur) : rien n'est révélé, rien n'est écrit.
  assert.equal((await getThread(app, 'alice', threadId)).statusCode, 404);
  const intrusion = await app.inject(as('alice', { method: 'POST', url: `/v1/console/threads/${threadId}/messages`, payload: { text: 'Je réponds à la place de Bob' } }));
  assert.equal(intrusion.statusCode, 404);
  const run = await app.inject(as('alice', { method: 'POST', url: `/v1/console/sessions/${session.session_id}/run`, payload: { question: 'Intrusion ?' } }));
  assert.equal(run.statusCode, 404);
  assert.deepEqual((await app.inject(as('alice', { method: 'GET', url: '/v1/console/threads' }))).json().threads, []);
  // Bob : une seule mission à la fois par session ; pas de relance d'un fil en cours.
  const second = await app.inject(as('bob', { method: 'POST', url: `/v1/console/sessions/${session.session_id}/run`, payload: { question: 'Encore ?' } }));
  assert.equal(second.statusCode, 409);
  assert.match(second.json().error, /déjà en cours sur cette session/);
  assert.ok(!/salon/i.test(second.json().error));
  const rerun = await app.inject(as('bob', { method: 'POST', url: `/v1/console/threads/${threadId}/messages`, payload: { text: 'Budget validé' } }));
  assert.equal(rerun.statusCode, 409);
  // Le comex voit le fil mais ne peut pas arbitrer avant la fin des analyses.
  assert.equal((await getThread(app, 'boss', threadId)).statusCode, 200);
  const early = await app.inject(as('boss', { method: 'POST', url: `/v1/console/threads/${threadId}/arbitrate`, payload: { action: 'accept_consensus' } }));
  assert.equal(early.statusCode, 409);
  assert.equal(calls.length, 1, 'aucun run supplémentaire lancé');
  gate.resolve();
  await hybridGateway.waitForThread(threadId);
  const arbitrated = await app.inject(as('boss', { method: 'POST', url: `/v1/console/threads/${threadId}/arbitrate`, payload: { action: 'accept_consensus' } }));
  assert.equal(arbitrated.statusCode, 200, arbitrated.body);
});

test('POST /threads/:id/messages relance le collectif en asynchrone (202 running → final)', async (t) => {
  const { app, swarm, hybridGateway } = await buildApp(); t.after(() => app.close());
  const session = await openSession(app);
  controllableRun(swarm);
  const res = await app.inject(as('bob', { method: 'POST', url: `/v1/console/sessions/${session.session_id}/run`, payload: { question: 'Lancer ?' } }));
  const threadId = res.json().thread_id;
  const first = await hybridGateway.waitForThread(threadId);
  const gate = deferred();
  controllableRun(swarm, { gate, verdict: 'NO_GO' });
  const reply = await app.inject(as('bob', { method: 'POST', url: `/v1/console/threads/${threadId}/messages`, payload: { text: 'Budget validé à 120 k€' } }));
  assert.equal(reply.statusCode, 202, reply.body);
  assert.equal(reply.json().status, 'running');
  assert.equal(reply.json().thread.status, 'running');
  assert.ok(reply.json().run_id);
  assert.equal(reply.json().thread.current_run_id, first.current_run_id);
  gate.resolve();
  await hybridGateway.waitForThread(threadId);
  const after = (await getThread(app, 'bob', threadId)).json().thread;
  assert.equal(after.status, 'awaiting_arbitration');
  assert.equal(after.current_run_id, reply.json().run_id);
  assert.equal(after.messages.filter((message) => message.kind === 'run').at(-1).run.consensus.verdict, 'NO_GO');
});

test('?wait=true conserve le mode synchrone pour /run et /messages', async (t) => {
  const { app, swarm, hybridGateway } = await buildApp(); t.after(() => app.close());
  const session = await openSession(app);
  controllableRun(swarm);
  const res = await app.inject(as('bob', { method: 'POST', url: `/v1/console/sessions/${session.session_id}/run?wait=true`, payload: { question: 'Lancer ?' } }));
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().summary.verdict, 'GO');
  assert.equal(res.json().thread.status, 'awaiting_arbitration');
  assert.ok(res.json().run.run_id);
  assert.equal(hybridGateway.jobs.size, 0, 'aucune tâche de fond en mode wait');
  const reply = await app.inject(as('bob', { method: 'POST', url: `/v1/console/threads/${res.json().thread.thread_id}/messages?wait=true`, payload: { text: 'Budget validé' } }));
  assert.equal(reply.statusCode, 202);
  assert.equal(reply.json().thread.status, 'awaiting_arbitration');
  assert.equal(hybridGateway.jobs.size, 0);
});

test('redémarrage : une mission restée `running` est exposée en `failed` (interrompue)', async (t) => {
  const store = new InMemoryCollaborationStore();
  const first = await buildApp({ store }); t.after(() => first.app.close());
  const session = await openSession(first.app);
  first.swarm.run = () => new Promise(() => {}); // processus arrêté pendant les analyses
  const res = await first.app.inject(as('bob', { method: 'POST', url: `/v1/console/sessions/${session.session_id}/run`, payload: { question: 'Lancer ?' } }));
  assert.equal(res.statusCode, 202);
  // Nouveau processus sur la même base : la reprise est faite au démarrage (lib/context.mjs).
  const second = await buildApp({ store }); t.after(() => second.app.close());
  assert.equal(await second.hybridGateway.recoverInterruptedRuns(), 1);
  const thread = (await getThread(second.app, 'bob', res.json().thread_id)).json().thread;
  assert.equal(thread.status, 'failed');
  assert.match(thread.error, /interrompue par un redémarrage/);
});

test('KAYROS_CONSOLE_RUN_TIMEOUT_MS : 30 min par défaut, 0 désactive', () => {
  assert.equal(consoleRunTimeoutMs(undefined), 1800000);
  assert.equal(consoleRunTimeoutMs(''), 1800000);
  assert.equal(consoleRunTimeoutMs('0'), 0);
  assert.equal(consoleRunTimeoutMs('600000'), 600000);
  assert.equal(consoleRunTimeoutMs('abc'), 1800000);
});
