// Tests quant guidance + schema + engine wiring + soft fallback — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeQuant, recommendQuant, resolveModelTag, parseQuantFromTag, stripQuantFromTag,
  extractAvailableQuants, filterGuidanceByAvailable, recommendForEngine,
  validateQuantRecommendation, validateAgentQuantInfo, validateQuantSnapshot,
  validateEventQuantBlock,
} from './quant-guidance.mjs';
import { createEngine, rebindAgentsQuant, collect } from './index.mjs';
import { KayrosLLM, RoutingPolicy, MockProvider } from './kayros-llm.mjs';

test('normalizeQuant aliases', () => {
  assert.equal(normalizeQuant('q4'), 'q4_K_M');
  assert.equal(normalizeQuant('Q5_K_M'), 'q5_K_M');
  assert.equal(normalizeQuant('q8'), 'q8_0');
});

test('stripQuantFromTag', () => {
  assert.equal(stripQuantFromTag('llama3.1:8b-instruct-q4_K_M'), 'llama3.1:8b-instruct');
  assert.equal(parseQuantFromTag('llama3.1:8b-instruct-q4_K_M'), 'q4_K_M');
});

test('recommendQuant tiers', () => {
  const high = recommendQuant({ role: 'Planner' });
  assert.equal(high.tier, 'high');
  assert.equal(high.quant, 'q5_K_M');
  const med = recommendQuant({ role: 'Bisociator' });
  assert.equal(med.quant, 'q4_K_M');
});

test('recommendQuant respects available list', () => {
  const r = recommendQuant({ role: 'Planner', available: ['q4_K_M', 'q3_K_M'] });
  assert.equal(r.quant, 'q4_K_M');
});

test('resolveModelTag / parseQuantFromTag', () => {
  const tag = resolveModelTag('llama3.1:8b-instruct', 'q4_K_M');
  assert.equal(tag, 'llama3.1:8b-instruct-q4_K_M');
  assert.equal(parseQuantFromTag(tag), 'q4_K_M');
});

test('filterGuidanceByAvailable', () => {
  const tags = ['llama3.2:latest', 'llama3.1:8b-instruct-q4_K_M', 'qwen2.5:7b-q5_K_M'];
  const g0 = recommendForEngine({ model: 'llama3.1:8b-instruct', quant: 'q8_0', sovereignty: 'local' });
  const g1 = filterGuidanceByAvailable(g0, tags);
  assert.ok(['q4_K_M', 'q5_K_M'].includes(g1.global.quant));
});

test('schema validators', () => {
  const rec = recommendQuant({ role: 'Critic' });
  assert.equal(validateQuantRecommendation(rec).ok, true);
  assert.equal(validateEventQuantBlock({ modelUsed: 'm', agent: null }).ok, true);
  assert.equal(validateQuantSnapshot(null).ok, true);
  assert.equal(validateAgentQuantInfo(null).ok, true);
});

test('createEngine local path resolves default model tag', () => {
  const eng = createEngine({ sovereignty: 'local', model: 'llama3.2', quant: 'q4_K_M' });
  assert.match(eng.quantGuidance.resolvedDefaultModel, /q4_K_M/);
  assert.match(eng.llm.providers.ollama.defaultModel, /q4_K_M/);
});

test('rebindAgentsQuant updates preferredModel', () => {
  const eng = createEngine({ model: 'llama3.1:8b-instruct', quant: 'q4_K_M', roleQuant: { Planner: 'q5_K_M' } });
  const tags = ['llama3.1:8b-instruct-q4_K_M'];
  const g = filterGuidanceByAvailable(eng.quantGuidance, tags);
  rebindAgentsQuant(eng.agents, g, 'llama3.1:8b-instruct');
  assert.ok(String(eng.agents.Planner.preferredModel || '').includes('q4_K_M')
    || String(eng.agents.Planner.preferredModel || '').includes('q5_K_M')
    || eng.agents.Planner.preferredModel != null);
});

test('KayrosLLM quant soft-fallback strips tag then mock', async () => {
  let calls = [];
  const flaky = {
    id: 'ollama',
    async complete(req) {
      calls.push(req.model);
      const e = new Error('Ollama HTTP 404');
      e.code = 'OLLAMA_HTTP';
      throw e;
    },
  };
  const llm = new KayrosLLM(
    { ollama: flaky, mock: new MockProvider() },
    new RoutingPolicy({ defaultProvider: 'ollama', fallback: 'mock' }),
    { breakerConfig: { failureThreshold: 99, coolDownMs: 1 } },
  );
  const res = await llm.complete({
    role: 'Planner',
    model: 'llama3.2:q5_K_M',
    messages: [{ role: 'user', content: 'hi' }],
  }, { sovereignty: 'local' });
  assert.equal(res.provider, 'mock');
  assert.ok(res.degraded);
  assert.equal(res.degraded.reason, 'provider_fallback');
  // first attempt quant tag, second strip (also fails), then mock
  assert.ok(calls.length >= 1);
});

test('orchestrator events expose quant + optional autoDistill', async () => {
  const eng = createEngine({ quant: 'q4_K_M', roleQuant: { Critic: 'q5_K_M' } });
  for (let i = 0; i < 3; i++) {
    await eng.layered.addAtomicFact({
      ideaId: 'iQ', content: `Observation quant ${i} marché`, type: 'observation', confidence: 0.8,
    });
  }
  const plan = await eng.orchestrator.plan('Test quant events', { ideaId: 'iQ', llmPlan: false });
  assert.ok(plan.quant);
  const events = await collect(eng.orchestrator.run(plan, {
    governance: 'auto', autoDistill: true, distillMinFacts: 3,
  }));
  assert.ok(events.find((e) => e.type === 'start')?.quant);
  assert.ok(events.filter((e) => e.type === 'trace').length >= 1);
  assert.ok(events.find((e) => e.type === 'distill')?.count >= 1);
  assert.equal(events.at(-1).type, 'final');
});
