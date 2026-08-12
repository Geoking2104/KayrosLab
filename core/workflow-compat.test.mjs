// KayrosLab -- v1 -> v2 compatibility.
//
// The v2 bump must not orphan graphs and states already persisted under v1.
// v1 payloads are accepted, promoted with validated defaults, and then held
// to the full v2 invariants. v1 semantics are preserved where they were
// stricter: a v1 graph was acyclic by construction and stays acyclic.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GRAPH_START,
  GRAPH_END,
  WORKFLOW_GRAPH_VERSION,
  SUPPORTED_GRAPH_VERSIONS,
  compileWorkflowGraph,
  upgradeWorkflowGraph,
} from './workflow-graph.mjs';

import {
  WORKFLOW_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  migrateWorkflowState,
  validateWorkflowState,
  applyWorkflowEvent,
} from './workflow-state.mjs';

// --------------------------------------------------------------- fixtures

/** A graph exactly as v1 emitted it: no maxAttempts, no permissions. */
function v1Graph() {
  return {
    version: 1,
    start: GRAPH_START,
    end: GRAPH_END,
    nodes: [
      { id: 'critic', kind: 'agent', agent: 'Critic', step: { id: 'critic', agent: 'Critic' } },
      {
        id: 'fetch',
        kind: 'tool',
        agent: null,
        step: { id: 'fetch', tool: 'search_web', toolInput: { q: 'kayros' } },
      },
    ],
    edges: [
      { id: 'e0', from: GRAPH_START, to: 'critic', kind: 'always' },
      { id: 'e1', from: 'critic', to: 'fetch', kind: 'always' },
      { id: 'e2', from: 'fetch', to: GRAPH_END, kind: 'always' },
    ],
  };
}

/** A state exactly as v1 persisted it: node holds the agent role, logs are thin. */
function v1State() {
  return {
    schemaVersion: 1,
    runId: 'run-legacy', traceId: 'trace-legacy',
    run_id: 'run-legacy', trace_id: 'trace-legacy',
    ideaId: 'idea-legacy',
    input: { request: 'Auditer', context: { market: 'EU' } },
    plan: { steps: [{ id: 's1', agent: 'Critic' }], successCriteria: [], graph: null },
    node: 'RedTeam',
    nodeAttempts: { RedTeam: 2, Critic: 1 },
    research: null, simulation: null, draft: null, review: null, gate: null,
    errors: [], artifacts: [],
    logs: [
      { ts: '2026-08-11T07:30:00.000Z', type: 'trace', node: 'RedTeam', attempt: 1, status: 'running' },
    ],
    status: 'running',
    createdAt: '2026-08-11T07:30:00.000Z',
    updatedAt: '2026-08-11T07:31:00.000Z',
  };
}

// ------------------------------------------------------- graph compat

test('the supported graph versions are advertised and include v1', () => {
  assert.ok(SUPPORTED_GRAPH_VERSIONS.includes(1));
  assert.ok(SUPPORTED_GRAPH_VERSIONS.includes(WORKFLOW_GRAPH_VERSION));
  assert.equal(WORKFLOW_GRAPH_VERSION, 2);
});

test('a v1 graph still compiles and routes', () => {
  const compiled = compileWorkflowGraph(v1Graph());
  assert.equal(compiled.definition.version, WORKFLOW_GRAPH_VERSION);
  assert.equal(compiled.next(GRAPH_START, {}).id, 'critic');
  assert.equal(compiled.next('critic', {}).id, 'fetch');
  assert.equal(compiled.next('fetch', {}), GRAPH_END);
});

test('promotion assigns validated defaults rather than blank capability', () => {
  const upgraded = upgradeWorkflowGraph(v1Graph());
  assert.equal(upgraded.version, WORKFLOW_GRAPH_VERSION);
  const critic = upgraded.nodes.find((node) => node.id === 'critic');
  const fetch = upgraded.nodes.find((node) => node.id === 'fetch');
  // v1 nodes ran exactly once; the promoted budget must say so.
  assert.equal(critic.maxAttempts, 1);
  assert.equal(fetch.maxAttempts, 1);
  // An agent node held no tool capability in v1 and gains none.
  assert.deepEqual(critic.permissions, { tools: [], writes: [] });
  // A tool node is allowlisted for exactly the tool its step names.
  assert.deepEqual(fetch.permissions, { tools: ['search_web'], writes: [] });
});

test('promotion is idempotent on a v2 graph', () => {
  const once = upgradeWorkflowGraph(v1Graph());
  const twice = upgradeWorkflowGraph(once);
  assert.deepEqual(twice, once);
});

test('a v1 graph carrying a cycle is rejected: v1 semantics were acyclic', () => {
  const cyclic = v1Graph();
  cyclic.edges = [
    { id: 'e0', from: GRAPH_START, to: 'critic', kind: 'always' },
    { id: 'e1', from: 'critic', to: 'fetch', kind: 'always' },
    { id: 'e2', from: 'fetch', to: 'critic', kind: 'conditional', condition: 'again' },
    { id: 'e3', from: 'fetch', to: GRAPH_END, kind: 'always' },
  ];
  assert.throws(
    () => compileWorkflowGraph(cyclic, { conditions: { again: () => true } }),
    /v1 graph must stay acyclic/i,
  );
});

test('an unsupported graph version is still refused', () => {
  assert.throws(() => compileWorkflowGraph({ ...v1Graph(), version: 0 }), /unsupported version/i);
  assert.throws(() => compileWorkflowGraph({ ...v1Graph(), version: 3 }), /unsupported version/i);
});

test('promotion refuses a v1 node that already carries v2 fields', () => {
  const forged = v1Graph();
  forged.nodes[0].maxAttempts = 99;
  assert.throws(() => compileWorkflowGraph(forged), /v1 node .* must not declare/i);
});

// ------------------------------------------------------- state compat

test('the supported schema versions are advertised and include v1', () => {
  assert.ok(SUPPORTED_SCHEMA_VERSIONS.includes(1));
  assert.ok(SUPPORTED_SCHEMA_VERSIONS.includes(WORKFLOW_SCHEMA_VERSION));
  assert.equal(WORKFLOW_SCHEMA_VERSION, 2);
});

test('a v1 state migrates to v2 with the role moved out of node', () => {
  const migrated = migrateWorkflowState(v1State());
  assert.equal(migrated.schemaVersion, WORKFLOW_SCHEMA_VERSION);
  assert.equal(validateWorkflowState(migrated), true);
  // v1 stored the role in `node`; it is preserved as the agent, and the node
  // id falls back to the same value because v1 knew nothing better.
  assert.equal(migrated.node, 'RedTeam');
  assert.equal(migrated.agent, 'RedTeam');
  assert.deepEqual(migrated.nodeAttempts, { RedTeam: 2, Critic: 1 });
});

test('migration backfills the correlation identifiers on legacy log entries', () => {
  const migrated = migrateWorkflowState(v1State());
  const entry = migrated.logs.at(-1);
  assert.equal(entry.runId, 'run-legacy');
  assert.equal(entry.traceId, 'trace-legacy');
  assert.equal(entry.agent, 'RedTeam');
  assert.equal(entry.node, 'RedTeam');
});

test('a migrated state accepts v2 events without further ceremony', () => {
  const migrated = migrateWorkflowState(v1State());
  const next = applyWorkflowEvent(migrated, {
    type: 'review', nodeId: 'verifier', agent: 'Verifier', status: 'OK', comments: [],
  });
  assert.deepEqual(next.review, { status: 'OK', comments: [] });
  assert.equal(next.node, 'verifier');
  assert.equal(next.agent, 'Verifier');
});

test('migration is idempotent and refuses an unsupported schema version', () => {
  const once = migrateWorkflowState(v1State());
  const twice = migrateWorkflowState(once);
  assert.deepEqual(twice, once);
  assert.throws(() => migrateWorkflowState({ ...v1State(), schemaVersion: 0 }), /unsupported schema/i);
  assert.throws(() => migrateWorkflowState({ ...v1State(), schemaVersion: 3 }), /unsupported schema/i);
});

test('validateWorkflowState still refuses an unmigrated v1 state', () => {
  // Compatibility is explicit: callers migrate, they do not get silent coercion.
  assert.throws(() => validateWorkflowState(v1State()), /schemaVersion must be 2/);
});
