import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';
import { createIdea } from '../../../core/model.mjs';
import { addRisque } from '../../../core/risques.mjs';
import portfolioRoute from '../routes/portfolio.mjs';

const ideaId = 'arb-idea-1';
const COMEX = 'comex@kayros.local';

describe('backend arbitrage (Étape 5, EF-14 / F1)', () => {
  let app, ctx, t, g1, g2;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    await app.register(portfolioRoute);
    await registerComex(ctx, { email: COMEX, name: 'Comex' });
    t = await bearer(ctx, COMEX, 'secret1234');
    await ctx.ideas.save(createIdea({
      id: ideaId, title: 'Arbitrage demo', author: COMEX, tenantId: 't1', stage: 'eprouver',
      roadmap: { risques: [addRisque([], { id: 'r1', libelle: 'Risque critique', probabilite: 0.9, impact: 0.9 })[0]] },
    }));
    const g = await app.inject({
      method: 'POST', url: `/v1/ideas/${ideaId}/gates`,
      headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
      payload: { type: 'comex_arbitrage', requiredRole: 'comex' },
    });
    assert.equal(g.statusCode, 201, g.body);
    g1 = g.json().gateId;
    await ctx.workingGroups.addGroup((await import('../../../core/index.mjs')).createWorkingGroup({
      ideaId, members: [{ email: COMEX, role: 'comex' }],
    }));
    await ctx.workingGroups.addVote(ideaId, { by: COMEX, role: 'comex', score: 82 });
  });
  after(async () => { if (app) await app.close(); });

  const auth = () => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  it('GET /v1/ideas/:id/arbitrage rend le dossier F1 (recommandation + red flags + gate)', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/ideas/${ideaId}/arbitrage`, headers: auth() });
    assert.equal(res.statusCode, 200, res.body);
    const s = res.json();
    assert.equal(s.idée.title, 'Arbitrage demo');
    assert.equal(s.recommandation.recommandation, 'Go');       // 82 => Go (seuil 70)
    assert.equal(s.redFlags.length, 1);
    assert.equal(s.redFlags[0].libelle, 'Risque critique');
    assert.equal(s.gatesEnAttente.length, 1);
    assert.equal(s.gatesEnAttente[0].gateId, g1);
    assert.ok(s.synthèse.includes('Recommandation du groupe de travail : Go'));
  });

  it('résoudre un gate No-Go trace une décision immuable sur l’idée', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/gates/${g1}/resolve`, headers: auth(),
      payload: { decision: 'reject', reason: 'véto sur le marché' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().idea.status, 'non_poursuivi');
    const idea = await ctx.ideas.get(ideaId);
    assert.equal(idea.decisions.length, 1);
    assert.equal(idea.decisions[0].decision, 'No-Go');
    assert.equal(idea.decisions[0].by, COMEX);
    assert.equal(idea.decisions[0].reason, 'véto sur le marché');
    assert.equal(idea.decisions[0].gateId, g1);
  });

  it('GET /v1/ideas/:id/decisions expose le journal horodaté', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/ideas/${ideaId}/decisions`, headers: auth() });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.count, 1);
    assert.equal(body.derniere.decision, 'No-Go');
    assert.equal(body.derniere.by, COMEX);
    assert.ok(body.decisions[0].ts);
  });

  it('une révision renvoie l’idée en Étape 4 (eprouver) et trace une seconde décision', async () => {
    const g = await app.inject({
      method: 'POST', url: `/v1/ideas/${ideaId}/gates`,
      headers: auth(), payload: { type: 'comex_arbitrage', requiredRole: 'comex' },
    });
    assert.equal(g.statusCode, 201, g.body);
    g2 = g.json().gateId;
    const res = await app.inject({
      method: 'POST', url: `/v1/gates/${g2}/resolve`, headers: auth(),
      payload: { decision: 'revise', reason: 'à re-éprouver' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().idea.stage, 'eprouver');
    const idea = await ctx.ideas.get(ideaId);
    assert.equal(idea.decisions.length, 2);
    assert.equal(idea.decisions[1].decision, 'Révision');
    assert.equal(idea.stage, 'eprouver');
  });
});
