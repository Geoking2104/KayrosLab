import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';
import { createIdea } from '../../../core/model.mjs';
import portfolioRoute from '../routes/portfolio.mjs';

const ideaId = 'exec-idea-1';
const milestones = [{ name: 'M1', effortPersonMonths: 3, durationMonths: 2 }, { name: 'M2', effortPersonMonths: 2, durationMonths: 4 }];
const kpis = [{ id: 'adoption', name: 'Adoption', threshold: 100, comparator: 'lte' }, { id: 'churn', name: 'Churn', threshold: 0.1, comparator: 'gte' }];

describe('backend realiser (execution + monitor loop)', () => {
  let app, ctx, t1;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    await app.register(portfolioRoute);
    await registerComex(ctx, { email: 'comex1@kayros.local', name: 'Comex' });
    t1 = await bearer(ctx, 'comex1@kayros.local', 'secret1234');
    await ctx.ideas.save(createIdea({ id: ideaId, title: 'Realiser demo', author: 'comex1@kayros.local', tenantId: 't1' }));
    const auth = { authorization: `Bearer ${t1}`, 'content-type': 'application/json' };
    const rm = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/roadmap`, headers: auth,
      payload: { milestones, costHypotheses: { costPerPersonMonth: 100, overheadRate: 0.2, horizonMonths: 6 }, kpis } });
    assert.equal(rm.statusCode, 200, rm.body);
  });
  after(async () => { if (app) await app.close(); });
  const auth = () => ({ authorization: `Bearer ${t1}`, 'content-type': 'application/json' });

  it('POST /v1/ideas/:id/execution demarre pilote depuis la roadmap', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/execution`, headers: auth(), payload: {} });
    assert.equal(res.statusCode, 201, res.body);
    const body = res.json();
    assert.equal(body.execution.phase, 'pilote');
    assert.equal(body.execution.jalons.length, 2);
    assert.equal(body.progression.total, 2);
  });

  it('PATCH /v1/ideas/:id/execution avance jalon + phase + cloture', async () => {
    let res = await app.inject({ method: 'PATCH', url: `/v1/ideas/${ideaId}/execution`, headers: auth(),
      payload: { jalonId: 'j1', patch: { statut: 'fait' } } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().execution.jalons[0].statut, 'fait');
    res = await app.inject({ method: 'PATCH', url: `/v1/ideas/${ideaId}/execution`, headers: auth(),
      payload: { jalonId: 'j2', patch: { statut: 'fait' } } });
    assert.equal(res.json().execution.jalons[1].statut, 'fait');
    res = await app.inject({ method: 'PATCH', url: `/v1/ideas/${ideaId}/execution`, headers: auth(),
      payload: { action: 'phase_suivante' } });
    assert.equal(res.json().execution.phase, 'deploiement');
    res = await app.inject({ method: 'PATCH', url: `/v1/ideas/${ideaId}/execution`, headers: auth(),
      payload: { action: 'cloturer', verdict: 'succes', enseignements: ['ok'] } });
    assert.equal(res.statusCode, 200, res.body);
    const idea = await ctx.ideas.get(ideaId);
    assert.equal(idea.status, 'termine');
    assert.equal(res.json().execution.cloture.verdict, 'succes');
  });

  it('GET /v1/ideas/:id/execution retourne execution + progression + impact', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/ideas/${ideaId}/execution`, headers: { authorization: `Bearer ${t1}` } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.execution.phase, 'bilan');
    assert.equal(body.progression.faits, 2);
    assert.ok(body.impact.ecart);
  });

  it('POST /v1/ideas/:id/execution/monitor declenche signal + re-arbitrage (EF-43)', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/execution/monitor`, headers: auth(),
      payload: { readings: [{ kpiId: 'adoption', value: 80 }, { kpiId: 'churn', value: 0.2 }] } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.alerts.length, 2);
    assert.ok(body.signals.length >= 1);
    assert.ok(body.reArbitrage.gateId);
    const idea = await ctx.ideas.get(ideaId);
    assert.ok(idea.loop);
    assert.equal(idea.impact.releves.length, 2);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some(l => l.type === 'loop.alert'));
  });

  it('monitor sans seuil franchi ne propose pas de re-arbitrage', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/execution/monitor`, headers: auth(),
      payload: { readings: [{ kpiId: 'adoption', value: 150 }, { kpiId: 'churn', value: 0.01 }], openGate: false } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.alerts.length, 0);
    assert.equal(body.signals.length, 0);
    assert.equal(body.reArbitrage, null);
  });
});
