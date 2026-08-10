import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';
import { createIdea } from '../../../core/model.mjs';
import portfolioRoute from '../routes/portfolio.mjs';

const ideaId = 'risk-idea-1';

describe('backend risques (matrice EF-42)', () => {
  let app, ctx, t1;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    await app.register(portfolioRoute);
    await registerComex(ctx, { email: 'comex1@kayros.local', name: 'Comex' });
    t1 = await bearer(ctx, 'comex1@kayros.local', 'secret1234');
    await ctx.ideas.save(createIdea({ id: ideaId, title: 'Risques demo', author: 'comex1@kayros.local', tenantId: 't1' }));
  });
  after(async () => { if (app) await app.close(); });
  const auth = () => ({ authorization: `Bearer ${t1}`, 'content-type': 'application/json' });

  it('POST add risque -> score/niveau + matrice + journal', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/risques`, headers: auth(),
      payload: { action: 'add', risque: { libelle: 'Timing marché', probabilite: 0.6, impact: 0.5 } } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.risques.length, 1);
    assert.equal(body.risques[0].score, 0.3);
    assert.equal(body.risques[0].niveau, 'moyen');
    assert.equal(body.matrice.total, 1);
    assert.equal(body.declencheurs.necessaire, false);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some(l => l.type === 'risque.add'));
  });

  it('POST update risque -> re-arbitrage gate si seuil franchi', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/risques`, headers: auth(),
      payload: { action: 'update', risqueId: 'r1', patch: { probabilite: 0.95, impact: 0.95 } } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.risques[0].niveau, 'critique');
    assert.equal(body.declencheurs.necessaire, true);
    assert.ok(body.reArbitrage.gateId);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some(l => l.type === 'risque.rearbitrage'));
  });

  it('POST remove risque + GET matrice', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/risques`, headers: auth(),
      payload: { action: 'remove', risqueId: 'r1' } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().risques.length, 0);
    const get = await app.inject({ method: 'GET', url: `/v1/ideas/${ideaId}/risques`, headers: { authorization: `Bearer ${t1}` } });
    assert.equal(get.statusCode, 200, get.body);
    assert.equal(get.json().matrice.total, 0);
  });
});
