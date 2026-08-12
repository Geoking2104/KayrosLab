// KayrosLab -- Graph Engineering v2: bounded cycles, retry budgets,
// enforced permissions, state channels, node/agent separation.
// Blockers B1..B5 of the Graph Engineering review.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GRAPH_START,
  GRAPH_END,
  WORKFLOW_GRAPH_VERSION,
  declareWorkflowGraph,
  compileWorkflowGraph,
} from './workflow-graph.mjs';

import {
  WORKFLOW_SCHEMA_VERSION,
  WRITABLE_CHANNELS,
  createWorkflowState,
  applyWorkflowEvent,
  freezeWorkflowState,
  validateWorkflowState,
} from './workflow-state.mjs';

import {
  assertToolAllowed,
  assertChannelWritable,
  isToolAllowed,
  isChannelWritable,
} from './workflow-permissions.mjs';

// ---------------------------------------------------------------- helpers

function node(id, agent, extra = {}) {
  return {
    id,
    kind: 'agent',
    agent,
    step: { id, agent },
    maxAttempts: 1,
    permissions: { tools: [], writes: [] },
    ...extra,
  };
}

function graphOf(nodes, edges) {
  return {
    version: WORKFLOW_GRAPH_VERSION,
    start: GRAPH_START,
    end: GRAPH_END,
    nodes,
    edges,
  };
}

/** The reference topology from the Graph Engineering spec section 4. */
function referenceGraph({ writerAttempts = 3 } = {}) {
  return graphOf(
    [
      node('writer', 'Writer', {
        maxAttempts: writerAttempts,
        permissions: { tools: [], writes: ['draft'] },
      }),
      node('verifier', 'Verifier', {
        maxAttempts: writerAttempts + 1,
        permissions: { tools: [], writes: ['review'] },
      }),
      node('escalate', 'HumanGate'),
      node('logger', 'Logger', { permissions: { tools: [], writes: ['artifacts'] } }),
    ],
    [
      { id: 'e-start', from: GRAPH_START, to: 'writer', kind: 'always' },
      { id: 'e-w-v', from: 'writer', to: 'verifier', kind: 'always' },
      { id: 'e-v-ok', from: 'verifier', to: 'logger', kind: 'conditional', condition: 'reviewOk' },
      { id: 'e-v-ko', from: 'verifier', to: 'writer', kind: 'conditional', condition: 'reviewKo' },
      { id: 'e-v-esc', from: 'verifier', to: 'escalate', kind: 'always' },
      { id: 'e-log-end', from: 'logger', to: GRAPH_END, kind: 'always' },
      { id: 'e-esc-end', from: 'escalate', to: GRAPH_END, kind: 'always' },
    ],
  );
}

const referenceConditions = {
  reviewOk: (state) => state.review?.status === 'OK',
  reviewKo: (state) => state.review?.status === 'KO',
};

// ------------------------------------------------------- B1 bounded cycles

test('B1: a revision loop compiles when every cycle node has a finite attempt budget', () => {
  const compiled = compileWorkflowGraph(referenceGraph(), { conditions: referenceConditions });
  assert.equal(compiled.definition.version, WORKFLOW_GRAPH_VERSION);
  // KO routes back to writer: the back edge is legal.
  const back = compiled.next('verifier', { review: { status: 'KO' }, nodeAttempts: {} });
  assert.equal(back.id, 'writer');
  // OK routes forward to the logger.
  const forward = compiled.next('verifier', { review: { status: 'OK' }, nodeAttempts: {} });
  assert.equal(forward.id, 'logger');
});

test('B1: an unbounded cycle is still rejected', () => {
  const g = graphOf(
    [node('a', 'A', { maxAttempts: null }), node('b', 'B', { maxAttempts: null })],
    [
      { id: 'e0', from: GRAPH_START, to: 'a', kind: 'always' },
      { id: 'e1', from: 'a', to: 'b', kind: 'always' },
      { id: 'e2', from: 'b', to: 'a', kind: 'conditional', condition: 'loop' },
      { id: 'e3', from: 'b', to: GRAPH_END, kind: 'always' },
    ],
  );
  assert.throws(
    () => compileWorkflowGraph(g, { conditions: { loop: () => true } }),
    /unbounded cycle/i,
  );
});

test('B1: a node that cannot reach the end is rejected as a trap', () => {
  const g = graphOf(
    [node('a', 'A'), node('trap', 'T', { maxAttempts: 2 })],
    [
      { id: 'e0', from: GRAPH_START, to: 'a', kind: 'always' },
      { id: 'e1', from: 'a', to: 'trap', kind: 'conditional', condition: 'goTrap' },
      { id: 'e2', from: 'a', to: GRAPH_END, kind: 'always' },
      { id: 'e3', from: 'trap', to: 'trap', kind: 'always' },
    ],
  );
  assert.throws(
    () => compileWorkflowGraph(g, { conditions: { goTrap: () => true } }),
    /cannot reach the end/i,
  );
});

// ------------------------------------------------------ B2 retry budgets

test('B2: maxAttempts must be a positive integer when declared', () => {
  const bad = graphOf(
    [node('a', 'A', { maxAttempts: 0 })],
    [
      { id: 'e0', from: GRAPH_START, to: 'a', kind: 'always' },
      { id: 'e1', from: 'a', to: GRAPH_END, kind: 'always' },
    ],
  );
  assert.throws(() => compileWorkflowGraph(bad), /maxAttempts/i);
});

test('B2: an exhausted node is removed from edge selection and the run escalates', () => {
  const compiled = compileWorkflowGraph(referenceGraph({ writerAttempts: 2 }), {
    conditions: referenceConditions,
  });
  // Writer still has budget: KO loops back.
  const first = compiled.next('verifier', {
    review: { status: 'KO' },
    nodeAttempts: { writer: 1 },
  });
  assert.equal(first.id, 'writer');
  // Writer budget spent: the KO edge is filtered out, the always edge escalates.
  const escalated = compiled.next('verifier', {
    review: { status: 'KO' },
    nodeAttempts: { writer: 2 },
  });
  assert.equal(escalated.id, 'escalate');
});

test('B2: exhausting every outgoing edge without escalation is a hard error', () => {
  const g = graphOf(
    [node('a', 'A'), node('b', 'B', { maxAttempts: 1 })],
    [
      { id: 'e0', from: GRAPH_START, to: 'a', kind: 'always' },
      { id: 'e1', from: 'a', to: 'b', kind: 'always' },
      { id: 'e2', from: 'b', to: GRAPH_END, kind: 'always' },
    ],
  );
  const compiled = compileWorkflowGraph(g);
  assert.throws(
    () => compiled.next('a', { nodeAttempts: { b: 1 } }),
    /attempts exhausted/i,
  );
});

test('B2: walk enforces a step budget independent of the node count', () => {
  const compiled = compileWorkflowGraph(referenceGraph({ writerAttempts: 50 }), {
    conditions: referenceConditions,
  });
  const state = { review: { status: 'KO' }, nodeAttempts: {} };
  assert.throws(() => {
    for (const _ of compiled.walk({ state: () => state, maxSteps: 5 })) { /* spin */ }
  }, /maxSteps/i);
});

// ------------------------------------------------------- B4 permissions

test('B4: a node may only call tools on its allowlist', () => {
  const reader = node('r', 'Researcher', { permissions: { tools: ['search_web'], writes: [] } });
  const readTool = { name: 'search_web', sideEffect: 'read', gate: false };
  const otherTool = { name: 'send_email', sideEffect: 'write', gate: true };

  assert.equal(isToolAllowed(reader, readTool), true);
  assert.doesNotThrow(() => assertToolAllowed(reader, readTool));

  assert.equal(isToolAllowed(reader, otherTool), false);
  assert.throws(() => assertToolAllowed(reader, otherTool), /not permitted/i);
});

test('B4: a node with no declared permissions cannot call any tool', () => {
  const planner = node('p', 'Planner');
  assert.throws(
    () => assertToolAllowed(planner, { name: 'search_web', sideEffect: 'read' }),
    /not permitted/i,
  );
});

test('B4: the wildcard allowlist never covers write or gated tools', () => {
  const wide = node('w', 'Writer', { permissions: { tools: '*', writes: ['draft'] } });
  assert.doesNotThrow(() => assertToolAllowed(wide, { name: 'search_web', sideEffect: 'read' }));
  assert.throws(
    () => assertToolAllowed(wide, { name: 'publish', sideEffect: 'write' }),
    /must be explicitly allowlisted/i,
  );
  assert.throws(
    () => assertToolAllowed(wide, { name: 'pay', sideEffect: 'read', gate: true }),
    /human gate/i,
  );
});

test('B4: a gated tool requires an explicit human gate even when allowlisted', () => {
  const payer = node('x', 'Writer', { permissions: { tools: ['pay'], writes: [] } });
  const gated = { name: 'pay', sideEffect: 'write', gate: true };
  assert.throws(() => assertToolAllowed(payer, gated), /human gate/i);
  assert.doesNotThrow(() => assertToolAllowed(payer, gated, { gateApproved: true }));
});

test('B4: the verifier can annotate review but cannot write the draft', () => {
  const verifier = node('v', 'Verifier', { permissions: { tools: [], writes: ['review'] } });
  assert.equal(isChannelWritable(verifier, 'review'), true);
  assert.equal(isChannelWritable(verifier, 'draft'), false);
  assert.doesNotThrow(() => assertChannelWritable(verifier, 'review'));
  assert.throws(() => assertChannelWritable(verifier, 'draft'), /cannot write/i);
});

test('B4: an unknown state channel is rejected outright', () => {
  const any = node('a', 'A', { permissions: { tools: [], writes: ['nope'] } });
  assert.throws(() => assertChannelWritable(any, 'nope'), /unknown channel/i);
  assert.ok(WRITABLE_CHANNELS.includes('review'));
  assert.ok(WRITABLE_CHANNELS.includes('draft'));
});

test('B4: the compiler rejects a node declaring an unknown write channel', () => {
  const g = graphOf(
    [node('a', 'A', { permissions: { tools: [], writes: ['forged'] } })],
    [
      { id: 'e0', from: GRAPH_START, to: 'a', kind: 'always' },
      { id: 'e1', from: 'a', to: GRAPH_END, kind: 'always' },
    ],
  );
  assert.throws(() => compileWorkflowGraph(g), /unknown channel/i);
});

// ---------------------------------------------------- B3 state channels

test('B3: research, simulation, draft and review events populate the state', () => {
  let state = createWorkflowState({ ideaId: 'idea-channels', input: { request: 'go' } });
  assert.equal(state.schemaVersion, WORKFLOW_SCHEMA_VERSION);

  state = applyWorkflowEvent(state, {
    type: 'research', nodeId: 'researcher', agent: 'Researcher',
    facts: ['3CL applies'], sources: ['ademe.fr'],
  });
  assert.deepEqual(state.research, { facts: ['3CL applies'], sources: ['ademe.fr'] });

  state = applyWorkflowEvent(state, {
    type: 'simulation', nodeId: 'simulator', agent: 'Simulator',
    metrics: { dpe: 142 }, warnings: ['surface estimee'],
  });
  assert.deepEqual(state.simulation, { metrics: { dpe: 142 }, warnings: ['surface estimee'] });

  state = applyWorkflowEvent(state, {
    type: 'draft', nodeId: 'writer', agent: 'Writer',
    content: '# Rapport', format: 'markdown',
  });
  assert.deepEqual(state.draft, { content: '# Rapport', format: 'markdown' });

  state = applyWorkflowEvent(state, {
    type: 'review', nodeId: 'verifier', agent: 'Verifier',
    status: 'KO', comments: ['metrique manquante'],
  });
  assert.deepEqual(state.review, { status: 'KO', comments: ['metrique manquante'] });

  assert.equal(validateWorkflowState(state), true);
});

test('B3: a review status outside OK/KO is rejected', () => {
  const state = createWorkflowState({ ideaId: 'idea-review', input: { request: 'go' } });
  assert.throws(
    () => applyWorkflowEvent(state, { type: 'review', nodeId: 'v', status: 'MAYBE' }),
    /review status/i,
  );
});

test('B3: a draft format outside markdown/json is rejected', () => {
  const state = createWorkflowState({ ideaId: 'idea-draft', input: { request: 'go' } });
  assert.throws(
    () => applyWorkflowEvent(state, { type: 'draft', nodeId: 'w', content: 'x', format: 'pdf' }),
    /draft format/i,
  );
});

test('B3: the review channel drives conditional routing end to end', () => {
  const compiled = compileWorkflowGraph(referenceGraph(), { conditions: referenceConditions });
  let state = createWorkflowState({ ideaId: 'idea-route', input: { request: 'go' } });
  state = applyWorkflowEvent(state, {
    type: 'review', nodeId: 'verifier', agent: 'Verifier', status: 'OK', comments: [],
  });
  assert.equal(compiled.next('verifier', state).id, 'logger');
});

// --------------------------------------------- B5 node / agent separation

test('B5: state tracks the graph node id and the agent role separately', () => {
  let state = createWorkflowState({ ideaId: 'idea-split', input: { request: 'go' } });
  state = applyWorkflowEvent(state, { type: 'trace', nodeId: 'writer', agent: 'Writer' });
  assert.equal(state.node, 'writer');
  assert.equal(state.agent, 'Writer');
  assert.equal(state.nodeAttempts.writer, 1);
  assert.equal(state.nodeAttempts.Writer, undefined);
});

test('B5: two nodes sharing an agent keep independent attempt budgets', () => {
  let state = createWorkflowState({ ideaId: 'idea-budgets', input: { request: 'go' } });
  state = applyWorkflowEvent(state, { type: 'trace', nodeId: 'writer-a', agent: 'Writer' });
  state = applyWorkflowEvent(state, { type: 'trace', nodeId: 'writer-a', agent: 'Writer' });
  state = applyWorkflowEvent(state, { type: 'trace', nodeId: 'writer-b', agent: 'Writer' });
  assert.equal(state.nodeAttempts['writer-a'], 2);
  assert.equal(state.nodeAttempts['writer-b'], 1);
});

test('B5: structured log entries carry the node id, the agent and the correlation ids', () => {
  let state = createWorkflowState({ ideaId: 'idea-logs', input: { request: 'go' } });
  state = applyWorkflowEvent(state, { type: 'trace', nodeId: 'writer', agent: 'Writer' });
  const entry = state.logs.at(-1);
  assert.equal(entry.node, 'writer');
  assert.equal(entry.agent, 'Writer');
  assert.equal(entry.runId, state.runId);
  assert.equal(entry.traceId, state.traceId);
});

// ------------------------------------------------ regressions kept green

test('regression: declared linear graphs still compile and stay frozen', () => {
  const declared = declareWorkflowGraph([
    { id: 'one', agent: 'Critic', description: 'a' },
    { id: 'two', agent: 'Synthesizer', description: 'b' },
  ]);
  assert.equal(declared.version, WORKFLOW_GRAPH_VERSION);
  assert.ok(Object.isFrozen(declared));
  const compiled = compileWorkflowGraph(declared);
  assert.equal(compiled.next(GRAPH_START, {}).id, 'one');
  assert.equal(compiled.next('one', {}).id, 'two');
  assert.equal(compiled.next('two', {}), GRAPH_END);
});

test('regression: accessor-backed transport data still cannot bypass JSON-safe validation', () => {
  const base = declareWorkflowGraph([{ id: 'only', agent: 'Critic', toolInput: { value: 1 } }]);
  const hostile = structuredClone(base);
  Object.defineProperty(hostile.nodes[0].step.toolInput, 'value', {
    enumerable: true, configurable: true, get() { return 3n; },
  });
  assert.throws(() => compileWorkflowGraph(hostile), /JSON-safe/i);
});

test('regression: frozen snapshots still resist routing tamper', () => {
  const live = createWorkflowState({ ideaId: 'idea-frozen', input: { request: 'go' } });
  const snapshot = freezeWorkflowState(live);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.nodeAttempts));
  assert.throws(() => { snapshot.node = 'attacker'; }, TypeError);
});
