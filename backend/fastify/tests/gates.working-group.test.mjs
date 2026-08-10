import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';
import { createIdea } from '../../../core/model.mjs';

const ideaId = 'wg-idea-1';
const COMEX1 = 'comex1@kayros.local';
const COMEX2 = 'comex2@kayros.local';

describe('backend working-group + gate vote flow', () => {
  let app, ctx, g1, t1, t2;
  before(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    await registerComex(ctx, { email: COMEX1, name: 'Comex One' });
    await registerComex(ctx, { email: COMEX2, name: 'Comex Two' });
    t1 = await bearer(ctx, COMEX1, 'secret1234');
    t2 = await bearer(ctx, COMEX2, 'secret1234');
    await ctx.ideas.save(createIdea({ id: ideaId, title: 'WG demo idea', author: COMEX1, tenantId: 't1' }));
    const opened = await app.inject({
      method: 'POST', url: `/v1/ideas/${ideaId}/gates`,
      headers: { authorization: `Bearer ${t1}`, 'content-type': 'application/json' },
      payload: { type: 'comex_arbitrage', requiredRole: 'comex' },
    });
    assert.equal(opened.statusCode, 201, opened.body);
    g1 = opened.json().gateId;
  });
  after(async () => { if (app) await app.close(); });

  const auth = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
  const members = [{ email: COMEX1, role: 'comex' }, { email: COMEX2, role: 'comex' }];

  it('non-membre cannot vote', async () => {
    await app.inject({ method: 'POST', url: `/v1/ideas/${ideaId}/working-group`, headers: auth(t1), payload: { members, quorum: 0.6 } });
    await registerComex(ctx, { email: 'stranger@kayros.local', name: 'Stranger' });
    const tStr = await bearer(ctx, 'stranger@kayros.local', 'secret1234');
    const vote = await app.inject({ method: 'POST', url: `/v1/gates/${g1}/votes`, headers: auth(tStr), payload: { score: 90 } });
    assert.equal(vote.statusCode, 403);
  });

  it('member votes evolve quorum status', async () => {
    const v1 = await app.inject({ method: 'POST', url: `/v1/gates/${g1}/votes`, headers: auth(t1), payload: { score: 80 } });
    assert.equal(v1.statusCode, 200);
    assert.equal(v1.json().status, 'en_attente'); // 1/2 = 50% < 60% quorum

    const v2 = await app.inject({ method: 'POST', url: `/v1/gates/${g1}/votes`, headers: auth(t2), payload: { score: 40 } });
    assert.equal(v2.statusCode, 200);
    const agg = v2.json();
    assert.equal(agg.participants, 2);
    assert.equal(agg.quorum, true);
    assert.equal(agg.status, 'quorum_ok');
    assert.ok(['Go', 'No-Go', 'Révision'].includes(agg.recommandation));
  });

  it('GET votes returns agregat + participations', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/gates/${g1}/votes`, headers: auth(t1) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().participants, 2);
    assert.equal(res.json().eligible, 2);
  });
});
