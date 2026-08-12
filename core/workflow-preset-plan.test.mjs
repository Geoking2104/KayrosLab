// KayrosLab -- a preset must be reachable from a plan.
//
// Three graphs shipped and none of them could be selected: plan() always
// built a linear graph from the planner's steps, so `unified` was the
// library default and simultaneously unreachable. Same defect as before --
// declared, never wired.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from './index.mjs';
import { compileWorkflowGraph } from './workflow-graph.mjs';
import { DEFAULT_PRESET, UNIFIED_CONDITIONS } from './workflow-presets.mjs';

test('plan() builds a preset graph when asked for one', async () => {
  const engine = createEngine();
  const plan = await engine.orchestrator.plan('Evaluer une offre', {
    ideaId: 'idea-preset', preset: 'unified',
  });

  assert.match(plan.generatedBy, /^preset:unified$/);
  const agents = plan.graph.nodes.map(({ agent }) => agent);
  assert.ok(agents.includes('Critic'), 'the adversarial phase is present');
  assert.ok(agents.includes('Verifier'), 'the deliverable phase is present');
  assert.ok(plan.graph.nodes.some((n) => n.gate?.type === 'decision_arbitrage'));
  // The plan's steps and its graph must describe the same run.
  assert.deepEqual(plan.steps.map((s) => s.id), plan.graph.nodes.map((n) => n.id));
});

test('a preset plan does not consult the LLM planner', async () => {
  const engine = createEngine();
  let called = false;
  engine.agents.Planner.createPlan = async () => { called = true; return { steps: [] }; };
  await engine.orchestrator.plan('Evaluer', { ideaId: 'i', preset: 'reference' });
  assert.equal(called, false, 'a preset is the plan: there is nothing to plan');
});

test('every shipped preset is selectable and compiles with the engine registry', async () => {
  const engine = createEngine();
  engine.orchestrator.graphConditions = UNIFIED_CONDITIONS;
  for (const name of ['unified', 'reference', 'kayros']) {
    const plan = await engine.orchestrator.plan('Objectif', { ideaId: 'i', preset: name });
    assert.equal(plan.generatedBy, `preset:${name}`);
    assert.doesNotThrow(
      () => compileWorkflowGraph(plan.graph, { conditions: engine.orchestrator.graphConditions }),
      `preset ${name} must compile with the server-side resolvers`,
    );
  }
});

test('preset options are honoured', async () => {
  const engine = createEngine();
  const plan = await engine.orchestrator.plan('Objectif', {
    ideaId: 'i', preset: 'unified', presetOptions: { writerAttempts: 5, reviseRounds: 1 },
  });
  const writer = plan.graph.nodes.find((n) => n.id === 'writer');
  const critic = plan.graph.nodes.find((n) => n.id === 'critic');
  assert.equal(writer.maxAttempts, 5);
  assert.equal(critic.maxAttempts, 2, 'reviseRounds 1 means the initial pass plus one revision');
});

test('an unknown preset is refused rather than silently ignored', async () => {
  const engine = createEngine();
  await assert.rejects(
    () => engine.orchestrator.plan('Objectif', { ideaId: 'i', preset: 'inconnu' }),
    /unknown preset/i,
  );
  // Prototype keys must not resolve either.
  await assert.rejects(
    () => engine.orchestrator.plan('Objectif', { ideaId: 'i', preset: 'constructor' }),
    /unknown preset/i,
  );
});

test('without a preset the previous behaviour is untouched', async () => {
  const engine = createEngine();
  const plan = await engine.orchestrator.plan('Objectif', { ideaId: 'i', llmPlan: false });
  assert.equal(plan.generatedBy, 'fallback');
  assert.equal(plan.graph.nodes.length, plan.steps.length);
  // The default preset is a library default, not an implicit API default.
  assert.equal(DEFAULT_PRESET, 'unified');
  assert.ok(!plan.graph.nodes.some((n) => n.gate), 'no gate is introduced behind the caller');
});
