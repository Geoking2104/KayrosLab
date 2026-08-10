import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';
import { createIdea } from '../../../core/model.mjs';
import portfolioRoute from '../routes/portfolio.mjs';

const ideaId = 'collision-idea-1';
const COMEX = 'comex@kayros.local';

describe('backend Construire Collision Mode (Étape 3, EF-06)', () => {
  let app, ctx, t;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    await app.register(portfolioRoute);
    await registerComex(ctx, { email: COMEX, name: 'Comex' });
    t = await bearer(ctx, COMEX, 'secret1234');
    await ctx.ideas.save(createIdea({ id: ideaId, title: 'Collision demo', author: COMEX, tenantId: 't1' }));
  });
  after(async () => { if (app) await app.close(); });

  const auth = () => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  it('POST collision génère les paires distantes sans score inventé + journal', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/ideas/${ideaId}/collision`, headers: auth(),
      payload: { concepts: [
        { id: 'c1', nom: 'IA', tags: ['ia'] },
        { id: 'c2', nom: 'Retail', tags: ['retail'] },
        { id: 'c3', nom: 'IA Retail', tags: ['ia', 'retail'] },
      ] },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.totalCollisions, 1);
    assert.equal(body.collisions[0].concepts[0], 'c1');
    assert.equal(body.collisions[0].score, null); // rien n est invente
    const idea = await ctx.ideas.get(ideaId);
    assert.equal(idea.construire.collisions.length, 1);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some((l) => l.type === 'construire.collision'));
  });

  it('POST collision avec scores → nouveauté × faisabilité importée', async () => {
    const id2 = `${ideaId}-scored`;
    await ctx.ideas.save(createIdea({ id: id2, title: 'Collision scored', author: COMEX, tenantId: 't1' }));
    const res = await app.inject({
      method: 'POST', url: `/v1/ideas/${id2}/collision`, headers: auth(),
      payload: {
        concepts: [
          { id: 'c1', nom: 'IA', tags: ['ia'] },
          { id: 'c2', nom: 'Retail', tags: ['retail'] },
        ],
        scores: [{ de: 'c1', vers: 'c2', proposition: 'Retail augmenté par IA générative', faisabilite: 60 }],
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    const c = body.collisions.find((x) => x.concepts.includes('c1'));
    assert.equal(c.proposition, 'Retail augmenté par IA générative');
    assert.equal(c.faisabilite, 60);
    assert.equal(c.nouveaute, 100);
    assert.equal(c.score, 60);
    assert.equal(body.meilleurScore, 60);
  });

  it('POST collision sans concepts → 400 si aucun canvas/sélection', async () => {
    const id2 = `${ideaId}-empty`;
    await ctx.ideas.save(createIdea({ id: id2, title: 'Vide', author: COMEX, tenantId: 't1' }));
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${id2}/collision`, headers: auth(), payload: {} });
    assert.equal(res.statusCode, 400);
  });

  it('GET collision rend le rapport (comptages réels)', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/ideas/${ideaId}/collision`, headers: auth() });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(body.totalIdees >= 1);
    assert.ok(body.rendu.includes('Collision Mode'));
  });

  it('POST selection mémorise les collisions choisies + journal', async () => {
    const idea = await ctx.ideas.get(ideaId);
    const ids = idea.construire.collisions.map((c) => c.id);
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/collision/selection`, headers: auth(), payload: { collisionIds: ids } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().selection.length, ids.length);
    const idea2 = await ctx.ideas.get(ideaId);
    assert.equal(idea2.construire.selectionCollisions.length, ids.length);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some((l) => l.type === 'construire.collision.select'));
  });
});
