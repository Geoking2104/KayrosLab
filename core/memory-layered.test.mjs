// Tests de la mémoire stratifiée L0–L3 — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createL0, createL1, createL2, createL3,
  LayeredMemory, FileOffloadBackend, FileLayeredStore, InMemoryVectorStore,
  extractFirstObject,
} from './memory.mjs';
import { MockEmbeddings, MemoryService } from './embeddings.mjs';
import { createEngine } from './index.mjs';
import { collect } from './orchestrator.mjs';

// ---------- Factories ----------
test('createL0 : champs obligatoires + defaults', () => {
  const item = createL0({
    ideaId: 'i1', step: 'construire', kind: 'tool_output', content: 'résultat long…',
  });
  assert.ok(item.id);
  assert.equal(item.ideaId, 'i1');
  assert.throws(() => createL0({ step: 'x', kind: 'y', content: 'z' }));
});

test('createL1 / L2 / L3', () => {
  const f = createL1({ content: 'Le concurrent X a 1200 stars', type: 'competitor', confidence: 1.5 });
  assert.equal(f.confidence, 1);
  const s = createL2({ title: 'Gap DePIN', content: '…', patternType: 'competitive_gap', ideaIds: ['i1'] });
  assert.equal(s.reviewStatus, 'draft');
  const c = createL3({ scope: 'user', scopeId: 'geoff', kind: 'preference', title: 'Style', content: 'Preuves quanti' });
  assert.equal(c.version, 1);
});

// ---------- Richer Mermaid canvas ----------
test('getWorkingCanvas : subgraphs par step + classes active/offloaded', async () => {
  const lm = new LayeredMemory();
  lm.rememberL0({ ideaId: 'i1', step: 'ecouter', kind: 'scrape', agentRole: 'Planner', content: 'A'.repeat(100) });
  lm.rememberL0({ ideaId: 'i1', step: 'ecouter', kind: 'agent_scratch', agentRole: 'Critic', content: 'B' });
  lm.rememberL0({ ideaId: 'i1', step: 'cartographier', kind: 'tool_output', content: 'C' });
  await lm.offload('i1', 'ecouter');

  const canvas = lm.getWorkingCanvas('i1', { includeOffloaded: true });
  assert.match(canvas.mermaid, /subgraph/);
  assert.match(canvas.mermaid, /ecouter/);
  assert.match(canvas.mermaid, /cartographier/);
  assert.match(canvas.mermaid, /classDef active/);
  assert.match(canvas.mermaid, /classDef offloaded/);
  assert.equal(canvas.stats.steps, 2);
  assert.ok(canvas.stats.offloaded >= 1);
  assert.ok(canvas.stats.active >= 1);
  assert.ok(canvas.nodeIds.length >= 3);
});

// ---------- Auto L2 distillation (heuristic) ----------
test('autoDistillL2 heuristic : regroupe par type et crée des scénarios draft', async () => {
  const store = new InMemoryVectorStore();
  const mem = new MemoryService({ embeddings: new MockEmbeddings({ dim: 16 }), store });
  const lm = new LayeredMemory({ memoryService: mem, store });

  for (let i = 0; i < 4; i++) {
    await lm.addAtomicFact({
      ideaId: 'iD',
      content: `Fait concurrent n°${i} : étoile ${100 + i}`,
      type: 'competitor',
      confidence: 0.7 + i * 0.05,
    });
  }
  await lm.addAtomicFact({ ideaId: 'iD', content: 'risque unique', type: 'risk' });

  const created = await lm.autoDistillL2('iD', { minFacts: 3 });
  assert.equal(created.length, 1);
  assert.equal(created[0].patternType, 'competitive_gap');
  assert.equal(created[0].reviewStatus, 'draft');
  assert.ok(created[0].relatedL1Ids.length >= 3);
  assert.ok(created[0].tags.includes('auto-distill'));

  const again = await lm.autoDistillL2('iD', { minFacts: 3 });
  assert.equal(again.length, 0);
});

// ---------- LLM-backed distillation ----------
test('extractFirstObject : parse robuste', () => {
  assert.equal(extractFirstObject('rien'), null);
  const o = extractFirstObject('bla {"title":"T","content":"C","summary":"S","patternType":"insight"} fin');
  assert.equal(o.title, 'T');
  assert.equal(o.content, 'C');
});

test('autoDistillL2 avec distillFn (callback pur)', async () => {
  const lm = new LayeredMemory();
  for (let i = 0; i < 3; i++) {
    await lm.addAtomicFact({
      ideaId: 'iFn',
      content: `Observation ${i} sur le marché énergie`,
      type: 'observation',
      confidence: 0.8,
    });
  }

  const created = await lm.autoDistillL2('iFn', {
    minFacts: 3,
    distillFn: async ({ type, group, ideaId }) => ({
      title: `Insight marché (${ideaId})`,
      summary: `Synthèse LLM-like de ${group.length} observations`,
      content: `## Analyse\n\n${group.map((f) => `- ${f.content}`).join('\n')}`,
      patternType: 'insight',
    }),
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].title, 'Insight marché (iFn)');
  assert.ok(created[0].tags.includes('llm-distill'));
  assert.match(created[0].content, /Observation 0/);
});

test('autoDistillL2 avec llm.complete (mock) + fallback si JSON invalide', async () => {
  const lm = new LayeredMemory();
  for (let i = 0; i < 3; i++) {
    await lm.addAtomicFact({
      ideaId: 'iLLM',
      content: `Fait concurrent ${i}`,
      type: 'competitor',
      confidence: 0.75,
    });
  }

  // Cas 1 : JSON valide
  const llmOk = {
    complete: async () => ({
      text: 'Voici : {"title":"Gap concurrentiel énergie","summary":"3 signaux faibles consolidés","content":"## Analyse\\n- signal A","patternType":"competitive_gap"}',
    }),
  };
  const created = await lm.autoDistillL2('iLLM', { minFacts: 3, llm: llmOk });
  assert.equal(created.length, 1);
  assert.equal(created[0].title, 'Gap concurrentiel énergie');
  assert.equal(created[0].patternType, 'competitive_gap');
  assert.ok(created[0].tags.includes('llm-distill'));

  // Cas 2 : JSON invalide → fallback heuristique (nouveau force)
  const llmKo = { complete: async () => ({ text: 'désolé je ne peux pas' }) };
  const fallback = await lm.autoDistillL2('iLLM', { minFacts: 3, force: true, llm: llmKo });
  assert.equal(fallback.length, 1);
  assert.match(fallback[0].title, /Synthèse competitor/);
  assert.ok(fallback[0].tags.includes('llm-distill')); // le flag reste car llm était fourni
});

// ---------- Persistence L1/L2/L3 ----------
test('FileLayeredStore + save/load round-trip', async () => {
  const disque = new Map();
  const fakeFs = {
    async readFile(p) {
      if (!disque.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return disque.get(p);
    },
    async writeFile(p, data) { disque.set(p, data); },
    async rename(a, b) { disque.set(b, disque.get(a)); disque.delete(a); },
  };

  const store = new FileLayeredStore({ path: '/tmp/mem.json', fs: fakeFs });
  const lm1 = new LayeredMemory({ persistentStore: store });

  await lm1.addAtomicFact({ ideaId: 'iP', content: 'fait persisté', type: 'observation' });
  await lm1.distillScenario({
    title: 'Scénario persisté', content: 'détail', summary: 'résumé', ideaIds: ['iP'],
  });
  lm1.updateCore({
    scope: 'organization', scopeId: 'kayros', kind: 'norm',
    title: 'Norme', content: 'Toujours quantifier',
  });

  assert.equal(await lm1.save(), true);

  const lm2 = new LayeredMemory({ persistentStore: store });
  assert.equal(await lm2.load(), true);
  assert.equal(lm2.getAtomicFacts({ ideaId: 'iP' }).length, 1);
  assert.equal(lm2.getScenarios({ ideaId: 'iP' }).length, 1);
  assert.equal(lm2.getCore({ scope: 'organization' }).length, 1);
  assert.equal(lm2.getAtomicFacts({ ideaId: 'iP' })[0].content, 'fait persisté');
});

// ---------- FileOffloadBackend ----------
test('FileOffloadBackend (fake fs)', async () => {
  const disque = new Map();
  const fakeFs = {
    async mkdir() {},
    async writeFile(p, data) { disque.set(p, data); },
    async readFile(p) {
      if (!disque.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return disque.get(p);
    },
  };
  const fakePath = { join: (...a) => a.join('/') };
  const backend = new FileOffloadBackend({ rootDir: '/tmp/l0', fs: fakeFs, path: fakePath });
  const lm = new LayeredMemory({ offloadBackend: backend });
  lm.rememberL0({ ideaId: 'i9', step: 'ecouter', kind: 'tool_output', content: 'payload '.repeat(200) });
  const refs = await lm.offload('i9');
  assert.equal(refs.length, 1);
  assert.ok(refs[0].filePath);
  assert.ok(disque.has(refs[0].filePath));
});

// ---------- Engine + Orchestrator integration ----------
test('createEngine expose layered + Orchestrator utilise canvas/offload/distill path', async () => {
  const eng = createEngine();
  assert.ok(eng.layered);
  assert.ok(eng.orchestrator.layered);

  await eng.layered.addAtomicFact({
    ideaId: 'iL', content: 'contrainte réglementaire batteries seconde vie Europe',
    type: 'constraint', confidence: 0.9,
  });

  const plan = await eng.orchestrator.plan('Évaluer batteries seconde vie', { ideaId: 'iL' });
  const events = await collect(eng.orchestrator.run(plan, { governance: 'auto' }));

  const recall = events.find((e) => e.type === 'recall');
  assert.ok(recall);
  assert.equal(recall.source, 'layered');

  const offload = events.find((e) => e.type === 'offload');
  assert.ok(offload);
  assert.ok(offload.count >= 1);

  assert.equal(events.at(-1).status, 'auto');
});

test('Orchestrator.monitorProjection injecte aussi en L1', async () => {
  const eng = createEngine();
  const before = eng.layered.getAtomicFacts({ ideaId: 'iM' }).length;
  await eng.orchestrator.monitorProjection(
    { kpis: [{ id: 'adoption', name: 'Adoption', threshold: 100, comparator: 'lte' }], readings: [{ kpiId: 'adoption', value: 70 }] },
    { ideaId: 'iM' },
  );
  const after = eng.layered.getAtomicFacts({ ideaId: 'iM' });
  assert.ok(after.length > before);
  assert.ok(after.some((f) => f.type === 'metric'));
});
