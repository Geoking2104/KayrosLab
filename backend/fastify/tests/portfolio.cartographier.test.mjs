import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';
import { createIdea } from '../../../core/model.mjs';
import portfolioRoute from '../routes/portfolio.mjs';

const ideaId = 'carto-idea-1';
const COMEX = 'comex@kayros.local';

describe('backend Cartographier (Étape 2, EF-03/EF-04)', () => {
  let app, ctx, t;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    await app.register(portfolioRoute);
    await registerComex(ctx, { email: COMEX, name: 'Comex' });
    t = await bearer(ctx, COMEX, 'secret1234');
    await ctx.ideas.save(createIdea({ id: ideaId, title: 'Carto demo', author: COMEX, tenantId: 't1' }));
  });
  after(async () => { if (app) await app.close(); });

  const auth = () => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  it('POST tendances construit le réseau + ponts + persiste + journal', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/ideas/${ideaId}/tendances`, headers: auth(),
      payload: { tendances: [
        { nom: 'IA générative', horizon: 'court', tags: ['ia', 'retail'] },
        { nom: 'Retail physique', horizon: 'long', tags: ['retail'] },
        { nom: 'Logistique automatisée', horizon: 'moyen', tags: ['logistique'] },
      ] },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.totalNoeuds, 3);
    assert.equal(body.totalAretes, 0);
    assert.ok(body.ponts.length >= 1);
    assert.ok(body.rendu.includes('Réseau'));
    const idea = await ctx.ideas.get(ideaId);
    assert.equal(idea.cartographie.tendances.length, 3);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some((l) => l.type === 'carto.build'));
  });

  it('POST tendances sans liste construit depuis les signaux qualifiés', async () => {
    const id2 = `${ideaId}-from-signals`;
    await ctx.ideas.save({ ...createIdea({ id: id2, title: 'Carto from signals', author: COMEX, tenantId: 't1' }), signals: [{ id: 'sig1', contenu: 'Grosse tendance signalée', qualifie: true }] });
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${id2}/tendances`, headers: auth(), payload: {} });
    assert.equal(res.statusCode, 200, res.body);
    assert.ok(res.json().totalNoeuds >= 1);
  });

  it('GET tendances rend le rapport agrégé', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/ideas/${ideaId}/tendances`, headers: auth() });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.totalNoeuds, 3);
    assert.equal(body.reseau.noeuds.length, 3);
    assert.ok(Array.isArray(body.zonesTension));
    assert.ok(Array.isArray(body.centralite.pivots));
  });

  it('POST ponts affiche les suggestions sans note inventée', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/tendances/ponts`, headers: auth(), payload: {} });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(body.ponts.length >= 1);
    assert.equal(body.ponts[0].plausibilite, null);
    assert.equal(body.ponts[0].score, null);
  });

  it('POST ponts avec plausibilité score (nouveauté × plausibilité)', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/tendances/ponts`, headers: auth(), payload: { plausibilite: [] } });
    assert.equal(res.statusCode, 200, res.body);
    const base = res.json().ponts[0];
    const res2 = await app.inject({
      method: 'POST', url: `/v1/ideas/${ideaId}/tendances/ponts`, headers: auth(),
      payload: { plausibilite: [{ de: base.de, vers: base.vers, valeur: 70 }] },
    });
    assert.equal(res2.statusCode, 200, res2.body);
    const scored = res2.json().ponts.find((p) => p.id === base.id);
    assert.equal(scored.plausibilite, 70);
    assert.ok(scored.score > 0);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some((l) => l.type === 'carto.ponts'));
  });

  it('POST sélection envoie le réseau choisi vers Construire (F6)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/ideas/${ideaId}/tendances/selection`, headers: auth(),
      payload: { noeuds: [], ponts: [] },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.selection.destination, 'construire');
    assert.ok(body.selection.ts);
    const idea = await ctx.ideas.get(ideaId);
    assert.equal(idea.cartographie.selection.destination, 'construire');
  });
});
