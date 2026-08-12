// KayrosLab -- a suspended run must actually be resumable.
//
// The previous commit made gates suspend instead of block, and called the
// emitted `pending_review` "resumable". It was not: governance.resolve()
// settles a promise nobody awaits any more, the state overwrites the node id
// with 'human_gate', and no entry point continues the run. A human decision
// therefore had no effect on the workflow -- declared, never wired.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from './index.mjs';
import { collect } from './orchestrator.mjs';
import { GRAPH_START, GRAPH_END, compileWorkflowGraph } from './workflow-graph.mjs';
import { applyWorkflowEvent, createWorkflowState } from './workflow-state.mjs';
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
    ideaId: 'idea-resume',
    goal: 'Produire un rapport verifie',
    steps: graph.nodes.map(({ step }) => step),
    graph,
  };
}

function neverResolving() {
  let n = 0;
  return { open: () => ({ gateId: `g${++n}`, promise: new Promise(() => {}) }) };
}

/** Drives a run to the escalation gate and returns the suspended snapshot. */
async function suspendAtEscalation() {
  const engine = createEngine();
  engine.orchestrator.governance = neverResolving();
  engine.agents.Verifier.execute = async () => ({
    output: 'ko', channel: { type: 'review', status: 'KO', comments: ['incomplet'] },
  });
  engine.agents.Writer.execute = async () => ({
    output: 'draft', channel: { type: 'draft', content: 'v1', format: 'markdown' },
  });
  const events = await collect(engine.orchestrator.run(referencePlan(), runOpts()));
  return { engine, events, snapshot: events.at(-1).workflowState };
}

// ------------------------------------------- the snapshot must be usable

test('a suspended state names the node to resume from', async () => {
  const { snapshot } = await suspendAtEscalation();
  assert.equal(snapshot.status, 'pending_review');
  assert.ok(snapshot.gate, 'the suspended state carries its gate');
  assert.equal(snapshot.gate.nodeId, 'escalate', 'the gate remembers which node it guards');
  assert.equal(snapshot.gate.type, 'human_escalation');
  assert.ok(snapshot.gate.id, 'the gate id is what governance will resolve');
});

test('the suspended state keeps the work already done', async () => {
  const { snapshot } = await suspendAtEscalation();
  assert.equal(snapshot.draft.content, 'v1', 'the draft survives the suspension');
  assert.equal(snapshot.review.status, 'KO');
  assert.equal(snapshot.nodeAttempts.writer, 2, 'the spent budget is preserved');
  assert.ok(snapshot.plan.graph, 'the graph travels with the state');
});

test('a gate event records the node it guards', () => {
  let state = createWorkflowState({ ideaId: 'i', input: { request: 'x' } });
  state = applyWorkflowEvent(state, {
    type: 'gate', gateId: 'g1', gateType: 'human_escalation', nodeId: 'escalate',
  });
  assert.equal(state.gate.nodeId, 'escalate');
  // A terminal pending_review must not erase it.
  state = applyWorkflowEvent(state, { type: 'final', status: 'pending_review' });
  assert.equal(state.gate.nodeId, 'escalate');
});

// ------------------------------------------------------- walk({ from })

test('walk can start at a given node, yielding it first', () => {
  const compiled = compileWorkflowGraph(referencePipelineGraph({ writerAttempts: 2 }), {
    conditions: REFERENCE_CONDITIONS,
  });
  const state = { review: { status: 'KO' }, nodeAttempts: { writer: 2 } };
  const seen = [...compiled.walk({ from: 'escalate', state: () => state })].map(({ node }) => node.id);
  assert.deepEqual(seen, ['escalate'], 'resuming re-enters the node that never ran');
});

test('walk rejects an unknown resume point', () => {
  const compiled = compileWorkflowGraph(referencePipelineGraph(), { conditions: REFERENCE_CONDITIONS });
  assert.throws(
    () => [...compiled.walk({ from: 'inconnu', state: () => ({}) })],
    /unknown node/i,
  );
});

// ------------------------------------------------------------- resume()

test('resume with an approval runs the gated node and finishes the run', async () => {
  const { snapshot } = await suspendAtEscalation();
  const engine = createEngine();
  let ran = false;
  engine.agents.HumanGate.execute = async () => { ran = true; return { output: 'escalade' }; };

  const events = await collect(engine.orchestrator.resume(snapshot, {
    ...runOpts(),
    decision: { decision: 'approve', by: 'comex@test' },
  }));

  assert.ok(ran, 'the gated node runs once the human approved');
  assert.equal(events.at(-1).type, 'final');
  assert.notEqual(events.at(-1).status, 'pending_review');
  assert.ok(events.some((e) => e.type === 'gate_resolved'));
});

test('resume does not replay the nodes that already ran', async () => {
  const { snapshot } = await suspendAtEscalation();
  const engine = createEngine();
  const replayed = [];
  for (const role of ['Researcher', 'Simulator', 'Writer', 'Verifier']) {
    engine.agents[role].execute = async () => { replayed.push(role); return { output: 'x' }; };
  }
  engine.agents.HumanGate.execute = async () => ({ output: 'escalade' });

  await collect(engine.orchestrator.resume(snapshot, {
    ...runOpts(),
    decision: { decision: 'approve', by: 'comex@test' },
  }));
  assert.deepEqual(replayed, [], 'no upstream node is executed twice');
});

test('resume carries the state forward instead of starting from scratch', async () => {
  const { snapshot } = await suspendAtEscalation();
  const engine = createEngine();
  engine.agents.HumanGate.execute = async () => ({ output: 'escalade' });

  const events = await collect(engine.orchestrator.resume(snapshot, {
    ...runOpts(),
    decision: { decision: 'approve', by: 'comex@test' },
  }));
  const final = events.at(-1).workflowState;
  assert.equal(final.runId, snapshot.runId, 'the run keeps its identity');
  assert.equal(final.traceId, snapshot.traceId);
  assert.equal(final.draft.content, 'v1', 'the draft is still there');
  assert.equal(final.nodeAttempts.writer, 2, 'the spent budget is not reset');
});

test('resume with a veto blocks and never runs the gated node', async () => {
  const { snapshot } = await suspendAtEscalation();
  const engine = createEngine();
  let ran = false;
  engine.agents.HumanGate.execute = async () => { ran = true; return { output: 'x' }; };

  const events = await collect(engine.orchestrator.resume(snapshot, {
    ...runOpts(),
    decision: { decision: 'veto', reason: 'hors budget' },
  }));
  assert.equal(ran, false);
  const final = events.at(-1);
  assert.equal(final.status, 'blocked_veto');
  assert.match(String(final.message), /hors budget/);
});

test('resume refuses a state that is not suspended', async () => {
  const engine = createEngine();
  const fresh = createWorkflowState({ ideaId: 'i', input: { request: 'x' } });
  await assert.rejects(
    async () => { for await (const _ of engine.orchestrator.resume(fresh, { decision: { decision: 'approve' } })) { /* */ } },
    /not suspended/i,
  );
});

test('resume refuses a decision it cannot interpret', async () => {
  const { snapshot } = await suspendAtEscalation();
  const engine = createEngine();
  await assert.rejects(
    async () => { for await (const _ of engine.orchestrator.resume(snapshot, {})) { /* */ } },
    /decision/i,
  );
});
