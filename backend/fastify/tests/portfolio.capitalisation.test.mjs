import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';
import { createIdea, setStatus } from '../../../core/model.mjs';
import portfolioRoute from '../routes/portfolio.mjs';

const ideaId = 'cap-idea-1';
const ideaActive = 'cap-idea-2';

describe('backend capitalisation No-Go (EF-44)', () => {
  let app, ctx, t1;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    await app.register(portfolioRoute);
    await registerComex(ctx, { email: 'comex1@kayros.local', name: 'Comex' });
    t1 = await bearer(ctx, 'comex1@kayros.local', 'secret1234');
    await ctx.ideas.save(setStatus(createIdea({ id: ideaId, title: 'Cap demo', author: 'comex1@kayros.local', tenantId: 't1' }), 'non_poursuivi', { by: 'comex1@kayros.local', motif: 'No-Go' }));
    await ctx.ideas.save(createIdea({ id: ideaActive, title: 'Active demo', author: 'comex1@kayros.local', tenantId: 't1' }));
  });
  after(async () => { if (app) await app.close(); });
  const auth = () => ({ authorization: `Bearer ${t1}`, 'content-type': 'application/json' });

  it('POST capitalisation sur ideo No-Go -> dossier persiste + journal', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/capitalisation`, headers: auth(),
      payload: {
        apprentissages: ['Ne pas lancer sans preuve de demande', { contenu: 'RGPD bloquant', categorie: 'reglementaire' }],
        reactivation: { conditions: ['Marche legalise en UE'], delai: '12 mois', signaux: ['loi adoptée'] },
        signaux: ['directive UE'],
        motif: 'risque regulatoire',
      } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.capitalisation.type, 'capitalisation');
    assert.equal(body.capitalisation.apprentissages.length, 2);
    assert.equal(body.resume.nbConditionsReactivation, 1);
    const idea = await ctx.ideas.get(ideaId);
    assert.ok(idea.capitalisation);
    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some(l => l.type === 'capitalisation.build'));
  });

  it('POST capitalisation sur ideo active -> 409', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/ideas/${ideaActive}/capitalisation`, headers: auth(),
      payload: { apprentissages: ['x'] } });
    assert.equal(res.statusCode, 409, res.body);
  });

  it('GET capitalisation retourne dossier + etat reactivation', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/ideas/${ideaId}/capitalisation?signaux=loi%20adopt%C3%A9e`, headers: { authorization: `Bearer ${t1}` } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.capitalisation.apprentissages.length, 2);
    assert.equal(body.reactivation.prete, true);
    const ko = await app.inject({ method: 'GET', url: `/v1/ideas/${ideaId}/capitalisation`, headers: { authorization: `Bearer ${t1}` } });
    assert.equal(ko.json().reactivation.prete, false);
  });
});
