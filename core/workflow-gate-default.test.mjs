// KayrosLab -- a gate must never hang a run by default.
//
// Graph-level gates were introduced awaiting their resolution unconditionally.
// That is correct for an interactive caller that holds the run open, and wrong
// for everything else: a production run reaching an unresolved gate hung
// forever. The default is now to suspend -- emit the gate, return a resumable
// `pending_review`, and hand control back. Waiting is an explicit opt-in.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from './index.mjs';
import { collect } from './orchestrator.mjs';
import { GRAPH_START, GRAPH_END } from './workflow-graph.mjs';
import { referencePipelineGraph, REFERENCE_CONDITIONS } from './workflow-presets.mjs';

const QUIET = {
  governance: 'auto', positionning: false, recall: false, remember: false,
  offload: false, autoDistill: false, frameControl: false,
  worldModel: false, adaptive: false,
};

const runOpts = (extra = {}) => ({ ...QUIET, graphConditions: REFERENCE_CONDITIONS, ...extra });

function referencePlan() {
  const graph = referencePipelineGraph({ writerAttempts: 2 });
  return {
    ideaId: 'idea-gate-default',
    goal: 'Produire un rapport verifie',
    steps: graph.nodes.map(({ step }) => step),
    graph,
  };
}

/** A gate nobody ever resolves -- the production failure mode. */
function neverResolvingGovernance(opened = []) {
  let n = 0;
  return {
    open(req) {
      n += 1;
      opened.push(req);
      return { gateId: `g${n}`, promise: new Promise(() => {}) };
    },
  };
}

function approvingGovernance(opened = []) {
  let n = 0;
  return {
    open(req) {
      n += 1;
      opened.push(req);
      return { gateId: `g${n}`, promise: Promise.resolve({ decision: 'approve', by: 'comex' }) };
    },
  };
}

function koVerifier(engine) {
  engine.agents.Verifier.execute = async () => ({
    output: 'refuse', channel: { type: 'review', status: 'KO', comments: ['incomplet'] },
  });
  return engine;
}

function gatedToolPlan() {
  const graph = {
    version: 2, start: GRAPH_START, end: GRAPH_END,
    nodes: [{
      id: 'publish', kind: 'tool', agent: null,
      step: { id: 'publish', tool: 'publish_report', toolInput: {} },
      maxAttempts: 1, permissions: { tools: ['publish_report'], writes: [] }, gate: null,
    }],
    edges: [
      { id: 'e0', from: GRAPH_START, to: 'publish', kind: 'always' },
      { id: 'e1', from: 'publish', to: GRAPH_END, kind: 'always' },
    ],
  };
  return { ideaId: 'idea-tool-default', goal: 'Publier', steps: graph.nodes.map((n) => n.step), graph };
}

// ------------------------------------------------- default: never blocks

test('by default an unresolved node gate suspends the run instead of hanging', async () => {
  const engine = koVerifier(createEngine());
  const opened = [];
  engine.orchestrator.governance = neverResolvingGovernance(opened);
  let ran = false;
  engine.agents.HumanGate.execute = async () => { ran = true; return { output: 'x' }; };

  // No opt-in: this must return, not hang. The test timeout is the assertion.
  const events = await collect(engine.orchestrator.run(referencePlan(), runOpts()));

  assert.equal(ran, false, 'the gated node must not run before approval');
  assert.ok(opened.some((g) => g.type === 'human_escalation'), 'the gate was still opened');
  const final = events.at(-1);
  assert.equal(final.type, 'final');
  assert.equal(final.status, 'pending_review');
});

test('the suspended run carries what is needed to resume it', async () => {
  const engine = koVerifier(createEngine());
  engine.orchestrator.governance = neverResolvingGovernance();
  const events = await collect(engine.orchestrator.run(referencePlan(), runOpts()));

  const final = events.at(-1);
  assert.ok(final.gateId, 'the final event names the gate to resolve');
  assert.equal(final.gateType, 'human_escalation');
  assert.equal(final.nodeId, 'escalate', 'the node to resume from is named');
  assert.equal(events.at(-1).workflowState.status, 'pending_review');
});

test('by default an unresolved tool gate suspends instead of hanging', async () => {
  const engine = createEngine();
  engine.orchestrator.governance = neverResolvingGovernance();
  let called = false;
  engine.orchestrator.tools = {
    get: (name) => ({ name, sideEffect: 'write', gate: true }),
    call: async () => { called = true; return { ok: true }; },
  };

  const events = await collect(engine.orchestrator.run(gatedToolPlan(), runOpts({ graphConditions: {} })));

  assert.equal(called, false, 'a risky tool never runs unapproved');
  const final = events.at(-1);
  assert.equal(final.status, 'pending_review');
  assert.equal(final.gateType, 'tool_execution');
});

test('a graph with no gate is unaffected by the default', async () => {
  const engine = createEngine();
  engine.orchestrator.governance = neverResolvingGovernance();
  engine.agents.Verifier.execute = async () => ({
    output: 'ok', channel: { type: 'review', status: 'OK', comments: [] },
  });
  // The OK path never reaches the escalation node.
  const events = await collect(engine.orchestrator.run(referencePlan(), runOpts()));
  const final = events.at(-1);
  assert.equal(final.type, 'final');
  assert.notEqual(final.status, 'pending_review');
});

// ------------------------------------------------------- explicit opt-in

test('waitNodeGate opts in to blocking, and an approval lets the node run', async () => {
  const engine = koVerifier(createEngine());
  engine.orchestrator.governance = approvingGovernance();
  let ran = false;
  engine.agents.HumanGate.execute = async () => { ran = true; return { output: 'escalade' }; };

  const events = await collect(engine.orchestrator.run(
    referencePlan(), runOpts({ waitNodeGate: true }),
  ));
  assert.ok(ran, 'the node runs once approved');
  assert.ok(events.some((e) => e.type === 'gate_resolved'));
  assert.equal(events.at(-1).status !== 'pending_review', true);
});

test('waitNodeGate with a veto still blocks the run', async () => {
  const engine = koVerifier(createEngine());
  engine.orchestrator.governance = {
    open: () => ({ gateId: 'g-veto', promise: Promise.resolve({ decision: 'veto', reason: 'non' }) }),
  };
  let ran = false;
  engine.agents.HumanGate.execute = async () => { ran = true; return { output: 'x' }; };

  const events = await collect(engine.orchestrator.run(
    referencePlan(), runOpts({ waitNodeGate: true }),
  ));
  assert.equal(ran, false);
  assert.equal(events.at(-1).status, 'blocked_veto');
});

test('waitNodeGate lets an approved risky tool execute', async () => {
  const engine = createEngine();
  engine.orchestrator.governance = approvingGovernance();
  let called = false;
  engine.orchestrator.tools = {
    get: (name) => ({ name, sideEffect: 'write', gate: true }),
    call: async () => { called = true; return { ok: true }; },
  };
  await collect(engine.orchestrator.run(
    gatedToolPlan(), runOpts({ graphConditions: {}, waitNodeGate: true }),
  ));
  assert.ok(called, 'the tool runs after approval');
});

// -------------------------------------------------------- prod defaults

test('the backend cycle route defaults cannot hang on a node gate', async () => {
  // Mirrors backend/fastify/routes/cycle.mjs: governance auto, waitGate false,
  // and no waitNodeGate. This combination must always terminate.
  const engine = koVerifier(createEngine());
  engine.orchestrator.governance = neverResolvingGovernance();
  const events = await collect(engine.orchestrator.run(referencePlan(), {
    ...QUIET, graphConditions: REFERENCE_CONDITIONS, waitGate: false,
  }));
  assert.equal(events.at(-1).type, 'final');
  assert.equal(events.at(-1).status, 'pending_review');
});
