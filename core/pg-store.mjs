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

/** Shared persistence for hybrid agent definitions, swarm configs and verdicts. */
export class PgSwarmStore {
  constructor(pool) { this.pool = pool; }

  async loadTenant(tenantId = 'default') {
    const scope = String(tenantId || 'default');
    const [agents, configurations, runs] = await Promise.all([
      this.pool.query('select payload from kayros_swarm_agents where tenant_id = $1', [scope]),
      this.pool.query('select payload from kayros_swarm_configurations where tenant_id = $1', [scope]),
      this.pool.query('select payload from kayros_swarm_runs where tenant_id = $1 order by updated_at desc limit 1000', [scope]),
    ]);
    return {
      agents: agents.rows.map((row) => row.payload),
      configurations: configurations.rows.map((row) => row.payload),
      runs: runs.rows.map((row) => row.payload),
    };
  }

  async saveAgent(agent, { tenantId = null } = {}) {
    const scope = String(tenantId || 'default');
    await this.pool.query(
      `insert into kayros_swarm_agents (tenant_id, agent_id, payload, updated_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (tenant_id, agent_id) do update set payload = excluded.payload, updated_at = now()`,
      [scope, agent.agent_id, JSON.stringify(agent)],
    );
    return agent;
  }

  async saveConfiguration(configuration, { tenantId = null } = {}) {
    const scope = String(tenantId || configuration?.tenant_id || 'default');
    await this.pool.query(
      `insert into kayros_swarm_configurations (tenant_id, swarm_id, payload, updated_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (tenant_id, swarm_id) do update set payload = excluded.payload, updated_at = now()`,
      [scope, configuration.swarm_id, JSON.stringify(configuration)],
    );
    return configuration;
  }

  async saveRun(run, { tenantId = null } = {}) {
    const scope = String(tenantId || run?.tenant_id || 'default');
    await this.pool.query(
      `insert into kayros_swarm_runs (tenant_id, run_id, swarm_id, status, payload, updated_at)
       values ($1, $2, $3, $4, $5::jsonb, now())
       on conflict (tenant_id, run_id) do update set
         swarm_id = excluded.swarm_id, status = excluded.status,
         payload = excluded.payload, updated_at = now()`,
      [scope, run.run_id, run.swarm_id, run.status, JSON.stringify(run)],
    );
    return run;
  }

  async countPendingRuns(tenantId = 'default') {
    const { rows } = await this.pool.query(
      `select count(*)::int as n from kayros_swarm_runs
       where tenant_id = $1 and status = 'pending_human_arbitration'`,
      [String(tenantId || 'default')],
    );
    return rows[0]?.n || 0;
  }
}

/** Shared rooms, event stream, webhook claims and distributed room locks. */
export class PgCollaborationStore {
  constructor(pool, { messageLeaseSeconds = 300 } = {}) {
    this.pool = pool;
    this.messageLeaseSeconds = Math.max(30, Number(messageLeaseSeconds) || 300);
  }

  async createRoom(room, runtimeBundle) {
    const payload = { room, runtime_bundle: runtimeBundle };
    const { rows } = await this.pool.query(
      `insert into kayros_collaboration_rooms
       (room_id, tenant_id, platform, external_room_id, status, payload, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       returning payload`,
      [room.room_id, room.tenant_id, room.platform, room.external_room_id, room.status,
        JSON.stringify(payload), room.created_at, room.updated_at],
    );
    return rows[0]?.payload || payload;
  }

  async getRoom(roomId, { tenantId = null } = {}) {
    const params = [String(roomId)];
    let sql = 'select payload from kayros_collaboration_rooms where room_id = $1';
    if (tenantId != null) { params.push(String(tenantId)); sql += ' and tenant_id = $2'; }
    const { rows } = await this.pool.query(sql, params);
    return rows[0]?.payload || null;
  }

  async findRoom(platform, externalRoomId) {
    const { rows } = await this.pool.query(
      `select payload from kayros_collaboration_rooms
       where platform = $1 and external_room_id = $2 and status = 'active'`,
      [String(platform), String(externalRoomId)],
    );
    return rows[0]?.payload || null;
  }

  async listRooms({ tenantId = null, platform = null } = {}) {
    const params = [];
    const where = [];
    if (tenantId != null) { params.push(String(tenantId)); where.push(`tenant_id = $${params.length}`); }
    if (platform) { params.push(String(platform)); where.push(`platform = $${params.length}`); }
    const clause = where.length ? ` where ${where.join(' and ')}` : '';
    const { rows } = await this.pool.query(
      `select payload from kayros_collaboration_rooms${clause} order by updated_at desc limit 1000`,
      params,
    );
    return rows.map((row) => row.payload);
  }

  async updateRoomActivity(roomId, timestamp) {
    await this.pool.query(
      `update kayros_collaboration_rooms set
         payload = jsonb_set(jsonb_set(payload, '{room,last_activity_at}', to_jsonb($2::text)), '{room,updated_at}', to_jsonb($2::text)),
         updated_at = $2::timestamptz
       where room_id = $1`,
      [String(roomId), String(timestamp)],
    );
  }

  async appendEvent(event) {
    const payload = { ...event };
    delete payload.sequence;
    const { rows } = await this.pool.query(
      `insert into kayros_collaboration_events (tenant_id, room_id, type, payload, created_at)
       values ($1, $2, $3, $4::jsonb, $5)
       returning sequence`,
      [String(event.tenant_id || 'default'), event.room_id || null, event.type, JSON.stringify(payload), event.ts],
    );
    return { ...event, sequence: Number(rows[0].sequence) };
  }

  async activity({ tenantId = null, roomId = null, after = 0, limit = 100 } = {}) {
    const params = [Number(after || 0)];
    const where = ['sequence > $1'];
    if (tenantId != null) { params.push(String(tenantId)); where.push(`tenant_id = $${params.length}`); }
    if (roomId) { params.push(String(roomId)); where.push(`room_id = $${params.length}`); }
    params.push(Math.max(1, Math.min(250, Number(limit) || 100)));
    const { rows } = await this.pool.query(
      `select sequence, payload from kayros_collaboration_events
       where ${where.join(' and ')} order by sequence desc limit $${params.length}`,
      params,
    );
    return rows.reverse().map((row) => ({ ...row.payload, sequence: Number(row.sequence) }));
  }

  async createThread(thread) {
    const { rows } = await this.pool.query(
      `insert into kayros_decision_threads
       (thread_id, tenant_id, room_id, root_run_id, current_run_id, status, question, payload, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) returning payload`,
      [thread.thread_id, thread.tenant_id, thread.room_id, thread.root_run_id, thread.current_run_id,
        thread.status, thread.question, JSON.stringify(thread), thread.created_at, thread.updated_at],
    );
    return rows[0]?.payload || thread;
  }

  async getThread(threadId, { tenantId = null } = {}) {
    const params = [String(threadId)];
    let where = 'thread_id = $1';
    if (tenantId != null) { params.push(String(tenantId)); where += ' and tenant_id = $2'; }
    const { rows } = await this.pool.query(`select payload from kayros_decision_threads where ${where}`, params);
    if (!rows[0]) return null;
    const messages = await this.pool.query(
      `select message_id, payload from kayros_decision_thread_messages
       where thread_id = $1 order by message_id asc`, [String(threadId)],
    );
    return { ...rows[0].payload, messages: messages.rows.map((row) => ({ ...row.payload, message_id: String(row.message_id) })) };
  }

  async listThreads({ tenantId = null, roomId = null, limit = 100 } = {}) {
    const params = [];
    const where = [];
    if (tenantId != null) { params.push(String(tenantId)); where.push(`tenant_id = $${params.length}`); }
    if (roomId) { params.push(String(roomId)); where.push(`room_id = $${params.length}`); }
    params.push(Math.max(1, Math.min(250, Number(limit) || 100)));
    const clause = where.length ? `where ${where.join(' and ')}` : '';
    const { rows } = await this.pool.query(
      `select payload from kayros_decision_threads ${clause} order by updated_at desc limit $${params.length}`, params,
    );
    return Promise.all(rows.map((row) => this.getThread(row.payload.thread_id, { tenantId })));
  }

  async updateThread(threadId, patch, { tenantId = null } = {}) {
    const current = await this.getThread(threadId, { tenantId });
    if (!current) return null;
    delete current.messages;
    const next = { ...current, ...patch, thread_id: current.thread_id, tenant_id: current.tenant_id };
    const { rows } = await this.pool.query(
      `update kayros_decision_threads set
         root_run_id=$3, current_run_id=$4, status=$5, question=$6, payload=$7::jsonb,
         updated_at=$8 where thread_id=$1 and tenant_id=$2 returning payload`,
      [next.thread_id, next.tenant_id, next.root_run_id, next.current_run_id, next.status,
        next.question, JSON.stringify(next), next.updated_at],
    );
    return rows[0]?.payload || null;
  }

  async appendThreadMessage(threadId, message, { tenantId = null } = {}) {
    const scope = String(tenantId || message.tenant_id || 'default');
    const { rows } = await this.pool.query(
      `insert into kayros_decision_thread_messages
       (thread_id, tenant_id, role, kind, author_id, payload, created_at)
       select $1,$2,$3,$4,$5,$6::jsonb,$7
       where exists (select 1 from kayros_decision_threads where thread_id=$1 and tenant_id=$2)
       returning message_id`,
      [String(threadId), scope, message.role, message.kind, message.author_id || null,
        JSON.stringify(message), message.created_at],
    );
    if (!rows[0]) throw new Error('fil introuvable');
    await this.pool.query('update kayros_decision_threads set updated_at=$2, payload=jsonb_set(payload, \'{updated_at}\', to_jsonb($2::text)) where thread_id=$1', [String(threadId), message.created_at]);
    return { ...message, message_id: String(rows[0].message_id) };
  }

  async claimMessage({ platform, messageId, tenantId, roomId }) {
    const { rows } = await this.pool.query(
      `insert into kayros_collaboration_messages
       (platform, message_id, tenant_id, room_id, status, lease_until, updated_at)
       values ($1, $2, $3, $4, 'processing', now() + ($5 * interval '1 second'), now())
       on conflict (tenant_id, platform, message_id) do update set
         room_id = excluded.room_id,
         status = 'processing',
         lease_until = excluded.lease_until,
         result = null,
         updated_at = now()
       where kayros_collaboration_messages.status = 'failed'
          or (kayros_collaboration_messages.status = 'processing'
              and kayros_collaboration_messages.lease_until < now())
       returning status, result`,
      [platform, messageId, String(tenantId || 'default'), roomId, this.messageLeaseSeconds],
    );
    if (rows.length) return { claimed: true, result: null };
    const existing = await this.pool.query(
      'select status, result from kayros_collaboration_messages where tenant_id = $1 and platform = $2 and message_id = $3',
      [String(tenantId || 'default'), platform, messageId],
    );
    return { claimed: false, completed: existing.rows[0]?.status === 'completed', result: existing.rows[0]?.result || null };
  }

  async completeMessage(platform, messageId, result, tenantId = null) {
    await this.pool.query(
      `update kayros_collaboration_messages
       set status = 'completed', result = $3::jsonb, lease_until = now(), updated_at = now()
       where platform = $1 and message_id = $2 and tenant_id = $4`,
      [platform, messageId, JSON.stringify(result), String(tenantId || 'default')],
    );
  }

  async failMessage(platform, messageId, tenantId = null) {
    await this.pool.query(
      `update kayros_collaboration_messages
       set status = 'failed', lease_until = now(), updated_at = now()
       where platform = $1 and message_id = $2 and tenant_id = $3`,
      [platform, messageId, String(tenantId || 'default')],
    );
  }

  async withRoomLock(roomId, fn) {
    const client = await this.pool.connect();
    try {
      await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [String(roomId)]);
      return await fn();
    } finally {
      try { await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [String(roomId)]); }
      finally { client.release(); }
    }
  }
}

/** PostgreSQL metadata repository for the Sales Oracle document-ingestion MVP. */
const normalizeSalesOracleDocument = (row) => row ? { ...row, size_bytes: Number(row.size_bytes) } : null;

export class PgSalesOracleRepository {
  constructor(pool) { this.pool = pool; }

  async saveCase(record) {
    const { rows } = await this.pool.query(
      `insert into sales_oracle_cases
       (case_id, tenant_id, name, use_case, decision_question, client_reference, committee_date,
        status, corpus_version, retention_until, created_by, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (case_id) do update set
         name=excluded.name, use_case=excluded.use_case, decision_question=excluded.decision_question,
         client_reference=excluded.client_reference, committee_date=excluded.committee_date,
         status=excluded.status, corpus_version=excluded.corpus_version,
         retention_until=excluded.retention_until, updated_at=excluded.updated_at
       returning *`,
      [record.case_id, record.tenant_id, record.name, record.use_case, record.decision_question,
        record.client_reference, record.committee_date, record.status, record.corpus_version,
        record.retention_until, record.created_by, record.created_at, record.updated_at],
    );
    return rows[0];
  }

  async getCase(caseId, { tenantId } = {}) {
    const { rows } = await this.pool.query(
      'select * from sales_oracle_cases where case_id=$1 and tenant_id=$2',
      [String(caseId), String(tenantId || 'default')],
    );
    return rows[0] || null;
  }

  async listCases({ tenantId, status } = {}) {
    const params = [String(tenantId || 'default')];
    let sql = 'select * from sales_oracle_cases where tenant_id=$1';
    if (status) { params.push(String(status)); sql += ' and status=$2'; }
    const { rows } = await this.pool.query(`${sql} order by updated_at desc limit 500`, params);
    return rows;
  }

  async saveDocument(record) {
    const { rows } = await this.pool.query(
      `insert into sales_oracle_documents
       (document_id, tenant_id, case_id, source_type, original_filename, mime_type, size_bytes,
        sha256, object_key, sensitivity, status, language, page_count, extraction_error,
        storage_etag, uploaded_by, uploaded_at, processed_at, deleted_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       on conflict (document_id) do update set
         status=excluded.status, language=excluded.language, page_count=excluded.page_count,
         extraction_error=excluded.extraction_error, storage_etag=excluded.storage_etag,
         processed_at=excluded.processed_at, deleted_at=excluded.deleted_at
       returning *`,
      [record.document_id, record.tenant_id, record.case_id, record.source_type,
        record.original_filename, record.mime_type, record.size_bytes, record.sha256,
        record.object_key, record.sensitivity, record.status, record.language, record.page_count,
        record.extraction_error, record.storage_etag || null, record.uploaded_by,
        record.uploaded_at, record.processed_at, record.deleted_at],
    );
    return normalizeSalesOracleDocument(rows[0]);
  }

  async getDocument(documentId, { tenantId } = {}) {
    const { rows } = await this.pool.query(
      'select * from sales_oracle_documents where document_id=$1 and tenant_id=$2',
      [String(documentId), String(tenantId || 'default')],
    );
    return normalizeSalesOracleDocument(rows[0] || null);
  }

  async listDocuments(caseId, { tenantId } = {}) {
    const { rows } = await this.pool.query(
      `select * from sales_oracle_documents
       where case_id=$1 and tenant_id=$2 and status <> 'deleted'
       order by uploaded_at desc`,
      [String(caseId), String(tenantId || 'default')],
    );
    return rows.map(normalizeSalesOracleDocument);
  }

  async findDocumentBySha(caseId, sha256, { tenantId } = {}) {
    const { rows } = await this.pool.query(
      `select * from sales_oracle_documents
       where case_id=$1 and tenant_id=$2 and sha256=$3 and status <> 'deleted' limit 1`,
      [String(caseId), String(tenantId || 'default'), String(sha256)],
    );
    return normalizeSalesOracleDocument(rows[0] || null);
  }

  async saveJob(record) {
    const { rows } = await this.pool.query(
      `insert into sales_oracle_ingestion_jobs
       (job_id, tenant_id, document_id, job_type, status, attempt_count, available_at,
        locked_at, locked_by, error, created_by, created_at, completed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
       returning *`,
      [record.job_id, record.tenant_id, record.document_id, record.job_type, record.status,
        record.attempt_count, record.available_at, record.locked_at, record.locked_by,
        record.error == null ? null : JSON.stringify(record.error), record.created_by,
        record.created_at, record.completed_at],
    );
    return rows[0];
  }
}
