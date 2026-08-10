import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';
import { createIdea } from '../../../core/model.mjs';
import portfolioRoute from '../routes/portfolio.mjs';

const ideaId = 'eco-idea-1';
const COMEX = 'comex@kayros.local';

describe('backend Écouter (Étape 1, EF-01/EF-02)', () => {
  let app, ctx, t;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    await app.register(portfolioRoute);
    await registerComex(ctx, { email: COMEX, name: 'Comex' });
    t = await bearer(ctx, COMEX, 'secret1234');
    await ctx.ideas.save(createIdea({ id: ideaId, title: 'Ecouter demo', author: COMEX, tenantId: 't1' }));
  });
  after(async () => { if (app) await app.close(); });

  const auth = () => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  it('POST signals ajoute + score expliqué + persiste + journal', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/ideas/${ideaId}/signals`, headers: auth(),
      payload: { signal: { contenu: 'IA générative dans le retail', source: 'presse', tags: ['ia'] }, scores: { pertinence: 90, impact: 50 } },
    });
    assert.equal(res.statusCode, 200, res.body);
    const s = res.json().signal;
    assert.ok(s.id);
    assert.ok(s.note >= 0 && s.note <= 100);
    assert.equal(s.dimensions.length, 3);
    assert.ok(s.explication.includes('Note'));
    const idea = await ctx.ideas.get(ideaId);
    assert.equal(idea.signals.length, 1);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some((l) => l.type === 'ecouter.add'));
  });

  it('POST signals sans contenu → 400', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/signals`, headers: auth(), payload: { signal: {} } });
    assert.equal(res.statusCode, 400);
  });

  it('GET signals rend le rapport (reduction + clusters)', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/ideas/${ideaId}/signals`, headers: auth() });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.total, 1);
    assert.equal(body.reduction.conservesCount, 1);
    assert.equal(body.clusters.find((c) => c.tag === 'ia').count, 1);
    assert.ok(body.rendu.includes('Réduction de bruit'));
  });

  it('POST promote qualifie + horodaté + journal, double promotion → 400', async () => {
    const ideaAvant = await ctx.ideas.get(ideaId);
    const signalId = ideaAvant.signals[0].id;
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/signals/promote`, headers: auth(), payload: { signalId } });
    assert.equal(res.statusCode, 200, res.body);
    const q = res.json().signal;
    assert.equal(q.qualifie, true);
    assert.equal(q.promote.by, COMEX);
    assert.equal(q.promote.ideaId, ideaId);
    assert.ok(q.promote.ts);
    const idea = await ctx.ideas.get(ideaId);
    assert.equal(idea.signals[0].qualifie, true);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some((l) => l.type === 'ecouter.promote'));
    const res2 = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/signals/promote`, headers: auth(), payload: { signalId } });
    assert.equal(res2.statusCode, 400);
  });

  it('POST noise fixe le seuil et masque les signaux sous le seuil', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/signals/noise`, headers: auth(), payload: { seuil: 99 } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.seuil, 99);
    assert.equal(body.reduction.masquesCount, 1);
    assert.equal(body.reduction.conservesCount, 0);
    const idea = await ctx.ideas.get(ideaId);
    assert.equal(idea.ecouter.seuil, 99);
  });
});
