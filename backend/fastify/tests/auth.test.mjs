import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, bearer } from './test-helpers.mjs';

describe('backend auth flow', () => {
  let app, ctx;
  beforeEach(async () => { const built = await buildTestApp(); app = built.app; ctx = built.ctx; });
  afterEach(async () => { if (app) await app.close(); });

  it('registers, logs in and authenticates a bearer token', async () => {
    const reg = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'alice@test.local', password: 'secret1234', name: 'Alice' },
    });
    assert.equal(reg.statusCode, 200);
    assert.equal(reg.json().user.role, 'contributeur');

    const token = await bearer(ctx, 'alice@test.local', 'secret1234');

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.email, 'alice@test.local');
    assert.equal(me.json().user.role, 'contributeur');

    const bad = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: 'Bearer nope' } });
    assert.equal(bad.statusCode, 401);
  });

  it('verifies password recovery by email, consumes the link once and revokes prior sessions', async () => {
    await ctx.auth.register({ email: 'recover@test.local', password: 'ancien-secret-2026', name: 'Recover' });
    const previousSession = await bearer(ctx, 'recover@test.local', 'ancien-secret-2026');
    const sent = [];
    ctx.passwordResetMailer = { send: async (message) => sent.push(message) };

    const unknown = await app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email: 'unknown@test.local' } });
    const known = await app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email: 'recover@test.local' } });
    assert.equal(unknown.statusCode, 202);
    assert.deepEqual(unknown.json(), known.json(), 'la réponse ne doit pas révéler si le compte existe');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].email, 'recover@test.local');

    const reset = await app.inject({ method: 'POST', url: '/v1/auth/password/reset', payload: { token: sent[0].token, password: 'nouveau-secret-2026' } });
    assert.equal(reset.statusCode, 200);
    await assert.rejects(() => ctx.auth.verify(previousSession), (error) => error.code === 'AUTH_REVOKED');
    await assert.rejects(() => ctx.auth.login({ email: 'recover@test.local', password: 'ancien-secret-2026' }));
    assert.ok((await ctx.auth.login({ email: 'recover@test.local', password: 'nouveau-secret-2026' })).token);

    const reused = await app.inject({ method: 'POST', url: '/v1/auth/password/reset', payload: { token: sent[0].token, password: 'troisieme-secret-2026' } });
    assert.equal(reused.statusCode, 400);
  });
});
