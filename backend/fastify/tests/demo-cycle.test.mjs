import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp } from './test-helpers.mjs';
import demoCycleRoute from '../routes/demo-cycle.mjs';

/**
 * La demo publique tourne sur le vrai moteur. Comme elle est publique, ce qui
 * compte n'est pas seulement qu'elle reponde, mais ce qu'elle refuse de faire :
 * pas d'authentification requise, donc pas de memoire, pas de persistance, pas
 * de gate bloquant, et un budget borne.
 */
describe('backend demo publique sur le moteur', () => {
  let app, ctx;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    await app.register(demoCycleRoute);
  });
  after(async () => { if (app) await app.close(); });

  const json = { 'content-type': 'application/json' };

  it('repond sans authentification', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/demo/cycle/run', headers: json,
      payload: { query: 'Evaluer une offre de diagnostic', stream: false },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.ok(Array.isArray(body.events) && body.events.length > 0);
    assert.equal(body.preset, 'kayros');
  });

  it('execute reellement le graphe, pas une suite de prompts', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/demo/cycle/run', headers: json,
      payload: { query: 'Evaluer une offre', stream: false },
    });
    const events = res.json().events;
    const start = events.find((e) => e.type === 'start');
    assert.ok(start?.graph, 'la topologie du graphe est exposee');
    assert.ok(start.graph.nodes.length >= 4);
    // Les agents dialectiques ont bien tourne, avec leurs identifiants de noeud.
    const nodes = events.filter((e) => e.type === 'trace').map((e) => e.nodeId);
    assert.ok(nodes.includes('critic'), 'le Critic a tourne');
    assert.ok(nodes.includes('synthesizer'), 'le Synthesizer a tourne');
    assert.ok(events.some((e) => e.type === 'final'));
  });

  it('n’expose ni l’etat complet ni les rouages internes', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/demo/cycle/run', headers: json,
      payload: { query: 'Evaluer une offre', stream: false },
    });
    const raw = res.body;
    // workflowState porte le graphe entier et jusqu'a 500 entrees de journal.
    assert.equal(raw.includes('"workflowState"'), false);
    assert.equal(raw.includes('"permissions"'), false, 'les permissions restent internes');
    assert.equal(raw.includes('"maxAttempts"'), false, 'les budgets restent internes');
    const start = res.json().events.find((e) => e.type === 'start');
    assert.equal(start.graph.nodes[0].permissions, undefined);
  });

  it('n’ecrit rien : ni idee, ni run store, ni journal', async () => {
    const avantIdees = (await ctx.ideas.list?.({}))?.length ?? 0;
    const avantRuns = (await ctx.runStore.list()).length;
    await app.inject({
      method: 'POST', url: '/v1/demo/cycle/run', headers: json,
      payload: { query: 'Evaluer une offre', stream: false },
    });
    const apresIdees = (await ctx.ideas.list?.({}))?.length ?? 0;
    assert.equal(apresIdees, avantIdees, 'aucune idee creee');
    assert.equal((await ctx.runStore.list()).length, avantRuns, 'aucun run persiste');
  });

  it('un gate suspend et rend la main au lieu de bloquer', async () => {
    // Le preset unifie s'arrete sur l'arbitrage humain. Une demo publique ne
    // doit pas tenir une connexion ouverte en attendant une decision.
    ctx.engine.orchestrator.governance = {
      open: () => ({ gateId: 'g1', promise: new Promise(() => {}) }),
    };
    const res = await app.inject({
      method: 'POST', url: '/v1/demo/cycle/run', headers: json,
      payload: { query: 'Evaluer une offre', preset: 'unified', stream: false },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().final.status, 'pending_review');
    assert.equal(res.json().final.gateType, 'decision_arbitrage');
  });

  it('refuse une requete hors schema', async () => {
    for (const payload of [{}, { query: 'ab' }, { query: 'x'.repeat(2001) }, { query: 'ok mais', preset: 'inconnu' }]) {
      const res = await app.inject({
        method: 'POST', url: '/v1/demo/cycle/run', headers: json, payload,
      });
      assert.equal(res.statusCode, 400, JSON.stringify(payload));
    }
  });

  it('la limite de debit est bien plus stricte que la limite globale', async () => {
    // Un cycle complet coute plusieurs appels LLM : 100/minute serait une
    // invitation a vider le budget.
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../routes/demo-cycle.mjs', import.meta.url), 'utf8');
    assert.match(source, /rateLimit: \{ max: 5, timeWindow: '1 minute' \}/);
    // Et les brides sont explicites dans le code, pas supposees.
    for (const bride of ['recall: false', 'remember: false', 'positionning: false',
      'runStore: null', 'waitNodeGate: false', 'maxSteps: DEMO_MAX_STEPS']) {
      assert.ok(source.includes(bride), `bride manquante : ${bride}`);
    }
  });
});
