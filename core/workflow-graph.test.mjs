import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from './index.mjs';
import * as coreApi from './index.mjs';
import { collect } from './orchestrator.mjs';
import {
  GRAPH_END,
  GRAPH_START,
  compileWorkflowGraph,
  declareWorkflowGraph,
} from './workflow-graph.mjs';

test('declares and compiles plan steps into an executable edge-driven graph', () => {
  const definition = declareWorkflowGraph([
    { id: 'research', agent: 'Critic', description: 'Research risks' },
    { id: 'simulate', agent: 'RedTeam', description: 'Simulate attacks' },
    { id: 'write', agent: 'Synthesizer', description: 'Write decision' },
  ]);

  assert.deepEqual(definition.nodes.map(({ id, agent }) => ({ id, agent })), [
    { id: 'research', agent: 'Critic' },
    { id: 'simulate', agent: 'RedTeam' },
    { id: 'write', agent: 'Synthesizer' },
  ]);
  assert.deepEqual(definition.edges.map(({ from, to }) => ({ from, to })), [
    { from: GRAPH_START, to: 'research' },
    { from: 'research', to: 'simulate' },
    { from: 'simulate', to: 'write' },
    { from: 'write', to: GRAPH_END },
  ]);

  const graph = compileWorkflowGraph(definition);
  assert.throws(() => {
    graph.definition.nodes[0].step.description = 'mutated after compilation';
  }, TypeError);
  assert.equal(graph.next(GRAPH_START).id, 'research');
  assert.equal(graph.next('research').id, 'simulate');
  assert.equal(graph.next('simulate').id, 'write');
  assert.equal(graph.next('write'), GRAPH_END);
  assert.deepEqual([...graph.walk()].map(({ node, edge }) => ({
    node: node.id,
    edge: `${edge.from}->${edge.to}`,
  })), [
    { node: 'research', edge: `${GRAPH_START}->research` },
    { node: 'simulate', edge: 'research->simulate' },
    { node: 'write', edge: 'simulate->write' },
  ]);
});

test('compiler rejects duplicate nodes and ambiguous or dangling edges', () => {
  assert.throws(() => declareWorkflowGraph([null]), /step definition/i);
  assert.throws(() => compileWorkflowGraph(null), /graph definition/i);
  assert.throws(
    () => compileWorkflowGraph({ ...declareWorkflowGraph([]), version: 3 }),
    /unsupported version/i,
  );
  assert.throws(
    () => compileWorkflowGraph({ ...declareWorkflowGraph([]), version: 1 }),
    /unsupported version/i,
  );
  assert.throws(
    () => compileWorkflowGraph({ ...declareWorkflowGraph([]), start: 'custom-start' }),
    /sentinels/i,
  );
  assert.throws(
    () => compileWorkflowGraph(declareWorkflowGraph([
      { id: 'same', agent: 'Critic' },
      { id: 'same', agent: 'RedTeam' },
    ])),
    /duplicate node/i,
  );

  const valid = declareWorkflowGraph([{ id: 'only', agent: 'Critic' }]);
  assert.throws(
    () => compileWorkflowGraph({ ...valid, nodes: [null] }),
    /node definition/i,
  );
  assert.throws(
    () => compileWorkflowGraph({
      ...valid,
      edges: [...valid.edges, { id: 'other', from: GRAPH_START, to: 'only', kind: 'always' }],
    }),
    /multiple outgoing edges/i,
  );
  assert.throws(
    () => compileWorkflowGraph({
      ...valid,
      edges: valid.edges.map((edge) => edge.to === 'only' ? { ...edge, to: 'missing' } : edge),
    }),
    /unknown edge target/i,
  );
  assert.throws(
    () => compileWorkflowGraph({
      ...valid,
      nodes: [...valid.nodes, {
        id: 'orphan', kind: 'agent', agent: 'RedTeam',
        step: { id: 'orphan', agent: 'RedTeam' },
      }],
      edges: [...valid.edges, { id: 'orphan-loop', from: 'orphan', to: 'orphan', kind: 'always' }],
    }),
    /unreachable node/i,
  );
  assert.throws(
    () => compileWorkflowGraph({
      ...valid,
      nodes: valid.nodes.map((node) => ({ ...node, agent: 'RedTeam' })),
    }),
    /node metadata mismatch/i,
  );
  assert.throws(
    () => compileWorkflowGraph({
      ...valid,
      edges: valid.edges.map((edge, index) => index === 0 ? { ...edge, kind: 'mystery' } : edge),
    }),
    /edge kind/i,
  );
  assert.throws(
    () => compileWorkflowGraph({
      ...valid,
      edges: valid.edges.map((edge, index) => index === 0
        ? { ...edge, kind: 'conditional', condition: 'toString' }
        : edge),
    }),
    /missing condition resolver/i,
  );
  assert.throws(
    () => compileWorkflowGraph({ ...valid, unexpected: true }),
    /unknown graph field/i,
  );
  assert.throws(
    () => compileWorkflowGraph({
      ...valid,
      nodes: valid.nodes.map((node) => ({ ...node, unexpected: true })),
    }),
    /unknown node field/i,
  );
  assert.throws(
    () => compileWorkflowGraph({
      ...valid,
      edges: valid.edges.map((edge) => ({ ...edge, unexpected: true })),
    }),
    /unknown edge field/i,
  );
  assert.throws(
    () => declareWorkflowGraph([{ id: '   ', agent: 'Critic' }]),
    /step id/i,
  );
  assert.throws(
    () => declareWorkflowGraph([{ id: 'big', agent: 'Critic', toolInput: { value: 1n } }]),
    /JSON-safe/i,
  );
  assert.throws(
    () => declareWorkflowGraph([{ id: 'nan', agent: 'Critic', toolInput: { value: NaN } }]),
    /JSON-safe/i,
  );
  const cyclic = { id: 'cycle', agent: 'Critic' };
  cyclic.input = cyclic;
  assert.throws(() => declareWorkflowGraph([cyclic]), /JSON-safe/i);
  const deeplyNested = {};
  let cursor = deeplyNested;
  for (let depth = 0; depth < 70; depth += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.throws(
    () => declareWorkflowGraph([{ id: 'deep', agent: 'Critic', toolInput: deeplyNested }]),
    /nesting is too deep/i,
  );
});

test('declaration assigns stable node ids to legacy steps without ids', () => {
  const definition = declareWorkflowGraph([
    { agent: 'Critic', description: 'Legacy one' },
    { agent: 'RedTeam', description: 'Legacy two' },
  ]);

  assert.deepEqual(definition.nodes.map(({ id }) => id), ['step-1', 'step-2']);
  assert.deepEqual(definition.nodes.map(({ step }) => step.id), ['step-1', 'step-2']);
  assert.deepEqual([...compileWorkflowGraph(definition).walk()].map(({ node }) => node.id), [
    'step-1', 'step-2',
  ]);
});

test('node kind matches the preserved agent-first dispatch contract', () => {
  const definition = declareWorkflowGraph([
    { id: 'agent-tool', agent: 'Critic', tool: 'search_web' },
    { id: 'tool-only', tool: 'search_web', toolInput: { query: 'Kayros' } },
  ]);

  assert.deepEqual(definition.nodes.map(({ kind }) => kind), ['agent', 'tool']);
  assert.doesNotThrow(() => compileWorkflowGraph(definition));
});

test('compiler selects a declared conditional edge from shared state', () => {
  const base = declareWorkflowGraph([
    { id: 'writer', agent: 'Synthesizer' },
    { id: 'logger', agent: 'Critic' },
  ]);
  const definition = {
    ...base,
    edges: [
      { id: 'start-writer', from: GRAPH_START, to: 'writer', kind: 'always' },
      { id: 'writer-logger', from: 'writer', to: 'logger', kind: 'conditional', condition: 'mustLog' },
      { id: 'writer-end', from: 'writer', to: GRAPH_END, kind: 'always' },
      { id: 'logger-end', from: 'logger', to: GRAPH_END, kind: 'always' },
    ],
  };
  const graph = compileWorkflowGraph(definition, {
    conditions: { mustLog: (state) => state.mustLog === true },
  });

  assert.equal(graph.next('writer', { mustLog: true }).id, 'logger');
  assert.equal(graph.next('writer', { mustLog: false }), GRAPH_END);
  const invalidResolver = compileWorkflowGraph(definition, {
    conditions: { mustLog: () => 'yes' },
  });
  assert.throws(() => invalidResolver.next('writer', {}), /must return a boolean/i);

  const mutableConditions = { mustLog: () => true };
  const stableGraph = compileWorkflowGraph(definition, { conditions: mutableConditions });
  mutableConditions.mustLog = () => false;
  assert.equal(stableGraph.next('writer', {}).id, 'logger');
});

test('accessor-backed transport data cannot bypass JSON-safe validation', () => {
  let declareReads = 0;
  const toolInput = {};
  Object.defineProperty(toolInput, 'value', {
    enumerable: true,
    configurable: true,
    get() { declareReads += 1; return declareReads === 1 ? 1 : 2n; },
  });
  const declared = declareWorkflowGraph([{ id: 'probe', agent: 'Critic', toolInput }]);
  assert.doesNotThrow(() => JSON.stringify(declared));

  const base = declareWorkflowGraph([{ id: 'only', agent: 'Critic', toolInput: { value: 1 } }]);
  const input = structuredClone(base);
  let compileReads = 0;
  Object.defineProperty(input.nodes[0].step.toolInput, 'value', {
    enumerable: true,
    configurable: true,
    get() { compileReads += 1; return compileReads === 1 ? 1 : 2n; },
  });
  const compiled = compileWorkflowGraph(input);
  assert.doesNotThrow(() => JSON.stringify(compiled.definition));

  const hostile = structuredClone(base);
  Object.defineProperty(hostile.nodes[0].step.toolInput, 'value', {
    enumerable: true,
    configurable: true,
    get() { return 3n; },
  });
  assert.throws(() => compileWorkflowGraph(hostile), /JSON-safe/i);
  assert.throws(
    () => declareWorkflowGraph([{ id: 'fn', agent: 'Critic', toolInput: { cb() {} } }]),
    /JSON-safe/i,
  );
});

test('yielded workflow state is frozen and cannot tamper conditional routing', async () => {
  const engine = createEngine();
  const calls = [];
  const steps = [
    { id: 'red', agent: 'RedTeam', description: 'Attack' },
    { id: 'critic', agent: 'Critic', description: 'Critique' },
  ];
  engine.agents.RedTeam.execute = async () => { calls.push('RedTeam'); return { output: 'red' }; };
  engine.agents.Critic.execute = async () => { calls.push('Critic'); return { output: 'critic' }; };
  engine.agents.Synthesizer.synthesize = async () => ({
    output: 'synthesis', structured: { decision: 'revise' },
  });
  const base = declareWorkflowGraph(steps);
  const graph = {
    ...base,
    edges: [
      { id: 'start-red', from: GRAPH_START, to: 'red', kind: 'always' },
      { id: 'red-critic', from: 'red', to: 'critic', kind: 'conditional', condition: 'redCompleted' },
      { id: 'red-end', from: 'red', to: GRAPH_END, kind: 'always' },
      { id: 'critic-end', from: 'critic', to: GRAPH_END, kind: 'always' },
    ],
  };

  for await (const event of engine.orchestrator.run({
    ideaId: 'idea-frozen-state', goal: 'Resist routing tamper', steps, graph,
  }, {
    graphConditions: { redCompleted: (state) => state.agent === 'RedTeam' },
    governance: 'auto', positionning: false, recall: false, remember: false,
    offload: false, autoDistill: false, frameControl: false,
    worldModel: false, adaptive: false,
  })) {
    assert.ok(Object.isFrozen(event.workflowState), `event ${event.type} state must be frozen`);
    assert.ok(Object.isFrozen(event.workflowState.nodeAttempts));
    assert.throws(() => { event.workflowState.node = 'attacker'; }, TypeError);
    assert.throws(() => { event.workflowState.nodeAttempts.forged = 99; }, TypeError);
  }
  assert.deepEqual(calls, ['RedTeam', 'Critic']);
});

test('compiler rejects oversized graph definitions before recursive validation', () => {
  assert.throws(
    () => declareWorkflowGraph(Array.from({ length: 257 }, (_, index) => ({
      id: `step-${index}`,
      agent: 'Critic',
    }))),
    /too many nodes/i,
  );
  const valid = declareWorkflowGraph([{ id: 'only', agent: 'Critic' }]);
  assert.throws(
    () => compileWorkflowGraph({
      ...valid,
      edges: Array.from({ length: 1025 }, (_, index) => ({
        id: `edge-${index}`,
        from: GRAPH_START,
        to: 'only',
        kind: 'always',
      })),
    }),
    /too many edges/i,
  );
});

test('Orchestrator executes plan nodes through the compiled graph edges', async () => {
  const engine = createEngine();
  const steps = [
    { id: 'critic', agent: 'Critic', description: 'Critique' },
    { id: 'red', agent: 'RedTeam', description: 'Attack' },
  ];
  engine.agents.Critic.execute = async () => ({ output: 'critic' });
  engine.agents.RedTeam.execute = async () => ({ output: 'red' });
  engine.agents.Synthesizer.synthesize = async () => ({
    output: 'synthesis', structured: { decision: 'revise' },
  });

  const events = await collect(engine.orchestrator.run({
    ideaId: 'idea-compiled-graph', goal: 'Follow graph edges', steps,
    graph: declareWorkflowGraph([steps[1], steps[0]]),
  }, {
    governance: 'auto', positionning: false, recall: false, remember: false,
    offload: false, autoDistill: false, frameControl: false,
    worldModel: false, adaptive: false,
  }));

  assert.deepEqual(
    events.filter(({ type }) => type === 'trace').map(({ agent }) => agent),
    ['RedTeam', 'Critic'],
  );
  assert.deepEqual(events[0].graph.edges.map(({ from, to }) => `${from}->${to}`), [
    `${GRAPH_START}->red`, 'red->critic', `critic->${GRAPH_END}`,
  ]);
  assert.deepEqual(events[0].workflowState.plan.graph, events[0].graph);
  assert.throws(() => {
    events[0].workflowState.plan.graph.nodes[0].step.agent = 'mutated';
  }, TypeError);
  assert.throws(() => {
    events.at(-1).workflowState.plan.graph.edges[0].to = 'mutated';
  }, TypeError);
  assert.deepEqual(
    events[0].workflowState.plan.steps.map(({ agent }) => agent),
    ['RedTeam', 'Critic'],
  );
});

test('Orchestrator resolves conditional edges against evolving WorkflowState', async () => {
  const engine = createEngine();
  const calls = [];
  const steps = [
    { id: 'red', agent: 'RedTeam', description: 'Attack' },
    { id: 'critic', agent: 'Critic', description: 'Critique' },
  ];
  engine.agents.RedTeam.execute = async () => { calls.push('RedTeam'); return { output: 'red' }; };
  engine.agents.Critic.execute = async () => { calls.push('Critic'); return { output: 'critic' }; };
  engine.agents.Synthesizer.synthesize = async () => ({
    output: 'synthesis', structured: { decision: 'revise' },
  });
  const base = declareWorkflowGraph(steps);
  const graph = {
    ...base,
    edges: [
      { id: 'start-red', from: GRAPH_START, to: 'red', kind: 'always' },
      { id: 'red-critic', from: 'red', to: 'critic', kind: 'conditional', condition: 'redCompleted' },
      { id: 'red-end', from: 'red', to: GRAPH_END, kind: 'always' },
      { id: 'critic-end', from: 'critic', to: GRAPH_END, kind: 'always' },
    ],
  };

  await collect(engine.orchestrator.run({
    ideaId: 'idea-conditional-graph', goal: 'Route from state', steps, graph,
  }, {
    graphConditions: { redCompleted: (state) => state.agent === 'RedTeam' },
    governance: 'auto', positionning: false, recall: false, remember: false,
    offload: false, autoDistill: false, frameControl: false,
    worldModel: false, adaptive: false,
  }));

  assert.deepEqual(calls, ['RedTeam', 'Critic']);
});

test('Orchestrator.plan publishes the declared graph through the core API', async () => {
  assert.equal(coreApi.declareWorkflowGraph, declareWorkflowGraph);
  assert.equal(coreApi.compileWorkflowGraph, compileWorkflowGraph);

  const engine = createEngine();
  const plan = await engine.orchestrator.plan('Publish topology', {
    ideaId: 'idea-declared-graph', llmPlan: false,
  });

  assert.equal(plan.graph.version, 2);
  assert.deepEqual(
    plan.graph.nodes.map(({ id }) => id),
    plan.steps.map(({ id }) => id),
  );
  assert.equal(plan.graph.edges[0].from, GRAPH_START);
  assert.equal(plan.graph.edges.at(-1).to, GRAPH_END);
});

test('Orchestrator halts the compiled graph without emitting a contradictory final event', async () => {
  const engine = createEngine();
  const events = await collect(engine.orchestrator.run({
    ideaId: 'idea-max-graph', goal: 'Stop before executing',
    steps: [{ id: 'blocked', agent: 'Critic', description: 'Must not execute' }],
  }, {
    maxSteps: 0, governance: 'auto', positionning: false, recall: false,
    remember: false, offload: false, autoDistill: false, frameControl: false,
    worldModel: false, adaptive: false,
  }));

  assert.deepEqual(events.map(({ type }) => type), ['start', 'halt']);
  assert.equal(events.at(-1).workflowState.status, 'failed');
});
