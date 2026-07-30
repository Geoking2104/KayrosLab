// Tests de la mémoire stratifiée L0–L3 — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createL0, createL1, createL2, createL3,
  LayeredMemory, FileOffloadBackend, InMemoryVectorStore,
} from './memory.mjs';
import { MockEmbeddings, MemoryService } from './embeddings.mjs';
import { createEngine } from './index.mjs';
import { collect } from './orchestrator.mjs';

// ---------- Factories ----------
test('createL0 : champs obligatoires + defaults', () => {
  const item = createL0({
    ideaId: 'i1',
    step: 'construire',
    kind: 'tool_output',
    content: 'résultat long…',
  });
  assert.ok(item.id);
  assert.equal(item.ideaId, 'i1');
  assert.equal(item.kind, 'tool_output');
  assert.ok(item.createdAt);
  assert.throws(() => createL0({ step: 'x', kind: 'y', content: 'z' })); // ideaId manquant
});

test('createL1 : atomic fact avec confidence bornée', () => {
  const f = createL1({
    content: 'Le concurrent X a 1200 stars sur GitHub',
    type: 'competitor',
    confidence: 1.5, // sera clampé à 1
    actors: ['scanner'],
    ideaId: 'i1',
  });
  assert.equal(f.confidence, 1);
  assert.equal(f.status, 'active');
  assert.equal(f.type, 'competitor');
  assert.throws(() => createL1({})); // content manquant
});

test('createL2 + createL3', () => {
  const s = createL2({
    title: 'Gap DePIN énergie',
    content: 'Les projets DePIN énergie manquent souvent de preuves de traction réelle.',
    patternType: 'competitive_gap',
    ideaIds: ['i1'],
    applicableStages: ['positionner', 'eprouver'],
  });
  assert.equal(s.reviewStatus, 'draft');
  assert.ok(s.applicableStages.includes('positionner'));

  const core = createL3({
    scope: 'user',
    scopeId: 'geoff',
    kind: 'preference',
    title: 'Style de décision',
    content: 'Préfère les preuves quantitatives avant arbitrage.',
  });
  assert.equal(core.version, 1);
  assert.equal(core.scope, 'user');
});

// ---------- LayeredMemory core operations ----------
test('LayeredMemory : L0 → offload → canvas', async () => {
  const lm = new LayeredMemory();
  lm.rememberL0({
    ideaId: 'i1',
    step: 'cartographier',
    kind: 'scrape',
    content: 'A'.repeat(1200),
  });
  const canvasBefore = lm.getWorkingCanvas('i1');
  assert.equal(canvasBefore.nodes.length, 1);

  const refs = await lm.offload('i1');
  assert.equal(refs.length, 1);
  assert.ok(refs[0].summary);

  const canvasAfter = lm.getWorkingCanvas('i1');
  assert.equal(canvasAfter.nodes.length, 0); // expiré
});

test('LayeredMemory : L1 + L2 + recall + buildContextBlock', async () => {
  const store = new InMemoryVectorStore();
  const mem = new MemoryService({ embeddings: new MockEmbeddings({ dim: 16 }), store });
  const lm = new LayeredMemory({ memoryService: mem, store });

  await lm.addAtomicFact({
    ideaId: 'i1',
    content: 'batteries seconde vie stockage résidentiel Europe',
    type: 'observation',
    confidence: 0.85,
  });
  await lm.addAtomicFact({
    ideaId: 'i1',
    content: 'recette de tarte aux pommes',
    type: 'observation',
  });
  await lm.distillScenario({
    title: 'Traction DePIN',
    content: 'Les projets avec >500 stars et activité récente ont plus de chances.',
    summary: 'stars + activité = signal de traction',
    ideaIds: ['i1'],
    patternType: 'insight',
  });
  lm.updateCore({
    scope: 'organization',
    scopeId: 'kayros',
    kind: 'norm',
    title: 'Preuves quanti',
    content: 'Toujours exiger des métriques avant Go.',
  });

  const { l1, l2, l3 } = await lm.recall('batteries stockage', { ideaId: 'i1', k: 3 });
  assert.ok(l1.length >= 1);
  assert.equal(l1[0].content.includes('batteries'), true);
  assert.ok(l2.length >= 1);
  assert.ok(l3.length >= 1);

  const block = await lm.buildContextBlock('batteries', { ideaId: 'i1' });
  assert.match(block, /Faits atomiques|Scénarios|Connaissances/);
});

test('LayeredMemory : FileOffloadBackend (fake fs)', async () => {
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
  assert.equal(backend.enabled, true);

  const lm = new LayeredMemory({ offloadBackend: backend });
  const item = lm.rememberL0({
    ideaId: 'i9',
    step: 'ecouter',
    kind: 'tool_output',
    content: 'payload très long '.repeat(100),
  });
  const refs = await lm.offload('i9');
  assert.equal(refs.length, 1);
  assert.ok(refs[0].filePath);
  assert.ok(disque.has(refs[0].filePath));
});

// ---------- Wiring dans createEngine + Orchestrator ----------
test('createEngine expose layered + Orchestrator l\'utilise', async () => {
  const eng = createEngine();
  assert.ok(eng.layered);
  assert.ok(eng.orchestrator.layered);

  // Pré-remplir un fait
  await eng.layered.addAtomicFact({
    ideaId: 'iL',
    content: 'contrainte réglementaire batteries seconde vie Europe',
    type: 'constraint',
    confidence: 0.9,
  });

  const plan = await eng.orchestrator.plan('Évaluer batteries seconde vie', { ideaId: 'iL' });
  const events = await collect(eng.orchestrator.run(plan, { governance: 'auto' }));

  const recall = events.find((e) => e.type === 'recall');
  assert.ok(recall, 'un événement recall doit être émis');
  assert.equal(recall.source, 'layered');

  const offload = events.find((e) => e.type === 'offload');
  assert.ok(offload, 'un offload de fin de cycle doit apparaître');
  assert.ok(offload.count >= 1);

  const final = events.at(-1);
  assert.equal(final.status, 'auto');
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
  assert.ok(after.some((f) => f.type === 'metric' && f.tags?.includes('kpi-alert')));
});
