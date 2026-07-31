// Account link service with durable store (v14).
// Replaces in-memory-only AccountLinkService when wired from context.

import { FileAccountLinkStore } from './account-link-store.mjs';

export class DurableAccountLinkService {
  /**
   * @param {{ store?: import('./account-link-store.mjs').FileAccountLinkStore|import('./account-link-store.mjs').PgAccountLinkStore }} opts
   */
  constructor({ store = null } = {}) {
    this._store = store || new FileAccountLinkStore();
    this._tokens = new Map();
    this._mem = new Map(); // cache
  }

  async load() {
    if (typeof this._store.load === 'function') await this._store.load();
    if (typeof this._store.all === 'function') {
      for (const row of await this._store.all()) {
        if (row?.platformId) this._mem.set(row.platformId, row);
      }
    }
    return this;
  }

  createToken({ platformId, userId, platform }) {
    const randomBytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(randomBytes);
    else randomBytes.forEach((_, i, arr) => { arr[i] = Math.floor(Math.random() * 256); });
    const token = `link_${Date.now()}_${Array.from(randomBytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    this._tokens.set(token, { platformId, userId, platform, expiresAt });
    return { token, expiresAt };
  }

  async link(token, kayrosUser) {
    const rec = this._tokens.get(token);
    if (!rec) throw new Error('Invalid or already used token');
    if (new Date(rec.expiresAt) < new Date()) {
      this._tokens.delete(token);
      throw new Error('Token expired');
    }
    this._tokens.delete(token);
    const record = {
      kayrosUserId: kayrosUser.id,
      email: kayrosUser.email,
      role: kayrosUser.role,
      tenantId: kayrosUser.tenantId,
      platform: rec.platform,
      platformId: rec.platformId,
      linkedAt: new Date().toISOString(),
    };
    this._mem.set(rec.platformId, record);
    if (typeof this._store.set === 'function') await this._store.set(rec.platformId, record);
    return { ok: true, platformId: rec.platformId };
  }

  get(platformId) {
    return this._mem.get(platformId) ?? this._store.get?.(platformId) ?? null;
  }

  async unlink(platformId) {
    this._mem.delete(platformId);
    if (typeof this._store.delete === 'function') return this._store.delete(platformId);
    return true;
  }

  list() {
    return [...this._mem.values()];
  }
}
