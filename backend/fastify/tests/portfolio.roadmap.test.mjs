import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';
import { createIdea } from '../../../core/model.mjs';
import portfolioRoute from '../routes/portfolio.mjs';

const ideaId = 'proj-idea-1';
const scenarios = [{ probability: 1, value: 50 }, { probability: 1, value: 100 }];
const costHypotheses = { costPerPersonMonth: 100, overheadRate: 0.2, horizonMonths: 6 };
const milestones = [{ name: 'M1', effortPersonMonths: 3, durationMonths: 2 }, { name: 'M2', effortPersonMonths: 2, durationMonths: 4 }];

describe('backend projeter (roadmap) routes', () => {
  let app, ctx, t1;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    await app.register(portfolioRoute);
    await registerComex(ctx, { email: 'comex1@kayros.local', name: 'Comex' });
    t1 = await bearer(ctx, 'comex1@kayros.local', 'secret1234');
    await ctx.ideas.save(createIdea({ id: ideaId, title: 'Projeter demo', author: 'comex1@kayros.local', tenantId: 't1' }));
  });
  after(async () => { if (app) await app.close(); });

  it('POST /v1/ideas/:id/roadmap builds + saves + journals', async () => {
    const auth = { authorization: `Bearer ${t1}`, 'content-type': 'application/json' };
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/roadmap`, headers: auth,
      payload: { milestones, costHypotheses, scenarios, raci: [{ m1: 'a' }], kpis: [], seed: 42, iterations: 1000 } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.roadmap.jalons.length, 2);
    assert.equal(body.ressources.budget, 600);
    assert.equal(body.projections.valeurAttendue, 75);
    const idea = await ctx.ideas.get(ideaId);
    assert.ok(idea.roadmap);
    assert.ok(idea.projection);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some(l => l.type === 'project.roadmap'));
  });

  it('GET /v1/ideas/:id/roadmap returns saved roadmap + rapport', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/ideas/${ideaId}/roadmap`, headers: { authorization: `Bearer ${t1}` } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.roadmap.jalons.length, 2);
    assert.equal(body.ressources.budget, 600);
    assert.equal(body.projections.valeurAttendue, 75);
    assert.ok(body.rapport);
  });
});
