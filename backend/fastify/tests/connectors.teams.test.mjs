import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { buildTestApp, registerComex, bearer } from './test-helpers.mjs';

const APP_ID = '8f3b2a1c-0000-1111-2222-333344445555';

function teamsKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  return { keys: [{ kty: 'RSA', kid: 'k1', use: 'sig', alg: 'RS256', n: jwk.n, e: jwk.e }], privateKey };
}

function signToken(privateKey, claims = {}) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = { kid: 'k1', alg: 'RS256', typ: 'JWT' };
  const body = { iss: 'https://api.botframework.com', aud: APP_ID, exp: Math.floor(Date.now() / 1000) + 3600, ...claims };
  const data = `${b64(header)}.${b64(body)}`;
  const sig = createSign('RSA-SHA256').update(data).end().sign(privateKey);
  return `${data}.${sig.toString('base64url')}`;
}

function invoke(token, actionId, payload = {}) {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  return {
    method: 'POST',
    url: '/v1/connectors/teams/interactive',
    headers,
    payload: {
      type: 'invoke', name: 'adaptiveCard/action',
      from: { id: 'W1', aadObjectId: 'smokeA1' }, conversation: { id: 'conv:1' },
      value: { action: { id: actionId, data: { ...payload, actionId } } },
    },
  };
}

describe('backend /v1/connectors/teams/interactive', () => {
  let app, ctx, bearerToken, keys, jwtToken;
  beforeEach(async () => {
    const built = await buildTestApp();
    app = built.app; ctx = built.ctx;
    keys = teamsKeys();
    // stub de verification (cache JWKS) + post webhook
    ctx.teamsAdapter._keyCache.set(keys.keys);
    ctx.teamsAdapter._fetch = async (url, opts) => ({ ok: true });
    await registerComex(ctx);
    bearerToken = await bearer(ctx, 'comex@test.local', 'secret1234');
    jwtToken = signToken(keys.privateKey);
  });
  afterEach(async () => { if (app) await app.close(); });

  it('rejects unsigned requests with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/connectors/teams/interactive', headers: { 'content-type': 'application/json' }, payload: { type: 'invoke', name: 'adaptiveCard/action', value: { action: { id: 'ping' } } } });
    assert.equal(res.statusCode, 401);
  });

  it('approves a gate and resolves it (proactive resolve)', async () => {
    // creer l'identite liée + un gate
    const link = await app.inject({
      method: 'POST', url: '/v1/connectors/link',
      headers: { authorization: `Bearer ${bearerToken}`, 'content-type': 'application/json' },
      payload: { platformId: 'teams:smokeA1', userId: 'W1', platform: 'teams' },
    });
    assert.equal(link.statusCode, 200);
    const linkToken = link.json().token;
    const finalize = await app.inject({ method: 'POST', url: `/v1/connectors/link/${linkToken}`, headers: { authorization: `Bearer ${bearerToken}` } });
    assert.equal(finalize.statusCode, 200);
    assert.equal(finalize.json().platformId, 'teams:smokeA1');

    const { gateId } = ctx.governance.open({ ideaId: 'smoke-idea', type: 'comex_arbitrage', requiredRole: 'comex' });
    const res = await app.inject(invoke(jwtToken, `approve:${gateId}`));
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().statusCode, 200);
    assert.equal(ctx.governance.list().length, 0);
  });

  it('opens a motif Task Module on reject then resolves with reason', async () => {
    const link = await app.inject({
      method: 'POST', url: '/v1/connectors/link',
      headers: { authorization: `Bearer ${bearerToken}`, 'content-type': 'application/json' },
      payload: { platformId: 'teams:smokeA1', userId: 'W1', platform: 'teams' },
    });
    const tk = link.json().token;
    await app.inject({ method: 'POST', url: `/v1/connectors/link/${tk}`, headers: { authorization: `Bearer ${bearerToken}` } });

    const { gateId } = ctx.governance.open({ ideaId: 'smoke-idea2', type: 'comex_arbitrage', requiredRole: 'comex' });
    const res = await app.inject(invoke(jwtToken, `reject:${gateId}`));
    const j = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(j.type, 'application/vnd.microsoft.card.adaptive');
    assert.equal(j.value.body.some((b) => b.type === 'Input.Text' && b.id === 'reason'), true);
    assert.equal(j.value.actions[0].data.actionId, `gate_motif:reject:${gateId}`);

    const resub = await app.inject(invoke(jwtToken, `gate_motif:reject:${gateId}`, { reason: 'Non aligne strategie' }));
    assert.equal(resub.statusCode, 200);
    assert.equal(resub.json().statusCode, 200);
    assert.equal(ctx.governance.list().length, 0);
  });

  it('returns 200 {statusCode:200} for a plain message (no retry)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/connectors/teams/interactive',
      headers: { authorization: `Bearer ${jwtToken}`, 'content-type': 'application/json' },
      payload: { type: 'message', text: 'bonjour', from: { id: 'W1' } },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().statusCode, 200);
  });
});
