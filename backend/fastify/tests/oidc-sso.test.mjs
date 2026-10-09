import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { buildTestApp } from './test-helpers.mjs';
import {
  authorizeUrl,
  googleConfigFromEnv,
  publicAuthProviders,
  oidcConfigFromEnv,
  isAllowedRedirect,
  pkceChallenge,
  verifyIdToken,
} from '../lib/oidc.mjs';

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function signIdToken(privateKey, payload, kid = 'sso-test') {
  const h = b64urlJson({ alg: 'RS256', typ: 'JWT', kid });
  const p = b64urlJson(payload);
  const signer = createSign('RSA-SHA256');
  signer.update(`${h}.${p}`);
  signer.end();
  return `${h}.${p}.${signer.sign(privateKey, 'base64url')}`;
}

describe('SSO OpenID Connect', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'sso-test';
  jwk.use = 'sig';
  jwk.alg = 'RS256';

  const issuer = 'https://sso.kayroslab.com';
  const clientId = 'kayroslab-console';
  const nonce = 'nonce-sso-test-value';
  const discovery = {
    issuer,
    authorization_endpoint: `${issuer}/api/oidc/authorization`,
    token_endpoint: `${issuer}/api/oidc/token`,
    jwks_uri: `${issuer}/jwks.json`,
  };

  it('construit l’URL d’autorisation depuis la découverte', () => {
    const url = authorizeUrl(
      {
        clientId,
        authorizationEndpoint: discovery.authorization_endpoint,
      },
      {
        redirectUri: 'https://www.kayroslab.com/console/',
        state: 'abc',
        challenge: pkceChallenge('verifier-verifier-verifier-verifier-1234567'),
        nonce,
      },
    );
    assert.match(url, /https:\/\/sso\.kayroslab\.com\/api\/oidc\/authorization\?/);
    assert.match(url, /code_challenge_method=S256/);
    assert.match(url, /scope=openid\+profile\+email/);
  });

  it('n’accepte que les redirect_uri de la console et du salon', () => {
    assert.equal(isAllowedRedirect('https://www.kayroslab.com/console/', 'https://www.kayroslab.com/console'), true);
    assert.equal(isAllowedRedirect('https://www.kayroslab.com/salon/', 'https://www.kayroslab.com/console'), true);
    assert.equal(isAllowedRedirect('https://www.kayroslab.com/salon/index.html', 'https://www.kayroslab.com/console'), true);
    assert.equal(isAllowedRedirect('http://localhost:4174/salon/', 'https://www.kayroslab.com/console'), true);
    assert.equal(isAllowedRedirect('https://evil.example/console/', 'https://www.kayroslab.com/console'), false);
    assert.equal(isAllowedRedirect('https://evil.example/salon/', 'https://www.kayroslab.com/console'), false);
  });

  it('vérifie un id_token RS256', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signIdToken(privateKey, {
      iss: issuer,
      aud: clientId,
      email: 'sso@test.local',
      email_verified: true,
      name: 'Sso',
      sub: 'authelia|abc',
      nonce,
      iat: now,
      exp: now + 300,
    });
    const payload = verifyIdToken(token, { issuer, audience: clientId, jwks: [jwk], nonce });
    assert.equal(payload.email, 'sso@test.local');
  });

  it('désactive le SSO sans émetteur', () => {
    const config = oidcConfigFromEnv({ OIDC_ISSUER: '', OIDC_CLIENT_ID: clientId });
    assert.equal(config.enabled, false);
  });

  it('expose Google comme fournisseur séparé quand ses secrets sont configurés', () => {
    const google = googleConfigFromEnv({ GOOGLE_OAUTH_CLIENT_ID: 'google-client', GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret' });
    const config = publicAuthProviders({ enabled: false }, google);
    assert.equal(google.enabled, true);
    assert.deepEqual(config.providers, [{ id: 'google', label: 'Google' }]);
  });

  let app, ctx;
  beforeEach(async () => {
    const built = await buildTestApp({
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: clientId,
    });
    app = built.app;
    ctx = built.ctx;
  });
  afterEach(async () => { if (app) await app.close(); });

  it('expose la config publique et échange un code PKCE', async () => {
    const advertised = await app.inject({ method: 'GET', url: '/v1/auth/sso' });
    assert.equal(advertised.statusCode, 200);
    assert.equal(advertised.json().enabled, true);
    assert.equal(advertised.json().provider, 'oidc');
    assert.equal(advertised.json().clientId, clientId);

    const now = Math.floor(Date.now() / 1000);
    const idToken = signIdToken(privateKey, {
      iss: issuer,
      aud: clientId,
      email: 'Geoff.SSO@Test.local',
      email_verified: true,
      name: 'Geoff SSO',
      sub: 'authelia|geoff',
      nonce,
      iat: now,
      exp: now + 300,
    });
    ctx.oidcDiscovery = discovery;
    ctx.oidcJwks = [jwk];
    ctx.oidcFetch = async () => ({
      ok: true,
      json: async () => ({ id_token: idToken, token_type: 'Bearer' }),
    });

    const started = await app.inject({
      method: 'POST',
      url: '/v1/auth/sso/start',
      payload: {
        redirectUri: 'https://www.kayroslab.com/console/',
        state: 'state-value-xx',
        challenge: pkceChallenge('verifier-verifier-verifier-verifier-1234567'),
        nonce,
      },
    });
    assert.equal(started.statusCode, 200);
    assert.match(started.json().url, /client_id=kayroslab-console/);
    assert.match(started.json().url, /\/api\/oidc\/authorization/);

    const callback = await app.inject({
      method: 'POST',
      url: '/v1/auth/sso/callback',
      payload: {
        code: 'oidc-one-time-code',
        codeVerifier: 'verifier-verifier-verifier-verifier-1234567',
        redirectUri: 'https://www.kayroslab.com/console/',
        nonce,
      },
    });
    assert.equal(callback.statusCode, 200, callback.body);
    assert.equal(callback.json().user.email, 'geoff.sso@test.local');
    assert.ok(callback.json().token);
  });

  it('connecte Google directement avec PKCE et authentifie la session KayrosLab', async () => {
    ctx.google = googleConfigFromEnv({ GOOGLE_OAUTH_CLIENT_ID: 'google-test-client', GOOGLE_OAUTH_CLIENT_SECRET: 'google-test-secret' });
    const googleDiscovery = {
      issuer: ctx.google.issuer,
      authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_endpoint: 'https://oauth2.googleapis.com/token',
      jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
    };
    const redirectUri = 'https://www.kayroslab.com/console/';
    const codeVerifier = 'google-verifier-verifier-verifier-verifier-1234567';
    const now = Math.floor(Date.now() / 1000);
    ctx.googleFetch = async (url, options) => {
      if (url.endsWith('/.well-known/openid-configuration')) return { ok: true, json: async () => googleDiscovery };
      assert.equal(url, googleDiscovery.token_endpoint);
      assert.equal(options.body.get('client_id'), ctx.google.clientId);
      assert.equal(options.body.get('client_secret'), ctx.google.clientSecret);
      assert.equal(options.body.get('code_verifier'), codeVerifier);
      assert.equal(options.body.get('redirect_uri'), redirectUri);
      return { ok: true, json: async () => ({ id_token: signIdToken(privateKey, {
        iss: 'accounts.google.com', aud: ctx.google.clientId, sub: 'google-user-123',
        email: 'google@test.local', email_verified: true, nonce, iat: now, exp: now + 300,
      }) }) };
    };
    ctx.googleJwks = [jwk];
    const advertised = await app.inject({ method: 'GET', url: '/v1/auth/sso' });
    assert.equal(advertised.json().providers[0].id, 'google');
    assert.equal(advertised.body.includes('google-test-secret'), false);
    const started = await app.inject({ method: 'POST', url: '/v1/auth/sso/start', payload: {
      provider: 'google', redirectUri, state: 'google-state-test', nonce, challenge: pkceChallenge(codeVerifier),
    } });
    assert.equal(started.statusCode, 200, started.body);
    const url = new URL(started.json().url);
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('client_id'), ctx.google.clientId);
    const callback = await app.inject({ method: 'POST', url: '/v1/auth/sso/callback', payload: {
      provider: 'google', code: 'google-code', codeVerifier, redirectUri, nonce,
    } });
    assert.equal(callback.statusCode, 200, callback.body);
    assert.equal(callback.json().user.role, 'contributeur');
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${callback.json().token}` } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.email, 'google@test.local');
  });

  it('refuse les jetons Google avec mauvaise audience, nonce ou expiration', () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: 'https://accounts.google.com', aud: 'google-test-client', sub: 'google-user', nonce, iat: now, exp: now + 300 };
    for (const patch of [{ aud: 'another-client' }, { nonce: 'another-nonce' }, { exp: now - 1 }, { exp: undefined }, { sub: '' }]) {
      assert.throws(() => verifyIdToken(signIdToken(privateKey, { ...claims, ...patch }), {
        issuer: claims.iss, audience: claims.aud, nonce, jwks: [jwk],
      }), { code: 'OIDC_TOKEN' });
    }
  });

  it('refuse un redirect_uri étranger', async () => {
    ctx.oidcDiscovery = discovery;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/sso/start',
      payload: {
        redirectUri: 'https://evil.example/',
        state: 'state-value-xx',
        challenge: pkceChallenge('verifier-verifier-verifier-verifier-1234567'),
        nonce,
      },
    });
    assert.equal(res.statusCode, 400);
  });
});
