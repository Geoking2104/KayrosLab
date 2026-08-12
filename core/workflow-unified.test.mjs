// KayrosLab -- the unified graph: adversarial phase, arbitrage gate,
// produce-then-verify pipeline.
//
// The two rosters were not competing designs but two phases of one workflow:
// an idea is attacked until it holds, a human arbitrates the resulting
// decision packet, and only then is a deliverable produced and checked.
// Output is therefore both a governed recommendation and a verified report.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from './index.mjs';
import { collect } from './orchestrator.mjs';
import { GRAPH_END, compileWorkflowGraph, GRAPH_START } from './workflow-graph.mjs';
import {
  unifiedGraph,
  UNIFIED_CONDITIONS,
  WORKFLOW_PRESETS,
  DEFAULT_PRESET,
  buildPreset,
} from './workflow-presets.mjs';

const QUIET = {
  governance: 'auto', positionning: false, recall: false, remember: false,
  offload: false, autoDistill: false, frameControl: false,
  worldModel: false, adaptive: false,
};

const ADVERSARIAL = ['critic', 'devils-advocate', 'red-team', 'bisociateur'];

function unifiedPlan(overrides = {}) {
  const graph = unifiedGraph({ reviseRounds: 2, writerAttempts: 2, ...overrides });
  return {
    ideaId: 'idea-unified',
    goal: 'Evaluer puis documenter une offre',
    steps: graph.nodes.map(({ step }) => step),
    graph,
  };
}

const runOpts = (extra = {}) => ({ ...QUIET, graphConditions: UNIFIED_CONDITIONS, ...extra });

const compiled = (overrides) => compileWorkflowGraph(
  unifiedGraph({ reviseRounds: 2, writerAttempts: 2, ...overrides }),
  { conditions: UNIFIED_CONDITIONS },
);

const withDecision = (decision, extra = {}) => ({
  gate: { id: 'g1', type: 'decision_arbitrage', status: 'resolved', decision: { decision } },
  nodeAttempts: {}, ...extra,
});

// ------------------------------------------------------------ topology

test('the unified preset is registered and is the default', () => {
  assert.ok(WORKFLOW_PRESETS.unified, 'the unified preset exists');
  assert.equal(DEFAULT_PRESET, 'unified');
  // The reduced graphs stay available for a short cycle or an MVP.
  assert.ok(WORKFLOW_PRESETS.kayros);
  assert.ok(WORKFLOW_PRESETS.reference);
  const { graph, conditions } = buildPreset('unified');
  assert.doesNotThrow(() => compileWorkflowGraph(graph, { conditions }));
});

test('it carries both rosters in one graph', () => {
  const graph = unifiedGraph();
  const agents = graph.nodes.map(({ agent }) => agent);
  for (const role of [
    'Planner', 'Researcher', 'Critic', 'DevilsAdvocate', 'RedTeam',
    'Bisociateur', 'Synthesizer', 'Simulator', 'Writer', 'Verifier', 'Logger',
  ]) {
    assert.ok(agents.includes(role), `${role} must be a node of the unified graph`);
  }
});

test('the adversarial phase runs before the arbitrage gate', () => {
  const g = compiled();
  assert.equal(g.next(GRAPH_START, {}).id, 'planner');
  assert.equal(g.next('planner', {}).id, 'researcher');
  assert.equal(g.next('researcher', {}).id, 'critic');
  assert.equal(g.next('critic', {}).id, 'devils-advocate');
  assert.equal(g.next('devils-advocate', {}).id, 'red-team');
  assert.equal(g.next('red-team', {}).id, 'bisociateur');
  assert.equal(g.next('bisociateur', {}).id, 'synthesizer');
  assert.equal(g.next('synthesizer', {}).id, 'decision-gate');
});

test('the arbitrage node declares a human gate', () => {
  const node = compiled().nodeById('decision-gate');
  assert.ok(node.gate, 'arbitrage is a checkpoint, not a formality');
  assert.equal(node.gate.type, 'decision_arbitrage');
  assert.equal(node.gate.requiredRole, 'comex');
});

// -------------------------------------------------- arbitrage routing

test('a Go decision opens the deliverable pipeline', () => {
  const g = compiled();
  assert.equal(g.next('decision-gate', withDecision('approve')).id, 'simulator');
  assert.equal(g.next('simulator', {}).id, 'writer');
  assert.equal(g.next('writer', {}).id, 'verifier');
});

test('a revise decision goes back to the adversarial phase, not to the writer', () => {
  const g = compiled();
  // The revision bears on the idea: the attack is replayed, not the wording.
  assert.equal(g.next('decision-gate', withDecision('revise')).id, 'critic');
});

test('the revise loop is bounded and escalates once spent', () => {
  // reviseRounds = 2 means the initial pass plus two revisions: three
  // attempts per adversarial node.
  const g = compiled({ reviseRounds: 2 });
  const attempts = (n) => withDecision('revise', {
    nodeAttempts: { critic: n, 'devils-advocate': n, 'red-team': n, bisociateur: n },
  });
  assert.equal(g.nodeById('critic').maxAttempts, 3);
  assert.equal(g.next('decision-gate', attempts(1)).id, 'critic', 'first revision allowed');
  assert.equal(g.next('decision-gate', attempts(2)).id, 'critic', 'second revision allowed');
  // Budget spent: asking again escalates instead of spinning.
  assert.equal(g.next('decision-gate', attempts(3)).id, 'escalate');
});

test('an unreadable decision escalates rather than proceeding', () => {
  const g = compiled();
  // Fail closed: nothing is produced on a verdict nobody can interpret.
  assert.equal(g.next('decision-gate', withDecision('inconnu')).id, 'escalate');
  assert.equal(g.next('decision-gate', { gate: null, nodeAttempts: {} }).id, 'escalate');
});

// ------------------------------------------------- deliverable phase

test('the verifier still loops to the writer then escalates', () => {
  const g = compiled({ writerAttempts: 2 });
  const ko = (n) => ({ review: { status: 'KO' }, nodeAttempts: { writer: n } });
  assert.equal(g.next('verifier', ko(1)).id, 'writer');
  assert.equal(g.next('verifier', ko(2)).id, 'escalate');
  assert.equal(g.next('verifier', { review: { status: 'OK' }, nodeAttempts: {} }).id, 'logger');
  assert.equal(g.next('logger', {}), GRAPH_END);
});

test('permissions keep each phase in its lane', () => {
  const g = compiled();
  // Adversarial agents produce text only: they own no channel.
  for (const id of ADVERSARIAL) {
    assert.deepEqual(g.nodeById(id).permissions.writes, [], id);
  }
  assert.deepEqual(g.nodeById('researcher').permissions.writes, ['research']);
  assert.deepEqual(g.nodeById('simulator').permissions.writes, ['simulation']);
  assert.deepEqual(g.nodeById('writer').permissions.writes, ['draft']);
  assert.deepEqual(g.nodeById('verifier').permissions.writes, ['review']);
  assert.deepEqual(g.nodeById('logger').permissions.writes, ['artifacts']);
});

// ------------------------------------------------------- end to end

test('a run suspends at the arbitrage gate before producing anything', async () => {
  const engine = createEngine();
  engine.orchestrator.governance = { open: () => ({ gateId: 'g1', promise: new Promise(() => {}) }) };
  let wrote = false;
  engine.agents.Writer.execute = async () => { wrote = true; return { output: 'x' }; };

  const events = await collect(engine.orchestrator.run(unifiedPlan(), runOpts()));
  const final = events.at(-1);
  assert.equal(final.status, 'pending_review');
  assert.equal(final.gateType, 'decision_arbitrage');
  assert.equal(wrote, false, 'nothing is produced before a human arbitrates');
  // The adversarial phase did run.
  const nodes = events.filter((e) => e.type === 'trace').map((e) => e.nodeId);
  for (const id of ADVERSARIAL) assert.ok(nodes.includes(id), id);
});

test('resuming with Go produces and verifies the deliverable', async () => {
  const engine = createEngine();
  engine.orchestrator.governance = { open: () => ({ gateId: 'g1', promise: new Promise(() => {}) }) };
  engine.agents.Verifier.execute = async () => ({
    output: 'ok', channel: { type: 'review', status: 'OK', comments: [] },
  });
  const first = await collect(engine.orchestrator.run(unifiedPlan(), runOpts()));
  const snapshot = first.at(-1).workflowState;

  const events = await collect(engine.orchestrator.resume(snapshot, {
    ...runOpts(), decision: { decision: 'approve', by: 'comex' },
  }));
  const nodes = events.filter((e) => e.type === 'trace').map((e) => e.nodeId);
  assert.ok(nodes.includes('writer'), 'the deliverable is produced after Go');
  assert.ok(nodes.includes('logger'));
  const last = events.at(-1).workflowState;
  assert.equal(last.review.status, 'OK', 'the run terminates on a passing review');
  assert.ok(last.draft?.content, 'a report exists');
});

test('resuming with revise replays the attack and re-opens a fresh gate', async () => {
  const engine = createEngine();
  const opened = [];
  engine.orchestrator.governance = {
    open: (req) => { opened.push(req.type); return { gateId: `g${opened.length}`, promise: new Promise(() => {}) }; },
  };
  const first = await collect(engine.orchestrator.run(unifiedPlan(), runOpts()));
  const snapshot = first.at(-1).workflowState;

  const events = await collect(engine.orchestrator.resume(snapshot, {
    ...runOpts(), decision: { decision: 'revise', by: 'comex' },
  }));
  const nodes = events.filter((e) => e.type === 'trace').map((e) => e.nodeId);
  assert.ok(nodes.includes('critic'), 'the adversarial phase is replayed');
  // The second arbitrage must open its own gate: a resumed approval is
  // consumed once, it does not wave the node through for ever.
  assert.equal(opened.filter((t) => t === 'decision_arbitrage').length, 2);
  assert.equal(events.at(-1).status, 'pending_review');
});

test('a veto at arbitrage blocks without producing a deliverable', async () => {
  const engine = createEngine();
  engine.orchestrator.governance = { open: () => ({ gateId: 'g1', promise: new Promise(() => {}) }) };
  let wrote = false;
  engine.agents.Writer.execute = async () => { wrote = true; return { output: 'x' }; };
  const first = await collect(engine.orchestrator.run(unifiedPlan(), runOpts()));

  const events = await collect(engine.orchestrator.resume(first.at(-1).workflowState, {
    ...runOpts(), decision: { decision: 'veto', reason: 'hors strategie' },
  }));
  assert.equal(wrote, false);
  assert.equal(events.at(-1).status, 'blocked_veto');
});
