import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';
import { createIdea } from '../../../core/model.mjs';
import { idScenario } from '../../../core/construire.mjs';
import portfolioRoute from '../routes/portfolio.mjs';

const ideaId = 'construire-idea-1';
const COMEX = 'comex@kayros.local';

describe('backend Construire (Étape 3, EF-05/F1)', () => {
  let app, ctx, t;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    await app.register(portfolioRoute);
    await registerComex(ctx, { email: COMEX, name: 'Comex' });
    t = await bearer(ctx, COMEX, 'secret1234');
    await ctx.ideas.save(createIdea({ id: ideaId, title: 'Construire demo', author: COMEX, tenantId: 't1' }));
  });
  after(async () => { if (app) await app.close(); });

  const auth = () => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  it('POST canvas initialise depuis la sélection Cartographier + journal', async () => {
    await ctx.ideas.save({ ...await ctx.ideas.get(ideaId), cartographie: { selection: { destination: 'construire', noeuds: [{ id: 'tend-1', nom: 'IA générative' }], ponts: [], ts: '2026-08-01T00:00:00.000Z' } } });
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/scenarios/canvas`, headers: auth(), payload: {} });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.totalNoeuds, 1);
    assert.equal(body.canvas.noeuds[0].nom, 'IA générative');
    assert.ok(body.rendu.includes('sélection Cartographier'));
    const idea = await ctx.ideas.get(ideaId);
    assert.equal(idea.construire.noeuds[0].id, 'tend-1');
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some((l) => l.type === 'construire.canvas'));
  });

  it('GET scenarios rend un canvas vide sans rien deviner', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/ideas/${ideaId}/scenarios`, headers: auth() });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().totalScenarios, 0);
  });

  it('POST scenarios compose un scénario + persiste + journal', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/ideas/${ideaId}/scenarios`, headers: auth(),
      payload: { scenario: { nom: 'Retail augmenté', type: 'rupture', hypotheses: ['h1'], noeuds: ['tend-1'] } },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.scenario.id, idScenario('Retail augmenté'));
    assert.equal(body.scenario.type, 'rupture');
    assert.equal(body.totalScenarios, 1);
    const idea = await ctx.ideas.get(ideaId);
    assert.equal(idea.construire.scenarios.length, 1);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some((l) => l.type === 'construire.add'));
  });

  it('POST scenarios duplicate → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/ideas/${ideaId}/scenarios`, headers: auth(),
      payload: { scenario: { nom: 'Retail augmenté' } },
    });
    assert.equal(res.statusCode, 400);
  });

  it('PATCH scenarios édite le scénario (canvas éditable) + journal', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/ideas/${ideaId}/scenarios/${idScenario('Retail augmenté')}`, headers: auth(),
      payload: { scenario: { type: 'prudente', cible: 'grands comptes' } },
    });
    assert.equal(res.statusCode, 200, res.body);
    const s = res.json().scenario;
    assert.equal(s.type, 'prudente');
    assert.equal(s.cible, 'grands comptes');
    assert.equal(s.nom, 'Retail augmenté');
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some((l) => l.type === 'construire.update'));
  });

  it('DELETE scenarios supprime + journal', async () => {
    const res = await app.inject({
      method: 'DELETE', url: `/v1/ideas/${ideaId}/scenarios/${idScenario('Retail augmenté')}`,
      headers: { authorization: `Bearer ${t}` },
    });
    assert.equal(res.statusCode, 200, res.body);
    const idea = await ctx.ideas.get(ideaId);
    assert.equal(idea.construire.scenarios.length, 0);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some((l) => l.type === 'construire.remove'));
  });
});
