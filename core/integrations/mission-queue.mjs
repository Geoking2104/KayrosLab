// KayrosLab — file de missions durable (Postgres, sans Redis).
//
// Une mission console ou API n'est plus une promesse vivant seulement dans le
// processus : c'est une ligne `kayros_mission_jobs`. Un worker la réclame avec
// `FOR UPDATE SKIP LOCKED` (plusieurs processus peuvent coexister sans double
// exécution), prolonge un bail (`lease_until`) tant qu'il travaille, et la
// marque terminée. Si le processus meurt (pm2 reload, déploiement, crash), le
// bail expire et un autre worker — ou le même après redémarrage — reprend la
// mission depuis le début, au plus `max_attempts` fois.

import { randomBytes } from 'node:crypto';

export const JOB_QUEUED = 'queued';
export const JOB_RUNNING = 'running';
export const JOB_DONE = 'done';
export const JOB_FAILED = 'failed';

function now() { return new Date().toISOString(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
export function makeJobId() { return `job_${Date.now().toString(36)}${randomBytes(5).toString('hex')}`; }

export class InMemoryMissionQueue {
  constructor() { this.jobs = new Map(); }
  async enqueue(job) {
    const record = {
      status: JOB_QUEUED, attempts: 0, max_attempts: 3, available_at: now(), locked_by: null,
      lease_until: null, last_error: null, created_at: now(), started_at: null, finished_at: null,
      ...clone(job),
    };
    this.jobs.set(record.job_id, record);
    return clone(record);
  }
  async claim({ workerId, leaseMs = 120000 } = {}) {
    const t = Date.now();
    const job = [...this.jobs.values()]
      .filter((item) => (item.status === JOB_QUEUED && Date.parse(item.available_at) <= t)
        || (item.status === JOB_RUNNING && Date.parse(item.lease_until || 0) < t))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
    if (!job) return null;
    Object.assign(job, {
      status: JOB_RUNNING, locked_by: workerId, lease_until: new Date(t + leaseMs).toISOString(),
      attempts: job.attempts + 1, started_at: job.started_at || now(),
    });
    return clone(job);
  }
  async heartbeat(jobId, workerId, leaseMs = 120000) {
    const job = this.jobs.get(jobId);
    if (!job || job.locked_by !== workerId || job.status !== JOB_RUNNING) return false;
    job.lease_until = new Date(Date.now() + leaseMs).toISOString();
    return true;
  }
  async complete(jobId, workerId) {
    const job = this.jobs.get(jobId);
    if (!job || job.locked_by !== workerId) return false;
    Object.assign(job, { status: JOB_DONE, finished_at: now(), lease_until: null, locked_by: null });
    return true;
  }
  async fail(jobId, workerId, error) {
    const job = this.jobs.get(jobId);
    if (!job || (workerId && job.locked_by !== workerId)) return false;
    Object.assign(job, { status: JOB_FAILED, finished_at: now(), lease_until: null, locked_by: null, last_error: String(error || '').slice(0, 500) });
    return true;
  }
  /** Arrêt propre : rend ses missions à la file (reprises au prochain démarrage, sans attendre le bail). */
  async release(workerId) {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.locked_by === workerId && job.status === JOB_RUNNING) {
        Object.assign(job, { status: JOB_QUEUED, locked_by: null, lease_until: null, attempts: Math.max(0, job.attempts - 1) });
        count += 1;
      }
    }
    return count;
  }
  async activeForThread(threadId) {
    return clone([...this.jobs.values()].find((job) => job.thread_id === threadId && [JOB_QUEUED, JOB_RUNNING].includes(job.status)) || null);
  }
  async stats() {
    const out = { queued: 0, running: 0 };
    for (const job of this.jobs.values()) if (out[job.status] != null) out[job.status] += 1;
    return out;
  }
}

export class PgMissionQueue {
  constructor(pool) { this.pool = pool; }
  static row(row) {
    if (!row) return null;
    const iso = (value) => (value ? new Date(value).toISOString() : null);
    return {
      job_id: row.job_id, tenant_id: row.tenant_id, thread_id: row.thread_id, run_id: row.run_id, kind: row.kind,
      spec: row.spec, status: row.status, attempts: Number(row.attempts || 0), max_attempts: Number(row.max_attempts || 3),
      locked_by: row.locked_by, lease_until: iso(row.lease_until), last_error: row.last_error,
      created_at: iso(row.created_at), started_at: iso(row.started_at), finished_at: iso(row.finished_at),
    };
  }
  async enqueue(job) {
    const { rows } = await this.pool.query(
      `insert into kayros_mission_jobs (job_id, tenant_id, thread_id, run_id, kind, spec, max_attempts)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7) returning *`,
      [job.job_id, job.tenant_id, job.thread_id, job.run_id, job.kind, JSON.stringify(job.spec || {}), Number(job.max_attempts) || 3],
    );
    return PgMissionQueue.row(rows[0]);
  }
  async claim({ workerId, leaseMs = 120000 } = {}) {
    const { rows } = await this.pool.query(
      `update kayros_mission_jobs j set status = 'running', locked_by = $1,
         lease_until = now() + ($2 * interval '1 millisecond'), attempts = j.attempts + 1,
         started_at = coalesce(j.started_at, now())
       where j.job_id = (
         select job_id from kayros_mission_jobs
         where (status = 'queued' and available_at <= now()) or (status = 'running' and lease_until < now())
         order by created_at asc
         for update skip locked
         limit 1)
       returning j.*`,
      [workerId, leaseMs],
    );
    return PgMissionQueue.row(rows[0]);
  }
  async heartbeat(jobId, workerId, leaseMs = 120000) {
    const { rowCount } = await this.pool.query(
      `update kayros_mission_jobs set lease_until = now() + ($3 * interval '1 millisecond')
       where job_id = $1 and locked_by = $2 and status = 'running'`, [jobId, workerId, leaseMs],
    );
    return rowCount > 0;
  }
  async complete(jobId, workerId) {
    const { rowCount } = await this.pool.query(
      `update kayros_mission_jobs set status = 'done', finished_at = now(), lease_until = null, locked_by = null
       where job_id = $1 and locked_by = $2`, [jobId, workerId],
    );
    return rowCount > 0;
  }
  async fail(jobId, workerId, error) {
    const { rowCount } = await this.pool.query(
      `update kayros_mission_jobs set status = 'failed', finished_at = now(), lease_until = null, locked_by = null, last_error = $3
       where job_id = $1 and ($2::text is null or locked_by = $2)`, [jobId, workerId || null, String(error || '').slice(0, 500)],
    );
    return rowCount > 0;
  }
  async release(workerId) {
    const { rowCount } = await this.pool.query(
      `update kayros_mission_jobs set status = 'queued', locked_by = null, lease_until = null, attempts = greatest(attempts - 1, 0)
       where locked_by = $1 and status = 'running'`, [workerId],
    );
    return rowCount;
  }
  async activeForThread(threadId) {
    const { rows } = await this.pool.query(
      `select * from kayros_mission_jobs where thread_id = $1 and status in ('queued','running')
       order by created_at desc limit 1`, [String(threadId)],
    );
    return PgMissionQueue.row(rows[0]);
  }
  async stats() {
    const { rows } = await this.pool.query(
      `select status, count(*)::int as n from kayros_mission_jobs where status in ('queued','running') group by status`,
    );
    const out = { queued: 0, running: 0 };
    for (const row of rows) out[row.status] = row.n;
    return out;
  }
}

/**
 * Worker : réclame des missions tant qu'il a de la place (`concurrency`),
 * entretient leur bail et les termine. `handler(job)` ne doit pas lever pour
 * une erreur métier (le fil est alors déjà `failed`) ; une exception est
 * consignée et la mission marquée `failed`.
 */
export class MissionWorker {
  constructor({ queue, handler, concurrency = 2, pollMs = 2000, leaseMs = 120000, workerId = null, logger = console } = {}) {
    if (!queue || typeof handler !== 'function') throw new Error('MissionWorker: queue et handler requis');
    this.queue = queue;
    this.handler = handler;
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.pollMs = Math.max(50, Number(pollMs) || 2000);
    this.leaseMs = Math.max(1000, Number(leaseMs) || 120000);
    this.workerId = workerId || `mw_${process.pid}_${randomBytes(3).toString('hex')}`;
    this.logger = logger;
    this.active = new Map();
    this.timer = null;
    this.filling = null;
    this.stopped = true;
  }

  start() {
    if (!this.stopped) return this;
    this.stopped = false;
    this.timer = setInterval(() => this.kick(), this.pollMs);
    this.timer.unref?.();
    this.kick();
    return this;
  }

  /** Réclame immédiatement (après une mise en file) sans attendre le prochain tic. */
  kick() {
    if (this.stopped) return Promise.resolve(0);
    if (!this.filling) {
      this.filling = this._fill().finally(() => { this.filling = null; });
    }
    return this.filling;
  }

  async _fill() {
    let started = 0;
    while (!this.stopped && this.active.size < this.concurrency) {
      let job = null;
      try { job = await this.queue.claim({ workerId: this.workerId, leaseMs: this.leaseMs }); }
      catch (e) { this.logger?.warn?.('[kayros][missions] réclamation impossible:', e?.message || e); return started; }
      if (!job) return started;
      started += 1;
      this.active.set(job.job_id, this._run(job));
    }
    return started;
  }

  async _run(job) {
    const beat = setInterval(() => {
      // Worker arrêté : plus de bail entretenu, la mission redevient réclamable.
      if (this.stopped) { clearInterval(beat); return; }
      this.queue.heartbeat(job.job_id, this.workerId, this.leaseMs).catch(() => {});
    }, Math.max(500, Math.floor(this.leaseMs / 3)));
    beat.unref?.();
    try {
      await this.handler(job);
      if (!this.stopped) await this.queue.complete(job.job_id, this.workerId);
    } catch (error) {
      if (!this.stopped) await this.queue.fail(job.job_id, this.workerId, error?.message || error).catch(() => {});
      this.logger?.warn?.(`[kayros][missions] ${job.job_id} en échec:`, error?.message || error);
    } finally {
      clearInterval(beat);
      this.active.delete(job.job_id);
      if (!this.stopped) setImmediate(() => this.kick());
    }
  }

  /** Attend la fin des missions en cours (tests). */
  async idle() {
    for (;;) {
      if (this.filling) await this.filling;
      if (!this.active.size) return;
      await Promise.allSettled([...this.active.values()]);
    }
  }

  /**
   * Arrêt. `release: true` (arrêt propre, SIGINT de pm2) rend les missions en
   * cours à la file pour une reprise immédiate au prochain démarrage.
   * Sans `release`, on simule un crash : le bail expirera.
   */
  async stop({ release = false } = {}) {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (release) return this.queue.release(this.workerId).catch(() => 0);
    return 0;
  }
}
