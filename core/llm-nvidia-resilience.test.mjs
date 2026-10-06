// Provider OpenAI-compatible (NVIDIA NIM), retrait du raisonnement, relances
// 429 (backoff + Retry-After) et concurrence bornée du swarm — node --test.
// Aucun appel réseau : fetch est toujours simulé, la clé est factice.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OpenAICompatibleProvider, stripReasoning, KayrosLLM, RoutingPolicy, MockProvider,
} from './kayros-llm.mjs';
import {
  withResilience, CircuitBreaker, BreakerState, parseRetryAfter, isRetryableError, mapWithConcurrency,
} from './resilience.mjs';
import { SwarmService, normalizeAgentAnalysis } from './swarm.mjs';

const FAKE_KEY = 'fake-test-key-not-a-secret';

function jsonResponse(status, body, headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => h.get(String(name).toLowerCase()) ?? null },
    json: async () => body,
  };
}

const okCompletion = (content, extra = {}) => jsonResponse(200, {
  model: 'deepseek-ai/deepseek-v4.1-flash',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content, ...extra } }],
  usage: { prompt_tokens: 11, completion_tokens: 7 },
});

function nvidia(fetchImpl, opts = {}) {
  return new OpenAICompatibleProvider({
    id: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1/', apiKey: FAKE_KEY, apiKeyEnv: 'NVIDIA_API_KEY',
    defaultModel: 'deepseek-ai/deepseek-v4.1-flash', defaultTemperature: 1.0, maxTokens: 4096,
    acceptsModel: (m) => String(m).includes('/') && !String(m).includes(':'),
    fetchImpl, ...opts,
  });
}

const noSleep = { maxRetries: 2, baseMs: 1, factor: 2, jitter: false, maxMs: 50, sleep: async () => {} };

// ---------- Retrait du raisonnement ----------
test('stripReasoning : retire <think>…</think>, balise orpheline et bloc non refermé', () => {
  assert.equal(stripReasoning('<think>GO ? {"verdict":"GO"}</think>\n{"verdict":"NO_GO"}'), '{"verdict":"NO_GO"}');
  assert.equal(stripReasoning('<THINKING>a</THINKING>x<think>b</think>y'), 'xy');
  assert.equal(stripReasoning('raisonnement sans ouverture</think> {"verdict":"GO"}'), '{"verdict":"GO"}');
  assert.equal(stripReasoning('{"verdict":"GO"} <think>tronqué'), '{"verdict":"GO"}');
  // Sans balise : texte rendu à l'identique (espaces compris).
  assert.equal(stripReasoning('  bonjour  '), '  bonjour  ');
  assert.equal(stripReasoning(null), '');
});

test('normalizeAgentAnalysis : le verdict ne vient jamais du bloc de raisonnement', () => {
  const raw = { output: '<think>Je pense GO. {"verdict":"GO","primary_reason":"brouillon"}</think>{"verdict":"NO_GO","primary_reason":"Risque juridique."}' };
  const a = normalizeAgentAnalysis(raw, { agent_id: 'legal_counsel' });
  assert.equal(a.verdict, 'NO_GO');
  assert.equal(a.primary_reason, 'Risque juridique.');
  const onlyThink = normalizeAgentAnalysis({ output: '<think>GO GO GO</think>' }, { agent_id: 'cfo' });
  assert.equal(onlyThink.verdict, 'CONDITIONAL_GO');
  assert.match(onlyThink.unverified_assumptions[0], /parsable formal verdict/);
});

// ---------- Provider OpenAI-compatible ----------
test('OpenAICompatibleProvider : requête chat/completions bien formée (NVIDIA)', async () => {
  const calls = [];
  const p = nvidia(async (url, init) => { calls.push({ url, init }); return okCompletion('{"verdict":"GO"}'); });
  const res = await p.complete({
    role: 'cfo', temperature: 0.3, model: 'llama3.2:q5_K_M',
    messages: [{ role: 'system', content: 'S' }, { role: 'tool', content: 'T' }, { role: 'assistant', content: 'A' }, { role: 'user', content: 42 }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(calls[0].init.body);
  // Le tag Ollama des agents de l'orchestrateur cède au modèle NVIDIA par défaut.
  assert.equal(body.model, 'deepseek-ai/deepseek-v4.1-flash');
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'S' }, { role: 'user', content: 'T' }, { role: 'assistant', content: 'A' }, { role: 'user', content: '42' },
  ]);
  assert.equal(body.temperature, 0.3);
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.stream, false);
  assert.equal(res.provider, 'nvidia');
  assert.equal(res.text, '{"verdict":"GO"}');
  assert.deepEqual(res.usage, { tokensIn: 11, tokensOut: 7, costUsd: 0 });
});

test('OpenAICompatibleProvider : modèle explicite, température imposée, extraBody', async () => {
  let body;
  const p = nvidia(async (_u, init) => { body = JSON.parse(init.body); return okCompletion('ok'); }, {
    temperature: 0.6, extraBody: { top_p: 0.95, model: 'ignored' },
  });
  await p.complete({ model: 'deepseek-ai/autre-modele', temperature: 0.1, messages: [{ role: 'user', content: 'x' }] });
  assert.equal(body.model, 'deepseek-ai/autre-modele');
  assert.equal(body.temperature, 0.6);
  assert.equal(body.top_p, 0.95);
});

test('OpenAICompatibleProvider : reasoning_content ignoré, <think> retiré du contenu', async () => {
  const p = nvidia(async () => okCompletion('<think>hésitation GO</think>\n{"verdict":"CONDITIONAL_GO"}', { reasoning_content: 'long raisonnement NO_GO' }));
  const res = await p.complete({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(res.text, '{"verdict":"CONDITIONAL_GO"}');
  assert.ok(!/raisonnement|hésitation/.test(JSON.stringify(res)));
});

test('OpenAICompatibleProvider : contenu vide + raisonnement seul → erreur non relançable (repli)', async () => {
  const p = nvidia(async () => okCompletion('', { reasoning_content: 'tout le budget' }));
  await assert.rejects(p.complete({ messages: [{ role: 'user', content: 'x' }] }), (e) => e.code === 'EMPTY_COMPLETION' && e.retryable === false);
});

test('OpenAICompatibleProvider : sans clé → NO_KEY, aucun appel réseau', async () => {
  let called = false;
  const p = new OpenAICompatibleProvider({ id: 'nvidia', baseUrl: 'https://x/v1', apiKey: '', apiKeyEnv: 'NVIDIA_API_KEY', fetchImpl: async () => { called = true; } });
  await assert.rejects(p.complete({ messages: [] }), (e) => e.code === 'NO_KEY' && /NVIDIA_API_KEY non configuree/.test(e.message));
  assert.equal(called, false);
  assert.equal(p.configured, false);
});

test('OpenAICompatibleProvider : 429 → RATE_LIMITED + Retry-After ; la clé ne fuit nulle part', async () => {
  const p = nvidia(async () => jsonResponse(429, { detail: 'Too Many Requests' }, { 'Retry-After': '2' }));
  let err;
  try { await p.complete({ messages: [{ role: 'user', content: 'x' }] }); } catch (e) { err = e; }
  assert.equal(err.status, 429);
  assert.equal(err.code, 'RATE_LIMITED');
  assert.equal(err.retryAfterMs, 2000);
  assert.equal(err.message, 'nvidia http 429');
  assert.ok(!JSON.stringify({ err, detail: err.detail, msg: err.message }).includes(FAKE_KEY));
  assert.ok(!JSON.stringify(p).includes(FAKE_KEY));
  const p401 = nvidia(async () => jsonResponse(401, { detail: 'Unauthorized' }));
  await assert.rejects(p401.complete({ messages: [] }), (e) => e.status === 401 && isRetryableError(e) === false);
});

// ---------- Relances 429 ----------
test('parseRetryAfter : secondes et date HTTP', () => {
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter('0.5'), 500);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6000);
  assert.equal(parseRetryAfter(''), null);
  assert.equal(parseRetryAfter('n/a'), null);
});

test('withResilience : 429 relancé en respectant Retry-After, sans ouvrir le circuit', async () => {
  const delays = [];
  let n = 0;
  const breaker = new CircuitBreaker({ failureThreshold: 1 });
  const res = await withResilience(async () => {
    n += 1;
    if (n < 3) { const e = new Error('nvidia http 429'); e.status = 429; e.retryAfterMs = 700; throw e; }
    return 'ok';
  }, breaker, { ...noSleep, sleep: async (ms) => { delays.push(ms); } });
  assert.equal(res, 'ok');
  assert.equal(n, 3);
  assert.deepEqual(delays, [700, 700]);
  assert.equal(breaker.state, BreakerState.CLOSED);
});

test('withResilience : backoff exponentiel + jitter borné sans Retry-After', async () => {
  const delays = [];
  const e429 = () => { const e = new Error('429'); e.status = 429; return e; };
  await assert.rejects(withResilience(async () => { throw e429(); }, null, {
    maxRetries: 3, baseMs: 100, factor: 2, jitter: true, maxMs: 10_000, sleep: async (ms) => { delays.push(ms); },
  }));
  assert.equal(delays.length, 3);
  [100, 200, 400].forEach((raw, i) => assert.ok(delays[i] >= raw / 2 && delays[i] <= raw, `délai ${i}: ${delays[i]}`));
});

test('withResilience : 429 persistant compté une seule fois ; erreurs non relançables immédiates', async () => {
  const breaker = new CircuitBreaker({ failureThreshold: 2 });
  let n = 0;
  await assert.rejects(withResilience(async () => { n += 1; const e = new Error('429'); e.status = 429; throw e; }, breaker, noSleep));
  assert.equal(n, 3, '3 essais (maxRetries=2)');
  assert.equal(breaker.state, BreakerState.CLOSED, 'une seule défaillance comptée');

  let k = 0;
  await assert.rejects(withResilience(async () => { k += 1; const e = new Error('k'); e.code = 'NO_KEY'; throw e; }, null, noSleep));
  assert.equal(k, 1);
  let u = 0;
  await assert.rejects(withResilience(async () => { u += 1; const e = new Error('401'); e.status = 401; throw e; }, null, noSleep));
  assert.equal(u, 1);
  // Retry-After au-delà du plafond : on n'attend pas, repli immédiat.
  let r = 0;
  await assert.rejects(withResilience(async () => { r += 1; const e = new Error('429'); e.status = 429; e.retryAfterMs = 600_000; throw e; }, null, { ...noSleep, maxRetryAfterMs: 20_000 }));
  assert.equal(r, 1);
});

test('KayrosLLM + NVIDIA : deux 429 puis succès, sans repli', async () => {
  let n = 0;
  const p = nvidia(async () => (++n < 3
    ? jsonResponse(429, { detail: 'rate' }, { 'retry-after': '0' })
    : okCompletion('{"verdict":"GO"}')));
  const llm = new KayrosLLM({ nvidia: p, mock: new MockProvider() }, new RoutingPolicy({ defaultProvider: 'nvidia', fallback: ['mistral', 'mock'] }), { retry: noSleep });
  const res = await llm.complete({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(n, 3);
  assert.equal(res.provider, 'nvidia');
  assert.equal(res.degraded, undefined);
});

test('KayrosLLM : 429 persistant → repli Mistral signalé, puis mock signalé', async () => {
  const always429 = () => jsonResponse(429, {}, { 'retry-after': '0' });
  const mistralCalls = [];
  const mistral = new OpenAICompatibleProvider({
    id: 'mistral', baseUrl: 'https://api.mistral.ai/v1', apiKey: FAKE_KEY, defaultModel: 'mistral-small-latest',
    fetchImpl: async (url, init) => { mistralCalls.push(JSON.parse(init.body).model); return okCompletion('{"verdict":"GO"}'); },
  });
  const llm = new KayrosLLM(
    { nvidia: nvidia(always429), mistral, mock: new MockProvider() },
    new RoutingPolicy({ defaultProvider: 'nvidia', fallback: ['mistral', 'mock'] }),
    { retry: noSleep },
  );
  const res = await llm.complete({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(res.provider, 'mistral');
  assert.deepEqual(mistralCalls, ['mistral-small-latest'], 'le repli prend son propre modèle');
  assert.equal(res.degraded.reason, 'provider_fallback');
  assert.equal(res.degraded.from, 'nvidia');
  assert.equal(res.degraded.to, 'mistral');
  assert.match(res.degraded.error, /429/);

  const llm2 = new KayrosLLM(
    { nvidia: nvidia(always429), mistral: new OpenAICompatibleProvider({ id: 'mistral', baseUrl: 'https://x/v1', apiKey: '' }), mock: new MockProvider() },
    new RoutingPolicy({ defaultProvider: 'nvidia', fallback: ['mistral', 'mock'] }),
    { retry: noSleep },
  );
  const res2 = await llm2.complete({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(res2.provider, 'mock');
  assert.equal(res2.degraded.to, 'mock');
  assert.equal(res2.degraded.chain.length, 2);
});

// ---------- Concurrence ----------
test('mapWithConcurrency : au plus N en vol, ordre conservé', async () => {
  let inFlight = 0; let peak = 0;
  const out = await mapWithConcurrency([5, 1, 4, 2, 3], 2, async (v) => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, v));
    inFlight -= 1;
    return v * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapWithConcurrency([], 2, async () => 1), []);
});

for (const [limit, expected] of [[1, 1], [2, 2], [0, 3]]) {
  test(`SwarmService : maxConcurrency=${limit} → ${expected} agent(s) simultané(s) au plus`, async () => {
    let inFlight = 0; let peak = 0;
    const llm = {
      async complete() {
        inFlight += 1; peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { text: '{"verdict":"GO","primary_reason":"ok"}', provider: 'nvidia' };
      },
    };
    const swarm = new SwarmService({ llm, maxConcurrency: limit, logger: { warn() {} } });
    const run = await swarm.run({ swarm_name: 'Concurrence', active_agents: ['cfo', 'cto', 'legal_counsel'] }, { question: 'Lancer ?' });
    assert.equal(peak, expected);
    assert.equal(run.analyses.length, 3);
    assert.deepEqual(run.analyses.map((a) => a.agent_id), ['cfo', 'cto', 'legal_counsel']);
    assert.equal(run.consensus.verdict, 'GO');
  });
}

test('SwarmService : concurrence par défaut = 2', () => {
  assert.equal(new SwarmService().maxConcurrency, 2);
});
