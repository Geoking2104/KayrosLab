import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { buildTestApp } from './test-helpers.mjs';
import {
  authorizeUrl,
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

  it('n’accepte que les redirect_uri de la console', () => {
    assert.equal(isAllowedRedirect('https://www.kayroslab.com/console/', 'https://www.kayroslab.com/console'), true);
    assert.equal(isAllowedRedirect('https://evil.example/console/', 'https://www.kayroslab.com/console'), false);
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
