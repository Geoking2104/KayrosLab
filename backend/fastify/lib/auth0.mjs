import { createPublicKey, createVerify, createHash, randomBytes } from 'node:crypto';

export const AUTH0_DEFAULT_DOMAIN = 'dev-1mveynszu4lngakl.us.auth0.com';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const unb64url = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(pad + '==='.slice((pad.length + 3) % 4), 'base64');
};

export function auth0ConfigFromEnv(env = process.env) {
  const domain = String(env.AUTH0_DOMAIN || AUTH0_DEFAULT_DOMAIN)
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .trim();
  const clientId = String(env.AUTH0_CLIENT_ID || '').trim();
  const clientSecret = String(env.AUTH0_CLIENT_SECRET || '').trim();
  const audience = String(env.AUTH0_AUDIENCE || '').trim();
  return {
    domain,
    clientId,
    clientSecret,
    audience,
    issuer: `https://${domain}/`,
    enabled: Boolean(domain && clientId),
  };
}

export function publicSsoConfig(config, { consoleUrl } = {}) {
  if (!config?.enabled) return { enabled: false, provider: 'auth0' };
  return {
    enabled: true,
    provider: 'auth0',
    domain: config.domain,
    clientId: config.clientId,
    audience: config.audience || undefined,
    redirectHint: consoleUrl || undefined,
  };
}

export function authorizeUrl(config, { redirectUri, state, challenge, nonce }) {
  const url = new URL(`https://${config.domain}/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (config.audience) url.searchParams.set('audience', config.audience);
  return url.toString();
}

export function pkceChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function randomToken(bytes = 32) {
  return b64url(randomBytes(bytes));
}

const jwksCache = new Map();

export async function fetchJwks(domain, { fetchImpl = fetch, now = Date.now, ttlMs = 3600_000 } = {}) {
  const cached = jwksCache.get(domain);
  if (cached && cached.exp > now()) return cached.keys;
  const res = await fetchImpl(`https://${domain}/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`jwks Auth0 injoignable (${res.status})`);
  const body = await res.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(domain, { keys, exp: now() + ttlMs });
  return keys;
}

export function verifyIdToken(token, { issuer, audience, jwks, nonce, now = () => Math.floor(Date.now() / 1000) }) {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    const e = new Error('id_token Auth0 invalide'); e.code = 'AUTH0_TOKEN'; throw e;
  }
  const [h, p, s] = token.split('.');
  let header;
  let payload;
  try {
    header = JSON.parse(unb64url(h).toString('utf8'));
    payload = JSON.parse(unb64url(p).toString('utf8'));
  } catch {
    const e = new Error('id_token Auth0 illisible'); e.code = 'AUTH0_TOKEN'; throw e;
  }
  if (header.alg !== 'RS256') {
    const e = new Error('id_token Auth0 : algorithme refusé'); e.code = 'AUTH0_TOKEN'; throw e;
  }
  const jwk = (jwks || []).find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) {
    const e = new Error('id_token Auth0 : clé inconnue'); e.code = 'AUTH0_TOKEN'; throw e;
  }
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const verify = createVerify('RSA-SHA256');
  verify.update(`${h}.${p}`);
  verify.end();
  if (!verify.verify(key, unb64url(s))) {
    const e = new Error('id_token Auth0 : signature'); e.code = 'AUTH0_TOKEN'; throw e;
  }
  const iss = String(issuer || '').replace(/\/?$/, '/');
  const gotIss = String(payload.iss || '').replace(/\/?$/, '/');
  if (gotIss !== iss) {
    const e = new Error('id_token Auth0 : émetteur'); e.code = 'AUTH0_TOKEN'; throw e;
  }
  const aud = payload.aud;
  const audOk = aud === audience || (Array.isArray(aud) && aud.includes(audience));
  if (!audOk) {
    const e = new Error('id_token Auth0 : audience'); e.code = 'AUTH0_TOKEN'; throw e;
  }
  if (typeof payload.exp === 'number' && now() >= payload.exp) {
    const e = new Error('id_token Auth0 : expiré'); e.code = 'AUTH0_TOKEN'; throw e;
  }
  if (nonce && payload.nonce !== nonce) {
    const e = new Error('id_token Auth0 : nonce'); e.code = 'AUTH0_TOKEN'; throw e;
  }
  return payload;
}

export async function exchangeAuthorizationCode(config, {
  code, redirectUri, codeVerifier, fetchImpl = fetch,
}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);
  const res = await fetchImpl(`https://${config.domain}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.id_token) {
    const e = new Error(json.error_description || json.error || `échange Auth0 refusé (${res.status})`);
    e.code = 'AUTH0_EXCHANGE';
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
  return candidates.has(got) || candidates.has(got.replace(/\/+$/, '') + '/');
}
