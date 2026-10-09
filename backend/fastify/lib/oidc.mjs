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
    id: 'oidc',
    label: String(env.OIDC_PROVIDER_NAME || 'SSO entreprise').trim(),
    issuer,
    clientId,
    clientSecret,
    audience,
    tokenEndpointAuthMethod: env.OIDC_TOKEN_ENDPOINT_AUTH_METHOD || (clientSecret ? 'client_secret_basic' : 'none'),
    enabled: Boolean(issuer && clientId),
  };
}

export function googleConfigFromEnv(env = process.env) {
  const clientId = String(env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  return {
    id: 'google', label: 'Google', issuer: 'https://accounts.google.com',
    clientId, clientSecret, audience: clientId,
    tokenEndpointAuthMethod: 'client_secret_post',
    enabled: Boolean(clientId && clientSecret),
  };
}

export function publicAuthProviders(oidc, google) {
  return {
    ...publicSsoConfig(oidc),
    enabled: Boolean(oidc?.enabled || google?.enabled),
    providers: [google, oidc].filter((config) => config?.enabled).map((config) => ({
      id: config.id || 'oidc', label: config.label || 'SSO entreprise',
    })),
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
  const res = await fetchImpl(`${config.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    const e = new Error(`découverte OIDC injoignable (${res.status})`); e.code = 'OIDC_DISCOVERY'; throw e;
  }
  const doc = await res.json();
  if (doc.issuer !== config.issuer || ![doc.authorization_endpoint, doc.token_endpoint, doc.jwks_uri].every((value) => {
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  })) {
    const e = new Error('découverte OIDC incomplète'); e.code = 'OIDC_DISCOVERY'; throw e;
  }
  return {
    ...config,
    issuer: config.issuer,
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
  const keys = (jwks || []).filter((k) => k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256'));
  const jwk = header.kid ? keys.find((k) => k.kid === header.kid) : (keys.length === 1 ? keys[0] : null);
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
  const validIssuer = payload.iss === issuer || (issuer === 'https://accounts.google.com' && payload.iss === 'accounts.google.com');
  if (!validIssuer) {
    const e = new Error('id_token OIDC : émetteur'); e.code = 'OIDC_TOKEN'; throw e;
  }
  const aud = payload.aud;
  const audOk = aud === audience || (Array.isArray(aud) && aud.includes(audience));
  if (!audOk || (payload.azp && payload.azp !== audience) || (Array.isArray(aud) && aud.length > 1 && payload.azp !== audience)) {
    const e = new Error('id_token OIDC : audience'); e.code = 'OIDC_TOKEN'; throw e;
  }
  if (!Number.isFinite(payload.exp) || now() >= payload.exp || !Number.isFinite(payload.iat) || payload.iat > now() + 60 || (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || payload.nbf > now() + 60))) {
    const e = new Error('id_token OIDC : expiré'); e.code = 'OIDC_TOKEN'; throw e;
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    const e = new Error('id_token OIDC : sujet manquant'); e.code = 'OIDC_TOKEN'; throw e;
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
  const method = discovered.tokenEndpointAuthMethod || (discovered.clientSecret ? 'client_secret_basic' : 'none');
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (method === 'client_secret_post') body.set('client_secret', discovered.clientSecret);
  else if (method === 'client_secret_basic') {
    headers.authorization = `Basic ${Buffer.from(`${discovered.clientId}:${discovered.clientSecret}`).toString('base64')}`;
  } else if (method !== 'none') throw new Error('Méthode d’authentification OIDC non prise en charge');
  const res = await fetchImpl(discovered.tokenEndpoint, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(10_000),
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
  if (parsed.search || parsed.hash || parsed.username || parsed.password) return false;
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
  add('https://www.kayroslab.com/salon/');
  add('https://www.kayroslab.com/salon/index.html');
  add('https://www.kayroslab.com/salon/flux/');
  add('https://www.kayroslab.com/salon/flux/callback/');
  add('http://localhost:4174/console/');
  add('http://localhost:4174/salon/');
  add('http://localhost:4174/salon/flux/');
  add('http://127.0.0.1:4174/console/');
  add('http://127.0.0.1:4174/salon/');
  const got = `${parsed.origin}${parsed.pathname}`;
  return candidates.has(got) || candidates.has(`${got.replace(/\/+$/, '')}/`);
}
