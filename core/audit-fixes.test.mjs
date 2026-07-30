// Audit fixes 1–7 — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SynthesizerAgent } from './agents/synthesizer-agent.mjs';
import { resolveModelTag, normalizeRole, recommendQuant } from './quant-guidance.mjs';
import { LayeredMemory } from './memory.mjs';
import { createEngine, collect } from './index.mjs';

test('1. Synthesizer no-go not classified as go', () => {
  const s = new SynthesizerAgent();
  assert.equal(s._extractDecision('Recommended decision: No-Go due to risks').decision, 'no-go');
  assert.equal(s._extractDecision('We recommend Go ahead').decision, 'go');
  assert.equal(s._extractDecision('Please revise the plan').decision, 'revise');
});

test('3. normalizeRole maps DevilsAdvocate / Bisociateur', () => {
  assert.equal(normalizeRole('DevilsAdvocate'), "Devil's Advocate");
  assert.equal(normalizeRole('Bisociateur'), 'Bisociator');
  assert.equal(recommendQuant({ role: 'DevilsAdvocate' }).tier, 'high');
});

test('4. resolveModelTag does not invent latest-q4', () => {
  assert.equal(resolveModelTag('llama3.2:latest', 'q4_K_M'), 'llama3.2:latest');
  assert.equal(resolveModelTag('llama3.2', 'q4_K_M'), 'llama3.2:q4_K_M');
  const tags = ['llama3.1:8b-instruct-q4_K_M', 'llama3.2:latest'];
  assert.equal(resolveModelTag('llama3.1:8b-instruct', 'q4_K_M', tags), 'llama3.1:8b-instruct-q4_K_M');
  assert.equal(resolveModelTag('llama3.2:latest', 'q4_K_M', tags), 'llama3.2:latest');
});

test('7. L3 recall requires scope', async () => {
  const mem = new LayeredMemory();
  mem.updateCore({ scope: 'tenant', scopeId: 't1', kind: 'norm', title: 'N1', content: 'secret tenant' });
  mem.updateCore({ scope: 'tenant', scopeId: 't2', kind: 'norm', title: 'N2', content: 'other tenant' });
  const open = await mem.recall('x', { layers: ['L3'], k: 5 });
  assert.equal(open.l3.length, 0);
  const scoped = await mem.recall('x', { layers: ['L3'], scope: 'tenant', scopeId: 't1', k: 5 });
  assert.equal(scoped.l3.length, 1);
  assert.equal(scoped.l3[0].title, 'N1');
});

test('7. offload skips short L0 items', async () => {
  const mem = new LayeredMemory();
  mem.rememberL0({ ideaId: 'i', step: 's1', kind: 'agent_scratch', content: 'short note' });
  mem.rememberL0({ ideaId: 'i', step: 's1', kind: 'scrape', content: 'x'.repeat(800) });
  const refs = await mem.offload('i');
  assert.equal(refs.length, 1);
  const snap = mem.snapshot('i');
  const short = snap.l0.find((x) => x.content === 'short note');
  assert.ok(short && !short.expiresAt);
});

test('2+5. autoDistill uses engine llm; degraded can appear on mock path', async () => {
  const eng = createEngine({ quant: 'q4_K_M' });
  for (let i = 0; i < 3; i++) {
    await eng.layered.addAtomicFact({
      ideaId: 'a1', content: `Observation audit ${i} marché`, type: 'observation', confidence: 0.8,
    });
  }
  const plan = await eng.orchestrator.plan('Audit test', { ideaId: 'a1', llmPlan: false });
  const events = await collect(eng.orchestrator.run(plan, {
    governance: 'auto',
    autoDistill: true,
    distillMinFacts: 3,
  }));
  assert.ok(events.find((e) => e.type === 'distill'));
  assert.equal(events.at(-1).type, 'final');
});
