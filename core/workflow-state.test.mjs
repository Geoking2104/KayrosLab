import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from './index.mjs';
import * as coreApi from './index.mjs';
import { collect } from './orchestrator.mjs';
import { runP1Hooks } from './run-hooks-p1.mjs';
import {
  BisociateurAgent, CriticAgent, DevilsAdvocateAgent, PlannerAgent,
  RedTeamAgent, SynthesizerAgent,
} from './agents/index.mjs';
import {
  applyWorkflowEvent,
  createWorkflowState,
  freezeWorkflowState,
  validateWorkflowState,
} from './workflow-state.mjs';

test('freezeWorkflowState yields a detached deep-frozen snapshot', () => {
  const live = createWorkflowState({
    ideaId: 'idea-freeze',
    input: { request: 'Snapshot', context: { market: 'EU' } },
    plan: { steps: [{ id: 's1', agent: 'Critic' }], successCriteria: [] },
  });
  const snapshot = freezeWorkflowState(live);

  assert.notEqual(snapshot, live);
  assert.equal(validateWorkflowState(snapshot), true);
  assert.deepEqual({ ...snapshot, plan: undefined }, { ...live, plan: undefined });
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.input.context));
  assert.ok(Object.isFrozen(snapshot.nodeAttempts));
  assert.ok(Object.isFrozen(snapshot.plan.steps[0]));
  assert.throws(() => { snapshot.node = 'attacker'; }, TypeError);
  // Mutating the snapshot must never leak back into the live state.
  live.node = 'still-live';
  assert.equal(snapshot.node, '__start__');
});

test('createWorkflowState builds a valid canonical state with correlation identifiers', () => {
  const state = createWorkflowState({
    ideaId: 'idea-1',
    input: { request: 'Évaluer une nouvelle offre', context: { market: 'EU' } },
    plan: {
      steps: [{ id: 's1', agent: 'Critic', description: 'Vérifier les hypothèses' }],
      successCriteria: ['Décision traçable'],
    },
  }, {
    idFactory: (kind) => `${kind}-fixed`,
    now: () => '2026-08-11T07:30:00.000Z',
  });

  assert.equal(state.schemaVersion, 2);
  assert.equal(state.runId, 'run-fixed');
  assert.equal(state.traceId, 'trace-fixed');
  assert.equal(state.run_id, 'run-fixed');
  assert.equal(state.trace_id, 'trace-fixed');
  assert.equal(state.ideaId, 'idea-1');
  assert.deepEqual(state.input, {
    request: 'Évaluer une nouvelle offre',
    context: { market: 'EU' },
  });
  assert.equal(state.plan.steps[0].agent, 'Critic');
  assert.deepEqual(state.plan.successCriteria, ['Décision traçable']);
  assert.equal(state.node, '__start__');
  assert.equal(state.agent, null);
  assert.equal(state.status, 'created');
  assert.deepEqual(state.nodeAttempts, {});
  assert.deepEqual(state.errors, []);
  assert.deepEqual(state.artifacts, []);
  assert.deepEqual(state.logs, []);
  assert.equal(state.createdAt, '2026-08-11T07:30:00.000Z');
  assert.equal(state.updatedAt, state.createdAt);
  assert.equal(validateWorkflowState(state), true);
});

test('workflow state API is exposed from the core entry point', () => {
  assert.equal(coreApi.createWorkflowState, createWorkflowState);
  assert.equal(coreApi.validateWorkflowState, validateWorkflowState);
  assert.equal(coreApi.applyWorkflowEvent, applyWorkflowEvent);
});

test('validateWorkflowState rejects a state without correlation identifiers', () => {
  assert.throws(
    () => validateWorkflowState({ schemaVersion: 2, traceId: 'trace-1' }),
    /runId/,
  );
  assert.throws(
    () => validateWorkflowState({ schemaVersion: 1, runId: 'r', traceId: 't' }),
    /schemaVersion must be 2/,
  );
});

test('validateWorkflowState rejects malformed attempts and structured logs', () => {
  const valid = createWorkflowState({
    runId: 'run-validation', traceId: 'trace-validation',
    input: { request: 'Valider un checkpoint' },
  });

  assert.throws(
    () => validateWorkflowState({ ...valid, nodeAttempts: { Critic: -1 } }),
    /nodeAttempts/,
  );
  assert.throws(
    () => validateWorkflowState({ ...valid, logs: ['not-structured'] }),
    /logs/,
  );
  for (const malformed of [
    {},
    { ts: '2026-08-11T00:00:00.000Z', type: 1, node: 'Planner', attempt: 1, status: 'running' },
    { ts: 'invalid', type: 'trace', node: 'Planner', attempt: -1, status: 'running' },
    { ts: '2026-08-11T00:00:00.000Z', type: 'trace', node: '', attempt: 1, status: 'running' },
  ]) {
    assert.throws(() => validateWorkflowState({ ...valid, logs: [malformed] }), /logs/);
  }
  assert.throws(
    () => validateWorkflowState({ ...valid, logs: Array.from({ length: 501 }, () => ({})) }),
    /logs/,
  );
});

test('applyWorkflowEvent advances node attempts without mutating prior state', () => {
  const initial = createWorkflowState({
    runId: 'run-1', traceId: 'trace-1', ideaId: 'idea-1',
    input: { request: 'Tester' },
  }, { now: () => '2026-08-11T07:30:00.000Z' });

  const running = applyWorkflowEvent(initial, { type: 'start' }, {
    now: () => '2026-08-11T07:31:00.000Z',
  });
  const first = applyWorkflowEvent(running, { type: 'trace', agent: 'Critic' }, {
    now: () => '2026-08-11T07:32:00.000Z',
  });
  const second = applyWorkflowEvent(first, { type: 'trace', agent: 'Critic' }, {
    now: () => '2026-08-11T07:33:00.000Z',
  });

  assert.equal(initial.status, 'created');
  assert.deepEqual(initial.nodeAttempts, {});
  assert.equal(running.status, 'running');
  assert.equal(first.node, 'Critic');
  assert.equal(first.nodeAttempts.Critic, 1);
  assert.equal(second.nodeAttempts.Critic, 2);
  assert.deepEqual(second.logs.map((entry) => entry.type), ['start', 'trace', 'trace']);
  assert.equal(second.logs.at(-1).node, 'Critic');
  assert.equal(second.logs.at(-1).attempt, 2);
  assert.equal(second.updatedAt, '2026-08-11T07:33:00.000Z');
  assert.equal(validateWorkflowState(second), true);
});

test('applyWorkflowEvent records gates, failures and final status', () => {
  const initial = createWorkflowState({
    runId: 'run-2', traceId: 'trace-2', ideaId: 'idea-2',
    input: { request: 'Décider' },
  });
  const gated = applyWorkflowEvent(initial, {
    type: 'gate', gateId: 'gate-1', gateType: 'output_censor', status: 'pending_review',
  });
  assert.equal(gated.status, 'pending_review');
  assert.deepEqual(gated.gate, {
    id: 'gate-1', type: 'output_censor', status: 'pending_review',
  });

  const failed = applyWorkflowEvent(gated, {
    type: 'error', error: 'provider timeout', node: 'Writer', code: 'TIMEOUT',
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errors[0].message, 'provider timeout');
  assert.equal(failed.errors[0].node, 'Writer');

  const completed = applyWorkflowEvent(gated, { type: 'final', status: 'validated_human' });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.node, 'end');
});

test('applyWorkflowEvent preserves blocked, revision, cancellation and failure terminals', () => {
  const initial = createWorkflowState({
    runId: 'run-terminals', traceId: 'trace-terminals',
    input: { request: 'Préserver les statuts terminaux' },
  });

  const blocked = applyWorkflowEvent(initial, { type: 'final', status: 'blocked_veto' });
  assert.equal(blocked.status, 'blocked');
  const revision = applyWorkflowEvent(initial, { type: 'final', status: 'revise' });
  assert.equal(revision.status, 'revision_required');
  const cancelled = applyWorkflowEvent(initial, { type: 'cancelled' });
  assert.equal(cancelled.status, 'cancelled');
  const halted = applyWorkflowEvent(initial, { type: 'halt', reason: 'maxSteps' });
  assert.equal(halted.status, 'failed');
  const failed = applyWorkflowEvent(initial, { type: 'error', error: 'provider timeout' });
  const finalAfterFailure = applyWorkflowEvent(failed, { type: 'final', status: 'auto' });
  assert.equal(finalAfterFailure.status, 'failed');
});

test('applyWorkflowEvent does not reopen terminal workflow states', () => {
  const initial = createWorkflowState({
    runId: 'run-immutable-terminals', traceId: 'trace-immutable-terminals',
    input: { request: 'Ne jamais rouvrir un état terminal' },
  });
  const terminals = [
    applyWorkflowEvent(initial, { type: 'final', status: 'auto' }),
    applyWorkflowEvent(initial, { type: 'final', status: 'blocked_veto' }),
    applyWorkflowEvent(initial, { type: 'final', status: 'revise' }),
    applyWorkflowEvent(initial, { type: 'cancelled' }),
    applyWorkflowEvent(initial, { type: 'error', error: 'terminal failure' }),
  ];

  for (const terminal of terminals) {
    const afterStart = applyWorkflowEvent(terminal, { type: 'start' });
    const afterFinal = applyWorkflowEvent(terminal, { type: 'final', status: 'auto' });
    assert.equal(afterStart.status, terminal.status);
    assert.equal(afterFinal.status, terminal.status);
  }
});

test('applyWorkflowEvent bounds embedded structured logs', () => {
  let state = createWorkflowState({
    runId: 'run-log-limit', traceId: 'trace-log-limit', ideaId: 'idea-log-limit',
    input: { request: 'Borner les logs' },
  });
  for (let attempt = 0; attempt < 505; attempt += 1) {
    state = applyWorkflowEvent(state, { type: 'trace', agent: 'Critic' });
  }
  assert.equal(state.logs.length, 500);
  assert.equal(state.logs[0].attempt, 6);
  assert.equal(state.logs.at(-1).attempt, 505);
});

test('createWorkflowState bounds preloaded structured logs', () => {
  const logs = Array.from({ length: 505 }, (_, index) => ({
    ts: new Date(index).toISOString(), type: 'trace', node: 'restore',
    agent: null, attempt: null, status: 'created', index,
    runId: 'run-preloaded-logs', traceId: 'trace-preloaded-logs',
  }));
  const state = createWorkflowState({
    runId: 'run-preloaded-logs', traceId: 'trace-preloaded-logs',
    input: { request: 'Restaurer un checkpoint' },
    logs,
  });

  assert.equal(state.logs.length, 500);
  assert.equal(state.logs[0].index, 5);
  assert.equal(state.logs.at(-1).index, 504);
});

test('Orchestrator emits one correlated WorkflowState across the complete run', async () => {
  const engine = createEngine();
  const plan = await engine.orchestrator.plan('Auditer une option', {
    ideaId: 'idea-correlated',
    llmPlan: false,
  });

  assert.match(plan.runId, /^run_/);
  assert.match(plan.traceId, /^trace_/);

  const events = await collect(engine.orchestrator.run(plan, {
    governance: 'auto',
    positionning: false,
    recall: false,
    remember: false,
    offload: false,
    autoDistill: false,
    frameControl: false,
    worldModel: false,
    adaptive: false,
  }));

  assert.ok(events.length > 2);
  assert.ok(events.every((event) => event.runId === plan.runId));
  assert.ok(events.every((event) => event.traceId === plan.traceId));
  assert.ok(events.every((event) => event.run_id === plan.runId));
  assert.ok(events.every((event) => event.trace_id === plan.traceId));
  assert.ok(events.every((event) => validateWorkflowState(event.workflowState)));
  assert.equal(events.at(-1).workflowState.status, 'completed');
  assert.equal(events.at(-1).workflowState.node, 'end');
  // v2: attempts are keyed by graph node id, never by agent role, so two
  // nodes sharing an agent keep independent budgets.
  assert.equal(events.at(-1).workflowState.nodeAttempts.s1, 1);
  assert.equal(events.at(-1).workflowState.nodeAttempts.s5, 1);
  assert.equal(events.at(-1).workflowState.nodeAttempts.Critic, undefined);
  assert.equal(events.at(-1).workflowState.nodeAttempts.Synthesizer, undefined);
});

test('Orchestrator passes the same correlation identifiers to every agent call', async () => {
  const engine = createEngine();
  const received = {};
  engine.agents.Planner.createPlan = async (_goal, context) => {
    received.Planner = context;
    return {
      generatedBy: 'test',
      steps: [
        { id: 's1', agent: 'Critic', description: 'Critiquer' },
        { id: 's2', agent: 'Synthesizer', description: 'Synthétiser' },
      ],
    };
  };
  engine.agents.Critic.execute = async (_input, context) => {
    received.Critic = context;
    return { output: 'critique' };
  };
  engine.agents.Synthesizer.synthesize = async (_outputs, context) => {
    received.Synthesizer = context;
    return { output: 'synthèse', structured: { recommendation: 'revise' } };
  };

  const plan = await engine.orchestrator.plan('Corréler les agents', {
    ideaId: 'idea-agent-correlation',
  });
  await collect(engine.orchestrator.run(plan, {
    governance: 'auto', positionning: false, recall: false, remember: false,
    offload: false, autoDistill: false, frameControl: false,
    worldModel: false, adaptive: false,
  }));

  for (const role of ['Planner', 'Critic', 'Synthesizer']) {
    assert.ok(received[role], `${role} was called`);
    assert.equal(received[role].runId, plan.runId, role);
    assert.equal(received[role].traceId, plan.traceId, role);
    assert.equal(received[role].run_id, plan.run_id, role);
    assert.equal(received[role].trace_id, plan.trace_id, role);
  }
});

test('Planner, specialist and synthesizer forward correlation to their LLM calls', async () => {
  const calls = [];
  const llm = {
    async complete(request, options) {
      calls.push({ request, options });
      if (request.role === 'Planner') {
        return { text: '[{"agent":"Critic","description":"Review"},{"agent":"Synthesizer","description":"Synthesize"}]' };
      }
      return { text: request.role === 'Synthesizer' ? 'Decision: Revise' : 'Critical analysis' };
    },
  };
  const correlation = {
    runId: 'run-llm-boundary', run_id: 'run-llm-boundary',
    traceId: 'trace-llm-boundary', trace_id: 'trace-llm-boundary',
  };
  const snakeCaseOnly = {
    run_id: correlation.run_id,
    trace_id: correlation.trace_id,
  };

  await new PlannerAgent({ llm }).createPlan('Planifier', snakeCaseOnly);
  for (const Agent of [CriticAgent, DevilsAdvocateAgent, RedTeamAgent]) {
    await new Agent({ llm }).execute('Analyser', { goal: 'Tester', ...snakeCaseOnly });
  }
  const bisociator = new BisociateurAgent({ llm });
  await bisociator.execute('Créer une collision', { goal: 'Tester', ...snakeCaseOnly });
  await bisociator.runMultiCollision('Tester', snakeCaseOnly, { k: 2 });
  await new SynthesizerAgent({ llm }).synthesize([
    { agent: 'Critic', output: 'Observation' },
  ], snakeCaseOnly);

  assert.deepEqual(calls.map(({ request }) => request.role), [
    'Planner', 'Critic', 'DevilsAdvocate', 'RedTeam',
    'Bisociateur', 'Bisociateur', 'Bisociateur', 'Synthesizer',
  ]);
  for (const call of calls) {
    assert.deepEqual({
      runId: call.request.runId, run_id: call.request.run_id,
      traceId: call.request.traceId, trace_id: call.request.trace_id,
    }, correlation);
    assert.deepEqual({
      runId: call.options.runId, run_id: call.options.run_id,
      traceId: call.options.traceId, trace_id: call.options.trace_id,
    }, correlation);
  }
});

test('Orchestrator.run preserves legacy snake_case correlation identifiers', async () => {
  const engine = createEngine();
  const plan = {
    ideaId: 'idea-snake-case',
    goal: 'Préserver la corrélation historique',
    run_id: 'run_snake_case',
    trace_id: 'trace_snake_case',
    steps: [{ id: 's1', agent: 'Synthesizer', description: 'Synthétiser' }],
  };

  const events = await collect(engine.orchestrator.run(plan, {
    governance: 'auto', positionning: false, recall: false, remember: false,
    offload: false, autoDistill: false, frameControl: false,
    worldModel: false, adaptive: false,
  }));

  assert.ok(events.every((event) => event.run_id === plan.run_id));
  assert.ok(events.every((event) => event.trace_id === plan.trace_id));
});

test('Orchestrator.plan preserves legacy snake_case correlation identifiers', async () => {
  const engine = createEngine();
  const plan = await engine.orchestrator.plan('Préserver le planning historique', {
    ideaId: 'idea-plan-snake', llmPlan: false,
    run_id: 'run_plan_snake', trace_id: 'trace_plan_snake',
  });

  assert.equal(plan.runId, 'run_plan_snake');
  assert.equal(plan.traceId, 'trace_plan_snake');
  assert.equal(plan.run_id, plan.runId);
  assert.equal(plan.trace_id, plan.traceId);
});

test('runP1Hooks passes correlation identifiers to dialectic agents', async () => {
  const received = {};
  const agents = {
    RedTeam: {
      name: 'RedTeam',
      execute: async (_input, context) => {
        received.RedTeam = context;
        return { output: 'Concrete failure mode with enough detail to parse correctly.' };
      },
    },
    Critic: {
      name: 'Critic',
      execute: async (_input, context) => {
        received.Critic = context;
        return { output: 'Concrete rebuttal preserving an explicit residual risk.' };
      },
    },
  };
  const opts = {
    dialectic: 'agents',
    survivingOptions: [{ id: 'option-1', summary: 'Option stratégique' }],
    runId: 'run-dialectic', traceId: 'trace-dialectic',
    run_id: 'run-dialectic', trace_id: 'trace-dialectic',
  };

  await runP1Hooks({
    plan: { goal: 'Tester la dialectique', ideaId: 'idea-dialectic' },
    opts, agentOutputs: [], contextBlock: 'Contexte', agents, memory: null,
  });

  for (const role of ['RedTeam', 'Critic']) {
    assert.equal(received[role].runId, opts.runId, role);
    assert.equal(received[role].traceId, opts.traceId, role);
    assert.equal(received[role].run_id, opts.run_id, role);
    assert.equal(received[role].trace_id, opts.trace_id, role);
  }
});
