import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';
import { createIdea } from '../../../core/model.mjs';
import portfolioRoute from '../routes/portfolio.mjs';

const ideaId = 'eprouver-idea-1';
const COMEX = 'comex@kayros.local';

describe('backend Éprouver (Étape 4, EF-08/F1-F5)', () => {
  let app, ctx, t;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    await app.register(portfolioRoute);
    await registerComex(ctx, { email: COMEX, name: 'Comex' });
    t = await bearer(ctx, COMEX, 'secret1234');
    await ctx.ideas.save(createIdea({
      id: ideaId, title: 'Offre IA retail', author: COMEX, tenantId: 't1',
    }));
  });
  after(async () => { if (app) await app.close(); });

  const auth = () => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

  it('POST eprouver lance les 3 agents et journalise le run', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/ideas/${ideaId}/eprouver`, headers: auth(), payload: {},
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(body.run, 'un run est retourné');
    assert.ok(Number.isInteger(body.run.totalAttaques));
    assert.ok(body.run.totalAttaques > 0, 'les heuristiques produisent des attaques');

    const idea = await ctx.ideas.get(ideaId);
    assert.equal(idea.eprouver.runs.length, 1);
    assert.equal(idea.eprouver.runs[0].declenchePar.by, COMEX);

    const logs = await ctx.auditStore.where({ ideaId });
    assert.ok(logs.some((l) => l.type === 'eprouver.run'), 'le run est journalisé');
  });

  it('POST eprouver accepte un apport externe et le conserve', async () => {
    const id2 = `${ideaId}-apport`;
    await ctx.ideas.save(createIdea({ id: id2, title: 'Avec apport', author: COMEX, tenantId: 't1' }));
    const res = await app.inject({
      method: 'POST', url: `/v1/ideas/${id2}/eprouver`, headers: auth(),
      payload: {
        apport: {
          critic: [{ argument: 'Le marché adressable est surestimé', severite: 0.9 }],
          red_team: [{ argument: 'Dépendance à un fournisseur unique', severite: 0.7 }],
        },
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    const args = JSON.stringify(body.run);
    assert.ok(args.includes('marché adressable'), "l'apport critic est conservé");
    assert.ok(args.includes('fournisseur unique'), "l'apport red_team est conservé");
    // Une sévérité au-delà du seuil doit remonter comme critique.
    assert.ok(body.run.critiques >= 1, 'une attaque sévère est comptée comme critique');
  });

  it('POST eprouver rejette un schéma invalide en 400', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/ideas/${ideaId}/eprouver`, headers: auth(),
      // `argument` est requis, et `severite` doit rester dans [0, 1].
      payload: { apport: { critic: [{ severite: 42 }] } },
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.ok(res.json().issues, 'les erreurs de schéma sont détaillées');
  });

  it('GET eprouver renvoie le rapport cumulé', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/ideas/${ideaId}/eprouver`, headers: auth(),
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(body, 'un rapport est retourné');
    assert.equal(typeof body, 'object');
  });

  it('isolation tenant : une idée d’un autre tenant est introuvable', async () => {
    const foreign = 'eprouver-idea-foreign';
    await ctx.ideas.save(createIdea({
      id: foreign, title: 'Autre tenant', author: 'x@autre.local', tenantId: 'tenant-2',
    }));
    const res = await app.inject({
      method: 'POST', url: `/v1/ideas/${foreign}/eprouver`, headers: auth(), payload: {},
    });
    assert.equal(res.statusCode, 404, res.body);
  });

  it('sans authentification, la route est refusée', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/ideas/${ideaId}/eprouver`,
      headers: { 'content-type': 'application/json' }, payload: {},
    });
    assert.ok(res.statusCode === 401 || res.statusCode === 403, `attendu 401/403, recu ${res.statusCode}`);
  });
});
