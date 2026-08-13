/**
 * Postgres-backed stores (optional dependency `pg`).
 * Multi-instance safe: shared pool, tenant columns, no local file locks.
 * When DATABASE_URL is unset or `pg` is missing → callers keep File‑/InMemory.
 *
 * Schema: core/sql/schema.sql
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
    const max = Number(env.KAYROS_PG_POOL_MAX) || 10;
    const pool = new pg.Pool({
      connectionString: url,
      max,
      idleTimeoutMillis: Number(env.KAYROS_PG_IDLE_MS) || 30_000,
      connectionTimeoutMillis: Number(env.KAYROS_PG_CONNECT_MS) || 5_000,
      // multi-instance: each process holds a small pool; rely on Postgres
      application_name: env.KAYROS_PG_APP_NAME || 'kayroslab',
    });
    await pool.query('select 1');
    return pool;
  } catch (e) {
    console.warn('[kayroslab] Postgres unavailable:', e.message);
    return null;
  }
}

/**
 * Applique core/sql/schema.sql sur la base.
 *
 * Le script de deploiement VPS le faisait deja, mais lui seul : une instance
 * demarree ailleurs (conteneur, second noeud, poste de dev) trouvait une base
 * vide et echouait a la premiere ecriture. Le schema est en
 * `create table if not exists`, donc l'appliquer a chaque demarrage est
 * idempotent et coute une requete.
 *
 * @param {import('pg').Pool} pool
 * @param {{ fs?: object, url?: URL, logger?: object }} [deps]
 * @returns {Promise<boolean>} true si le schema a ete applique
 */
export async function applySchema(pool, { fs = null, url = null, logger = console } = {}) {
  if (!pool) return false;
  try {
    const nodeFs = fs || await import('node:fs/promises');
    const target = url || new URL('./sql/schema.sql', import.meta.url);
    const sql = await nodeFs.readFile(target, 'utf8');
    if (!sql.trim()) return false;
    await pool.query(sql);
    logger?.info?.('[kayroslab] schema Postgres applique');
    return true;
  } catch (e) {
    // Un schema non applicable ne doit pas empecher le demarrage : la base
    // peut etre geree par un DBA, ou les droits DDL refuses. L'echec est
    // signale, la premiere ecriture dira le reste.
    logger?.warn?.('[kayroslab] schema Postgres non applique:', e.message);
    return false;
  }
}

/** Idea repository — same surface as FileIdeaRepository / InMemoryIdeaRepository. */
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

  async remove(id) {
    const { rowCount } = await this.pool.query(
      'delete from kayros_ideas where id = $1',
      [id],
    );
    return rowCount > 0;
  }

  async all() {
    const { rows } = await this.pool.query(
      'select payload from kayros_ideas order by updated_at desc limit 2000',
    );
    return rows.map((r) => r.payload);
  }

  async size() {
    const { rows } = await this.pool.query('select count(*)::int as n from kayros_ideas');
    return rows[0]?.n ?? 0;
  }

  async list({ tenantId, stage, status, category, author, q, sort = 'updatedAt', order = 'desc' } = {}) {
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
    if (author) {
      params.push(author);
      sql += ` and payload->>'author' = $${params.length}`;
    }
    if (q) {
      params.push(`%${q}%`);
      sql += ` and (payload->>'title' ilike $${params.length} or payload::text ilike $${params.length})`;
    }
    const dir = order === 'asc' ? 'asc' : 'desc';
    if (sort === 'title') {
      sql += ` order by payload->>'title' ${dir} limit 500`;
    } else if (sort === 'createdAt') {
      sql += ` order by payload->>'createdAt' ${dir} nulls last limit 500`;
    } else {
      sql += ` order by updated_at ${dir} limit 500`;
    }
    const { rows } = await this.pool.query(sql, params);
    return rows.map((r) => r.payload);
  }

  async load() { return this; }
}

/** Pending gates + history — multi-instance (shared pending table). */
export class PgGateStore {
  constructor(pool) {
    this.pool = pool;
  }

  async load() { return this; }

  async putPending(rec) {
    const tenantId = rec.tenantId || rec.payload?.tenantId || 'default';
    await this.pool.query(
      `insert into kayros_gates_pending (gate_id, tenant_id, payload)
       values ($1, $2, $3::jsonb)
       on conflict (gate_id) do update set
         tenant_id = excluded.tenant_id,
         payload = excluded.payload`,
      [rec.gateId, tenantId, JSON.stringify(rec)],
    );
  }

  async removePending(gateId) {
    await this.pool.query('delete from kayros_gates_pending where gate_id = $1', [gateId]);
  }

  async appendHistory(res) {
    const tenantId = res.tenantId || 'default';
    await this.pool.query(
      `insert into kayros_gates_history (gate_id, tenant_id, payload, resolved_at)
       values ($1, $2, $3::jsonb, now())`,
      [res.gateId, tenantId, JSON.stringify(res)],
    );
  }

  async allPending({ tenantId } = {}) {
    if (tenantId) {
      const { rows } = await this.pool.query(
        'select payload from kayros_gates_pending where tenant_id = $1',
        [tenantId],
      );
      return rows.map((r) => r.payload);
    }
    const { rows } = await this.pool.query('select payload from kayros_gates_pending');
    return rows.map((r) => r.payload);
  }

  async allHistory({ tenantId } = {}) {
    if (tenantId) {
      const { rows } = await this.pool.query(
        'select payload from kayros_gates_history where tenant_id = $1 order by resolved_at desc limit 1000',
        [tenantId],
      );
      return rows.map((r) => r.payload);
    }
    const { rows } = await this.pool.query(
      'select payload from kayros_gates_history order by resolved_at desc limit 1000',
    );
    return rows.map((r) => r.payload);
  }
}

/**
 * Store Postgres des runs suspendus.
 *
 * FileRunStore suppose un seul processus ecrivain : il reecrit tout le fichier
 * a chaque changement, donc deux instances derriere un load balancer se
 * marchent dessus et une decision humaine peut disparaitre. Cette table est
 * la source de verite partagee.
 *
 * Le filtrage tenant est fait dans la requete, pas apres : une lecture
 * inter-tenant doit etre impossible par construction, pas par vigilance de
 * l'appelant.
 */
export class PgRunStore {
  constructor(pool) {
    this.pool = pool;
  }

  async load() { return this; }

  async save(state, { tenantId } = {}) {
    if (!state || typeof state !== 'object') throw new Error('PgRunStore: state requis');
    if (!state.runId) throw new Error('PgRunStore: a run snapshot needs a runId');
    const scope = String(tenantId ?? state?.input?.context?.tenantId ?? 'default');
    await this.pool.query(
      `insert into kayros_runs_suspended (run_id, tenant_id, idea_id, status, payload, updated_at)
       values ($1, $2, $3, $4, $5::jsonb, now())
       on conflict (run_id) do update set
         tenant_id = excluded.tenant_id,
         idea_id = excluded.idea_id,
         status = excluded.status,
         payload = excluded.payload,
         updated_at = now()`,
      [state.runId, scope, state.ideaId ?? null, state.status, JSON.stringify(state)],
    );
    return {
      runId: state.runId, traceId: state.traceId, ideaId: state.ideaId,
      tenantId: scope, status: state.status, gate: state.gate ?? null,
      updatedAt: state.updatedAt,
    };
  }

  async get(runId, { tenantId } = {}) {
    const params = [String(runId)];
    let sql = 'select payload from kayros_runs_suspended where run_id = $1';
    if (tenantId !== undefined) {
      sql += ' and tenant_id = $2';
      params.push(String(tenantId));
    }
    const { rows } = await this.pool.query(sql, params);
    return rows.length ? rows[0].payload : null;
  }

  /** Listing leger : ni le brouillon ni les logs ne remontent. */
  async list({ tenantId, ideaId, status } = {}) {
    const params = [];
    const where = [];
    if (tenantId !== undefined) { params.push(String(tenantId)); where.push(`tenant_id = $${params.length}`); }
    if (ideaId !== undefined) { params.push(String(ideaId)); where.push(`idea_id = $${params.length}`); }
    if (status !== undefined) { params.push(String(status)); where.push(`status = $${params.length}`); }
    const clause = where.length ? ` where ${where.join(' and ')}` : '';
    const { rows } = await this.pool.query(
      `select run_id, tenant_id, idea_id, status,
              payload->>'traceId' as trace_id,
              payload->'gate' as gate,
              payload->>'updatedAt' as updated_at
       from kayros_runs_suspended${clause}
       order by updated_at desc limit 1000`,
      params,
    );
    return rows.map((r) => ({
      runId: r.run_id,
      traceId: r.trace_id,
      ideaId: r.idea_id,
      tenantId: r.tenant_id,
      status: r.status,
      gate: r.gate,
      updatedAt: r.updated_at,
    }));
  }

  async delete(runId, { tenantId } = {}) {
    const params = [String(runId)];
    let sql = 'delete from kayros_runs_suspended where run_id = $1';
    if (tenantId !== undefined) {
      sql += ' and tenant_id = $2';
      params.push(String(tenantId));
    }
    const res = await this.pool.query(sql, params);
    return (res.rowCount ?? 0) > 0;
  }
}
