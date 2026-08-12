// KayrosLab -- suspended runs must survive the request that created them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from './index.mjs';
import { collect } from './orchestrator.mjs';
import { InMemoryRunStore, FileRunStore } from './run-store.mjs';
import { createWorkflowState, applyWorkflowEvent } from './workflow-state.mjs';
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
    ideaId: 'idea-store',
    goal: 'Produire un rapport verifie',
    steps: graph.nodes.map(({ step }) => step),
    graph,
  };
}

const neverResolving = () => {
  let n = 0;
  return { open: () => ({ gateId: `g${++n}`, promise: new Promise(() => {}) }) };
};

function suspendedState() {
  let state = createWorkflowState({
    runId: 'run-1', traceId: 'trace-1', ideaId: 'idea-1', input: { request: 'x' },
  });
  return applyWorkflowEvent(state, {
    type: 'gate', gateId: 'g1', gateType: 'human_escalation', nodeId: 'escalate',
  });
}

// ------------------------------------------------------------ store API

test('a suspended snapshot round-trips through the store', async () => {
  const store = new InMemoryRunStore();
  const state = suspendedState();
  await store.save(state, { tenantId: 't1' });

  const back = await store.get('run-1', { tenantId: 't1' });
  assert.equal(back.runId, 'run-1');
  assert.equal(back.status, 'pending_review');
  assert.equal(back.gate.nodeId, 'escalate');
});

test('the store refuses a cross-tenant read rather than trusting the caller', async () => {
  const store = new InMemoryRunStore();
  await store.save(suspendedState(), { tenantId: 't1' });
  assert.equal(await store.get('run-1', { tenantId: 't2' }), null);
  assert.equal(await store.delete('run-1', { tenantId: 't2' }), false);
  assert.ok(await store.get('run-1', { tenantId: 't1' }), 'the owner still reads it');
});

test('listing stays lightweight and filters by tenant and idea', async () => {
  const store = new InMemoryRunStore();
  await store.save(suspendedState(), { tenantId: 't1' });
  const rows = await store.list({ tenantId: 't1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].runId, 'run-1');
  assert.equal(rows[0].state, undefined, 'listing carries no full state');
  assert.equal((await store.list({ tenantId: 't2' })).length, 0);
  assert.equal((await store.list({ tenantId: 't1', ideaId: 'autre' })).length, 0);
});

test('the store refuses an invalid snapshot', async () => {
  const store = new InMemoryRunStore();
  await assert.rejects(() => store.save({ schemaVersion: 2 }), /WorkflowState/);
});

test('the file store persists across instances and survives a missing file', async () => {
  const files = new Map();
  const fakeFs = {
    readFile: async (p) => {
      if (!files.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files.get(p);
    },
    writeFile: async (p, data) => { files.set(p, data); },
    rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); },
  };
  const a = new FileRunStore({ path: '/data/runs.json', fs: fakeFs });
  await a.save(suspendedState(), { tenantId: 't1' });
  // Write-then-rename: no leftover temp file.
  assert.equal(files.has('/data/runs.json.tmp'), false);

  const b = new FileRunStore({ path: '/data/runs.json', fs: fakeFs });
  const back = await b.get('run-1', { tenantId: 't1' });
  assert.equal(back.runId, 'run-1');

  const fresh = new FileRunStore({ path: '/data/absent.json', fs: fakeFs });
  assert.deepEqual(await fresh.list(), [], 'a missing file is an empty store, not a crash');
});

// ------------------------------------------------- orchestrator wiring

test('a run suspended on a gate is stored automatically', async () => {
  const engine = createEngine();
  const store = new InMemoryRunStore();
  engine.orchestrator.governance = neverResolving();
  engine.agents.Verifier.execute = async () => ({
    output: 'ko', channel: { type: 'review', status: 'KO', comments: ['incomplet'] },
  });

  const events = await collect(engine.orchestrator.run(
    referencePlan(), runOpts({ runStore: store, tenantId: 't1' }),
  ));
  const runId = events.at(-1).runId;

  const rows = await store.list({ tenantId: 't1' });
  assert.equal(rows.length, 1, 'the suspended run was persisted');
  assert.equal(rows[0].runId, runId);
  assert.equal(rows[0].gate.nodeId, 'escalate');
});

test('a run that finishes leaves nothing behind in the store', async () => {
  const engine = createEngine();
  const store = new InMemoryRunStore();
  engine.agents.Verifier.execute = async () => ({
    output: 'ok', channel: { type: 'review', status: 'OK', comments: [] },
  });
  await collect(engine.orchestrator.run(
    referencePlan(), runOpts({ runStore: store, tenantId: 't1' }),
  ));
  assert.deepEqual(await store.list({ tenantId: 't1' }), []);
});

test('the stored snapshot is enough to resume the run end to end', async () => {
  const engine = createEngine();
  const store = new InMemoryRunStore();
  engine.orchestrator.governance = neverResolving();
  engine.agents.Verifier.execute = async () => ({
    output: 'ko', channel: { type: 'review', status: 'KO', comments: ['incomplet'] },
  });
  engine.agents.Writer.execute = async () => ({
    output: 'draft', channel: { type: 'draft', content: 'v1', format: 'markdown' },
  });
  const first = await collect(engine.orchestrator.run(
    referencePlan(), runOpts({ runStore: store, tenantId: 't1' }),
  ));
  const runId = first.at(-1).runId;

  // A new engine: nothing survives in memory, only what the store holds.
  const later = createEngine();
  let ran = false;
  later.agents.HumanGate.execute = async () => { ran = true; return { output: 'escalade' }; };
  const snapshot = await store.get(runId, { tenantId: 't1' });

  const events = await collect(later.orchestrator.resume(snapshot, {
    ...runOpts({ runStore: store, tenantId: 't1' }),
    decision: { decision: 'approve', by: 'comex' },
  }));

  assert.ok(ran, 'the gated node ran after the human decision');
  assert.equal(events.at(-1).workflowState.draft.content, 'v1', 'earlier work survived');
  assert.deepEqual(await store.list({ tenantId: 't1' }), [], 'the resumed run left the store');
});

test('a vetoed resume also clears the store', async () => {
  const engine = createEngine();
  const store = new InMemoryRunStore();
  engine.orchestrator.governance = neverResolving();
  engine.agents.Verifier.execute = async () => ({
    output: 'ko', channel: { type: 'review', status: 'KO', comments: ['incomplet'] },
  });
  const first = await collect(engine.orchestrator.run(
    referencePlan(), runOpts({ runStore: store, tenantId: 't1' }),
  ));
  const snapshot = await store.get(first.at(-1).runId, { tenantId: 't1' });

  await collect(engine.orchestrator.resume(snapshot, {
    ...runOpts({ runStore: store, tenantId: 't1' }),
    decision: { decision: 'veto', reason: 'hors budget' },
  }));
  assert.deepEqual(await store.list({ tenantId: 't1' }), []);
});

test('a failing store degrades the run without changing its outcome', async () => {
  const engine = createEngine();
  const store = {
    save: async () => { throw new Error('disque plein'); },
    get: async () => null,
    delete: async () => { throw new Error('disque plein'); },
  };
  engine.agents.Verifier.execute = async () => ({
    output: 'ok', channel: { type: 'review', status: 'OK', comments: [] },
  });
  const events = await collect(engine.orchestrator.run(
    referencePlan(), runOpts({ runStore: store, tenantId: 't1' }),
  ));
  assert.ok(events.some((e) => e.type === 'soft_error' && e.phase === 'run_store'));
  assert.ok(events.some((e) => e.type === 'final'));
});
