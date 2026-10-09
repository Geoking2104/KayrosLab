// F4 : /v1/swarm/* — un contributeur ne lit ni ne lance les configurations et
// runs d'un autre membre du tenant (404, existence non révélée) ; comex garde
// la vue du tenant. LLM simulé, aucun appel réseau.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { bearer, buildTestApp, registerComex } from './test-helpers.mjs';
import { canAccessRun } from '../routes/swarm.mjs';

describe('contrôle de propriétaire sur /v1/swarm/*', () => {
  let app; let ctx; let alice; let bob; let boss;
  beforeEach(async () => {
    ({ app, ctx } = await buildTestApp());
    await registerComex(ctx);
    boss = { authorization: `Bearer ${await bearer(ctx, 'comex@test.local', 'secret1234')}` };
    for (const name of ['alice', 'bob']) {
      await ctx.auth.register({ email: `${name}@test.local`, password: 'secret1234', name, role: 'contributeur', tenantId: 't1' });
    }
    alice = { authorization: `Bearer ${await bearer(ctx, 'alice@test.local', 'secret1234')}` };
    bob = { authorization: `Bearer ${await bearer(ctx, 'bob@test.local', 'secret1234')}` };
    ctx.engine.swarm.llm = { complete: async () => ({ text: JSON.stringify({ verdict: 'GO', primary_reason: 'ok', critical_risks: [], required_mitigations: [], unverified_assumptions: [] }), usage: {} }) };
  });
  afterEach(async () => { if (app) await app.close(); });

  it('isole configurations et runs entre contributeurs, comex voit tout', async () => {
    const created = await app.inject({ method: 'POST', url: '/v1/swarm/configurations', headers: alice, payload: { swarm_id: 'alice_swarm', swarm_name: 'Alice', active_agents: ['cfo', 'cto'], voting_threshold: 'majority' } });
    assert.equal(created.statusCode, 201, created.body);
    const run = await app.inject({ method: 'POST', url: '/v1/swarm/configurations/alice_swarm/run', headers: alice, payload: { question: 'Lancer ?' } });
    assert.equal(run.statusCode, 202, run.body);
    const runId = run.json().run_id;
    assert.ok(run.json().created_by, 'le run porte son auteur');

    for (const [method, url, payload] of [
      ['GET', '/v1/swarm/configurations/alice_swarm'],
      ['POST', '/v1/swarm/configurations/alice_swarm/run', { question: 'Lancer ?' }],
      ['GET', `/v1/swarm/runs/${runId}`],
      ['GET', `/v1/swarm/runs/${runId}/dossier`],
    ]) {
      const denied = await app.inject({ method, url, headers: bob, ...(payload ? { payload } : {}) });
      assert.equal(denied.statusCode, 404, `${method} ${url} doit être masqué pour un autre contributeur`);
      const own = await app.inject({ method, url, headers: alice, ...(payload ? { payload } : {}) });
      assert.ok([200, 202].includes(own.statusCode), `${method} ${url} reste accessible à son auteur`);
      const comex = await app.inject({ method, url, headers: boss, ...(payload ? { payload } : {}) });
      assert.ok([200, 202].includes(comex.statusCode), `${method} ${url} reste accessible au comex`);
    }
  });

  it('un run antérieur à created_by est attribué via son audit de fin', () => {
    const legacy = { run_id: 'r1', audit: [{ type: 'swarm.run.completed', by: 'u-alice' }] };
    assert.equal(canAccessRun({ sub: 'u-alice', role: 'contributeur' }, legacy), true);
    assert.equal(canAccessRun({ sub: 'u-bob', role: 'contributeur' }, legacy), false);
    assert.equal(canAccessRun({ sub: 'u-boss', role: 'comex' }, legacy), true);
  });
});
