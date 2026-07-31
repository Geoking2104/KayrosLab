/**
 * E — Integration: cycle mock non-blocking, positionning L1, gate open without hang
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from './index.mjs';
import { collect } from './orchestrator.mjs';
import { applyGateResolution } from './cycle-lifecycle.mjs';
import { createIdea } from './model.mjs';

test('E. cycle run mock: events include positionning, no hang with waitGate false', async () => {
  const eng = createEngine({ sovereignty: null }); // mock path
  const plan = await eng.orchestrator.plan('Offre B2B IoT maintenance prédictive', {
    ideaId: 'int-1',
    llmPlan: false,
  });
  assert.ok(plan.steps?.length >= 2);

  const events = await collect(eng.orchestrator.run(plan, {
    governance: 'auto',
    positionning: true,
    autoDistill: true,
    distillMinFacts: 2,
    waitGate: false,
    offload: false,
  }));

  const types = events.map((e) => e.type);
  assert.ok(types.includes('start'), 'start');
  assert.ok(types.includes('positionning'), 'positionning');
  assert.ok(types.includes('trace'), 'trace');
  assert.ok(types.includes('final'), 'final');

  const pos = events.find((e) => e.type === 'positionning');
  assert.ok(pos.facts >= 1, 'at least one L1 fact from positionning');
  assert.ok(pos.mode === 'heuristic' || pos.mode === 'heuristic-fallback' || pos.mode === 'scanners');

  const final = events.find((e) => e.type === 'final');
  assert.ok(final.status === 'auto' || final.status === 'pending_review');

  const l1 = eng.layered.getAtomicFacts({ ideaId: 'int-1' });
  assert.ok(l1.some((f) => f.tags?.includes('positionning') || f.type === 'competitor' || f.type === 'metric'));
});

test('E. supervise + waitGate false yields pending_review without blocking', async () => {
  const eng = createEngine({});
  // Force sensitive-looking answer path: use strict governance instead
  const plan = await eng.orchestrator.plan('Décision Go/No-Go réglementaire RGPD', {
    ideaId: 'int-gate',
    llmPlan: false,
  });
  const events = await collect(eng.orchestrator.run(plan, {
    governance: 'strict',
    positionning: false,
    autoDistill: false,
    waitGate: false,
    offload: false,
  }));
  const types = events.map((e) => e.type);
  assert.ok(types.includes('gate') || types.includes('final'));
  const final = events.filter((e) => e.type === 'final').pop();
  assert.ok(final);
  if (types.includes('gate')) {
    assert.equal(final.status, 'pending_review');
    assert.ok(final.gateId);
  }
});

test('E. gate resolve maps idea lifecycle', () => {
  let idea = createIdea({ id: 'g1', title: 'X', stage: 'arbitrer', status: 'en_revue' });
  ({ idea } = applyGateResolution(idea, { decision: 'approve' }));
  assert.equal(idea.status, 'en_developpement');
  assert.equal(idea.stage, 'projeter');
});
