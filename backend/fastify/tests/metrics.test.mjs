// Métriques Prometheus applicatives (lib/metrics.mjs) : appels LLM par
// fournisseur/issue, replis vers mock, 429/délais, missions console
// (durée, issue, en cours, interrompues au démarrage) et accès protégé à
// /metrics. Aucun appel LLM réel : fournisseurs simulés.
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import metricsPlugin from 'fastify-metrics';
import consoleRoute from '../routes/console.mjs';
import {
  metricsRegister, metricsEndpoint, metricsAccessHook, instrumentProviders, instrumentLlm, setLlmPrimary,
  classifyLlmError, modelLabel, consoleRunObserver, recordInterruptedRuns, runOutcomeFromThread,
} from '../lib/metrics.mjs';
import { KayrosLLM, RoutingPolicy, MockProvider, HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { InMemoryCollaborationStore } from '../../../core/collaboration-store.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';

async function value(name, labels = {}) {
  const metric = metricsRegister.getSingleMetric(name);
  assert.ok(metric, `métrique ${name} absente`);
  const { values } = await metric.get();
  const hit = values.find((v) => Object.entries(labels).every(([k, want]) => v.labels[k] === want));
  return hit ? hit.value : 0;
}
async function histogramCount(name, labels = {}) {
  const metric = metricsRegister.getSingleMetric(name);
  const { values } = await metric.get();
  const hit = values.find((v) => v.metricName === `${name}_count` && Object.entries(labels).every(([k, want]) => v.labels[k] === want));
  return hit ? hit.value : 0;
}
function failing(id, makeError) {
  return { id, defaultModel: `${id}-model`, async complete() { throw makeError(); } };
}
const rateLimited = () => Object.assign(new Error('nvidia http 429'), { status: 429, code: 'RATE_LIMITED' });
const timedOut = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

test('classifyLlmError normalise 429, délai, clé absente, circuit ouvert', () => {
  assert.equal(classifyLlmError(rateLimited()), 'rate_limited');
  assert.equal(classifyLlmError({ status: 429 }), 'rate_limited');
  assert.equal(classifyLlmError(timedOut()), 'timeout');
  assert.equal(classifyLlmError(Object.assign(new Error('x'), { name: 'AbortError' })), 'timeout');
  assert.equal(classifyLlmError(Object.assign(new Error('NVIDIA_API_KEY non configuree'), { code: 'NO_KEY' })), 'not_configured');
  assert.equal(classifyLlmError(Object.assign(new Error('CircuitBreaker OPEN'), { code: 'CIRCUIT_OPEN' })), 'circuit_open');
  assert.equal(classifyLlmError(new Error('mistral http 500')), 'error');
});

test('label model borné : caractères sûrs et plafond de cardinalité', () => {
  assert.equal(modelLabel('moonshotai/kimi-k3'), 'moonshotai/kimi-k3');
  assert.equal(modelLabel(''), 'default');
  assert.match(modelLabel('a b{c}"d'), /^[A-Za-z0-9._:/-]+$/);
  for (let i = 0; i < 40; i += 1) modelLabel(`modele-${i}`);
  assert.equal(modelLabel('encore-un-autre-modele'), 'other');
  assert.equal(modelLabel('moonshotai/kimi-k3'), 'moonshotai/kimi-k3', 'un modèle déjà vu garde son label');
});

test('chaîne NVIDIA (429) → Mistral (délai) → mock : appels, replis et requête dégradée comptés', async () => {
  const providers = instrumentProviders({
    nvidia: failing('nvidia', rateLimited),
    mistral: failing('mistral', timedOut),
    mock: new MockProvider(),
  });
  const llm = instrumentLlm(new KayrosLLM(providers, new RoutingPolicy({ defaultProvider: 'nvidia', fallback: ['mistral', 'mock'] }), {
    retry: { maxRetries: 0 },
  }));
  // Idempotence : une seconde instrumentation ne double pas les compteurs.
  instrumentProviders(providers); instrumentLlm(llm);

  const before = {
    nvidia429: await value('kayros_llm_calls_total', { provider: 'nvidia', outcome: 'rate_limited' }),
    mistralTimeout: await value('kayros_llm_calls_total', { provider: 'mistral', outcome: 'timeout' }),
    mockOk: await value('kayros_llm_calls_total', { provider: 'mock', outcome: 'success' }),
    toMock: await value('kayros_llm_fallbacks_total', { from: 'nvidia', to: 'mock', reason: 'provider_fallback' }),
    degraded: await value('kayros_llm_requests_total', { outcome: 'degraded' }),
  };
  const res = await llm.complete({ messages: [{ role: 'user', content: 'Bonjour' }] });
  assert.equal(res.degraded.to, 'mock');

  assert.equal(await value('kayros_llm_calls_total', { provider: 'nvidia', outcome: 'rate_limited' }), before.nvidia429 + 1);
  assert.equal(await value('kayros_llm_calls_total', { provider: 'mistral', outcome: 'timeout' }), before.mistralTimeout + 1);
  assert.equal(await value('kayros_llm_calls_total', { provider: 'mock', outcome: 'success' }), before.mockOk + 1);
  assert.equal(await value('kayros_llm_fallbacks_total', { from: 'nvidia', to: 'mock', reason: 'provider_fallback' }), before.toMock + 1);
  assert.equal(await value('kayros_llm_requests_total', { outcome: 'degraded' }), before.degraded + 1);
  assert.ok(await value('kayros_llm_last_fallback_to_mock_timestamp_seconds') > 0);
  assert.ok(await histogramCount('kayros_llm_call_duration_seconds', { provider: 'nvidia', outcome: 'rate_limited' }) >= 1);
});

test('requête réussie sur le primaire : success, sans repli ; échec total : failed', async () => {
  const ok = { id: 'nvidia', async complete() { return { text: 'ok', provider: 'nvidia', model: 'moonshotai/kimi-k3' }; } };
  const llm = instrumentLlm(new KayrosLLM(instrumentProviders({ nvidia: ok }), new RoutingPolicy({ defaultProvider: 'nvidia', fallback: [] }), { retry: { maxRetries: 0 } }));
  const success = await value('kayros_llm_requests_total', { outcome: 'success' });
  const kimi = await value('kayros_llm_calls_total', { provider: 'nvidia', model: 'moonshotai/kimi-k3', outcome: 'success' });
  await llm.complete({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(await value('kayros_llm_requests_total', { outcome: 'success' }), success + 1);
  assert.equal(await value('kayros_llm_calls_total', { provider: 'nvidia', model: 'moonshotai/kimi-k3', outcome: 'success' }), kimi + 1);

  const broken = instrumentLlm(new KayrosLLM(instrumentProviders({ mistral: failing('mistral', () => new Error('mistral http 500')) }),
    new RoutingPolicy({ defaultProvider: 'mistral', fallback: [] }), { retry: { maxRetries: 0 } }));
  const failed = await value('kayros_llm_requests_total', { outcome: 'failed' });
  await assert.rejects(() => broken.complete({ messages: [{ role: 'user', content: 'x' }] }));
  assert.equal(await value('kayros_llm_requests_total', { outcome: 'failed' }), failed + 1);
  assert.ok(await value('kayros_llm_calls_total', { provider: 'mistral', outcome: 'error' }) >= 1);
});

test('fournisseur primaire publié sans secret', async () => {
  setLlmPrimary({ provider: 'nvidia', nvidia: { model: 'moonshotai/kimi-k3' }, models: {} });
  assert.equal(await value('kayros_llm_primary_info', { provider: 'nvidia', model: 'moonshotai/kimi-k3' }), 1);
  setLlmPrimary({ provider: 'mock', models: {} });
  assert.equal(await value('kayros_llm_primary_info', { provider: 'nvidia' }), 0, 'une seule série active');
  assert.equal(await value('kayros_llm_primary_info', { provider: 'mock' }), 1);
});

test('runOutcomeFromThread : statuts finaux → issues', () => {
  assert.equal(runOutcomeFromThread({ status: 'awaiting_arbitration' }), 'completed');
  assert.equal(runOutcomeFromThread({ status: 'needs_clarification' }), 'needs_clarification');
  assert.equal(runOutcomeFromThread({ status: 'failed', error: 'boom' }), 'failed');
  assert.equal(runOutcomeFromThread({ status: 'failed', error: 'délai maximal d’exécution dépassé (1 s)' }), 'timeout');
  assert.equal(runOutcomeFromThread({ status: 'running' }), null);
});

test('observateur : en cours, âge de la plus ancienne mission, interruptions au démarrage', async () => {
  const inProgress = await value('kayros_console_runs_in_progress');
  const handle = consoleRunObserver.started({ kind: 'message' });
  assert.equal(await value('kayros_console_runs_in_progress'), inProgress + 1);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(await value('kayros_console_run_oldest_running_seconds') > 0);
  consoleRunObserver.finished(handle, { thread: { status: 'needs_clarification' } });
  consoleRunObserver.finished(handle, { thread: { status: 'needs_clarification' } }); // double appel ignoré
  assert.equal(await value('kayros_console_runs_in_progress'), inProgress);
  assert.equal(await value('kayros_console_run_oldest_running_seconds'), 0);

  const interrupted = await value('kayros_console_runs_interrupted_total');
  recordInterruptedRuns(2); recordInterruptedRuns(0); recordInterruptedRuns(undefined);
  assert.equal(await value('kayros_console_runs_interrupted_total'), interrupted + 2);
});

test('missions console réelles (gateway + route 202) : durée et issue comptées, échec compris', async (t) => {
  const swarm = new SwarmService({ logger: null });
  const hybridGateway = new HybridAgentGateway({ swarm, store: new InMemoryCollaborationStore(), runObserver: consoleRunObserver });
  const app = Fastify();
  app.decorate('kayrosContext', {
    hybridGateway, connectorConfig: new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() }),
    engine: { swarm }, crystalKnowsConfigured: false, connectorEncryptionConfigured: false,
  });
  app.decorate('requireAuth', async () => ({ sub: 'u-bob', email: 'bob@kayros.test', role: 'contributeur', tenantId: 'default' }));
  await app.register(consoleRoute);
  t.after(() => app.close());

  let fail = false;
  swarm.run = async (_id, options) => {
    if (fail) throw new Error('fournisseur indisponible');
    const run = {
      run_id: options.runId, swarm_name: 'S', question: options.question,
      analyses: [{ agent_id: 'cfo', verdict: 'GO' }],
      consensus: { verdict: 'GO', rationale: 'ok', requires_human_arbitration: true },
      status: 'pending_human_arbitration', human_decision: null, audit: [],
    };
    swarm.runs.set(swarm._key(options.tenantId, run.run_id), run);
    return run;
  };
  const created = await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: { name: 'Comex', active_agents: ['cfo'] } });
  assert.equal(created.statusCode, 201, created.body);
  const sessionId = created.json().session.session_id;

  const completed = await value('kayros_console_runs_total', { kind: 'message', outcome: 'completed' });
  const failed = await value('kayros_console_runs_total', { kind: 'message', outcome: 'failed' });
  const durations = await histogramCount('kayros_console_run_duration_seconds', { kind: 'message', outcome: 'completed' });

  const ok = await app.inject({ method: 'POST', url: `/v1/console/sessions/${sessionId}/run`, payload: { question: 'Lancer ?' } });
  assert.equal(ok.statusCode, 202, ok.body);
  await hybridGateway.idle();
  assert.equal(await value('kayros_console_runs_total', { kind: 'message', outcome: 'completed' }), completed + 1);
  assert.equal(await histogramCount('kayros_console_run_duration_seconds', { kind: 'message', outcome: 'completed' }), durations + 1);

  fail = true;
  const ko = await app.inject({ method: 'POST', url: `/v1/console/sessions/${sessionId}/run`, payload: { question: 'Et maintenant ?' } });
  assert.equal(ko.statusCode, 202, ko.body);
  await hybridGateway.idle();
  assert.equal(await value('kayros_console_runs_total', { kind: 'message', outcome: 'failed' }), failed + 1);
  assert.equal(await value('kayros_console_runs_in_progress'), 0);
});

test('un observateur défaillant ne casse jamais une mission', async () => {
  const swarm = new SwarmService({ logger: null });
  const gateway = new HybridAgentGateway({ swarm, store: new InMemoryCollaborationStore(), runObserver: {
    started() { throw new Error('observer down'); }, finished() { throw new Error('observer down'); },
  } });
  const thread = await gateway._launch('t1', 'default', 'r1', { execute: async () => ({}), finish: async () => ({ status: 'awaiting_arbitration' }) });
  assert.equal(thread.status, 'awaiting_arbitration');
});

test('/metrics : Bearer METRICS_TOKEN exigé quand il est défini, sans fuite du jeton', async (t) => {
  const app = Fastify();
  await app.register(metricsPlugin, { endpoint: metricsEndpoint({ METRICS_TOKEN: 'jeton-de-test' }) });
  app.get('/ping', async () => ({ ok: true }));
  t.after(() => app.close());

  assert.equal((await app.inject({ method: 'GET', url: '/metrics' })).statusCode, 401);
  const wrong = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer mauvais' } });
  assert.equal(wrong.statusCode, 401);
  assert.doesNotMatch(wrong.body, /jeton-de-test/);
  const res = await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer jeton-de-test', 'x-forwarded-for': '203.0.113.9' } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /# TYPE kayros_llm_calls_total counter/);
  assert.match(res.body, /# TYPE kayros_console_runs_in_progress gauge/);
  assert.match(res.body, /process_resident_memory_bytes/);
  assert.doesNotMatch(res.body, /jeton-de-test|tenant|email|@kayros/);
});

test('/metrics sans jeton : loopback direct seulement, refusé via le proxy ou à distance', async (t) => {
  const app = Fastify();
  app.get('/metrics', { onRequest: metricsAccessHook({ token: '' }) }, async () => 'ok');
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'GET', url: '/metrics' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/metrics', headers: { 'x-real-ip': '203.0.113.9' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/metrics', headers: { 'x-forwarded-for': '203.0.113.9' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/metrics', remoteAddress: '203.0.113.9' })).statusCode, 403);
});
