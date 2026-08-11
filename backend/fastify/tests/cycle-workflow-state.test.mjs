import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowState } from '../../../core/workflow-state.mjs';
import { buildTestApp } from './test-helpers.mjs';
import cycleRoute from '../routes/cycle.mjs';

test('POST /v1/cycle/run exposes and audits one runId/traceId for the complete run', async (t) => {
  const { app, ctx } = await buildTestApp();
  await app.register(cycleRoute);
  t.after(async () => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/cycle/run',
    payload: {
      query: 'Auditer une option',
      ideaId: 'idea-api-correlation',
      stream: false,
      llmPlan: false,
      governance: 'auto',
      positionning: false,
      frameControl: false,
      worldModel: false,
      adaptive: false,
      autoDistill: false,
      offload: false,
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.match(body.runId, /^run_/);
  assert.match(body.traceId, /^trace_/);
  assert.equal(body.run_id, body.runId);
  assert.equal(body.trace_id, body.traceId);
  assert.ok(body.events.length > 2);
  assert.ok(body.events.every((event) => event.runId === body.runId));
  assert.ok(body.events.every((event) => event.traceId === body.traceId));
  assert.ok(body.events.every((event) => event.workflowState === undefined));
  assert.equal(body.workflowState.run_id, body.runId);
  assert.equal(body.workflowState.status, 'completed');
  assert.ok(body.workflowState.logs.length > 0);

  const auditEvents = ctx.activites.filter((event) =>
    event.type === 'cycle.start' || event.type === 'cycle.idea');
  assert.ok(auditEvents.length >= 1);
  assert.ok(auditEvents.every((event) => event.runId === body.runId));
  assert.ok(auditEvents.every((event) => event.traceId === body.traceId));
  assert.ok(auditEvents.every((event) => event.run_id === body.runId));
  assert.ok(auditEvents.every((event) => event.trace_id === body.traceId));
});

test('POST /v1/cycle/run correlates SSE meta, workflow and done events', async (t) => {
  const { app } = await buildTestApp();
  await app.register(cycleRoute);
  t.after(async () => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/v1/cycle/run',
    payload: {
      query: 'Tracer un cycle SSE',
      ideaId: 'idea-sse-correlation',
      stream: true,
      llmPlan: false,
      governance: 'auto',
      positionning: false,
      frameControl: false,
      worldModel: false,
      adaptive: false,
      autoDistill: false,
      offload: false,
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  const events = response.body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
  const meta = events.find((event) => event.type === 'meta');
  const done = events.find((event) => event.type === 'done');
  assert.match(meta.runId, /^run_/);
  assert.match(meta.traceId, /^trace_/);
  assert.equal(meta.run_id, meta.runId);
  assert.equal(meta.trace_id, meta.traceId);
  assert.equal(done.runId, meta.runId);
  assert.equal(done.traceId, meta.traceId);
  assert.equal(done.run_id, meta.runId);
  assert.equal(done.trace_id, meta.traceId);
  const workflowEvents = events.filter((event) => !['meta', 'done'].includes(event.type));
  assert.ok(workflowEvents
    .every((event) => event.runId === meta.runId && event.traceId === meta.traceId));
  assert.ok(workflowEvents.every((event) => event.workflowState === undefined));
  assert.equal(done.workflowState.run_id, meta.runId);
  assert.ok(done.workflowState.logs.length > 0);
});

test('POST /v1/cycle/run keeps correlation identifiers on SSE errors', async (t) => {
  const { app, ctx } = await buildTestApp();
  await app.register(cycleRoute);
  t.after(async () => app.close());
  ctx.engine.orchestrator.plan = async (goal, { ideaId }) => ({
    goal, ideaId, runId: 'run_error', traceId: 'trace_error', steps: [],
  });
  ctx.engine.orchestrator.run = async function* run() {
    throw new Error('forced failure');
  };

  const response = await app.inject({
    method: 'POST',
    url: '/v1/cycle/run',
    payload: {
      query: 'Provoquer une erreur tracée',
      ideaId: 'idea-error-correlation',
      stream: true,
      llmPlan: false,
      syncIdea: false,
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  const events = response.body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
  const error = events.find((event) => event.type === 'error');
  assert.equal(error.runId, 'run_error');
  assert.equal(error.traceId, 'trace_error');
  assert.equal(error.run_id, 'run_error');
  assert.equal(error.trace_id, 'trace_error');
  assert.equal(error.workflowState.run_id, 'run_error');
  assert.equal(error.workflowState.status, 'failed');
  assert.match(error.error, /forced failure/);
  const auditError = ctx.activites.find((event) => event.type === 'cycle.error');
  assert.equal(auditError.run_id, 'run_error');
  assert.equal(auditError.trace_id, 'trace_error');
});

test('POST /v1/cycle/run returns a failed WorkflowState on non-stream runtime errors', async (t) => {
  const { app, ctx } = await buildTestApp();
  await app.register(cycleRoute);
  t.after(async () => app.close());
  ctx.engine.orchestrator.plan = async (goal, { ideaId }) => ({
    goal, ideaId, runId: 'run_http_error', traceId: 'trace_http_error', steps: [],
  });
  ctx.engine.orchestrator.run = async function* run() {
    throw new Error('forced HTTP failure');
  };

  const response = await app.inject({
    method: 'POST', url: '/v1/cycle/run',
    payload: {
      query: 'Provoquer une erreur HTTP tracée', ideaId: 'idea-http-error',
      stream: false, llmPlan: false, syncIdea: false,
    },
  });

  assert.equal(response.statusCode, 502, response.body);
  const body = response.json();
  assert.equal(body.workflowState.run_id, 'run_http_error');
  assert.equal(body.workflowState.status, 'failed');
  assert.equal(body.workflowState.logs.at(-1).type, 'error');
  const auditError = ctx.activites.find((event) => event.type === 'cycle.error');
  assert.equal(auditError.run_id, 'run_http_error');
});

test('POST /v1/cycle/run adds correlation for legacy orchestrators without identifiers', async (t) => {
  const { app, ctx } = await buildTestApp();
  await app.register(cycleRoute);
  t.after(async () => app.close());
  ctx.engine.orchestrator.plan = async (goal, { ideaId }) => ({ goal, ideaId, steps: [] });
  ctx.engine.orchestrator.run = async function* run() {
    yield {
      type: 'final', status: 'auto', answer: 'legacy',
      workflowState: createWorkflowState({
        run_id: 'run_foreign', trace_id: 'trace_foreign',
        input: { request: 'foreign state must not escape' },
      }),
    };
  };

  const response = await app.inject({
    method: 'POST', url: '/v1/cycle/run',
    payload: {
      query: 'Corréler un orchestrateur historique',
      ideaId: 'idea-legacy-correlation',
      stream: false,
      syncIdea: false,
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.match(body.run_id, /^run_/);
  assert.match(body.trace_id, /^trace_/);
  assert.equal(body.events[0].run_id, body.run_id);
  assert.equal(body.events[0].trace_id, body.trace_id);
  assert.equal(body.workflowState.run_id, body.run_id);
  assert.equal(body.workflowState.status, 'completed');
});

test('POST /v1/cycle/run correlates planning failures in the response and audit', async (t) => {
  const { app, ctx } = await buildTestApp();
  await app.register(cycleRoute);
  t.after(async () => app.close());
  ctx.engine.orchestrator.plan = async () => {
    throw new Error('planner failure');
  };

  const response = await app.inject({
    method: 'POST', url: '/v1/cycle/run',
    payload: {
      query: 'Échouer pendant le planning',
      ideaId: 'idea-planning-failure',
      stream: false,
      syncIdea: false,
    },
  });

  assert.equal(response.statusCode, 502, response.body);
  const body = response.json();
  assert.match(body.run_id, /^run_/);
  assert.match(body.trace_id, /^trace_/);
  assert.equal(body.workflowState.run_id, body.run_id);
  assert.equal(body.workflowState.status, 'failed');
  const auditError = ctx.activites.find((event) => event.type === 'cycle.error');
  assert.equal(auditError.run_id, body.run_id);
  assert.equal(auditError.trace_id, body.trace_id);
});
