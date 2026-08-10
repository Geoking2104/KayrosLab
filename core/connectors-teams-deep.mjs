// KayrosLab — Teams adapter helpers (V17)
// Server-only: Azure Bot Service JWT (RS256) verification + pure helpers.
import { createPublicKey, verify } from 'node:crypto';

export const BOTFRAMEWORK_OPENID_CONFIG = 'https://login.botframework.com/v3/.well-known/openidconfiguration';
export const BOTFRAMEWORK_ISSUER = 'https://api.botframework.com';

/** Extrait le jeton Bearer d'un header Authorization. */
export function getBearerToken(authHeader) {
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/.exec(String(authHeader ?? '').trim());
  return m ? m[1] : null;
}

function base64UrlDecode(part) {
  const b64 = String(part).replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? 0 : 4 - (b64.length % 4);
  return Buffer.from(b64 + '='.repeat(pad), 'base64');
}

/** Décode un segment JWT (header ou claims). */
export function decodeJwtPart(part) {
  try {
    return JSON.parse(base64UrlDecode(part).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Découpe un JWT en { header, claims, data, signature }.
 * @param {string} token
 * @returns {null|{header:object, claims:object, data:Buffer, signature:Buffer}}
 */
export function splitJwt(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (!header || !claims) return null;
  return {
    header,
    claims,
    data: Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'),
    signature: base64UrlDecode(parts[2]),
  };
}

/**
 * Récupère le jeu de clés (JWKS) via la config OpenID de Bot Framework.
 * @param {{fetchImpl?:Function, openIdConfigUrl?:string}} opts
 */
export async function fetchJwks({ fetchImpl, openIdConfigUrl = BOTFRAMEWORK_OPENID_CONFIG } = {}) {
  const f = fetchImpl ?? globalThis.fetch;
  if (!f) return null;
  try {
    const cfgRes = await f(openIdConfigUrl, { headers: { Accept: 'application/json' } });
    if (!cfgRes.ok) return null;
    const cfg = await cfgRes.json();
    if (!cfg.jwks_uri) return null;
    const res = await f(cfg.jwks_uri, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const set = await res.json();
    return Array.isArray(set?.keys) ? set.keys : null;
  } catch {
    return null;
  }
}

/** Cache simple des clés publiques avec TTL (évite de marteler le JWKS). */
export class TeamsKeyCache {
  constructor({ ttlMs = 6 * 3600 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.keys = null;
    this.at = 0;
  }

  get() { return this.keys && Date.now() - this.at < this.ttlMs ? this.keys : null; }
  set(keys) { this.keys = keys; this.at = Date.now(); }
  clear() { this.keys = null; this.at = 0; }
}

/**
 * Vérifie un JWT d'interaction Teams/Bot Framework (RS256).
 * Contrôle exp/nbf, issuer et audience (App ID).
 * @param {string} token
 * @param {{appId?:string, issuers?:string[], openIdConfigUrl?:string, fetchImpl?:Function, keys?:object[], nowMs?:number}} opts
 *  `keys` court-circuite le réseau (tests / cache).
 * @returns {Promise<boolean>}
 */
export async function verifyTeamsToken(token, {
  appId = '',
  issuers = [BOTFRAMEWORK_ISSUER],
  openIdConfigUrl = BOTFRAMEWORK_OPENID_CONFIG,
  fetchImpl,
  keys = null,
  nowMs = Date.now(),
} = {}) {
  const jwt = splitJwt(token);
  if (!jwt) return false;
  if (!jwt.header.kid || jwt.header.alg !== 'RS256') return false;
  const nowSec = nowMs / 1000;
  if (typeof jwt.claims.exp !== 'number' || nowSec > jwt.claims.exp) return false;
  if (typeof jwt.claims.nbf === 'number' && nowSec < jwt.claims.nbf) return false;
  if (!issuers.includes(jwt.claims.iss)) return false;
  if (!appId || jwt.claims.aud !== appId) return false;

  let keyList = keys;
  if (!keyList) keyList = await fetchJwks({ fetchImpl, openIdConfigUrl });
  if (!Array.isArray(keyList)) return false;
  const jwk = keyList.find((k) => k.kid === jwt.header.kid && k.kty === 'RSA');
  if (!jwk) return false;
  try {
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    return verify('RSA-SHA256', jwt.data, publicKey, jwt.signature);
  } catch {
    return false;
  }
}

/** Idempotence stable d'une activité Teams (miroir EF-92). */
export function teamsActivityId(body = {}) {
  if (!body?.id || !body?.from?.id) return null;
  const actor = body.from.aadObjectId || body.from.id;
  const kind = body.type === 'invoke' ? 'invoke' : body.type === 'message' ? 'msg' : 'act';
  const stamp = body.timestamp || '';
  const token = body.value?.action?.id || body.text || '';
  return `teams:${actor}:${kind}:${body.id}:${stamp}:${token}`;
}