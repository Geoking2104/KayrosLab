// KayrosLab -- the reference pipeline must actually execute.
//
// v2 made the state channels real and the revision loop expressible, but the
// orchestrator never emitted a channel event and the reference preset named
// five agents that did not exist. The graph was therefore decorative: the
// `review.status == 'OK'` edge could not fire in a real run. These tests hold
// the pipeline to an end-to-end contract.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from './index.mjs';
import { collect } from './orchestrator.mjs';
import { AGENT_TYPES, createAllAgents } from './agents/index.mjs';
import { referencePipelineGraph, REFERENCE_CONDITIONS } from './workflow-presets.mjs';

const QUIET = {
  governance: 'auto', positionning: false, recall: false, remember: false,
  offload: false, autoDistill: false, frameControl: false,
  worldModel: false, adaptive: false,
};

function referencePlan(overrides = {}) {
  const graph = referencePipelineGraph({ writerAttempts: 2, ...overrides });
  return {
    ideaId: 'idea-pipeline',
    goal: 'Produire un rapport verifie',
    steps: graph.nodes.map(({ step }) => step),
    graph,
  };
}

function runOpts(extra = {}) {
  return { ...QUIET, graphConditions: REFERENCE_CONDITIONS, ...extra };
}

/**
 * The escalation node declares a human gate, so a run that reaches it blocks
 * until someone resolves it -- which is the point. Tests that are not about
 * gating install an auto-approving governance so the run can finish.
 */
function autoApprove(engine) {
  let n = 0;
  engine.orchestrator.governance = {
    open: () => {
      n += 1;
      return { gateId: `g${n}`, promise: Promise.resolve({ decision: 'approve', by: 'test' }) };
    },
  };
  return engine;
}

// ------------------------------------------------------- agent roster

test('every agent named by the reference preset actually exists', () => {
  for (const role of ['Planner', 'Researcher', 'Simulator', 'Writer', 'Verifier', 'Logger']) {
    assert.ok(AGENT_TYPES.includes(role), `${role} must be a known agent type`);
  }
  const agents = createAllAgents({ llm: null });
  for (const role of AGENT_TYPES) {
    assert.ok(agents[role], `${role} must be instantiable`);
    assert.equal(typeof agents[role].execute, 'function', `${role} must be executable`);
  }
});

test('channel-owning agents declare the channel they write', () => {
  const agents = createAllAgents({ llm: null });
  assert.equal(agents.Researcher.channel, 'research');
  assert.equal(agents.Simulator.channel, 'simulation');
  assert.equal(agents.Writer.channel, 'draft');
  assert.equal(agents.Verifier.channel, 'review');
  // Adversarial agents own no channel: they only produce text.
  assert.equal(agents.Critic.channel, null);
});

// --------------------------------------------------- channel emission

test('a node that owns a channel emits the matching event', async () => {
  const engine = autoApprove(createEngine());
  const events = await collect(engine.orchestrator.run(referencePlan(), runOpts()));

  const types = events.map((event) => event.type);
  for (const channel of ['research', 'simulation', 'draft', 'review']) {
    assert.ok(types.includes(channel), `a ${channel} event must be emitted`);
  }
  const last = events.at(-1).workflowState;
  assert.ok(Array.isArray(last.research.facts));
  assert.ok(last.draft && typeof last.draft.content === 'string');
  assert.ok(['OK', 'KO'].includes(last.review.status));
});

test('a node without the write permission cannot emit a channel', async () => {
  const engine = autoApprove(createEngine());
  // The verifier owns `review`; make it try to overwrite the draft instead.
  engine.agents.Verifier.execute = async () => ({
    output: 'tentative', channel: { type: 'draft', content: 'forge', format: 'markdown' },
  });
  const events = await collect(engine.orchestrator.run(referencePlan(), runOpts()));

  const denied = events.filter((event) => event.type === 'degraded' && event.reason === 'permission_denied');
  assert.ok(denied.length > 0, 'writing a foreign channel must be denied');
  assert.ok(!events.some((event) => event.type === 'draft' && event.content === 'forge'));
});

// ------------------------------------------------ real revision loop

test('a KO review really loops back to the writer then escalates', async () => {
  const engine = autoApprove(createEngine());
  const visits = [];
  engine.agents.Writer.execute = async () => {
    visits.push('writer');
    return { output: 'draft', channel: { type: 'draft', content: `v${visits.length}`, format: 'markdown' } };
  };
  engine.agents.Verifier.execute = async () => ({
    output: 'refuse',
    channel: { type: 'review', status: 'KO', comments: ['incomplet'] },
  });

  const events = await collect(engine.orchestrator.run(referencePlan(), runOpts()));
  const nodes = events.filter((event) => event.type === 'trace').map((event) => event.nodeId);

  // writerAttempts = 2: the writer runs twice, then the budget forces escalation.
  assert.equal(visits.length, 2, 'the writer must run exactly its attempt budget');
  assert.ok(nodes.includes('escalate'), 'the run must escalate once the budget is spent');
  assert.ok(nodes.indexOf('escalate') > nodes.lastIndexOf('writer'));
});

test('an OK review reaches the logger and never revisits the writer', async () => {
  const engine = autoApprove(createEngine());
  const visits = [];
  engine.agents.Writer.execute = async () => {
    visits.push('writer');
    return { output: 'draft', channel: { type: 'draft', content: 'v1', format: 'markdown' } };
  };
  engine.agents.Verifier.execute = async () => ({
    output: 'accepte', channel: { type: 'review', status: 'OK', comments: [] },
  });

  const events = await collect(engine.orchestrator.run(referencePlan(), runOpts()));
  const nodes = events.filter((event) => event.type === 'trace').map((event) => event.nodeId);

  assert.equal(visits.length, 1);
  assert.ok(nodes.includes('logger'));
  assert.ok(!nodes.includes('escalate'));
});

test('the verifier checks the draft against the plan success criteria', async () => {
  const engine = autoApprove(createEngine());
  const seen = {};
  engine.agents.Verifier.execute = async (task, ctx) => {
    seen.criteria = ctx.successCriteria;
    seen.draft = ctx.draft;
    return { output: 'ok', channel: { type: 'review', status: 'OK', comments: [] } };
  };
  const plan = { ...referencePlan(), successCriteria: ['chiffre source', 'moins de 2 pages'] };
  await collect(engine.orchestrator.run(plan, runOpts()));

  assert.deepEqual(seen.criteria, ['chiffre source', 'moins de 2 pages']);
  assert.ok(seen.draft && typeof seen.draft.content === 'string', 'the verifier reads the draft');
});
