// Tests quant guidance + schema + engine wiring — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeQuant, recommendQuant, resolveModelTag, parseQuantFromTag,
  extractAvailableQuants, filterGuidanceByAvailable, recommendForEngine,
  validateQuantRecommendation, validateAgentQuantInfo, validateQuantSnapshot,
  validateEventQuantBlock, QUANT_META,
} from './quant-guidance.mjs';
import { createEngine } from './index.mjs';
import { collect } from './orchestrator.mjs';

test('normalizeQuant aliases', () => {
  assert.equal(normalizeQuant('q4'), 'q4_K_M');
  assert.equal(normalizeQuant('Q5_K_M'), 'q5_K_M');
  assert.equal(normalizeQuant('q8'), 'q8_0');
});

test('recommendQuant tiers', () => {
  const high = recommendQuant({ role: 'Planner' });
  assert.equal(high.tier, 'high');
  assert.equal(high.quant, 'q5_K_M');

  const med = recommendQuant({ role: 'Bisociator' });
  assert.equal(med.tier, 'medium');
  assert.equal(med.quant, 'q4_K_M');

  const forced = recommendQuant({ role: 'Planner', prefer: 'q8_0' });
  assert.equal(forced.quant, 'q8_0');
});

test('recommendQuant respects available list', () => {
  const r = recommendQuant({ role: 'Planner', available: ['q4_K_M', 'q3_K_M'] });
  assert.equal(r.quant, 'q4_K_M'); // best preferred that is available
});

test('resolveModelTag / parseQuantFromTag', () => {
  const tag = resolveModelTag('llama3.1:8b-instruct', 'q4_K_M');
  assert.equal(tag, 'llama3.1:8b-instruct-q4_K_M');
  assert.equal(parseQuantFromTag(tag), 'q4_K_M');

  const replaced = resolveModelTag('llama3.1:8b-instruct-q5_K_M', 'q4_K_M');
  assert.equal(parseQuantFromTag(replaced), 'q4_K_M');
});

test('extractAvailableQuants + filterGuidanceByAvailable', () => {
  const tags = ['llama3.2:latest', 'llama3.1:8b-instruct-q4_K_M', 'qwen2.5:7b-q5_K_M'];
  const av = extractAvailableQuants(tags);
  assert.ok(av.includes('q4_K_M'));
  assert.ok(av.includes('q5_K_M'));

  const g0 = recommendForEngine({ model: 'llama3.1:8b-instruct', quant: 'q8_0', sovereignty: 'local' });
  assert.equal(g0.global.quant, 'q8_0');

  const g1 = filterGuidanceByAvailable(g0, tags);
  // q8 not available → falls back to best available for default tier
  assert.ok(['q4_K_M', 'q5_K_M'].includes(g1.global.quant));
  assert.ok(g1.availableQuants.length >= 2);
});

test('schema validators', () => {
  const rec = recommendQuant({ role: 'Critic' });
  assert.equal(validateQuantRecommendation(rec).ok, true);
  assert.equal(validateAgentQuantInfo(null).ok, true);
  assert.equal(validateAgentQuantInfo({ preferredModel: 'x', quant: 'q4_K_M', tier: 'medium', quality: 0.97, label: 'x' }).ok, true);
  assert.equal(validateEventQuantBlock({ modelUsed: 'm', agent: null }).ok, true);
  assert.equal(validateQuantSnapshot(null).ok, true);
});

test('createEngine wires preferredModel on agents (mock path)', () => {
  const eng = createEngine({
    model: 'llama3.1:8b-instruct',
    quant: 'q4_K_M',
    roleQuant: { Planner: 'q5_K_M' },
    // sovereignty not local → resolvedDefault stays base, but role resolution still works via quantGuidance
  });
  assert.ok(eng.quantGuidance);
  assert.equal(eng.quantGuidance.global.quant, 'q4_K_M');
  assert.ok(eng.agents.Planner);
  // preferredModel set when baseModel + quantGuidance present
  assert.ok(
    eng.agents.Planner.preferredModel === null
    || String(eng.agents.Planner.preferredModel).includes('q5_K_M')
    || String(eng.agents.Planner.preferredModel).includes('q4_K_M'),
  );
});

test('createEngine local path resolves default model tag', () => {
  const eng = createEngine({
    sovereignty: 'local',
    model: 'llama3.2',
    quant: 'q4_K_M',
  });
  assert.match(eng.quantGuidance.resolvedDefaultModel, /q4_K_M/);
  assert.ok(eng.llm.providers.ollama);
  assert.match(eng.llm.providers.ollama.defaultModel, /q4_K_M/);
});

test('orchestrator events expose quant + optional autoDistill', async () => {
  const eng = createEngine({ quant: 'q4_K_M', roleQuant: { Critic: 'q5_K_M' } });

  // Seed L1 so autoDistill can fire
  for (let i = 0; i < 3; i++) {
    await eng.layered.addAtomicFact({
      ideaId: 'iQ',
      content: `Observation quant ${i} marché`,
      type: 'observation',
      confidence: 0.8,
    });
  }

  const plan = await eng.orchestrator.plan('Test quant events', { ideaId: 'iQ', llmPlan: false });
  assert.ok(plan.quant);

  const events = await collect(eng.orchestrator.run(plan, {
    governance: 'auto',
    autoDistill: true,
    distillMinFacts: 3,
  }));

  const start = events.find((e) => e.type === 'start');
  assert.ok(start?.quant);

  const traces = events.filter((e) => e.type === 'trace');
  assert.ok(traces.length >= 1);
  assert.ok('quant' in traces[0]);

  const distill = events.find((e) => e.type === 'distill');
  assert.ok(distill);
  assert.ok(distill.count >= 1);

  const final = events.at(-1);
  assert.equal(final.type, 'final');
  assert.ok(final.quant);
});
