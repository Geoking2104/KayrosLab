import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, bearer, registerComex } from './test-helpers.mjs';
import { mentionMatches, SalonXStore, seal, openSeal, hashWrite } from '../lib/salon-x.mjs';

describe('Salon × X', () => {
  it('reconnaît une convocation @handle', () => {
    assert.equal(mentionMatches('vu @gdelatournelle ce soir', 'gdelatournelle'), true);
    assert.equal(mentionMatches('vu gdelatournelle', 'gdelatournelle'), false);
    assert.equal(mentionMatches('@other only', 'gdelatournelle'), false);
  });

  it('scelle et rouvre un jeton', () => {
    const packed = seal('refresh-secret');
    assert.notEqual(packed, 'refresh-secret');
    assert.equal(openSeal(packed), 'refresh-secret');
  });

  let app, ctx;
  beforeEach(async () => {
    process.env.X_CLIENT_ID = 'test-client';
    const built = await buildTestApp();
    app = built.app;
    ctx = built.ctx;
    ctx.xClient = {
      async exchangeCode() {
        return { access_token: 'acc', refresh_token: 'ref', token_type: 'bearer' };
      },
      async me() {
        return { data: { id: '42', username: 'hote', name: 'Hôte' } };
      },
      async getTweet(_tok, id) {
        return { data: { id, text: 'bonjour @hote une question' } };
      },
      async postTweet() {
        return { data: { id: '999' } };
      },
      async deleteTweet() {
        return { data: { deleted: true } };
      },
      async revoke() {},
    };
  });
  afterEach(async () => { if (app) await app.close(); });

  it('exige le SSO et isole le binding', async () => {
    const naked = await app.inject({ method: 'GET', url: '/v1/salon/x/binding' });
    assert.equal(naked.statusCode, 401);

    await registerComex(ctx, { email: 'a@test.local', password: 'secret1234', name: 'A' });
    const tok = await bearer(ctx, 'a@test.local', 'secret1234');

    const start = await app.inject({
      method: 'POST',
      url: '/v1/salon/x/oauth/start',
      headers: { authorization: `Bearer ${tok}` },
      payload: { redirectUri: 'https://www.kayroslab.com/salon/flux/callback', scopes: ['tweet.write'] },
    });
    assert.equal(start.statusCode, 200, start.body);
    const url = new URL(start.json().url);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const state = url.searchParams.get('state');

    const cb = await app.inject({
      method: 'POST',
      url: '/v1/salon/x/oauth/callback',
      headers: { authorization: `Bearer ${tok}` },
      payload: { code: 'abc', state },
    });
    assert.equal(cb.statusCode, 200, cb.body);
    assert.equal(cb.json().binding.handle, 'hote');
    assert.equal(cb.json().binding.accessSealed, undefined);

    const posted = await app.inject({
      method: 'POST',
      url: '/v1/salon/x/tweets',
      headers: { authorization: `Bearer ${tok}` },
      payload: { text: 'réplique', in_reply_to_tweet_id: '1234567890' },
    });
    assert.equal(posted.statusCode, 200, posted.body);
    assert.equal(posted.json().id, '999');

    ctx.xClient.getTweet = async () => ({ data: { id: '1', text: 'sans mention' } });
    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/salon/x/tweets',
      headers: { authorization: `Bearer ${tok}` },
      payload: { text: 'autre', in_reply_to_tweet_id: '1234567891' },
    });
    assert.equal(blocked.statusCode, 403);
  });

  it('refuse un redirect hors pupitre', async () => {
    await registerComex(ctx, { email: 'c@test.local', password: 'secret1234', name: 'C' });
    const tok = await bearer(ctx, 'c@test.local', 'secret1234');
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/salon/x/oauth/start',
      headers: { authorization: `Bearer ${tok}` },
      payload: { redirectUri: 'https://evil.test/cb' },
    });
    assert.equal(bad.statusCode, 400);
  });
});

describe('SalonXStore', () => {
  it('expose un hash d’idempotence', () => {
    const store = new SalonXStore();
    assert.ok(store);
    assert.equal(hashWrite('u', 't', '1').length, 16);
  });
});
