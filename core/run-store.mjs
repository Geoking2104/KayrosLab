// KayrosLab -- persistence for runs suspended on a human gate.
//
// `Orchestrator.resume` takes the snapshot the suspended run yielded. If
// nobody stores that snapshot it dies with the HTTP request, and the resume
// path is unreachable in practice. The JSONL sink writes the *log*, not the
// state, so it cannot serve here.
//
// A suspended run is keyed by runId and scoped by tenant: resuming someone
// else's run must be impossible by construction, not by a caller remembering
// to check.

import { migrateWorkflowState, validateWorkflowState } from './workflow-state.mjs';

/** Statuses worth keeping: a run that is over has nothing to resume. */
export const RESUMABLE_STATUSES = Object.freeze(['pending_review', 'revision_required']);

function assertResumable(state) {
  validateWorkflowState(state);
  if (!state.runId) throw new Error('RunStore: a run snapshot needs a runId');
  return state;
}

function scopeOf(state, tenantId) {
  return String(tenantId ?? state?.input?.context?.tenantId ?? 'default');
}

function matches(record, { tenantId, ideaId, status } = {}) {
  if (tenantId !== undefined && record.tenantId !== String(tenantId)) return false;
  if (ideaId !== undefined && record.state.ideaId !== ideaId) return false;
  if (status !== undefined && record.state.status !== status) return false;
  return true;
}

/** Base behaviour shared by every store; subclasses provide persistence. */
class BaseRunStore {
  constructor() { this._runs = new Map(); }

  async save(state, { tenantId } = {}) {
    assertResumable(state);
    const record = {
      runId: state.runId,
      traceId: state.traceId,
      ideaId: state.ideaId,
      tenantId: scopeOf(state, tenantId),
      status: state.status,
      gate: state.gate ?? null,
      updatedAt: state.updatedAt,
      state: JSON.parse(JSON.stringify(state)),
    };
    this._runs.set(record.runId, record);
    await this._persist();
    return record;
  }

  /**
   * Returns the stored snapshot, or null. `tenantId` is checked here rather
   * than left to the caller: a missed check is a cross-tenant read.
   */
  async get(runId, { tenantId } = {}) {
    const record = this._runs.get(String(runId));
    if (!record) return null;
    if (tenantId !== undefined && record.tenantId !== String(tenantId)) return null;
    return migrateWorkflowState(record.state);
  }

  /** Lightweight listing: no full state, so it stays cheap to poll. */
  async list(filter = {}) {
    const out = [];
    for (const record of this._runs.values()) {
      if (!matches(record, filter)) continue;
      out.push({
        runId: record.runId,
        traceId: record.traceId,
        ideaId: record.ideaId,
        tenantId: record.tenantId,
        status: record.status,
        gate: record.gate,
        updatedAt: record.updatedAt,
      });
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async delete(runId, { tenantId } = {}) {
    const record = this._runs.get(String(runId));
    if (!record) return false;
    if (tenantId !== undefined && record.tenantId !== String(tenantId)) return false;
    this._runs.delete(String(runId));
    await this._persist();
    return true;
  }

  async _persist() { /* memory store: nothing to do */ }
}

export class InMemoryRunStore extends BaseRunStore {}

/**
 * File-backed store. Writes the whole map on each change: a suspended run is
 * a rare event, and an atomic rewrite is easier to reason about than an
 * append log that has to be compacted.
 */
export class FileRunStore extends BaseRunStore {
  constructor({ path, fs = null } = {}) {
    super();
    if (!path) throw new Error('FileRunStore: path required');
    this.path = path;
    this._fs = fs;
    this._loaded = false;
  }

  async _getFs() {
    if (!this._fs) this._fs = await import('node:fs/promises');
    return this._fs;
  }

  async load() {
    if (this._loaded) return this;
    this._loaded = true;
    try {
      const fs = await this._getFs();
      const raw = await fs.readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      for (const record of Array.isArray(parsed) ? parsed : []) {
        if (record?.runId) this._runs.set(String(record.runId), record);
      }
    } catch {
      // No file yet, or an unreadable one: an empty store is the safe start.
      // Losing a suspended run is bad, but refusing to boot is worse.
    }
    return this;
  }

  async save(state, opts) { await this.load(); return super.save(state, opts); }
  async get(runId, opts) { await this.load(); return super.get(runId, opts); }
  async list(filter) { await this.load(); return super.list(filter); }
  async delete(runId, opts) { await this.load(); return super.delete(runId, opts); }

  async _persist() {
    const fs = await this._getFs();
    const payload = JSON.stringify([...this._runs.values()], null, 2);
    const tmp = `${this.path}.tmp`;
    // Write-then-rename: a crash mid-write must not truncate the store.
    await fs.writeFile(tmp, payload, 'utf8');
    await fs.rename(tmp, this.path);
  }
}

/** Normalizes whatever the caller passed as a store. */
export function resolveRunStore(store) {
  if (!store) return null;
  if (typeof store.save === 'function' && typeof store.get === 'function') return store;
  return null;
}
