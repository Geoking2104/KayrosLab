import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';
import cycleRoute from '../routes/cycle.mjs';
import resumeRoute from '../routes/resume.mjs';

const COMEX = 'comex@kayros.local';

/**
 * Boucle complete par HTTP seulement : un run sur le graphe unifie suspend
 * sur l'arbitrage humain, atterrit dans le store, et repart par la route de
 * reprise. C'est la preuve que le moteur est atteignable de bout en bout.
 */
describe('backend cycle : preset de graphe et boucle de reprise', () => {
  let app, ctx, t;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    // Gouvernance qui ne resout jamais : le cas de production ou l'humain
    // n'a pas encore tranche.
    let n = 0;
    ctx.governance.open = () => ({ gateId: `g${++n}`, promise: new Promise(() => {}) });
    ctx.engine.orchestrator.governance = ctx.governance;
    await app.register(cycleRoute);
    await app.register(resumeRoute);
    await registerComex(ctx, { email: COMEX, name: 'Comex' });
    t = await bearer(ctx, COMEX, 'secret1234');
  });
  after(async () => { if (app) await app.close(); });

  const auth = () => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
  const quiet = {
    stream: false, positionning: false, autoDistill: false, offload: false,
    frameControl: false, worldModel: false, adaptive: false, syncIdea: false,
  };

  it('refuse un preset inconnu au niveau du schema', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/cycle/run', headers: auth(),
      payload: { query: 'Evaluer une offre', preset: 'inconnu', ...quiet },
    });
    assert.equal(res.statusCode, 400, res.body);
  });

  it('sans preset, le comportement historique est inchange', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/cycle/run', headers: auth(),
      payload: { query: 'Evaluer une offre', llmPlan: false, ...quiet },
    });
    assert.equal(res.statusCode, 200, res.body);
    const suspendus = await ctx.runStore.list({ tenantId: 't1' });
    assert.equal(suspendus.length, 0, 'aucun gate n’est introduit derriere l’appelant');
  });

  it('le preset unifie suspend sur l’arbitrage et persiste le run', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/cycle/run', headers: auth(),
      payload: {
        query: 'Evaluer puis documenter une offre',
        preset: 'unified',
        presetOptions: { reviseRounds: 1, writerAttempts: 2 },
        ...quiet,
      },
    });
    // 202 : accepte, en attente d'une decision humaine. Un run suspendu
    // n'est pas un run termine et ne doit pas se presenter comme tel.
    assert.equal(res.statusCode, 202, res.body);

    const suspendus = await ctx.runStore.list({ tenantId: 't1' });
    assert.equal(suspendus.length, 1, 'le run suspendu est persiste');
    assert.equal(suspendus[0].gate.type, 'decision_arbitrage');
    assert.equal(suspendus[0].gate.nodeId, 'decision-gate');
  });

  it('la route de reprise voit le run et le relance sur decision', async () => {
    const liste = await app.inject({ method: 'GET', url: '/v1/runs/suspended', headers: auth() });
    assert.equal(liste.statusCode, 200, liste.body);
    const runId = liste.json().runs[0].runId;

    const detail = await app.inject({ method: 'GET', url: `/v1/runs/${runId}`, headers: auth() });
    assert.equal(detail.json().gate.type, 'decision_arbitrage');

    const reprise = await app.inject({
      method: 'POST', url: `/v1/runs/${runId}/resume`, headers: auth(),
      payload: { decision: 'approve', reason: 'go', stream: false },
    });
    assert.equal(reprise.statusCode, 200, reprise.body);
    const nodes = reprise.json().events.filter((e) => e.type === 'trace').map((e) => e.nodeId);
    assert.ok(nodes.includes('simulator'), 'la phase livrable demarre apres le Go');
    assert.ok(nodes.includes('writer'));
  });

  it('un veto par HTTP bloque le run sans produire de livrable', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/cycle/run', headers: auth(),
      payload: { query: 'Idee hors strategie', preset: 'unified', ...quiet },
    });
    assert.equal(res.statusCode, 202, res.body);
    const runs = await ctx.runStore.list({ tenantId: 't1' });
    const runId = runs.at(-1).runId;

    const veto = await app.inject({
      method: 'POST', url: `/v1/runs/${runId}/resume`, headers: auth(),
      payload: { decision: 'veto', reason: 'hors strategie', stream: false },
    });
    assert.equal(veto.statusCode, 200, veto.body);
    assert.equal(veto.json().final.status, 'blocked_veto');
    const nodes = veto.json().events.filter((e) => e.type === 'trace').map((e) => e.nodeId);
    assert.ok(!nodes.includes('writer'), 'un veto ne coute aucune production');
    assert.equal(await ctx.runStore.get(runId, { tenantId: 't1' }), null);
  });
});
