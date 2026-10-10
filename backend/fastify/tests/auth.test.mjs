import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, bearer, registerComex } from './test-helpers.mjs';

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

  it('S17 / N3 : ignores a client-supplied tenantId at registration (tenant fixed server-side)', async () => {
    const reg = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'mallory@test.local', password: 'secret1234', name: 'Mallory', tenantId: 'victim-tenant' },
    });
    assert.equal(reg.statusCode, 200);
    assert.equal(reg.json().user.tenantId, 'default');
    const token = await bearer(ctx, 'mallory@test.local', 'secret1234');
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
    assert.equal(me.json().user.tenantId, 'default');

    // Un COMEX crée un compte privilégié dans son propre tenant, jamais dans celui demandé.
    await registerComex(ctx, { email: 'boss@test.local' });
    const comexToken = await bearer(ctx, 'boss@test.local', 'secret1234');
    const created = await app.inject({
      method: 'POST', url: '/v1/auth/register',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${comexToken}` },
      payload: { email: 'deputy@test.local', password: 'secret1234', role: 'comex', tenantId: 'victim-tenant' },
    });
    assert.equal(created.statusCode, 200);
    assert.equal(created.json().user.tenantId, 't1');
  });

  it('verifies password recovery by email, consumes the link once and revokes prior sessions', async () => {
    await ctx.auth.register({ email: 'recover@test.local', password: 'ancien-secret-2026', name: 'Recover' });
    const previousSession = await bearer(ctx, 'recover@test.local', 'ancien-secret-2026');
    const sent = [];
    let checks = 0;
    ctx.passwordResetMailer = { verify: async () => { checks++; }, send: async (message) => sent.push(message) };

    const unknown = await app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email: 'unknown@test.local' } });
    const known = await app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email: 'recover@test.local' } });
    assert.equal(unknown.statusCode, 202);
    assert.deepEqual(unknown.json(), known.json(), 'la réponse ne doit pas révéler si le compte existe');
    assert.equal(sent.length, 1);
    assert.equal(checks, 2, 'SMTP is checked even for an unknown address');
    assert.equal(sent[0].email, 'recover@test.local');

    const reset = await app.inject({ method: 'POST', url: '/v1/auth/password/reset', payload: { token: sent[0].token, password: 'nouveau-secret-2026' } });
    assert.equal(reset.statusCode, 200);
    await assert.rejects(() => ctx.auth.verify(previousSession), (error) => error.code === 'AUTH_REVOKED');
    await assert.rejects(() => ctx.auth.login({ email: 'recover@test.local', password: 'ancien-secret-2026' }));
    assert.ok((await ctx.auth.login({ email: 'recover@test.local', password: 'nouveau-secret-2026' })).token);

    const reused = await app.inject({ method: 'POST', url: '/v1/auth/password/reset', payload: { token: sent[0].token, password: 'troisieme-secret-2026' } });
    assert.equal(reused.statusCode, 400);
  });

  it('reports missing or unreachable SMTP without looking up an account', async () => {
    ctx.auth.createPasswordReset = async () => { assert.fail('account lookup must follow SMTP readiness'); };
    for (const mailer of [null, {
      verify: async () => { throw Object.assign(new Error('private SMTP details'), { code: 'EAUTH' }); },
      send: async () => { assert.fail('must not send'); },
    }]) {
      ctx.passwordResetMailer = mailer;
      const responses = [];
      for (const email of ['known@test.local', 'unknown@test.local']) {
        const response = await app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email } });
        assert.equal(response.statusCode, 503);
        assert.match(response.json().error, /temporairement indisponible/);
        assert.doesNotMatch(response.body, /private SMTP details|EAUTH/);
        responses.push(response.json());
      }
      assert.deepEqual(responses[0], responses[1]);
    }
  });

  it('does not claim delivery or reveal membership when a recipient is rejected', async () => {
    await ctx.auth.register({ email: 'recover@test.local', password: 'ancien-secret-2026' });
    ctx.passwordResetMailer = {
      verify: async () => true,
      send: async () => { throw Object.assign(new Error('recipient rejected'), { code: 'EENVELOPE' }); },
    };
    const known = await app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email: 'recover@test.local' } });
    const unknown = await app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email: 'unknown@test.local' } });
    assert.equal(known.statusCode, 202);
    assert.deepEqual(known.json(), unknown.json());
    assert.doesNotMatch(known.body, /a été envoyé|vient d’être envoyé|recipient rejected/);
  });

  it('returns the verified identity for synchronization of the SSO password', async () => {
    await ctx.auth.register({ email: 'sync@test.local', password: 'ancien-secret-2026', name: 'Sync' });
    const { token } = await ctx.auth.createPasswordReset({ email: 'sync@test.local' });
    const result = await ctx.auth.resetPassword({ token, password: 'nouveau-secret-2026' });
    assert.equal(result.user.email, 'sync@test.local');
    assert.equal(result.user.name, 'Sync');
    assert.equal(result.user.passwordHash, undefined);
  });
});
