// KayrosLab — missions de l'API publique (/v1/public/missions).
//
// Une mission publique est un fil de décision de la console (même moteur,
// même arbitrage) enrichi de : clé d'idempotence, référence externe
// (ex. salesforce:Opportunity:006…), URL de rappel, profil d'exécution.
// Ce module ne réimplémente rien du collectif : il stocke ces métadonnées,
// aplatit le fil en un verdict simple à mapper dans Zapier/n8n, et publie les
// événements signés mission.completed / mission.failed / mission.arbitrated.

import { createHash, randomBytes } from 'node:crypto';

function now() { return new Date().toISOString(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
export function makeMissionId() { return `msn_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`; }
function makeEventId() { return `evt_${Date.now().toString(36)}${randomBytes(8).toString('hex')}`; }

/** Empreinte stable d'une requête (clés triées) pour détecter la réutilisation d'une clé d'idempotence. */
export function requestFingerprint(body) {
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
    return value;
  };
  return createHash('sha256').update(JSON.stringify(stable(body ?? {}))).digest('hex');
}

/** `salesforce:Opportunity:006…` ⇄ `{ system, object, id }`. */
export function parseExternalRef(value) {
  if (!value) return null;
  if (typeof value === 'object') {
    const system = String(value.system || '').trim().toLowerCase();
    const id = String(value.id || '').trim();
    if (!system || !id) return null;
    return { system, object: String(value.object || '').trim() || null, id, url: value.url ? String(value.url) : null };
  }
  const parts = String(value).split(':');
  if (parts.length < 2) return null;
  const system = parts.shift().trim().toLowerCase();
  const id = parts.pop().trim();
  const object = parts.join(':').trim() || null;
  return system && id ? { system, object, id, url: null } : null;
}

// --- Stockage --------------------------------------------------------------

export class InMemoryPublicMissionStore {
  constructor() { this.items = new Map(); }
  async insert(mission) {
    for (const item of this.items.values()) {
      if (mission.idempotency_key && item.tenant_id === mission.tenant_id && item.idempotency_key === mission.idempotency_key) {
        const error = new Error('clé d’idempotence déjà utilisée'); error.code = 'IDEMPOTENCY_CONFLICT'; error.existing = clone(item); throw error;
      }
    }
    this.items.set(mission.mission_id, clone(mission));
    return clone(mission);
  }
  async update(missionId, patch) {
    const item = this.items.get(missionId); if (!item) return null;
    Object.assign(item, clone(patch), { updated_at: now() });
    return clone(item);
  }
  async remove(missionId) { this.items.delete(missionId); }
  async get(tenantId, missionId) {
    const item = this.items.get(missionId);
    return item && item.tenant_id === tenantId ? clone(item) : null;
  }
  async findByIdempotencyKey(tenantId, key) {
    return clone([...this.items.values()].find((item) => item.tenant_id === tenantId && item.idempotency_key === key) || null);
  }
  async findByThread(threadId) { return clone([...this.items.values()].find((item) => item.thread_id === threadId) || null); }
  async search(tenantId, { externalRef = null, limit = 20 } = {}) {
    return [...this.items.values()].filter((item) => item.tenant_id === tenantId && (!externalRef || (
      item.external_ref?.system === externalRef.system && item.external_ref?.id === externalRef.id
      && (!externalRef.object || item.external_ref?.object === externalRef.object))))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit).map(clone);
  }
  async countSince(tenantId, sinceIso) {
    return [...this.items.values()].filter((item) => item.tenant_id === tenantId && item.created_at >= sinceIso).length;
  }
}

export class PgPublicMissionStore {
  constructor(pool) { this.pool = pool; }
  static row(row) {
    if (!row) return null;
    return { ...row.payload, mission_id: row.mission_id, tenant_id: row.tenant_id, thread_id: row.thread_id };
  }
  async insert(mission) {
    try {
      const ref = mission.external_ref || {};
      const { rows } = await this.pool.query(
        `insert into kayros_public_missions (mission_id, tenant_id, key_id, idempotency_key, request_sha256, thread_id, room_id,
           profile, external_system, external_object, external_id, payload, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$13) returning *`,
        [mission.mission_id, mission.tenant_id, mission.key_id || null, mission.idempotency_key || null,
          mission.request_sha256 || null, mission.thread_id || null, mission.room_id, mission.profile,
          ref.system || null, ref.object || null, ref.id || null, JSON.stringify(mission), mission.created_at],
      );
      return PgPublicMissionStore.row(rows[0]);
    } catch (error) {
      if (error?.code === '23505' && mission.idempotency_key) {
        const existing = await this.findByIdempotencyKey(mission.tenant_id, mission.idempotency_key);
        const conflict = new Error('clé d’idempotence déjà utilisée'); conflict.code = 'IDEMPOTENCY_CONFLICT'; conflict.existing = existing; throw conflict;
      }
      throw error;
    }
  }
  async update(missionId, patch) {
    const { rows } = await this.pool.query(
      `update kayros_public_missions set payload = payload || $2::jsonb,
         thread_id = coalesce(($2::jsonb ->> 'thread_id'), thread_id), updated_at = now()
       where mission_id = $1 returning *`, [missionId, JSON.stringify({ ...patch, updated_at: now() })],
    );
    return PgPublicMissionStore.row(rows[0]);
  }
  async remove(missionId) { await this.pool.query('delete from kayros_public_missions where mission_id = $1', [missionId]); }
  async get(tenantId, missionId) {
    const { rows } = await this.pool.query('select * from kayros_public_missions where tenant_id = $1 and mission_id = $2', [tenantId, missionId]);
    return PgPublicMissionStore.row(rows[0]);
  }
  async findByIdempotencyKey(tenantId, key) {
    const { rows } = await this.pool.query('select * from kayros_public_missions where tenant_id = $1 and idempotency_key = $2', [tenantId, key]);
    return PgPublicMissionStore.row(rows[0]);
  }
  async findByThread(threadId) {
    const { rows } = await this.pool.query('select * from kayros_public_missions where thread_id = $1 limit 1', [threadId]);
    return PgPublicMissionStore.row(rows[0]);
  }
  async search(tenantId, { externalRef = null, limit = 20 } = {}) {
    const params = [tenantId];
    let where = 'tenant_id = $1';
    if (externalRef) {
      params.push(externalRef.system, externalRef.id);
      where += ` and external_system = $2 and external_id = $3`;
      if (externalRef.object) { params.push(externalRef.object); where += ` and external_object = $${params.length}`; }
    }
    params.push(Math.max(1, Math.min(100, Number(limit) || 20)));
    const { rows } = await this.pool.query(
      `select * from kayros_public_missions where ${where} order by created_at desc limit $${params.length}`, params,
    );
    return rows.map(PgPublicMissionStore.row);
  }
  async countSince(tenantId, sinceIso) {
    const { rows } = await this.pool.query(
      'select count(*)::int as n from kayros_public_missions where tenant_id = $1 and created_at >= $2', [tenantId, sinceIso],
    );
    return rows[0]?.n || 0;
  }
}

// --- Vue aplatie ----------------------------------------------------------

function lastRun(thread) {
  const runs = (thread?.messages || []).filter((message) => message.kind === 'run' && message.run);
  return runs.length ? runs[runs.length - 1].run : null;
}
function lastDecision(thread) {
  const items = (thread?.messages || []).filter((message) => message.kind === 'arbitration');
  return items.length ? items[items.length - 1].decision || null : null;
}
function uniq(list, max) { return [...new Set(list.filter(Boolean).map((item) => String(item)))].slice(0, max); }

/**
 * Forme plate d'une mission : la même pour GET /v1/public/missions/:id et
 * pour le corps des webhooks (sans `event`).
 */
export function missionView(mission, thread, { consoleUrl = 'https://www.kayroslab.com/console' } = {}) {
  const run = lastRun(thread);
  const analyses = run?.analyses || [];
  const decision = lastDecision(thread);
  const verdict = run?.consensus?.verdict || null;
  const providers = run?.llm?.providers || [];
  const status = thread?.status || 'queued';
  return {
    mission_id: mission.mission_id,
    status,
    state: status === 'running' ? 'running'
      : status === 'failed' ? 'failed'
        : status === 'resolved' ? 'arbitrated'
          : ['awaiting_arbitration', 'needs_clarification', 'reevaluation_requested'].includes(status) ? 'completed' : status,
    collective_id: mission.room_id,
    question: mission.question,
    profile: mission.profile,
    external_ref: mission.external_ref || null,
    metadata: mission.metadata || {},
    progress: thread?.progress || null,
    verdict,
    verdict_label: verdict ? verdict.replaceAll('_', ' ') : null,
    summary: run?.consensus?.rationale || null,
    risks: uniq(analyses.flatMap((a) => a.critical_risks || []), 8),
    conditions: uniq(analyses.flatMap((a) => a.required_mitigations || []), 8),
    clarification_questions: thread?.clarification_questions || [],
    agents: analyses.map((a) => ({
      agent_id: a.agent_id, name: a.assigned_human || a.role_name || a.agent_id, role: a.role_name || null,
      verdict: a.verdict, reason: a.primary_reason || null, persona: !!a.personality_simulation_enabled,
    })),
    human_decision: decision ? {
      action: decision.action, verdict: decision.verdict || null, by: decision.by || null,
      justification: decision.justification || '', decided_at: decision.decided_at || null,
    } : null,
    llm: run ? {
      provider: providers.join(',') || null,
      profile: mission.effective_profile || mission.profile,
      simulated: mission.effective_profile === 'demo' || providers.includes('demo'),
      degraded: !!(run.llm?.mock || run.llm?.degraded?.length),
    } : null,
    error: thread?.error || null,
    dossier_url: thread ? `${String(consoleUrl).replace(/\/$/, '')}/#activity?thread=${encodeURIComponent(thread.thread_id)}` : null,
    created_at: mission.created_at,
    updated_at: thread?.updated_at || mission.updated_at || mission.created_at,
  };
}

export const THREAD_EVENT_TO_WEBHOOK = Object.freeze({
  completed: 'mission.completed',
  failed: 'mission.failed',
  arbitrated: 'mission.arbitrated',
});

/**
 * Relie les événements du gateway aux webhooks : pour un fil issu d'une
 * mission publique, met en file un événement signé vers `callback_url`
 * (mission) et vers l'URL d'abonnement du tenant (console → Intégrations).
 */
export class MissionEventPublisher {
  constructor({ missions, settings, dispatcher, consoleUrl, logger = console } = {}) {
    this.missions = missions;
    this.settings = settings;
    this.dispatcher = dispatcher;
    this.consoleUrl = consoleUrl;
    this.logger = logger;
  }

  async publish(kind, thread) {
    const type = THREAD_EVENT_TO_WEBHOOK[kind];
    if (!type || !thread?.thread_id) return [];
    const mission = await this.missions.findByThread(thread.thread_id);
    if (!mission) return [];
    const settings = await this.settings.get(mission.tenant_id);
    const targets = [];
    if (mission.callback_url) targets.push(mission.callback_url);
    if (settings.webhook_url && settings.enabled !== false && (settings.events || []).includes(type)) targets.push(settings.webhook_url);
    if (!targets.length) return [];
    const event = {
      event: type, event_id: makeEventId(), occurred_at: now(), tenant_id: mission.tenant_id,
      ...missionView(mission, thread, { consoleUrl: this.consoleUrl }),
    };
    return this.dispatcher.enqueue({ tenantId: mission.tenant_id, event, missionId: mission.mission_id, targets });
  }

  /** Événement de test (console → « Envoyer un webhook de test »). */
  async ping(tenantId, url) {
    const event = {
      event: 'ping', event_id: makeEventId(), occurred_at: now(), tenant_id: tenantId,
      message: 'Webhook de test KayrosLab : la signature X-Kayros-Signature doit être vérifiée avec votre secret.',
    };
    return this.dispatcher.enqueue({ tenantId, event, targets: [url] });
  }
}
