// KayrosLab -- spec sections 5 and 6: human gates modelled in the graph,
// an append-only JSONL audit sink, and role-scoped context.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from './index.mjs';
import { collect } from './orchestrator.mjs';
import { GRAPH_START, GRAPH_END, compileWorkflowGraph } from './workflow-graph.mjs';
import { referencePipelineGraph, REFERENCE_CONDITIONS } from './workflow-presets.mjs';
import { createJsonlSink, createMemorySink } from './log-sink.mjs';
import { buildRoleContext, ROLE_CONTEXT_POLICY } from './role-context.mjs';

const QUIET = {
  governance: 'auto', positionning: false, recall: false, remember: false,
  offload: false, autoDistill: false, frameControl: false,
  worldModel: false, adaptive: false,
};

function referencePlan(overrides = {}) {
  const graph = referencePipelineGraph({ writerAttempts: 2, ...overrides });
  return {
    ideaId: 'idea-gov',
    goal: 'Produire un rapport verifie',
    steps: graph.nodes.map(({ step }) => step),
    graph,
  };
}

const runOpts = (extra = {}) => ({ ...QUIET, graphConditions: REFERENCE_CONDITIONS, ...extra });

/** Auto-approving governance stub. */
function approvingGovernance(record = []) {
  let n = 0;
  return {
    open(req) {
      n += 1;
      const gateId = `g${n}`;
      record.push({ gateId, ...req });
      return { gateId, promise: Promise.resolve({ decision: 'approve', by: 'comex@test' }) };
    },
  };
}

// ============================================================ 1. gates

test('the graph schema accepts a gate declaration on a node', () => {
  const graph = referencePipelineGraph();
  const escalate = graph.nodes.find((node) => node.id === 'escalate');
  assert.ok(escalate.gate, 'the escalation node declares a gate');
  assert.equal(escalate.gate.type, 'human_escalation');
  assert.ok(escalate.gate.requiredRole, 'a gate names the role that may resolve it');
  assert.doesNotThrow(() => compileWorkflowGraph(graph, { conditions: REFERENCE_CONDITIONS }));
});

test('a malformed gate declaration is refused at compile time', () => {
  const graph = structuredClone(referencePipelineGraph());
  graph.nodes.find((node) => node.id === 'escalate').gate = { requiredRole: 'comex' };
  assert.throws(
    () => compileWorkflowGraph(graph, { conditions: REFERENCE_CONDITIONS }),
    /gate type/i,
  );
});

test('reaching a gate node opens a governance gate before the node runs', async () => {
  const engine = createEngine();
  const opened = [];
  engine.orchestrator.governance = approvingGovernance(opened);
  let ran = false;
  engine.agents.HumanGate.execute = async () => { ran = true; return { output: 'escalade' }; };
  engine.agents.Verifier.execute = async () => ({
    output: 'ko', channel: { type: 'review', status: 'KO', comments: ['incomplet'] },
  });

  const events = await collect(engine.orchestrator.run(referencePlan(), runOpts()));
  const nodeGate = opened.find((g) => g.type === 'human_escalation');
  assert.ok(nodeGate, 'the gate node opened a governance gate');
  assert.equal(nodeGate.requiredRole, 'comex');
  assert.ok(ran, 'the node runs once the gate is approved');

  const gateEvents = events.filter((e) => e.type === 'gate' && e.gateType === 'human_escalation');
  assert.equal(gateEvents.length, 1);
  assert.ok(events.some((e) => e.type === 'gate_resolved'));
});

test('a vetoed gate node blocks the run instead of executing', async () => {
  const engine = createEngine();
  engine.orchestrator.governance = {
    open: () => ({ gateId: 'g-veto', promise: Promise.resolve({ decision: 'veto', reason: 'non' }) }),
  };
  let ran = false;
  engine.agents.HumanGate.execute = async () => { ran = true; return { output: 'x' }; };
  engine.agents.Verifier.execute = async () => ({
    output: 'ko', channel: { type: 'review', status: 'KO', comments: ['incomplet'] },
  });

  const events = await collect(engine.orchestrator.run(referencePlan(), runOpts()));
  assert.equal(ran, false, 'a vetoed node must not execute');
  const final = events.at(-1);
  assert.equal(final.type, 'final');
  assert.equal(final.status, 'blocked_veto');
});

test('a gated tool systematically opens a governance gate instead of being denied', async () => {
  const engine = createEngine();
  const opened = [];
  engine.orchestrator.governance = approvingGovernance(opened);
  let called = false;
  engine.orchestrator.tools = {
    get: (name) => ({ name, sideEffect: 'write', gate: true }),
    call: async () => { called = true; return { ok: true }; },
  };
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
  const events = await collect(engine.orchestrator.run(
    { ideaId: 'idea-tool', goal: 'Publier', steps: graph.nodes.map((n) => n.step), graph },
    runOpts({ graphConditions: {} }),
  ));

  const toolGate = opened.find((g) => g.type === 'tool_execution');
  assert.ok(toolGate, 'a gated tool opens a governance gate');
  assert.equal(toolGate.payload?.tool, 'publish_report');
  assert.ok(called, 'the tool runs only after approval');
  assert.ok(!events.some((e) => e.type === 'degraded' && e.reason === 'permission_denied'));
});

test('a gated tool is refused when no governance is wired', async () => {
  const engine = createEngine();
  engine.orchestrator.governance = null;
  let called = false;
  engine.orchestrator.tools = {
    get: (name) => ({ name, sideEffect: 'write', gate: true }),
    call: async () => { called = true; return { ok: true }; },
  };
  const graph = {
    version: 2, start: GRAPH_START, end: GRAPH_END,
    nodes: [{
      id: 'pay', kind: 'tool', agent: null,
      step: { id: 'pay', tool: 'pay_invoice', toolInput: {} },
      maxAttempts: 1, permissions: { tools: ['pay_invoice'], writes: [] }, gate: null,
    }],
    edges: [
      { id: 'e0', from: GRAPH_START, to: 'pay', kind: 'always' },
      { id: 'e1', from: 'pay', to: GRAPH_END, kind: 'always' },
    ],
  };
  const events = await collect(engine.orchestrator.run(
    { ideaId: 'idea-nogov', goal: 'Payer', steps: graph.nodes.map((n) => n.step), graph },
    runOpts({ graphConditions: {} }),
  ));
  assert.equal(called, false, 'no governance means no risky action');
  assert.ok(events.some((e) => e.type === 'degraded' && e.reason === 'permission_denied'));
});

// ======================================================= 2. JSONL sink

test('the memory sink records one JSON line per structured log entry', async () => {
  const sink = createMemorySink();
  await sink.append({ runId: 'r1', type: 'trace', node: 'writer' });
  await sink.append({ runId: 'r1', type: 'review', node: 'verifier' });
  assert.equal(sink.lines.length, 2);
  assert.deepEqual(JSON.parse(sink.lines[0]), { runId: 'r1', type: 'trace', node: 'writer' });
});

test('the jsonl sink appends to logs/<runId>.jsonl and never rewrites', async () => {
  const writes = [];
  const fakeFs = {
    mkdir: async () => {},
    appendFile: async (path, data) => { writes.push({ path, data }); },
  };
  const sink = createJsonlSink({ dir: 'logs', fs: fakeFs });
  await sink.append({ runId: 'run-42', type: 'start' });
  await sink.append({ runId: 'run-42', type: 'final' });

  assert.equal(writes.length, 2);
  assert.ok(writes[0].path.replace(/\\/g, '/').endsWith('logs/run-42.jsonl'), writes[0].path);
  assert.equal(writes[0].path, writes[1].path);
  for (const write of writes) {
    assert.ok(write.data.endsWith('\n'), 'each record is one line');
    assert.equal(write.data.trimEnd().split('\n').length, 1);
  }
});

test('a run streams its structured log entries to the sink', async () => {
  const engine = createEngine();
  engine.orchestrator.governance = approvingGovernance();
  const sink = createMemorySink();
  engine.agents.Verifier.execute = async () => ({
    output: 'ok', channel: { type: 'review', status: 'OK', comments: [] },
  });
  await collect(engine.orchestrator.run(referencePlan(), runOpts({ logSink: sink })));

  assert.ok(sink.lines.length > 0, 'the run wrote an audit trail');
  const records = sink.lines.map((line) => JSON.parse(line));
  for (const record of records) {
    assert.ok(record.runId && record.traceId, 'every record is correlated');
    assert.ok(record.type && record.node, 'every record names its type and node');
  }
  assert.ok(records.some((r) => r.type === 'review'));
  // Append-only: entries are never emitted twice.
  const keys = records.map((r) => `${r.ts}|${r.type}|${r.node}`);
  assert.equal(new Set(keys).size, keys.length, 'no duplicated record');
});

test('a failing sink degrades the run without aborting it', async () => {
  const engine = createEngine();
  engine.orchestrator.governance = approvingGovernance();
  const sink = { append: async () => { throw new Error('disque plein'); } };
  const events = await collect(engine.orchestrator.run(referencePlan(), runOpts({ logSink: sink })));
  assert.equal(events.at(-1).type, 'final');
  assert.ok(events.some((e) => e.type === 'soft_error' && e.phase === 'log_sink'));
});

// ================================================== 3. role context

test('the role policy gives each role only what it needs', () => {
  assert.ok(ROLE_CONTEXT_POLICY.Researcher);
  // The researcher must not see the draft: it would anchor the research.
  assert.equal(ROLE_CONTEXT_POLICY.Researcher.channels.includes('draft'), false);
  // The verifier judges the draft against the criteria and nothing else.
  assert.deepEqual([...ROLE_CONTEXT_POLICY.Verifier.channels].sort(), ['draft']);
  assert.equal(ROLE_CONTEXT_POLICY.Verifier.successCriteria, true);
  assert.equal(ROLE_CONTEXT_POLICY.Verifier.memoryContext, false);
});

test('buildRoleContext hides channels a role may not read', () => {
  const state = {
    research: { facts: ['f1'], sources: [] },
    simulation: { metrics: { a: 1 }, warnings: [] },
    draft: { content: 'brouillon', format: 'markdown' },
    review: { status: 'KO', comments: ['c1'] },
  };
  const shared = { state, contextBlock: 'MEMOIRE', successCriteria: ['crit'] };

  const researcher = buildRoleContext('Researcher', shared);
  assert.equal(researcher.draft, null);
  assert.equal(researcher.review, null);

  const verifier = buildRoleContext('Verifier', shared);
  assert.deepEqual(verifier.draft, state.draft);
  assert.equal(verifier.research, null);
  assert.equal(verifier.simulation, null);
  assert.deepEqual(verifier.successCriteria, ['crit']);
  assert.equal(verifier.context, '', 'the verifier gets no memory context');

  const writer = buildRoleContext('Writer', shared);
  assert.deepEqual(writer.research, state.research);
  assert.deepEqual(writer.simulation, state.simulation);
  assert.deepEqual(writer.review, state.review, 'the writer needs the rejection comments');
});

test('an unknown role falls back to the shared context only', () => {
  const state = { draft: { content: 'x', format: 'markdown' }, research: null, simulation: null, review: null };
  const ctx = buildRoleContext('Inconnu', { state, contextBlock: 'MEMOIRE', successCriteria: [] });
  assert.equal(ctx.context, 'MEMOIRE');
  assert.equal(ctx.draft, null, 'an unknown role reads no channel by default');
});

test('the orchestrator hands each node its role-scoped context only', async () => {
  const engine = createEngine();
  engine.orchestrator.governance = approvingGovernance();
  const seen = {};
  for (const role of ['Researcher', 'Verifier']) {
    engine.agents[role].execute = async (_task, ctx) => {
      seen[role] = ctx;
      return role === 'Verifier'
        ? { output: 'ok', channel: { type: 'review', status: 'OK', comments: [] } }
        : { output: 'faits', channel: { type: 'research', facts: ['f'], sources: [] } };
    };
  }
  await collect(engine.orchestrator.run(referencePlan(), runOpts()));

  assert.equal(seen.Researcher.draft, null, 'the researcher never sees the draft');
  assert.equal(seen.Verifier.research, null, 'the verifier never sees the raw research');
  assert.ok(seen.Verifier.draft, 'the verifier does see the draft');
});
