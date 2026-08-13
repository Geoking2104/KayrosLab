// KayrosLab -- Preset workflow graphs: both families must compile and route
// on the same paradigm-agnostic v2 engine.

import test from 'node:test';
import assert from 'node:assert/strict';

import { compileWorkflowGraph, GRAPH_START, GRAPH_END } from './workflow-graph.mjs';
import { createWorkflowState, applyWorkflowEvent } from './workflow-state.mjs';
import {
  buildPreset,
  kayrosCycleGraph,
  referencePipelineGraph,
  REFERENCE_CONDITIONS,
  WORKFLOW_PRESETS,
} from './workflow-presets.mjs';

test('both presets compile on the same engine', () => {
  for (const name of Object.keys(WORKFLOW_PRESETS)) {
    const { graph, conditions } = buildPreset(name);
    assert.doesNotThrow(() => compileWorkflowGraph(graph, { conditions }), `preset ${name}`);
  }
});

test('buildPreset rejects an unknown or inherited preset name', () => {
  assert.throws(() => buildPreset('nope'), /unknown preset/i);
  assert.throws(() => buildPreset('toString'), /unknown preset/i);
  assert.throws(() => buildPreset('__proto__'), /unknown preset/i);
});

test('reference pipeline walks the happy path start to end', () => {
  const compiled = compileWorkflowGraph(referencePipelineGraph(), {
    conditions: REFERENCE_CONDITIONS,
  });
  const ok = { review: { status: 'OK' }, nodeAttempts: {} };
  assert.equal(compiled.next(GRAPH_START, ok).id, 'planner');
  assert.equal(compiled.next('planner', ok).id, 'researcher');
  assert.equal(compiled.next('researcher', ok).id, 'simulator');
  assert.equal(compiled.next('simulator', ok).id, 'writer');
  assert.equal(compiled.next('writer', ok).id, 'verifier');
  assert.equal(compiled.next('verifier', ok).id, 'logger');
  assert.equal(compiled.next('logger', ok), GRAPH_END);
});

test('reference pipeline loops back to the writer then escalates once the budget is spent', () => {
  const compiled = compileWorkflowGraph(referencePipelineGraph({ writerAttempts: 3 }), {
    conditions: REFERENCE_CONDITIONS,
  });
  const ko = (writerAttempts) => ({
    review: { status: 'KO' },
    nodeAttempts: { writer: writerAttempts },
  });
  assert.equal(compiled.next('verifier', ko(1)).id, 'writer');
  assert.equal(compiled.next('verifier', ko(2)).id, 'writer');
  // Budget spent: the KO edge drops out and the always edge escalates.
  assert.equal(compiled.next('verifier', ko(3)).id, 'escalate');
  assert.equal(compiled.next('escalate', ko(3)), GRAPH_END);
});

test('reference pipeline permissions match the spec role boundaries', () => {
  const compiled = compileWorkflowGraph(referencePipelineGraph(), {
    conditions: REFERENCE_CONDITIONS,
  });
  // The planner plans; it holds no capability at all.
  assert.deepEqual(compiled.nodeById('planner').permissions.tools, []);
  assert.deepEqual(compiled.nodeById('planner').permissions.writes, []);
  // The verifier annotates review and nothing else.
  assert.deepEqual(compiled.nodeById('verifier').permissions.writes, ['review']);
  // The writer owns the draft, never the review.
  assert.deepEqual(compiled.nodeById('writer').permissions.writes, ['draft']);
  // The logger owns the audit artifacts.
  assert.deepEqual(compiled.nodeById('logger').permissions.writes, ['artifacts']);
});

test('reference pipeline drives routing from real state transitions', () => {
  const compiled = compileWorkflowGraph(referencePipelineGraph({ writerAttempts: 2 }), {
    conditions: REFERENCE_CONDITIONS,
  });
  let state = createWorkflowState({ ideaId: 'idea-preset', input: { request: 'Rapport DPE' } });

  state = applyWorkflowEvent(state, { type: 'trace', nodeId: 'writer', agent: 'Writer' });
  state = applyWorkflowEvent(state, {
    type: 'draft', nodeId: 'writer', agent: 'Writer', content: 'v1', format: 'markdown',
  });
  state = applyWorkflowEvent(state, {
    type: 'review', nodeId: 'verifier', agent: 'Verifier',
    status: 'KO', comments: ['metrique manquante'],
  });
  assert.equal(state.nodeAttempts.writer, 1);
  assert.equal(compiled.next('verifier', state).id, 'writer');

  state = applyWorkflowEvent(state, { type: 'trace', nodeId: 'writer', agent: 'Writer' });
  state = applyWorkflowEvent(state, {
    type: 'review', nodeId: 'verifier', agent: 'Verifier', status: 'KO', comments: ['toujours KO'],
  });
  assert.equal(state.nodeAttempts.writer, 2);
  // Budget of 2 spent -> escalation rather than an infinite revision loop.
  assert.equal(compiled.next('verifier', state).id, 'escalate');
});

test('kayros dialectical cycle stays linear and permissionless', () => {
  const compiled = compileWorkflowGraph(kayrosCycleGraph(), { conditions: {} });
  assert.equal(compiled.next(GRAPH_START, {}).id, 'critic');
  assert.equal(compiled.next('critic', {}).id, 'devils-advocate');
  assert.equal(compiled.next('devils-advocate', {}).id, 'red-team');
  assert.equal(compiled.next('red-team', {}).id, 'bisociateur');
  assert.equal(compiled.next('bisociateur', {}).id, 'synthesizer');
  assert.equal(compiled.next('synthesizer', {}), GRAPH_END);

  for (const id of ['critic', 'devils-advocate', 'red-team', 'bisociateur']) {
    assert.deepEqual(compiled.nodeById(id).permissions.tools, [], id);
    assert.deepEqual(compiled.nodeById(id).permissions.writes, [], id);
  }
  assert.deepEqual(compiled.nodeById('synthesizer').permissions.writes, ['draft']);
});

test('cycle8 has exactly one node per step of the KayrosLab cycle', async () => {
  const { CYCLE8_STEPS, cycle8Graph } = await import('./workflow-presets.mjs');
  const graph = cycle8Graph({ arbitrageGate: false });
  assert.equal(graph.nodes.length, 8);
  assert.deepEqual(graph.nodes.map((n) => n.id), CYCLE8_STEPS.map((s) => s.id));
  // L'ordre est le contrat : la demo indexe ses huit etapes dessus.
  assert.deepEqual(graph.nodes.map((n) => n.id), [
    'ecouter', 'cartographier', 'construire', 'positionner',
    'eprouver', 'arbitrer', 'projeter', 'realiser',
  ]);
  assert.equal(new Set(graph.nodes.map((n) => n.id)).size, 8, 'aucun identifiant duplique');
});

test('cycle8 traverses its eight steps in order', () => {
  const compiled = compileWorkflowGraph(
    // eslint-disable-next-line no-undef
    WORKFLOW_PRESETS.cycle8.build({ arbitrageGate: false }),
    { conditions: {} },
  );
  const seen = [...compiled.walk({})].map(({ node }) => node.id);
  assert.equal(seen.length, 8, 'les huit etapes sont parcourues');
  assert.equal(seen[0], 'ecouter');
  assert.equal(seen.at(-1), 'realiser');
});

test('cycle8 gates arbitration by default and only there', async () => {
  const { cycle8Graph } = await import('./workflow-presets.mjs');
  const gated = cycle8Graph();
  const avecGate = gated.nodes.filter((n) => n.gate);
  assert.equal(avecGate.length, 1, 'une seule gate');
  assert.equal(avecGate[0].id, 'arbitrer');
  assert.equal(avecGate[0].gate.type, 'decision_arbitrage');
  // La demo publique la desactive explicitement : le visiteur ne peut pas
  // resoudre une gate, le cycle s'arreterait a la sixieme etape.
  assert.equal(cycle8Graph({ arbitrageGate: false }).nodes.every((n) => !n.gate), true);
});

test('cycle8 keeps each channel with the step that owns it', async () => {
  const { cycle8Graph } = await import('./workflow-presets.mjs');
  const byId = Object.fromEntries(cycle8Graph().nodes.map((n) => [n.id, n]));
  assert.deepEqual(byId.ecouter.permissions.writes, ['research']);
  assert.deepEqual(byId.construire.permissions.writes, ['draft']);
  assert.deepEqual(byId.positionner.permissions.writes, ['simulation']);
  assert.deepEqual(byId.realiser.permissions.writes, ['artifacts']);
  // Les etapes adversariales ne produisent que du texte.
  assert.deepEqual(byId.eprouver.permissions.writes, []);
  assert.deepEqual(byId.cartographier.permissions.writes, []);
});

test('kayros cycle can drop the bisociator without breaking the graph', () => {
  const compiled = compileWorkflowGraph(kayrosCycleGraph({ bisociator: false }), { conditions: {} });
  assert.equal(compiled.nodeById('bisociateur'), null);
  assert.equal(compiled.next('red-team', {}).id, 'synthesizer');
});
