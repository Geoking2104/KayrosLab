import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';
import resumeRoute from '../routes/resume.mjs';
import { InMemoryRunStore } from '../../../core/run-store.mjs';
import { createWorkflowState, applyWorkflowEvent } from '../../../core/workflow-state.mjs';
import { referencePipelineGraph } from '../../../core/workflow-presets.mjs';

const COMEX = 'comex@kayros.local';

/** Un run reellement suspendu sur le gate d'escalade du pipeline de reference. */
function suspendedRun({ runId = 'run-suspendu', ideaId = 'idea-1' } = {}) {
  const graph = referencePipelineGraph({ writerAttempts: 2 });
  let state = createWorkflowState({
    runId, traceId: `trace-${runId}`, ideaId,
    input: { request: 'Produire un rapport verifie' },
    plan: { steps: graph.nodes.map(({ step }) => step), successCriteria: [], graph },
  });
  state = applyWorkflowEvent(state, {
    type: 'draft', nodeId: 'writer', agent: 'Writer', content: 'v1', format: 'markdown',
  });
  state = applyWorkflowEvent(state, {
    type: 'review', nodeId: 'verifier', agent: 'Verifier', status: 'KO', comments: ['incomplet'],
  });
  return applyWorkflowEvent(state, {
    type: 'gate', gateId: 'gate-esc-1', gateType: 'human_escalation', nodeId: 'escalate',
  });
}

describe('backend reprise de run suspendu', () => {
  let app, ctx, t, store;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    store = new InMemoryRunStore();
    ctx.runStore = store;
    await app.register(resumeRoute);
    await registerComex(ctx, { email: COMEX, name: 'Comex' });
    t = await bearer(ctx, COMEX, 'secret1234');
  });
  after(async () => { if (app) await app.close(); });

  const auth = () => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  it('liste les runs suspendus du tenant', async () => {
    await store.save(suspendedRun({ runId: 'run-a' }), { tenantId: 't1' });
    const res = await app.inject({ method: 'GET', url: '/v1/runs/suspended', headers: auth() });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.total, 1);
    assert.equal(body.runs[0].runId, 'run-a');
    assert.equal(body.runs[0].gate.nodeId, 'escalate');
    assert.equal(body.runs[0].state, undefined, 'la liste ne transporte pas l’etat complet');
  });

  it('n’expose pas les runs d’un autre tenant', async () => {
    await store.save(suspendedRun({ runId: 'run-etranger' }), { tenantId: 'autre-tenant' });
    const res = await app.inject({ method: 'GET', url: '/v1/runs/suspended', headers: auth() });
    const ids = res.json().runs.map((r) => r.runId);
    assert.ok(!ids.includes('run-etranger'));

    const detail = await app.inject({ method: 'GET', url: '/v1/runs/run-etranger', headers: auth() });
    assert.equal(detail.statusCode, 404, 'introuvable, pas interdit');
  });

  it('renvoie le detail d’un run suspendu sans le brouillon complet', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/runs/run-a', headers: auth() });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.status, 'pending_review');
    assert.equal(body.gate.type, 'human_escalation');
    assert.equal(body.review.status, 'KO');
    assert.equal(body.draft.bytes, 2, 'seule la taille du brouillon est exposee');
    assert.equal(body.draft.content, undefined);
  });

  it('reprend un run sur approbation et le retire du store', async () => {
    await store.save(suspendedRun({ runId: 'run-approve' }), { tenantId: 't1' });
    const res = await app.inject({
      method: 'POST', url: '/v1/runs/run-approve/resume', headers: auth(),
      payload: { decision: 'approve', reason: 'validé', stream: false },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(body.events.length > 0);
    assert.ok(body.events.some((e) => e.type === 'gate_resolved'));
    assert.ok(body.final, 'la reprise atteint un evenement final');
    assert.notEqual(body.final.status, 'pending_review');
    assert.equal(await store.get('run-approve', { tenantId: 't1' }), null, 'run retire du store');
  });

  it('un veto bloque le run et le retire du store', async () => {
    await store.save(suspendedRun({ runId: 'run-veto' }), { tenantId: 't1' });
    const res = await app.inject({
      method: 'POST', url: '/v1/runs/run-veto/resume', headers: auth(),
      payload: { decision: 'veto', reason: 'hors budget', stream: false },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().final.status, 'blocked_veto');
    assert.equal(await store.get('run-veto', { tenantId: 't1' }), null);
  });

  it('refuse de reprendre un run inconnu ou deja termine', async () => {
    const absent = await app.inject({
      method: 'POST', url: '/v1/runs/inconnu/resume', headers: auth(),
      payload: { decision: 'approve', stream: false },
    });
    assert.equal(absent.statusCode, 404);

    // Un run repris n'est plus dans le store : le reprendre deux fois echoue.
    const rejoue = await app.inject({
      method: 'POST', url: '/v1/runs/run-approve/resume', headers: auth(),
      payload: { decision: 'approve', stream: false },
    });
    assert.equal(rejoue.statusCode, 404, 'pas de double reprise');
  });

  it('refuse une decision hors schema', async () => {
    await store.save(suspendedRun({ runId: 'run-schema' }), { tenantId: 't1' });
    const res = await app.inject({
      method: 'POST', url: '/v1/runs/run-schema/resume', headers: auth(),
      payload: { decision: 'peut-etre', stream: false },
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.ok(res.json().issues);
  });

  it('refuse sans authentification', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/runs/suspended',
      headers: { 'content-type': 'application/json' },
    });
    assert.ok(res.statusCode === 401 || res.statusCode === 403, `recu ${res.statusCode}`);
  });
});
