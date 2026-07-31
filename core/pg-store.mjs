/**
 * I — Postgres-backed store foundation (optional dependency `pg`).
 * When DATABASE_URL is unset or `pg` is missing, callers keep using File* stores.
 *
 * Schema (run once):
 *   see core/sql/schema.sql
 */

export function hasDatabaseUrl(env = process.env) {
  return !!(env.DATABASE_URL || env.KAYROS_DATABASE_URL);
}

/**
 * @returns {Promise<import('pg').Pool|null>}
 */
export async function createPgPool(env = process.env) {
  const url = env.DATABASE_URL || env.KAYROS_DATABASE_URL;
  if (!url) return null;
  try {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: 8 });
    await pool.query('select 1');
    return pool;
  } catch (e) {
    console.warn('[kayroslab] Postgres unavailable:', e.message);
    return null;
  }
}

/** Minimal idea repository over Postgres (same surface as FileIdeaRepository). */
export class PgIdeaRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async get(id) {
    const { rows } = await this.pool.query(
      'select payload from kayros_ideas where id = $1',
      [id],
    );
    return rows[0]?.payload ?? null;
  }

  async save(idea) {
    if (!idea?.id) throw new Error('PgIdeaRepository.save: id requis');
    await this.pool.query(
      `insert into kayros_ideas (id, tenant_id, payload, updated_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (id) do update set
         tenant_id = excluded.tenant_id,
         payload = excluded.payload,
         updated_at = now()`,
      [idea.id, idea.tenantId || 'default', JSON.stringify(idea)],
    );
    return idea;
  }

  async list({ tenantId, stage, status, category, q } = {}) {
    let sql = 'select payload from kayros_ideas where 1=1';
    const params = [];
    if (tenantId) {
      params.push(tenantId);
      sql += ` and tenant_id = $${params.length}`;
    }
    if (stage) {
      params.push(stage);
      sql += ` and payload->>'stage' = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` and payload->>'status' = $${params.length}`;
    }
    if (category) {
      params.push(category);
      sql += ` and payload->>'category' = $${params.length}`;
    }
    if (q) {
      params.push(`%${q}%`);
      sql += ` and (payload->>'title' ilike $${params.length})`;
    }
    sql += ' order by updated_at desc limit 500';
    const { rows } = await this.pool.query(sql, params);
    return rows.map((r) => r.payload);
  }

  async load() { return this; }
}

/** Pending gates + history in Postgres. */
export class PgGateStore {
  constructor(pool) {
    this.pool = pool;
  }

  async load() { return this; }

  async putPending(rec) {
    await this.pool.query(
      `insert into kayros_gates_pending (gate_id, payload)
       values ($1, $2::jsonb)
       on conflict (gate_id) do update set payload = excluded.payload`,
      [rec.gateId, JSON.stringify(rec)],
    );
  }

  async removePending(gateId) {
    await this.pool.query('delete from kayros_gates_pending where gate_id = $1', [gateId]);
  }

  async appendHistory(res) {
    await this.pool.query(
      `insert into kayros_gates_history (gate_id, payload, resolved_at)
       values ($1, $2::jsonb, now())`,
      [res.gateId, JSON.stringify(res)],
    );
  }

  async allPending() {
    const { rows } = await this.pool.query('select payload from kayros_gates_pending');
    return rows.map((r) => r.payload);
  }

  async allHistory() {
    const { rows } = await this.pool.query(
      'select payload from kayros_gates_history order by resolved_at desc limit 1000',
    );
    return rows.map((r) => r.payload);
  }
}
