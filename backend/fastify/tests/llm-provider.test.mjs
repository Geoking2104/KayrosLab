// Sélection du provider LLM (NVIDIA prioritaire, Mistral en repli), /health,
// requête NVIDIA bien formée et concurrence du swarm. Aucun appel réseau :
// fetch global simulé, clé factice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLlmConfig, NVIDIA_DEFAULT_MODEL, NVIDIA_DEFAULT_BASE_URL } from '../lib/llm-config.mjs';
import { buildTestApp } from './test-helpers.mjs';

const FAKE_KEY = 'fake-nvidia-key-for-tests';
const LLM_ENV = ['NVIDIA_API_KEY', 'NVIDIA_MODEL', 'NVIDIA_BASE_URL', 'LLM_PROVIDER', 'LLM_FALLBACK', 'LLM_MAX_CONCURRENCY', 'LLM_MAX_RETRIES', 'MISTRAL_API_KEY'];

function snapshotEnv(t) {
  const saved = Object.fromEntries(LLM_ENV.map((k) => [k, process.env[k]]));
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

test('resolveLlmConfig : ordre de priorité LLM_PROVIDER > NVIDIA > Mistral > Anthropic > mock', () => {
  assert.equal(resolveLlmConfig({}).provider, 'mock');
  assert.deepEqual(resolveLlmConfig({}).fallback, []);
  assert.equal(resolveLlmConfig({ ANTHROPIC_API_KEY: 'x' }).provider, 'anthropic');

  const mistralOnly = resolveLlmConfig({ MISTRAL_API_KEY: 'x' });
  assert.equal(mistralOnly.provider, 'mistral');
  assert.deepEqual(mistralOnly.fallback, ['mock']);

  const both = resolveLlmConfig({ NVIDIA_API_KEY: 'x', MISTRAL_API_KEY: 'y', ANTHROPIC_API_KEY: 'z' });
  assert.equal(both.provider, 'nvidia');
  assert.equal(both.forced, false);
  assert.equal(both.live, true);
  assert.equal(both.model, NVIDIA_DEFAULT_MODEL);
  assert.deepEqual(both.fallback, ['mistral', 'mock'], 'Mistral reste en repli');

  const forcedMistral = resolveLlmConfig({ NVIDIA_API_KEY: 'x', MISTRAL_API_KEY: 'y', LLM_PROVIDER: 'Mistral' });
  assert.equal(forcedMistral.provider, 'mistral');
  assert.equal(forcedMistral.forced, true);
  assert.deepEqual(forcedMistral.fallback, ['mock']);

  assert.equal(resolveLlmConfig({ NVIDIA_API_KEY: 'x', LLM_PROVIDER: 'auto' }).provider, 'nvidia');
});

test('resolveLlmConfig : provider forcé sans clé ou inconnu → avertissement, jamais silencieux', () => {
  const noKey = resolveLlmConfig({ LLM_PROVIDER: 'nvidia', MISTRAL_API_KEY: 'y' });
  assert.equal(noKey.provider, 'nvidia');
  assert.equal(noKey.live, false);
  assert.deepEqual(noKey.fallback, ['mistral', 'mock']);
  assert.match(noKey.warnings[0], /NVIDIA_API_KEY est vide/);

  const unknown = resolveLlmConfig({ LLM_PROVIDER: 'openai', MISTRAL_API_KEY: 'y' });
  assert.equal(unknown.provider, 'mistral');
  assert.match(unknown.warnings[0], /inconnu/);
});

test('resolveLlmConfig : modèle, URL, LLM_FALLBACK, concurrence et relances', () => {
  const d = resolveLlmConfig({ NVIDIA_API_KEY: 'x' });
  assert.equal(d.nvidia.baseUrl, NVIDIA_DEFAULT_BASE_URL);
  assert.equal(d.nvidia.model, 'deepseek-ai/deepseek-v4.1-flash');
  assert.equal(d.nvidia.temperature, null);
  assert.equal(d.nvidia.maxTokens, 4096);
  // Un modèle lent (Kimi K3 ≈ 75 s, pointes ~120 s) doit passer sous le délai par défaut.
  assert.equal(d.nvidia.timeoutMs, 180000);
  assert.ok(d.nvidia.timeoutMs > 120000);
  assert.equal(resolveLlmConfig({ NVIDIA_TIMEOUT_MS: '240000' }).nvidia.timeoutMs, 240000);
  assert.equal(resolveLlmConfig({ NVIDIA_MODEL: 'moonshotai/kimi-k3', NVIDIA_API_KEY: 'x' }).model, 'moonshotai/kimi-k3');
  assert.equal(d.maxConcurrency, 2);
  assert.equal(d.retry.maxRetries, 2);

  const c = resolveLlmConfig({
    NVIDIA_API_KEY: 'x', NVIDIA_MODEL: 'deepseek-ai/autre', NVIDIA_BASE_URL: 'https://nim.example/v1/',
    NVIDIA_TEMPERATURE: '0.6', NVIDIA_EXTRA_BODY: '{"top_p":0.95}', LLM_FALLBACK: 'anthropic, mistral, bogus',
    LLM_MAX_CONCURRENCY: '1', LLM_MAX_RETRIES: '4', MISTRAL_API_KEY: 'y',
  });
  assert.equal(c.model, 'deepseek-ai/autre');
  assert.equal(c.nvidia.baseUrl, 'https://nim.example/v1');
  assert.equal(c.nvidia.temperature, 0.6);
  assert.deepEqual(c.nvidia.extraBody, { top_p: 0.95 });
  assert.deepEqual(c.fallback, ['anthropic', 'mistral', 'mock']);
  assert.ok(c.warnings.some((w) => /bogus/.test(w)));
  assert.equal(c.maxConcurrency, 1);
  assert.equal(c.retry.maxRetries, 4);
  assert.equal(resolveLlmConfig({ LLM_MAX_CONCURRENCY: 'abc' }).maxConcurrency, 2);
  assert.ok(resolveLlmConfig({ NVIDIA_EXTRA_BODY: '[1]' }).warnings.some((w) => /NVIDIA_EXTRA_BODY/.test(w)));
  // Aucune clé dans la configuration résolue : seulement des booléens.
  assert.ok(!JSON.stringify(resolveLlmConfig({ NVIDIA_API_KEY: FAKE_KEY })).includes(FAKE_KEY));
});

test('serveur : NVIDIA_API_KEY présente → provider nvidia, /health sans clé, swarm borné', async (t) => {
  snapshotEnv(t);
  const { app, ctx } = await buildTestApp({ NVIDIA_API_KEY: FAKE_KEY, MISTRAL_API_KEY: '', LLM_PROVIDER: '', LLM_MAX_CONCURRENCY: '1' });
  t.after(() => app.close());
  assert.ok(ctx.providers.nvidia, 'provider nvidia enregistré');
  assert.ok(ctx.providers.mistral, 'Mistral reste disponible');
  assert.equal(ctx.llm.policy.defaultProvider, 'nvidia');
  assert.deepEqual(ctx.llm.policy.fallback, ['mock']);
  assert.equal(ctx.engine.swarm.maxConcurrency, 1);

  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.llm.provider, 'nvidia');
  assert.equal(body.llm.live, true);
  assert.equal(body.llm.model, NVIDIA_DEFAULT_MODEL);
  assert.equal(body.llm.baseUrl, NVIDIA_DEFAULT_BASE_URL);
  assert.equal(body.llm.maxConcurrency, 1);
  assert.equal(body.nvidiaConfigured, true);
  assert.ok(body.providers.includes('nvidia'));
  assert.ok(!res.body.includes(FAKE_KEY), 'la clé ne sort jamais dans /health');
});

test('serveur : appel NVIDIA bien formé (fetch simulé), raisonnement retiré', async (t) => {
  snapshotEnv(t);
  const { app, ctx } = await buildTestApp({ NVIDIA_API_KEY: FAKE_KEY, MISTRAL_API_KEY: '', LLM_PROVIDER: '' });
  t.after(() => app.close());
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ choices: [{ message: { content: '<think>GO ?</think>{"verdict":"NO_GO","primary_reason":"r"}', reasoning_content: 'x' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4 } }),
    };
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const res = await ctx.llm.complete({ role: 'cfo', temperature: 0.3, messages: [{ role: 'user', content: 'Lancer ?' }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_KEY}`);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.model, NVIDIA_DEFAULT_MODEL);
  assert.equal(sent.temperature, 0.3);
  assert.deepEqual(sent.messages, [{ role: 'user', content: 'Lancer ?' }]);
  assert.equal(res.provider, 'nvidia');
  assert.equal(res.text, '{"verdict":"NO_GO","primary_reason":"r"}');
  assert.equal(res.degraded, undefined);
});

test('serveur : Mistral seul → comportement inchangé (provider mistral, repli mock)', async (t) => {
  snapshotEnv(t);
  const { app, ctx } = await buildTestApp({ NVIDIA_API_KEY: '', MISTRAL_API_KEY: 'fake-mistral-key', LLM_PROVIDER: '' });
  t.after(() => app.close());
  assert.equal(ctx.llm.policy.defaultProvider, 'mistral');
  assert.deepEqual(ctx.llm.policy.fallback, ['mock']);
  const body = (await app.inject({ method: 'GET', url: '/health' })).json();
  assert.equal(body.llm.provider, 'mistral');
  assert.equal(body.llm.model, 'mistral-small-latest');
  assert.equal(body.nvidiaConfigured, false);
});
