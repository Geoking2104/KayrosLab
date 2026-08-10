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
});
