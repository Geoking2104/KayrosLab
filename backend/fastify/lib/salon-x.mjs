/**
 * Liaison X de l’hôte : jetons scellés, OAuth 2.0 PKCE, publication si @mention.
 */
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { safeUserKey } from './salon-state.mjs';

const AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const API = 'https://api.x.com/2';
const MIN_WRITE_MS = 45_000;
const ENGAGEMENTS = new Set(['off', 'prepare', 'autopost_mentions']);

export function configuredX() {
  return Boolean(process.env.X_CLIENT_ID);
}

export function publicBinding(raw) {
  if (!raw) return null;
  return {
    xUserId: raw.xUserId || '',
    handle: raw.handle || '',
    name: raw.name || '',
    scopes: Array.isArray(raw.scopes) ? raw.scopes : [],
    engagement: ENGAGEMENTS.has(raw.engagement) ? raw.engagement : 'off',
    linkedAt: raw.linkedAt || null,
  };
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32) {
  return b64url(randomBytes(bytes));
}

export function pkceChallenge(verifier) {
  return b64url(createHash('sha256').update(verifier).digest());
}

function secretKey() {
  const src = process.env.X_TOKEN_SECRET || process.env.KAYROS_AUTH_SECRET || 'salon-x-dev';
  return createHash('sha256').update(src).digest();
}

export function seal(plain) {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${b64url(iv)}:${b64url(enc)}:${b64url(tag)}`;
}

export function openSeal(packed) {
  if (!packed || typeof packed !== 'string') return '';
  if (!packed.startsWith('v1:')) return packed;
  const [, ivB, dataB, tagB] = packed.split(':');
  const iv = Buffer.from(ivB, 'base64url');
  const data = Buffer.from(dataB, 'base64url');
  const tag = Buffer.from(tagB, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function mentionMatches(text, handle) {
  const h = String(handle || '').replace(/^@/, '').toLowerCase();
  if (!h || !text) return false;
  const re = new RegExp(`(^|[^A-Za-z0-9_])@${h}\\b`, 'i');
  return re.test(text);
}

export function createXClient(fetchImpl = globalThis.fetch) {
  const clientId = () => process.env.X_CLIENT_ID || '';
  const clientSecret = () => process.env.X_CLIENT_SECRET || '';

  async function request(url, init = {}) {
    const res = await fetchImpl(url, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error_description || body.detail || body.error || `X ${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  return {
    async exchangeCode({ code, verifier, redirectUri }) {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        client_id: clientId(),
      });
      const headers = { 'content-type': 'application/x-www-form-urlencoded' };
      if (clientSecret()) {
        headers.authorization = `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64')}`;
      }
      return request(TOKEN_URL, { method: 'POST', headers, body: params });
    },
    async me(accessToken) {
      return request(`${API}/users/me?user.fields=name,username`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
    },
    async getTweet(accessToken, id) {
      return request(`${API}/tweets/${id}?tweet.fields=text,author_id,conversation_id`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
    },
    async postTweet(accessToken, payload) {
      return request(`${API}/tweets`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    },
    async deleteTweet(accessToken, id) {
      return request(`${API}/tweets/${id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${accessToken}` },
      });
    },
    async revoke(token) {
      if (!token) return;
      const params = new URLSearchParams({
        token,
        token_type_hint: 'refresh_token',
        client_id: clientId(),
      });
      try {
        await request('https://api.x.com/2/oauth2/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: params,
        });
      } catch {
        /* révocation best-effort */
      }
    },
  };
}

export function authorizeUrl({ state, challenge, redirectUri, scopes }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.X_CLIENT_ID || '',
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params}`;
}

export class SalonXStore {
  constructor({ dir = null, fs = null } = {}) {
    this.dir = dir ? String(dir) : null;
    this._fs = fs;
    this._mem = new Map();
    this._pending = new Map();
    this._writes = new Map();
  }

  async _mod() {
    return this._fs ?? (await import('node:fs/promises'));
  }

  _path(userId) {
    return `${this.dir}/${safeUserKey(userId)}.x.json`;
  }

  async _load(userId) {
    const key = safeUserKey(userId);
    if (this._mem.has(key)) return this._mem.get(key);
    const empty = { binding: null, tweets: [], pending: null };
    if (!this.dir) {
      this._mem.set(key, empty);
      return empty;
    }
    try {
      const fs = await this._mod();
      const raw = JSON.parse(await fs.readFile(this._path(userId), 'utf8'));
      const rec = {
        binding: raw.binding && typeof raw.binding === 'object' ? raw.binding : null,
        tweets: Array.isArray(raw.tweets) ? raw.tweets.slice(-80) : [],
        pending: null,
      };
      this._mem.set(key, rec);
      return rec;
    } catch {
      this._mem.set(key, empty);
      return empty;
    }
  }

  async _save(userId, rec) {
    const key = safeUserKey(userId);
    this._mem.set(key, rec);
    if (!this.dir) return rec;
    const fs = await this._mod();
    await fs.mkdir(this.dir, { recursive: true }).catch(() => {});
    const path = this._path(userId);
    const tmp = `${path}.tmp`;
    const disk = { binding: rec.binding, tweets: rec.tweets };
    await fs.writeFile(tmp, JSON.stringify(disk), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, path);
    try { await fs.chmod(path, 0o600); } catch { /* */ }
    return rec;
  }

  async getBinding(userId) {
    const rec = await this._load(userId);
    return rec.binding;
  }

  async putBinding(userId, binding) {
    const rec = await this._load(userId);
    rec.binding = binding;
    await this._save(userId, rec);
    return binding;
  }

  async deleteBinding(userId) {
    const rec = await this._load(userId);
    rec.binding = null;
    await this._save(userId, rec);
  }

  putPending(state, payload) {
    this._pending.set(state, { ...payload, at: Date.now() });
  }

  takePending(state) {
    const row = this._pending.get(state);
    this._pending.delete(state);
    if (!row) return null;
    if (Date.now() - row.at > 15 * 60 * 1000) return null;
    return row;
  }

  lastWrite(userId) {
    return this._writes.get(safeUserKey(userId)) || 0;
  }

  touchWrite(userId) {
    this._writes.set(safeUserKey(userId), Date.now());
  }

  async findTweet(userId, tweetId) {
    const rec = await this._load(userId);
    return rec.tweets.find((t) => t.id === tweetId) || null;
  }

  async findByHash(userId, hash) {
    const rec = await this._load(userId);
    return rec.tweets.find((t) => t.hash === hash) || null;
  }

  async recordTweet(userId, tweet) {
    const rec = await this._load(userId);
    rec.tweets = [...rec.tweets.filter((t) => t.hash !== tweet.hash && t.id !== tweet.id), tweet].slice(-80);
    await this._save(userId, rec);
    return tweet;
  }

  async dropTweet(userId, tweetId) {
    const rec = await this._load(userId);
    rec.tweets = rec.tweets.filter((t) => t.id !== tweetId);
    await this._save(userId, rec);
  }
}

export function hashWrite(userId, text, replyTo) {
  return createHash('sha256').update(`${userId}|${replyTo}|${text}`).digest('hex').slice(0, 16);
}

export { MIN_WRITE_MS, ENGAGEMENTS };
