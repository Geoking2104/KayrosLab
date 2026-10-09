// KayrosLab — clés d'API par tenant pour l'API publique /v1/public/*.
//
// Même modèle que les jetons MCP (backend/fastify/lib/mcp-auth.mjs) : seul le
// SHA-256 du secret est stocké, la comparaison est à temps constant, chaque
// clé porte des scopes et une expiration. Différences : les clés vivent en
// Postgres (ou en mémoire hors production), se créent et se révoquent depuis la
// console, et chacune est rattachée à un compte de service (`service_account`)
// qui devient le propriétaire des missions lancées avec elle.
//
// Format : kl_live_<prefix 10>_<secret 32>. Le préfixe, non secret, permet de
// retrouver la clé en O(1) et de l'afficher dans la console ; le secret
// complet n'est montré qu'une fois, à la création.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const API_KEY_SCOPES = Object.freeze([
  'missions:write',
  'missions:read',
  'collectives:read',
  'webhooks:manage',
]);
export const DEFAULT_API_KEY_SCOPES = Object.freeze(['missions:write', 'missions:read', 'collectives:read']);
const KEY_PATTERN = /^kl_(live|test)_([a-z0-9]{10})_([A-Za-z0-9]{32})$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomString(length, alphabet) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
function now() { return new Date().toISOString(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function authError(message, statusCode, code = 'API_KEY_INVALID') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export function hashApiKey(token) {
  return createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

/** Découpe une clé ; null si le format est invalide (aucune requête en base dans ce cas). */
export function parseApiKey(token) {
  const match = KEY_PATTERN.exec(String(token || '').trim());
  if (!match) return null;
  return { mode: match[1], prefix: match[2], token: match[0] };
}

export function generateApiKey({ mode = 'live' } = {}) {
  const prefix = randomString(10, ALPHABET);
  const secret = randomString(32, ALPHANUM);
  const token = `kl_${mode === 'test' ? 'test' : 'live'}_${prefix}_${secret}`;
  return { token, prefix, sha256: hashApiKey(token) };
}

/** Extrait la clé de `Authorization: Bearer …` ou `X-Api-Key`. */
export function apiKeyFromHeaders(headers = {}) {
  const auth = String(headers.authorization || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const header = headers['x-api-key'];
  return header ? String(Array.isArray(header) ? header[0] : header).trim() : '';
}

export function normalizeScopes(scopes) {
  const list = [...new Set(Array.isArray(scopes) && scopes.length ? scopes : DEFAULT_API_KEY_SCOPES)].map(String);
  const unknown = list.filter((scope) => !API_KEY_SCOPES.includes(scope));
  if (unknown.length) throw authError(`scopes inconnus : ${unknown.join(', ')}`, 400, 'API_KEY_SCOPES');
  return list;
}

/** Vue publique d'une clé : jamais le hash ni le secret. */
export function apiKeyView(record) {
  if (!record) return null;
  return {
    key_id: record.key_id, tenant_id: record.tenant_id, name: record.name,
    display: `kl_live_${record.prefix}_…`, prefix: record.prefix,
    scopes: [...(record.scopes || [])], service_account: record.service_account,
    collective_ids: [...(record.collective_ids || [])],
    created_by: record.created_by || null, created_at: record.created_at,
    last_used_at: record.last_used_at || null, expires_at: record.expires_at || null,
    revoked_at: record.revoked_at || null,
    status: record.revoked_at ? 'revoked'
      : record.expires_at && Date.parse(record.expires_at) <= Date.now() ? 'expired' : 'active',
  };
}

/** Principal porté par une requête authentifiée par clé (même forme qu'une session : sub, role, tenantId). */
export function servicePrincipal(record) {
  return Object.freeze({
    kind: 'api_key',
    sub: `svc:${record.tenant_id}:${record.service_account}`,
    email: `${record.service_account}@service.kayroslab.local`,
    role: 'service',
    tenantId: record.tenant_id,
    keyId: record.key_id,
    keyName: record.name,
    serviceAccount: record.service_account,
    scopes: Object.freeze([...(record.scopes || [])]),
    collectiveIds: Object.freeze([...(record.collective_ids || [])]),
  });
}

export class InMemoryApiKeyStore {
  constructor() { this.keys = new Map(); }
  async insert(record) { this.keys.set(record.key_id, clone(record)); return clone(record); }
  async findByPrefix(prefix) {
    for (const record of this.keys.values()) if (record.prefix === prefix) return clone(record);
    return null;
  }
  async list(tenantId) {
    return [...this.keys.values()].filter((record) => record.tenant_id === tenantId)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(clone);
  }
  async revoke(tenantId, keyId, at) {
    const record = this.keys.get(keyId);
    if (!record || record.tenant_id !== tenantId) return null;
    if (!record.revoked_at) record.revoked_at = at;
    return clone(record);
  }
  async touch(keyId, at) { const record = this.keys.get(keyId); if (record) record.last_used_at = at; }
}

export class PgApiKeyStore {
  constructor(pool) { this.pool = pool; }
  static row(row) {
    if (!row) return null;
    const iso = (value) => (value ? new Date(value).toISOString() : null);
    return {
      key_id: row.key_id, tenant_id: row.tenant_id, name: row.name, prefix: row.prefix,
      token_sha256: row.token_sha256, scopes: row.scopes || [], service_account: row.service_account,
      collective_ids: row.collective_ids || [], created_by: row.created_by,
      created_at: iso(row.created_at), last_used_at: iso(row.last_used_at),
      expires_at: iso(row.expires_at), revoked_at: iso(row.revoked_at),
    };
  }
  async insert(record) {
    const { rows } = await this.pool.query(
      `insert into kayros_api_keys (key_id, tenant_id, name, prefix, token_sha256, scopes, service_account,
         collective_ids, created_by, created_at, expires_at)
       values ($1,$2,$3,$4,$5,$6::text[],$7,$8::text[],$9,$10,$11) returning *`,
      [record.key_id, record.tenant_id, record.name, record.prefix, record.token_sha256, record.scopes,
        record.service_account, record.collective_ids, record.created_by, record.created_at, record.expires_at],
    );
    return PgApiKeyStore.row(rows[0]);
  }
  async findByPrefix(prefix) {
    const { rows } = await this.pool.query('select * from kayros_api_keys where prefix = $1', [prefix]);
    return PgApiKeyStore.row(rows[0]);
  }
  async list(tenantId) {
    const { rows } = await this.pool.query(
      'select * from kayros_api_keys where tenant_id = $1 order by created_at desc limit 200', [tenantId],
    );
    return rows.map(PgApiKeyStore.row);
  }
  async revoke(tenantId, keyId, at) {
    const { rows } = await this.pool.query(
      `update kayros_api_keys set revoked_at = coalesce(revoked_at, $3)
       where tenant_id = $1 and key_id = $2 returning *`, [tenantId, keyId, at],
    );
    return PgApiKeyStore.row(rows[0]);
  }
  async touch(keyId, at) {
    // Écriture bornée : au plus une mise à jour par minute et par clé.
    await this.pool.query(
      `update kayros_api_keys set last_used_at = $2
       where key_id = $1 and (last_used_at is null or last_used_at < $2::timestamptz - interval '1 minute')`,
      [keyId, at],
    );
  }
}

export class ApiKeyService {
  constructor({ store = new InMemoryApiKeyStore() } = {}) { this.store = store; }

  /** Crée une clé ; le jeton en clair n'est renvoyé qu'ici. */
  async create({ tenantId, name, scopes, serviceAccount, collectiveIds = [], expiresInDays = null, createdBy = null } = {}) {
    const tenant = String(tenantId || '').trim();
    const label = String(name || '').trim().slice(0, 120);
    if (!tenant) throw authError('tenant requis', 400, 'API_KEY_INPUT');
    if (!label) throw authError('nom de clé requis', 400, 'API_KEY_INPUT');
    const account = String(serviceAccount || 'integration').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 64) || 'integration';
    const days = expiresInDays == null || expiresInDays === '' ? null : Number(expiresInDays);
    if (days != null && !(Number.isFinite(days) && days > 0 && days <= 3650)) throw authError('expires_in_days invalide (1 à 3650)', 400, 'API_KEY_INPUT');
    const generated = generateApiKey();
    const createdAt = now();
    const record = await this.store.insert({
      key_id: `key_${randomString(16, ALPHABET)}`, tenant_id: tenant, name: label,
      prefix: generated.prefix, token_sha256: generated.sha256, scopes: normalizeScopes(scopes),
      service_account: account,
      collective_ids: [...new Set((collectiveIds || []).map(String).filter(Boolean))].slice(0, 50),
      created_by: createdBy, created_at: createdAt,
      expires_at: days ? new Date(Date.now() + days * 86400000).toISOString() : null,
      last_used_at: null, revoked_at: null,
    });
    return { key: apiKeyView(record), token: generated.token };
  }

  async list(tenantId) { return (await this.store.list(String(tenantId))).map(apiKeyView); }

  async revoke(tenantId, keyId) {
    const record = await this.store.revoke(String(tenantId), String(keyId), now());
    return apiKeyView(record);
  }

  /** Vérifie une clé et renvoie le principal de service ; lève 401 sinon. */
  async authenticate(token) {
    const parsed = parseApiKey(token);
    if (!parsed) throw authError('clé d’API requise (Authorization: Bearer kl_live_…)', 401);
    const record = await this.store.findByPrefix(parsed.prefix);
    const candidate = Buffer.from(hashApiKey(parsed.token), 'hex');
    const expected = Buffer.from(record?.token_sha256 || '0'.repeat(64), 'hex');
    const match = candidate.length === expected.length && timingSafeEqual(candidate, expected);
    if (!record || !match) throw authError('clé d’API invalide', 401);
    if (record.revoked_at) throw authError('clé d’API révoquée', 401, 'API_KEY_REVOKED');
    if (record.expires_at && Date.parse(record.expires_at) <= Date.now()) throw authError('clé d’API expirée', 401, 'API_KEY_EXPIRED');
    this.store.touch(record.key_id, now()).catch(() => {});
    return servicePrincipal(record);
  }
}

export function hasApiScope(principal, scope) { return !!principal?.scopes?.includes(scope); }
