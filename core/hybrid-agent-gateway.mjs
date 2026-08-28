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
    for (const adapter of adapters || []) this.setAdapter(adapter);
  }

  setAdapter(adapter) {
    if (!adapter?.platform) return false;
    this.adapters.set(normalizePlatform(adapter.platform), adapter);
    return true;
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
        const summary = summarizeSwarmRun(run);
        const result = { ignored: false, duplicate: false, room, run, summary };
        await this.store.updateRoomActivity(room.room_id, now());
        await this._record('collaboration.run.completed', {
          room_id: room.room_id, tenant_id: room.tenant_id, platform,
          message_id: messageId, run_id: run.run_id, verdict: summary.verdict,
        });
        if (input.publish === true) {
          const adapter = this.adapters.get(platform);
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
