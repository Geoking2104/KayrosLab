// KayrosLab — shared collaboration runtime for Slack, Discord and Teams.
// Rooms, events, idempotency and per-room locks are store-backed so multiple
// backend instances can safely consume the same webhook stream.

import { AbstractView } from './connectors.mjs';
import { InMemoryCollaborationStore } from './collaboration-store.mjs';

export const COLLABORATION_PLATFORMS = Object.freeze(['slack', 'discord', 'teams', 'console']);
export const ROOM_MODES = Object.freeze(['mention_only', 'always']);

function now() { return new Date().toISOString(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function makeId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`; }
function required(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} requis`);
  return normalized;
}
function normalizePlatform(value) {
  const platform = String(value || '').trim().toLowerCase();
  if (!COLLABORATION_PLATFORMS.includes(platform)) throw new Error(`plateforme inconnue: ${platform}`);
  return platform;
}
function cleanPrompt(text) {
  return String(text || '').replace(/^\s*\/kayros(?:\s+ask)?\s*/i, '')
    .replace(/<@[A-Z0-9]+>/gi, '').replace(/@(?:kayros(?:lab)?|agent)\b[:,]?/gi, '').trim();
}
function wasInvoked(text, explicit = false) {
  return explicit || /^\s*\/kayros\b/i.test(String(text || ''))
    || /@(?:kayros(?:lab)?|agent)\b/i.test(String(text || '')) || /<@[A-Z0-9]+>/i.test(String(text || ''));
}
function publicRoom(record) { return clone(record?.room || null); }

function clarificationQuestions(run) {
  const analyses = run?.analyses || [];
  const assumptions = [...new Set(analyses.flatMap((item) => item.unverified_assumptions || []))];
  const ambiguous = run?.consensus?.verdict === 'CONDITIONAL_GO' || assumptions.length > 0;
  if (!ambiguous) return [];
  const conditions = [...new Set(analyses.flatMap((item) => item.required_mitigations || []))];
  const risks = [...new Set(analyses.flatMap((item) => item.critical_risks || []))];
  const candidates = [
    ...assumptions.map((item) => `Pouvez-vous confirmer ou corriger cette hypothèse : ${item}`),
    ...conditions.map((item) => `Quel est l’état, le responsable et l’échéance de cette condition : ${item}`),
    ...risks.map((item) => `Quelle preuve ou mesure disponible permet d’évaluer ce risque : ${item}`),
  ];
  if (!candidates.length && run?.consensus?.verdict === 'CONDITIONAL_GO') {
    candidates.push('Quels paramètres, seuils ou contraintes doivent être précisés avant une décision ferme ?');
  }
  return candidates.slice(0, 4);
}

export function summarizeSwarmRun(run) {
  const verdict = run?.consensus?.verdict || 'CONDITIONAL_GO';
  const risks = (run?.analyses || []).flatMap((analysis) => analysis.critical_risks || []).slice(0, 3);
  const mitigations = (run?.analyses || []).flatMap((analysis) => analysis.required_mitigations || []).slice(0, 3);
  const rationale = run?.consensus?.rationale || 'Human review is required.';
  const lines = [`Verdict du collectif : ${verdict.replaceAll('_', ' ')}`, rationale];
  if (risks.length) lines.push(`Risques : ${risks.join(' · ')}`);
  if (mitigations.length) lines.push(`Conditions : ${mitigations.join(' · ')}`);
  lines.push(`Décision humaine requise · dossier ${run?.run_id || 'indisponible'}`);
  return {
    title: `${run?.swarm_name || 'Collectif Kayros'} · ${verdict.replaceAll('_', ' ')}`,
    text: lines.join('\n'), verdict, rationale, risks, mitigations,
    run_id: run?.run_id || null,
    requires_human_arbitration: run?.consensus?.requires_human_arbitration !== false,
  };
}

export class HybridAgentGateway {
  constructor({ swarm, adapters = [], auditSink = null, maxEvents = 1000, store = null } = {}) {
    if (!swarm) throw new Error('HybridAgentGateway: swarm requis');
    this.swarm = swarm;
    this.auditSink = auditSink;
    this.store = store || new InMemoryCollaborationStore({ maxEvents });
    this.adapters = new Map();
    this.tenantAdapters = new Map();
    for (const adapter of adapters || []) this.setAdapter(adapter);
  }

  setAdapter(adapter) {
    if (!adapter?.platform) return false;
    this.adapters.set(normalizePlatform(adapter.platform), adapter);
    return true;
  }

  setTenantAdapter(tenantId, adapter) {
    if (!adapter?.platform) return false;
    this.tenantAdapters.set(`${String(tenantId || 'default')}:${normalizePlatform(adapter.platform)}`, adapter);
    return true;
  }

  adapterFor(platform, tenantId = null) {
    return this.tenantAdapters.get(`${String(tenantId || 'default')}:${normalizePlatform(platform)}`)
      || this.adapters.get(normalizePlatform(platform)) || null;
  }

  async connections({ tenantId = null } = {}) {
    const rooms = (await this.store.listRooms({ tenantId })).map(publicRoom);
    return COLLABORATION_PLATFORMS.filter((platform) => platform !== 'console').map((platform) => ({
      platform,
      status: this.adapters.has(platform) ? 'connected' : 'not_configured',
      adapter: this.adapters.get(platform)?.name || null,
      rooms: rooms.filter((room) => room.platform === platform).length,
    }));
  }

  async _record(type, detail = {}) {
    const event = await this.store.appendEvent({ type, ts: now(), ...clone(detail) });
    try { await this.auditSink?.(event); } catch { /* audit must never break chat delivery */ }
    return event;
  }

  _runtimeBundle(configuration, tenantId) {
    return {
      configuration: clone(configuration),
      agents: configuration.active_agents.map((agentId) => this.swarm.registry.get(agentId, { tenantId })).filter(Boolean),
    };
  }

  async _hydrateRuntime(record) {
    const room = record?.room;
    if (!room) return null;
    await this.swarm.hydrateTenant?.(room.tenant_id);
    const bundle = record.runtime_bundle || {};
    for (const agent of bundle.agents || []) this.swarm.registry.upsert(agent, { tenantId: room.tenant_id });
    if (bundle.configuration) this.swarm.restoreConfiguration(bundle.configuration, { tenantId: room.tenant_id });
    return room;
  }

  async createRoom(input, { tenantId = null, by = null } = {}) {
    const scope = String(tenantId || 'default');
    await this.swarm.hydrateTenant?.(scope);
    const platform = normalizePlatform(input?.platform || 'console');
    const external_room_id = required(input?.external_room_id, 'external_room_id');
    const name = required(input?.name || external_room_id, 'name');
    const mode = input?.mode || 'mention_only';
    if (!ROOM_MODES.includes(mode)) throw new Error(`mode inconnu: ${mode}`);
    if (await this.store.findRoom(platform, external_room_id)) throw new Error(`salon déjà connecté: ${platform}:${external_room_id}`);

    let swarm_id = String(input?.swarm_id || '').trim();
    let configuration = swarm_id ? this.swarm.getConfiguration(swarm_id, { tenantId: scope }) : null;
    if (swarm_id && !configuration) throw new Error(`swarm introuvable: ${swarm_id}`);
    if (!swarm_id) {
      const active_agents = Array.isArray(input?.active_agents) && input.active_agents.length
        ? input.active_agents : ['cfo', 'cto', 'legal_counsel'];
      const hasConsentedHybrid = active_agents.some((agentId) => {
        const agent = this.swarm.registry.get(agentId, { tenantId: scope });
        return agent?.agent_type === 'hybrid_modified' && agent?.human_profile?.consent_confirmed === true;
      });
      configuration = this.swarm.createConfiguration({
        swarm_name: input?.swarm_name || `${name} — hybrid team`, active_agents,
        voting_threshold: input?.voting_threshold || 'majority',
        personality_simulation_enabled: input?.personality_simulation_enabled == null
          ? hasConsentedHybrid : input.personality_simulation_enabled === true,
        agent_rule_overrides: input?.agent_rule_overrides || {},
      }, { tenantId: scope, by });
      await this.swarm.flush?.();
      swarm_id = configuration.swarm_id;
    }

    const room = {
      room_id: String(input?.room_id || '').trim() || makeId('room'), tenant_id: scope,
      name, platform, external_room_id, mode, swarm_id, status: 'active',
      created_by: by, created_at: now(), updated_at: now(), last_activity_at: null,
    };
    await this.store.createRoom(room, this._runtimeBundle(configuration, scope));
    await this._record('collaboration.room.connected', {
      room_id: room.room_id, tenant_id: scope, platform, external_room_id, swarm_id, by,
    });
    return clone(room);
  }

  async getRoom(roomId, { tenantId = null } = {}) { return publicRoom(await this.store.getRoom(roomId, { tenantId })); }
  async listRooms({ tenantId = null, platform = null } = {}) {
    const normalized = platform ? normalizePlatform(platform) : null;
    return (await this.store.listRooms({ tenantId, platform: normalized })).map(publicRoom);
  }
  async activity(options = {}) { return this.store.activity(options); }

  async pendingDecisionCount(tenantId = null) {
    if (this.swarm.store?.countPendingRuns) return this.swarm.store.countPendingRuns(String(tenantId || 'default'));
    await this.swarm.hydrateTenant?.(tenantId);
    return [...this.swarm.runs.values()].filter((run) => (
      run.tenant_id === String(tenantId || 'default') && run.status === 'pending_human_arbitration'
    )).length;
  }

  async getThread(threadId, { tenantId = null } = {}) {
    return this.store.getThread?.(threadId, { tenantId }) || null;
  }

  async listThreads({ tenantId = null, roomId = null, limit = 100 } = {}) {
    return this.store.listThreads?.({ tenantId, roomId, limit }) || [];
  }

  async _createDecisionThread({ room, run, question, by = null }) {
    const createdAt = now();
    const questions = clarificationQuestions(run);
    const needsClarification = run.consensus?.verdict === 'CONDITIONAL_GO'
      || (run.analyses || []).some((analysis) => (analysis.unverified_assumptions || []).length > 0);
    const thread = {
      thread_id: makeId('thread'), tenant_id: room.tenant_id, room_id: room.room_id,
      root_run_id: run.run_id, current_run_id: run.run_id,
      status: needsClarification ? 'needs_clarification' : 'awaiting_arbitration',
      question, clarification_questions: questions,
      created_by: by, created_at: createdAt, updated_at: createdAt,
    };
    await this.store.createThread(thread);
    await this.store.appendThreadMessage(thread.thread_id, {
      role: 'human', kind: 'question', author_id: by, text: question, created_at: createdAt,
    }, { tenantId: room.tenant_id });
    await this.store.appendThreadMessage(thread.thread_id, {
      role: 'collective', kind: 'run', author_id: 'kayros-swarm', run, created_at: now(),
    }, { tenantId: room.tenant_id });
    if (questions.length) {
      await this.store.appendThreadMessage(thread.thread_id, {
        role: 'assistant', kind: 'clarification_request', author_id: 'kayros-swarm',
        text: 'Le collectif a besoin de précisions ciblées avant de conclure.',
        questions, created_at: now(),
      }, { tenantId: room.tenant_id });
    }
    return this.store.getThread(thread.thread_id, { tenantId: room.tenant_id });
  }

  async continueThread(threadId, { tenantId = null, text, by = null } = {}) {
    const scope = String(tenantId || 'default');
    const thread = await this.store.getThread(threadId, { tenantId: scope });
    if (!thread) throw new Error('fil introuvable');
    if (thread.status === 'resolved') throw new Error('fil déjà arbitré');
    const answer = required(text, 'réponse humaine');
    const roomRecord = await this.store.getRoom(thread.room_id, { tenantId: scope });
    const room = await this._hydrateRuntime(roomRecord);
    if (!room) throw new Error('salon introuvable');
    await this.store.appendThreadMessage(threadId, {
      role: 'human', kind: 'clarification', author_id: by, text: answer, created_at: now(),
    }, { tenantId: scope });
    const history = (thread.messages || []).map((message) => {
      if (message.kind === 'run') return `Verdict précédent: ${message.run?.consensus?.verdict || 'inconnu'} — ${message.run?.consensus?.rationale || ''}`;
      return `${message.role}: ${message.text || (message.questions || []).join(' | ')}`;
    }).join('\n');
    const run = await this.swarm.run(room.swarm_id, {
      tenantId: scope,
      question: thread.question,
      context: `Fil de décision ${threadId}\n${history}\nRéponse humaine: ${answer}`,
      by,
    });
    const questions = clarificationQuestions(run);
    const status = run.consensus?.verdict === 'CONDITIONAL_GO' || questions.length
      ? 'needs_clarification' : 'awaiting_arbitration';
    await this.store.appendThreadMessage(threadId, {
      role: 'collective', kind: 'run', author_id: 'kayros-swarm', run, created_at: now(),
    }, { tenantId: scope });
    if (status === 'needs_clarification' && questions.length) {
      await this.store.appendThreadMessage(threadId, {
        role: 'assistant', kind: 'clarification_request', author_id: 'kayros-swarm',
        text: 'Des informations restent nécessaires.', questions, created_at: now(),
      }, { tenantId: scope });
    }
    await this.store.updateThread(threadId, {
      current_run_id: run.run_id, status, clarification_questions: questions, updated_at: now(),
    }, { tenantId: scope });
    await this._record('collaboration.thread.rerun', {
      room_id: room.room_id, tenant_id: scope, thread_id: threadId, run_id: run.run_id, by,
    });
    return this.store.getThread(threadId, { tenantId: scope });
  }

  async arbitrateThread(threadId, input = {}, { tenantId = null, by = null } = {}) {
    const scope = String(tenantId || 'default');
    const thread = await this.store.getThread(threadId, { tenantId: scope });
    if (!thread) throw new Error('fil introuvable');
    const run = this.swarm.arbitrate(thread.current_run_id, { ...input, tenantId: scope, by });
    await this.swarm.flush?.();
    await this.store.appendThreadMessage(threadId, {
      role: 'human', kind: 'arbitration', author_id: by, decision: run.human_decision, created_at: now(),
    }, { tenantId: scope });
    await this.store.updateThread(threadId, {
      status: input.action === 'reevaluate' ? 'reevaluation_requested' : 'resolved',
      updated_at: now(),
    }, { tenantId: scope });
    return this.store.getThread(threadId, { tenantId: scope });
  }

  async handleMessage(input = {}) {
    const platform = normalizePlatform(input.platform || 'console');
    const record = input.room_id
      ? await this.store.getRoom(input.room_id, { tenantId: input.tenantId })
      : await this.store.findRoom(platform, required(input.external_room_id, 'external_room_id'));
    const room = publicRoom(record);
    if (!room || room.status !== 'active') throw new Error('aucun salon Kayros actif pour ce canal');
    if (input.tenantId != null && room.tenant_id !== String(input.tenantId)) throw new Error('salon inaccessible pour ce tenant');
    if (room.mode === 'mention_only' && !wasInvoked(input.text, input.explicit === true)) {
      return { ignored: true, reason: 'mention_required', room };
    }
    const question = cleanPrompt(input.text);
    if (!question) throw new Error('message vide après suppression de la mention Kayros');

    const messageId = String(input.message_id || '').trim() || makeId('message');
    let claimed = false;
    try {
      return await this.store.withRoomLock(room.room_id, async () => {
        const claim = await this.store.claimMessage({
          platform, messageId, tenantId: room.tenant_id, roomId: room.room_id,
        });
        if (!claim.claimed) {
          if (claim.completed && claim.result) return { ...clone(claim.result), duplicate: true };
          return { ignored: false, duplicate: true, processing: true, room };
        }
        claimed = true;
        await this._hydrateRuntime(record);
        await this._record('collaboration.message.received', {
          room_id: room.room_id, tenant_id: room.tenant_id, platform,
          message_id: messageId, user_id: input.user_id || null,
        });
        const run = await this.swarm.run(room.swarm_id, {
          tenantId: room.tenant_id, question,
          context: String(input.context || `Conversation ${platform} · salon ${room.name}`),
          provider: input.provider, sovereignty: input.sovereignty, model: input.model,
          by: input.by || input.user_id || `${platform}:anonymous`,
        });
        const thread = await this._createDecisionThread({ room, run, question, by: input.by || input.user_id || `${platform}:anonymous` });
        const summary = { ...summarizeSwarmRun(run), thread_id: thread.thread_id, clarification_questions: thread.clarification_questions || [] };
        const result = { ignored: false, duplicate: false, room, run, thread, summary };
        await this.store.updateRoomActivity(room.room_id, now());
        await this._record('collaboration.run.completed', {
          room_id: room.room_id, tenant_id: room.tenant_id, platform,
          message_id: messageId, run_id: run.run_id, verdict: summary.verdict,
        });
        if (input.publish === true) {
          const adapter = this.adapterFor(platform, room.tenant_id);
          if (!adapter) throw new Error(`connecteur ${platform} non configuré`);
          await adapter.postMessage(room.external_room_id, new AbstractView({
            title: summary.title, text: summary.text,
            color: summary.verdict === 'GO' ? 'good' : summary.verdict === 'NO_GO' ? 'danger' : 'warning',
            fields: [{ label: 'Dossier', value: summary.run_id }, { label: 'Statut', value: 'En attente d’arbitrage humain' }],
          }));
          await this._record('collaboration.reply.published', {
            room_id: room.room_id, tenant_id: room.tenant_id, platform, run_id: run.run_id,
          });
        }
        await this.store.completeMessage(platform, messageId, result, room.tenant_id);
        return clone(result);
      });
    } catch (error) {
      if (claimed) await this.store.failMessage(platform, messageId, room.tenant_id).catch(() => {});
      throw error;
    }
  }
}
