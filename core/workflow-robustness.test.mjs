// KayrosLab -- robustness defects R1..R8 of the Graph Engineering review.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from './index.mjs';
import { collect } from './orchestrator.mjs';
import { GRAPH_START, GRAPH_END, declareWorkflowGraph, compileWorkflowGraph } from './workflow-graph.mjs';
import { createWorkflowState, applyWorkflowEvent, freezeWorkflowState } from './workflow-state.mjs';

const QUIET = {
  governance: 'auto', positionning: false, recall: false, remember: false,
  offload: false, autoDistill: false, frameControl: false,
  worldModel: false, adaptive: false,
};

function stubAgents(engine, onCall = () => {}) {
  for (const name of ['Critic', 'DevilsAdvocate', 'RedTeam', 'Bisociateur']) {
    engine.agents[name].execute = async (input, ctx) => {
      onCall(name, ctx);
      return { output: `${name} ok` };
    };
  }
  engine.agents.Synthesizer.synthesize = async () => ({
    output: 'synthese', structured: { decision: 'go' },
  });
}

// ------------------------------------- R1 concurrency / caller-owned opts

test('R1: two concurrent runs never share per-run positionning state', async () => {
  const engine = createEngine();
  stubAgents(engine);
  const planA = await engine.orchestrator.plan('A', { ideaId: 'idea-a', llmPlan: false });
  const planB = await engine.orchestrator.plan('B', { ideaId: 'idea-b', llmPlan: false });

  const [a, b] = await Promise.all([
    collect(engine.orchestrator.run(planA, { ...QUIET })),
    collect(engine.orchestrator.run(planB, { ...QUIET })),
  ]);

  assert.ok(a.every((event) => event.ideaId === undefined || event.ideaId === 'idea-a'));
  assert.ok(b.every((event) => event.ideaId === undefined || event.ideaId === 'idea-b'));
  // The orchestrator instance must hold no run-scoped residue at all.
  assert.equal(engine.orchestrator._lastPositionning, undefined);
});

test('R1: run() never mutates the caller-owned options object', async () => {
  const engine = createEngine();
  stubAgents(engine);
  const plan = await engine.orchestrator.plan('Ne pas muter', { ideaId: 'idea-opts', llmPlan: false });
  const opts = { ...QUIET };
  const before = JSON.stringify(opts);
  await collect(engine.orchestrator.run(plan, opts));
  assert.equal(JSON.stringify(opts), before);
  assert.equal('_lastPositionning' in opts, false);
});

// ------------------------------------------------ R2 observable failures

test('R2: a failing soft phase emits a soft_error event instead of vanishing', async () => {
  const engine = createEngine();
  stubAgents(engine);
  engine.orchestrator.layered = {
    recall: async () => { throw new Error('layered down'); },
    buildContextBlock: async () => { throw new Error('layered down'); },
    snapshot: () => ({ stats: {} }),
    rememberL0: () => {},
    addAtomicFact: async () => { throw new Error('layered down'); },
    offload: async () => { throw new Error('layered down'); },
  };
  const plan = await engine.orchestrator.plan('Observer les echecs', {
    ideaId: 'idea-soft', llmPlan: false,
  });
  const events = await collect(engine.orchestrator.run(plan, { ...QUIET, recall: true }));

  const soft = events.filter((event) => event.type === 'soft_error');
  assert.ok(soft.length > 0, 'at least one soft failure must surface');
  for (const event of soft) {
    assert.ok(typeof event.phase === 'string' && event.phase.trim(), 'soft_error carries a phase');
    assert.ok(typeof event.message === 'string' && event.message.trim());
  }
  // The run still completes: a soft failure degrades, it does not abort.
  assert.equal(events.at(-1).type, 'final');
});

// --------------------------------------------------- R3 timeout / cancel

test('R3: a step that exceeds stepTimeoutMs degrades instead of hanging', async () => {
  const engine = createEngine();
  stubAgents(engine);
  engine.agents.Critic.execute = () => new Promise(() => { /* never settles */ });
  const plan = await engine.orchestrator.plan('Timeout', { ideaId: 'idea-timeout', llmPlan: false });

  const events = await collect(engine.orchestrator.run(plan, { ...QUIET, stepTimeoutMs: 25 }));
  const degraded = events.filter((event) => event.type === 'degraded');
  assert.ok(degraded.some((event) => event.reason === 'timeout'), 'a timeout must be reported');
  assert.equal(events.at(-1).type, 'final');
});

test('R3: an aborted signal cancels the run and emits a cancelled event', async () => {
  const engine = createEngine();
  stubAgents(engine);
  const controller = new AbortController();
  engine.agents.Critic.execute = async () => {
    controller.abort();
    return { output: 'critic ok' };
  };
  const plan = await engine.orchestrator.plan('Annulation', { ideaId: 'idea-abort', llmPlan: false });

  const events = await collect(engine.orchestrator.run(plan, { ...QUIET, signal: controller.signal }));
  assert.ok(events.some((event) => event.type === 'cancelled'), 'cancellation must surface');
  assert.equal(events.at(-1).workflowState.status, 'cancelled');
});

test('R3: a signal already aborted stops before any agent runs', async () => {
  const engine = createEngine();
  const calls = [];
  stubAgents(engine, (name) => calls.push(name));
  const controller = new AbortController();
  controller.abort();
  const plan = await engine.orchestrator.plan('Deja annule', { ideaId: 'idea-pre', llmPlan: false });

  const events = await collect(engine.orchestrator.run(plan, { ...QUIET, signal: controller.signal }));
  assert.deepEqual(calls, []);
  assert.ok(events.some((event) => event.type === 'cancelled'));
});

// ------------------------------------------------------- R4 clone cost

test('R4: applying an event does not re-serialize the graph', () => {
  const graph = declareWorkflowGraph(
    Array.from({ length: 40 }, (_, index) => ({ id: `n${index}`, agent: 'Critic' })),
  );
  const state = createWorkflowState({
    ideaId: 'idea-cost',
    input: { request: 'cout' },
    plan: { steps: [], successCriteria: [], graph },
  });
  const next = applyWorkflowEvent(state, { type: 'trace', nodeId: 'n0', agent: 'Critic' });
  // Structural sharing: the immutable graph is carried by reference, never copied.
  assert.equal(next.plan.graph, state.plan.graph);
  assert.equal(freezeWorkflowState(next).plan.graph, state.plan.graph);
});

test('R4: mutating a derived state never reaches back into its predecessor', () => {
  let state = createWorkflowState({ ideaId: 'idea-share', input: { request: 'partage' } });
  state = applyWorkflowEvent(state, { type: 'trace', nodeId: 'a', agent: 'Critic' });
  const before = state;
  const after = applyWorkflowEvent(before, { type: 'trace', nodeId: 'b', agent: 'RedTeam' });

  assert.notEqual(after.logs, before.logs);
  assert.notEqual(after.nodeAttempts, before.nodeAttempts);
  assert.equal(before.logs.length, 1);
  assert.equal(after.logs.length, 2);
  assert.equal(before.nodeAttempts.b, undefined);
  assert.equal(after.nodeAttempts.b, 1);
});

// ---------------------------------------- R7 JSON-unsafe caller context

test('R7: a non JSON-safe run context is rejected rather than silently mangled', () => {
  assert.throws(
    () => createWorkflowState({ ideaId: 'idea-ctx', input: { request: 'x', context: { when: 1n } } }),
    /JSON-safe/i,
  );
  assert.throws(
    () => createWorkflowState({ ideaId: 'idea-ctx', input: { request: 'x', context: { cb() {} } } }),
    /JSON-safe/i,
  );
  // A plain context still passes untouched.
  const ok = createWorkflowState({
    ideaId: 'idea-ctx', input: { request: 'x', context: { market: 'EU', n: 3 } },
  });
  assert.deepEqual(ok.input.context, { market: 'EU', n: 3 });
});

// ------------------------------------------ R8 routing state divergence

test('R8: a conditional graph refuses to run without a live state provider', () => {
  const base = declareWorkflowGraph([{ id: 'a', agent: 'Critic' }, { id: 'b', agent: 'RedTeam' }]);
  const compiled = compileWorkflowGraph({
    ...base,
    edges: [
      { id: 'e0', from: GRAPH_START, to: 'a', kind: 'always' },
      { id: 'e1', from: 'a', to: 'b', kind: 'conditional', condition: 'go' },
      { id: 'e2', from: 'a', to: GRAPH_END, kind: 'always' },
      { id: 'e3', from: 'b', to: GRAPH_END, kind: 'always' },
    ],
  }, { conditions: { go: (state) => state.go === true } });

  assert.equal(compiled.hasConditionalEdges, true);
  assert.throws(() => {
    for (const _ of compiled.walk({})) { /* no state provider */ }
  }, /requires a state provider/i);
});

test('R8: an unconditional graph still walks without a state provider', () => {
  const compiled = compileWorkflowGraph(declareWorkflowGraph([{ id: 'a', agent: 'Critic' }]));
  assert.equal(compiled.hasConditionalEdges, false);
  assert.deepEqual([...compiled.walk({})].map(({ node }) => node.id), ['a']);
});
