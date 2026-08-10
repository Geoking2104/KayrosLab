import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';
import { createIdea } from '../../../core/model.mjs';
import portfolioRoute from '../routes/portfolio.mjs';

const ideaId = 'gf-idea-1';

describe('backend gates futurs (EF-45)', () => {
  let app, ctx, t1;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    await app.register(portfolioRoute);
    await registerComex(ctx, { email: 'comex1@kayros.local', name: 'Comex' });
    t1 = await bearer(ctx, 'comex1@kayros.local', 'secret1234');
    await ctx.ideas.save(createIdea({ id: ideaId, title: 'Gates futurs demo', author: 'comex1@kayros.local', tenantId: 't1' }));
  });
  after(async () => { if (app) await app.close(); });
  const auth = () => ({ authorization: `Bearer ${t1}`, 'content-type': 'application/json' });

  it('POST gates-futurs planifie + persiste + journal', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/gates-futurs`, headers: auth(),
      payload: { gates: [
        { libelle: 'Revue rollout', date: '2030-01-01', questions: ['OK rollout ?'] },
        { libelle: 'Bilan pilote', date: '2020-01-01' },
      ] } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.gatesFuturs.length, 2);
    assert.equal(body.gatesFuturs[0].type, 'comex_arbitrage');
    assert.equal(body.status.aVenir, 1);
    assert.equal(body.status.dus, 1);
    const idea = await ctx.ideas.get(ideaId);
    assert.equal(idea.roadmap.gatesFuturs.length, 2);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some(l => l.type === 'gatesfuturs.plan'));
  });

  it('GET gates-futurs retourne le statut', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/ideas/${ideaId}/gates-futurs`, headers: { authorization: `Bearer ${t1}` } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().status.dus, 1);
  });

  it('POST gates-futurs/materialise ouvre de vrais gates COMEX', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/gates-futurs/materialise`, headers: auth(), payload: {} });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.materialises.length, 1);
    assert.ok(body.materialises[0].materialise.gateId);
    assert.equal(body.status.materialises, 1);
    assert.equal(body.status.dus, 0);
    assert.equal(ctx.governance.list().filter((g) => g.ideaId === ideaId).length, 1);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some(l => l.type === 'gatesfuturs.materialise'));
  });
});
