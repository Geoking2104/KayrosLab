// Persistent store for Slack/Teams ↔ KayrosLab account links (v14).

/**
 * In-memory map with optional JSON file flush.
 * Shape: platformId → { kayrosUserId, email, role, tenantId, platform, platformId, linkedAt }
 */
export class FileAccountLinkStore {
  /**
   * @param {{ path?: string, fs?: object }} opts
   */
  constructor({ path = null, fs = null } = {}) {
    this.path = path;
    this._fs = fs;
    this._m = new Map();
    this._loaded = false;
  }

  async _mod() {
    return this._fs ?? (await import('node:fs/promises'));
  }

  async load() {
    if (!this.path) {
      this._loaded = true;
      return this;
    }
    try {
      const fs = await this._mod();
      const raw = await fs.readFile(this.path, 'utf8');
      const arr = JSON.parse(raw);
      this._m = new Map(
        (Array.isArray(arr) ? arr : []).map((row) => [row.platformId, row]),
      );
    } catch {
      this._m = new Map();
    }
    this._loaded = true;
    return this;
  }

  async flush() {
    if (!this.path) return false;
    const fs = await this._mod();
    await fs.writeFile(
      this.path,
      JSON.stringify([...this._m.values()], null, 2),
      'utf8',
    );
    return true;
  }

  get(platformId) {
    return this._m.get(platformId) ?? null;
  }

  async set(platformId, record) {
    this._m.set(platformId, record);
    await this.flush();
    return record;
  }

  async delete(platformId) {
    const ok = this._m.delete(platformId);
    if (ok) await this.flush();
    return ok;
  }

  all() {
    return [...this._m.values()];
  }

  size() {
    return this._m.size;
  }
}

/** Optional Postgres-backed links (same payload shape). */
export class PgAccountLinkStore {
  constructor(pool) {
    this.pool = pool;
  }

  async load() {
    return this;
  }

  async get(platformId) {
    const r = await this.pool.query(
      'select payload from kayros_account_links where platform_id = $1',
      [platformId],
    );
    return r.rows[0]?.payload ?? null;
  }

  async set(platformId, record) {
    await this.pool.query(
      `insert into kayros_account_links (platform_id, tenant_id, payload, linked_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (platform_id) do update
         set payload = excluded.payload,
             tenant_id = excluded.tenant_id,
             linked_at = now()`,
      [platformId, record.tenantId || 'default', JSON.stringify(record)],
    );
    return record;
  }

  async delete(platformId) {
    const r = await this.pool.query(
      'delete from kayros_account_links where platform_id = $1',
      [platformId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async all() {
    const r = await this.pool.query('select payload from kayros_account_links');
    return r.rows.map((row) => row.payload);
  }

  async size() {
    const r = await this.pool.query('select count(*)::int as n from kayros_account_links');
    return r.rows[0]?.n ?? 0;
  }

  async flush() {
    return true;
  }
}
