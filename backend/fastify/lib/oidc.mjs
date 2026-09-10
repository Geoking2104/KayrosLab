import { createPublicKey, createVerify, createHash, randomBytes } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const unb64url = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(pad + '==='.slice((pad.length + 3) % 4), 'base64');
};

export const KAYROS_OIDC_CLIENT_ID = 'kayroslab-console';

export function oidcConfigFromEnv(env = process.env) {
  const issuer = String(env.OIDC_ISSUER || '').replace(/\/$/, '').trim();
  const clientId = String(env.OIDC_CLIENT_ID || '').trim();
  const clientSecret = String(env.OIDC_CLIENT_SECRET || '').trim();
  const audience = String(env.OIDC_AUDIENCE || clientId).trim();
  return {
    issuer,
    clientId,
    clientSecret,
    audience,
    enabled: Boolean(issuer && clientId),
  };
}

export function publicSsoConfig(config) {
  if (!config?.enabled) return { enabled: false, provider: 'oidc' };
  return {
    enabled: true,
    provider: 'oidc',
    issuer: config.issuer,
    clientId: config.clientId,
  };
}

export function pkceChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function randomToken(bytes = 32) {
  return b64url(randomBytes(bytes));
}

export async function loadDiscovery(config, { fetchImpl = fetch } = {}) {
  if (!config?.issuer) {
    const e = new Error('émetteur OIDC manquant'); e.code = 'OIDC_DISCOVERY'; throw e;
  }
  const res = await fetchImpl(`${config.issuer}/.well-known/openid-configuration`);
  if (!res.ok) {
    const e = new Error(`découverte OIDC injoignable (${res.status})`); e.code = 'OIDC_DISCOVERY'; throw e;
  }
  const doc = await res.json();
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    const e = new Error('découverte OIDC incomplète'); e.code = 'OIDC_DISCOVERY'; throw e;
  }
  return {
    ...config,
    issuer: String(doc.issuer || config.issuer).replace(/\/$/, ''),
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    jwksUri: doc.jwks_uri,
    discovery: doc,
  };
}

export function authorizeUrl(discovered, { redirectUri, state, challenge, nonce }) {
  const url = new URL(discovered.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', discovered.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

const jwksCache = new Map();

export async function fetchJwks(jwksUri, { fetchImpl = fetch, now = Date.now, ttlMs = 3600_000 } = {}) {
  const cached = jwksCache.get(jwksUri);
  if (cached && cached.exp > now()) return cached.keys;
  const res = await fetchImpl(jwksUri);
  if (!res.ok) throw new Error(`jwks OIDC injoignable (${res.status})`);
  const body = await res.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(jwksUri, { keys, exp: now() + ttlMs });
  return keys;
}

export function verifyIdToken(token, { issuer, audience, jwks, nonce, now = () => Math.floor(Date.now() / 1000) }) {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    const e = new Error('id_token OIDC invalide'); e.code = 'OIDC_TOKEN'; throw e;
  }
  const [h, p, s] = token.split('.');
  let header;
  let payload;
  try {
    header = JSON.parse(unb64url(h).toString('utf8'));
    payload = JSON.parse(unb64url(p).toString('utf8'));
  } catch {
    const e = new Error('id_token OIDC illisible'); e.code = 'OIDC_TOKEN'; throw e;
  }
  if (header.alg !== 'RS256') {
    const e = new Error('id_token OIDC : algorithme refusé'); e.code = 'OIDC_TOKEN'; throw e;
  }
  const jwk = (jwks || []).find((k) => k.kid === header.kid && k.kty === 'RSA')
    || (jwks || []).find((k) => k.kty === 'RSA');
  if (!jwk) {
    const e = new Error('id_token OIDC : clé inconnue'); e.code = 'OIDC_TOKEN'; throw e;
  }
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const verify = createVerify('RSA-SHA256');
  verify.update(`${h}.${p}`);
  verify.end();
  if (!verify.verify(key, unb64url(s))) {
    const e = new Error('id_token OIDC : signature'); e.code = 'OIDC_TOKEN'; throw e;
  }
  const iss = String(issuer || '').replace(/\/?$/, '/');
  const gotIss = String(payload.iss || '').replace(/\/?$/, '/');
  if (gotIss !== iss) {
    const e = new Error('id_token OIDC : émetteur'); e.code = 'OIDC_TOKEN'; throw e;
  }
  const aud = payload.aud;
  const audOk = aud === audience || (Array.isArray(aud) && aud.includes(audience));
  if (!audOk) {
    const e = new Error('id_token OIDC : audience'); e.code = 'OIDC_TOKEN'; throw e;
  }
  if (typeof payload.exp === 'number' && now() >= payload.exp) {
    const e = new Error('id_token OIDC : expiré'); e.code = 'OIDC_TOKEN'; throw e;
  }
  if (nonce && payload.nonce !== nonce) {
    const e = new Error('id_token OIDC : nonce'); e.code = 'OIDC_TOKEN'; throw e;
  }
  return payload;
}

export async function exchangeAuthorizationCode(discovered, {
  code, redirectUri, codeVerifier, fetchImpl = fetch,
}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: discovered.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  if (discovered.clientSecret) body.set('client_secret', discovered.clientSecret);
  const res = await fetchImpl(discovered.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.id_token) {
    const e = new Error(json.error_description || json.error || `échange OIDC refusé (${res.status})`);
    e.code = 'OIDC_EXCHANGE';
    throw e;
  }
  return json;
}

export function isAllowedRedirect(uri, consoleUrl) {
  let parsed;
  try { parsed = new URL(uri); } catch { return false; }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    return false;
  }
  const candidates = new Set();
  const add = (value) => {
    if (!value) return;
    candidates.add(String(value).replace(/\/+$/, ''));
    candidates.add(`${String(value).replace(/\/+$/, '')}/`);
  };
  add(consoleUrl);
  add('https://www.kayroslab.com/console/');
  add('http://localhost:4174/console/');
  add('http://127.0.0.1:4174/console/');
  const got = `${parsed.origin}${parsed.pathname}`;
  return candidates.has(got) || candidates.has(`${got.replace(/\/+$/, '')}/`);
}
