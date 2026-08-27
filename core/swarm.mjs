// KayrosLab — Specialized Agent Swarms v6.
// Dynamic agent definitions, personality-enriched hybrid agents, three-layer
// rule resolution, audited formal verdicts and absolute human arbitration.

import { SpecializedDecisionAgent } from './agents/specialized-agent.mjs';
import {
  ProfileImportService,
  mergeHumanProfiles,
  normalizeHumanProfile,
  profileFromAgentOverride,
} from './personality.mjs';

export const AGENT_TYPES = Object.freeze(['system_predefined', 'user_defined', 'hybrid_modified']);
export const AGENT_SENIORITIES = Object.freeze(['intern', 'junior', 'senior', 'executive']);
export const RULE_STATUSES = Object.freeze(['active', 'overridden', 'disabled']);
export const SWARM_VERDICTS = Object.freeze(['GO', 'NO_GO', 'CONDITIONAL_GO']);
export const VOTING_THRESHOLDS = Object.freeze(['unanimous', 'majority', 'veto_power_csuite']);
export const HUMAN_ACTIONS = Object.freeze(['accept_consensus', 'override_veto', 'reevaluate']);

export const DEFAULT_SYSTEM_AGENTS = Object.freeze([
  {
    agent_id: 'cfo', agent_type: 'system_predefined', role_name: 'Chief Financial Officer',
    department: 'Finance', seniority: 'executive',
    primary_focus: 'Test financial viability, cash exposure, unit economics and downside scenarios.',
    veto_power: false,
    rule_configuration: {
      system_proposed_rules: [
        { rule_id: 'RULE_CFO_01', rule_text: 'Model material investments with P10/P50/P90 scenarios.', status: 'active' },
        { rule_id: 'RULE_CFO_02', rule_text: 'Flag a payback period above 12 months as a blocking condition.', status: 'active' },
      ], user_added_rules: [], user_modified_rules: [],
    },
  },
  {
    agent_id: 'cto', agent_type: 'system_predefined', role_name: 'Chief Technology Officer',
    department: 'Engineering', seniority: 'executive',
    primary_focus: 'Test architecture, delivery feasibility, operability, scalability and technical debt.',
    veto_power: false,
    rule_configuration: {
      system_proposed_rules: [
        { rule_id: 'RULE_CTO_01', rule_text: 'Identify single points of failure and scaling bottlenecks.', status: 'active' },
        { rule_id: 'RULE_CTO_02', rule_text: 'Require a credible migration and rollback path for material changes.', status: 'active' },
      ], user_added_rules: [], user_modified_rules: [],
    },
  },
  {
    agent_id: 'legal_counsel', agent_type: 'system_predefined', role_name: 'Legal Counsel',
    department: 'Legal & Compliance', seniority: 'executive',
    primary_focus: 'Test regulatory, contractual, licensing, privacy and documentation exposure.',
    veto_power: false,
    rule_configuration: {
      system_proposed_rules: [
        { rule_id: 'RULE_LEG_01', rule_text: 'Identify applicable regulatory obligations and evidence gaps.', status: 'active' },
        { rule_id: 'RULE_LEG_02', rule_text: 'Audit software and data licences for commercial-use risk.', status: 'active' },
        { rule_id: 'RULE_LEG_03', rule_text: 'Require privacy and retention controls for personal data.', status: 'active' },
      ], user_added_rules: [], user_modified_rules: [],
    },
  },
]);

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function tenantKey(tenantId) { return String(tenantId || 'default'); }
function now() { return new Date().toISOString(); }
function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
function strings(value) {
  return Array.isArray(value) ? value.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
}
function assertOneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label}: valeur inconnue "${value}"`);
}
function assertAgentId(value) {
  const id = String(value || '').trim();
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(id)) {
    throw new Error('agent_id: 2-64 caractères minuscules, chiffres ou underscore, commençant par une lettre');
  }
  return id;
}

export function validateAgentDefinition(input, { forceType = null } = {}) {
  const d = clone(input || {});
  d.agent_id = assertAgentId(d.agent_id);
  d.agent_type = forceType || d.agent_type || 'user_defined';
  assertOneOf(d.agent_type, AGENT_TYPES, 'agent_type');
  d.base_agent_id = d.base_agent_id ? assertAgentId(d.base_agent_id) : null;
  d.role_name = String(d.role_name || '').trim();
  d.department = String(d.department || '').trim();
  d.seniority = d.seniority || 'senior';
  d.primary_focus = String(d.primary_focus || '').trim();
  assertOneOf(d.seniority, AGENT_SENIORITIES, 'seniority');
  if (!d.role_name || !d.department || !d.primary_focus) {
    throw new Error('role_name, department et primary_focus sont requis');
  }
  d.veto_power = !!d.veto_power;
  d.human_profile = d.human_profile ? normalizeHumanProfile(d.human_profile) : null;
  const rc = d.rule_configuration || {};
  const base = Array.isArray(rc.system_proposed_rules) ? rc.system_proposed_rules : [];
  const added = Array.isArray(rc.user_added_rules) ? rc.user_added_rules : [];
  const modified = Array.isArray(rc.user_modified_rules) ? rc.user_modified_rules : [];
  const seen = new Set();
  d.rule_configuration = {
    system_proposed_rules: base.map((r) => {
      const rule_id = String(r?.rule_id || '').trim();
      const rule_text = String(r?.rule_text || '').trim();
      const status = r?.status || 'active';
      if (!rule_id || !rule_text || seen.has(rule_id)) throw new Error(`system rule invalide ou dupliquée: ${rule_id}`);
      assertOneOf(status, RULE_STATUSES, `status ${rule_id}`);
      seen.add(rule_id);
      return { rule_id, rule_text, status };
    }),
    user_added_rules: added.map((r, i) => {
      const rule_id = String(r?.rule_id || `USR_${d.agent_id.toUpperCase()}_${i + 1}`).trim();
      const rule_text = String(r?.rule_text || r || '').trim();
      if (!rule_text || seen.has(rule_id)) throw new Error(`user rule invalide ou dupliquée: ${rule_id}`);
      seen.add(rule_id);
      return { rule_id, rule_text };
    }),
    user_modified_rules: modified.map((r) => {
      const replaces_rule_id = String(r?.replaces_rule_id || '').trim();
      const modified_text = String(r?.modified_text || '').trim();
      if (!replaces_rule_id || !modified_text) throw new Error('user_modified_rules: replaces_rule_id et modified_text requis');
      if (!base.some((b) => b.rule_id === replaces_rule_id)) throw new Error(`règle remplacée introuvable: ${replaces_rule_id}`);
      return { replaces_rule_id, modified_text };
    }),
  };
  return d;
}

/** Apply the compact override shape used by swarm configuration documents. */
export function applyRulePatchToDefinition(definition, patch = {}) {
  const d = validateAgentDefinition(definition);
  const rc = d.rule_configuration;
  const disabled = new Set(strings(patch.disabled_rules));
  const modifiedEntries = patch.modified_rules && !Array.isArray(patch.modified_rules)
    ? Object.entries(patch.modified_rules)
    : (patch.modified_rules || []).map((x) => [x.replaces_rule_id, x.modified_text]);
  const modified = new Map(modifiedEntries.map(([id, text]) => [String(id), String(text || '').trim()]));
  const baseIds = new Set(rc.system_proposed_rules.map((r) => r.rule_id));
  for (const id of [...disabled, ...modified.keys()]) {
    if (!baseIds.has(id)) throw new Error(`override impossible, règle introuvable: ${id}`);
  }
  rc.system_proposed_rules = rc.system_proposed_rules.map((r) => ({
    ...r, status: disabled.has(r.rule_id) ? 'disabled' : modified.has(r.rule_id) ? 'overridden' : r.status,
  }));
  const replacements = new Map(rc.user_modified_rules.map((r) => [r.replaces_rule_id, r.modified_text]));
  for (const id of disabled) replacements.delete(id);
  for (const [id, text] of modified) {
    if (!text) throw new Error(`modified_rules: texte requis pour ${id}`);
    replacements.set(id, text);
  }
  rc.user_modified_rules = [...replacements].map(([replaces_rule_id, modified_text]) => ({ replaces_rule_id, modified_text }));
  const additions = Array.isArray(patch.added_rules) ? patch.added_rules : [];
  let seq = rc.user_added_rules.length;
  for (const item of additions) {
    const rule_text = String(item?.rule_text || item || '').trim();
    if (!rule_text) continue;
    seq += 1;
    const rule_id = String(item?.rule_id || `USR_${d.agent_id.toUpperCase()}_${seq}`);
    if (rc.user_added_rules.some((r) => r.rule_id === rule_id)) throw new Error(`user rule dupliquée: ${rule_id}`);
    rc.user_added_rules.push({ rule_id, rule_text });
  }
  return validateAgentDefinition(d);
}

/** Apply rules plus the optional personality fields carried by v6 overrides. */
export function applyAgentPatchToDefinition(definition, patch = {}, { personalityEnabled = false } = {}) {
  let d = applyRulePatchToDefinition(definition, patch);
  const overlay = profileFromAgentOverride(patch);
  if (overlay) {
    if (personalityEnabled && overlay.consent_confirmed !== true) {
      throw new Error(`personality ${d.agent_id}: consentement explicite requis`);
    }
    d.human_profile = mergeHumanProfiles(d.human_profile, overlay);
    if (d.agent_type === 'system_predefined') {
      d.agent_type = 'hybrid_modified';
      d.base_agent_id = d.agent_id;
    }
  }
  if (personalityEnabled && d.human_profile && d.human_profile.consent_confirmed !== true) {
    throw new Error(`personality ${d.agent_id}: consentement explicite requis`);
  }
  return validateAgentDefinition(d);
}

export function resolveEffectiveRules(definition) {
  const d = validateAgentDefinition(definition);
  const replacements = new Map(d.rule_configuration.user_modified_rules.map((r) => [r.replaces_rule_id, r.modified_text]));
  const rules = [];
  for (const rule of d.rule_configuration.system_proposed_rules) {
    if (rule.status === 'disabled') continue;
    rules.push({
      rule_id: rule.rule_id,
      rule_text: rule.status === 'overridden' ? replacements.get(rule.rule_id) || rule.rule_text : rule.rule_text,
      origin: rule.status === 'overridden' ? 'user_modified' : 'system',
    });
  }
  for (const rule of d.rule_configuration.user_added_rules) rules.push({ ...rule, origin: 'user_added' });
  return rules;
}

export function compileEffectiveAgentContext(definition) {
  const d = validateAgentDefinition(definition);
  const rules = resolveEffectiveRules(d);
  return rules.length
    ? rules.map((r) => `- [${r.rule_id}] (${r.origin}) ${r.rule_text}`).join('\n')
    : '- No active evaluation rule; explicitly flag this governance gap.';
}

export class AgentRegistry {
  constructor({ systemAgents = DEFAULT_SYSTEM_AGENTS } = {}) {
    this.systemAgents = systemAgents.map((d) => validateAgentDefinition(d, { forceType: 'system_predefined' }));
    this.byTenant = new Map();
  }

  _registry(tenantId) {
    const key = tenantKey(tenantId);
    if (!this.byTenant.has(key)) {
      this.byTenant.set(key, new Map(this.systemAgents.map((d) => [d.agent_id, clone(d)])));
    }
    return this.byTenant.get(key);
  }

  list({ tenantId = null } = {}) { return [...this._registry(tenantId).values()].map(clone); }
  get(agentId, { tenantId = null } = {}) { return clone(this._registry(tenantId).get(agentId) || null); }

  create(input, { tenantId = null } = {}) {
    const d = validateAgentDefinition(input, { forceType: 'user_defined' });
    if (d.human_profile && d.human_profile.consent_confirmed !== true) {
      throw new Error('human_profile: consentement explicite requis');
    }
    const registry = this._registry(tenantId);
    if (registry.has(d.agent_id)) throw new Error(`agent déjà existant: ${d.agent_id}`);
    registry.set(d.agent_id, d);
    return clone(d);
  }

  updateRules(agentId, patch, { tenantId = null } = {}) {
    const registry = this._registry(tenantId);
    const current = registry.get(agentId);
    if (!current) throw new Error(`agent introuvable: ${agentId}`);
    const updated = applyRulePatchToDefinition(current, patch);
    registry.set(agentId, updated);
    return clone(updated);
  }

  assignHumanProfile(agentId, humanProfile, { tenantId = null } = {}) {
    const registry = this._registry(tenantId);
    const current = registry.get(agentId);
    if (!current) throw new Error(`agent introuvable: ${agentId}`);
    const profile = normalizeHumanProfile(humanProfile);
    if (profile.consent_confirmed !== true) throw new Error('human_profile: consentement explicite requis');
    const updated = {
      ...current,
      human_profile: mergeHumanProfiles(current.human_profile, profile),
      agent_type: current.agent_type === 'system_predefined' ? 'hybrid_modified' : current.agent_type,
      base_agent_id: current.agent_type === 'system_predefined' ? current.agent_id : current.base_agent_id,
    };
    const validated = validateAgentDefinition(updated);
    registry.set(agentId, validated);
    return clone(validated);
  }

  /** Restore a previously validated tenant definition from shared storage. */
  upsert(input, { tenantId = null } = {}) {
    const definition = validateAgentDefinition(input);
    if (definition.human_profile && definition.human_profile.consent_confirmed !== true) {
      throw new Error('human_profile: consentement explicite requis');
    }
    this._registry(tenantId).set(definition.agent_id, definition);
    return clone(definition);
  }
}

export function normalizeSwarmVerdict(raw) {
  const t = String(raw || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (['GO', 'APPROVED', 'APPROVE'].includes(t)) return 'GO';
  if (['NO_GO', 'NOGO', 'REJECTED', 'REJECT', 'VETO'].includes(t)) return 'NO_GO';
  if (['CONDITIONAL_GO', 'CONDITIONAL', 'REVISE', 'REVISION'].includes(t)) return 'CONDITIONAL_GO';
  return null;
}

function firstJsonObject(text) {
  const src = String(text || '');
  const start = src.indexOf('{');
  if (start < 0) return null;
  let depth = 0; let quote = false; let escaped = false;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') quote = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(src.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export function normalizeAgentAnalysis(raw, definition = {}, { personalityEnabled = !!definition.human_profile } = {}) {
  let value = raw?.structured || raw?.output || raw;
  if (typeof value === 'string') value = firstJsonObject(value) || { primary_reason: value.slice(0, 500) };
  value = value && typeof value === 'object' ? value : {};
  let verdict = normalizeSwarmVerdict(value.verdict || value.decision);
  const unverified = strings(value.unverified_assumptions);
  if (!verdict) {
    verdict = normalizeSwarmVerdict(String(raw?.output || raw || '').match(/\b(CONDITIONAL[\s_-]?GO|NO[\s_-]?GO|GO)\b/i)?.[1]);
  }
  if (!verdict) {
    verdict = 'CONDITIONAL_GO';
    unverified.push('Agent output did not contain a parsable formal verdict; human review required.');
  }
  const profile = personalityEnabled ? definition.human_profile || null : null;
  return {
    agent_id: definition.agent_id || raw?.agentId || raw?.agent || 'unknown_agent',
    role_name: definition.role_name || raw?.role_name || null,
    agent_type: definition.agent_type || raw?.agent_type || null,
    seniority: definition.seniority || raw?.seniority || null,
    veto_power: !!definition.veto_power,
    verdict,
    primary_reason: String(value.primary_reason || value.reason || '').trim() || 'No primary reason supplied.',
    personality_simulation_enabled: !!profile,
    assigned_human: profile?.assigned_name || null,
    disc_type: profile?.disc_type || null,
    behavioral_archetype: profile?.behavioral_archetype || null,
    simulated_stakeholder_feedback: profile
      ? String(value.simulated_stakeholder_feedback || value.stakeholder_feedback || '').trim() || null
      : null,
    strengths_opportunities: strings(value.strengths_opportunities || value.strengths),
    critical_risks: strings(value.critical_risks || value.risks),
    metrics: Array.isArray(value.metrics) ? value.metrics.map((m) => ({
      metric: String(m?.metric || m?.name || ''), value: String(m?.value ?? ''),
      confidence_impact: String(m?.confidence_impact || m?.confidence || m?.impact || 'unknown'),
      persona_skepticism_level: String(m?.persona_skepticism_level || m?.skepticism || ''),
    })).filter((m) => m.metric) : [],
    required_mitigations: strings(value.required_mitigations || value.mitigations),
    unverified_assumptions: [...new Set(unverified)],
  };
}

export function aggregateSwarmConsensus(analyses, threshold = 'majority') {
  assertOneOf(threshold, VOTING_THRESHOLDS, 'voting_threshold');
  if (!Array.isArray(analyses) || analyses.length === 0) throw new Error('consensus: au moins une analyse requise');
  const counts = { GO: 0, NO_GO: 0, CONDITIONAL_GO: 0 };
  for (const a of analyses) counts[a.verdict] += 1;
  const explicitVeto = analyses.find((a) => a.verdict === 'NO_GO' && a.veto_power);
  const csuiteVeto = threshold === 'veto_power_csuite'
    ? analyses.find((a) => a.verdict === 'NO_GO' && a.seniority === 'executive')
    : null;
  let verdict; let rationale;
  if (explicitVeto || csuiteVeto) {
    const veto = explicitVeto || csuiteVeto;
    verdict = 'NO_GO'; rationale = `Blocking veto issued by ${veto.agent_id}.`;
  } else if (threshold === 'unanimous') {
    if (counts.GO === analyses.length) { verdict = 'GO'; rationale = 'Every participating agent issued GO.'; }
    else if (counts.NO_GO > 0) { verdict = 'NO_GO'; rationale = 'Unanimity failed because at least one agent issued NO_GO.'; }
    else { verdict = 'CONDITIONAL_GO'; rationale = 'Unanimity is conditional on outstanding mitigations.'; }
  } else if (counts.GO > analyses.length / 2) {
    verdict = 'GO'; rationale = 'A strict majority issued GO.';
  } else if (counts.NO_GO > analyses.length / 2) {
    verdict = 'NO_GO'; rationale = 'A strict majority issued NO_GO.';
  } else {
    verdict = 'CONDITIONAL_GO'; rationale = 'No strict GO or NO_GO majority; conditions require human arbitration.';
  }
  return {
    verdict, rationale, threshold, counts,
    veto: explicitVeto || csuiteVeto ? { agent_id: (explicitVeto || csuiteVeto).agent_id, reason: (explicitVeto || csuiteVeto).primary_reason } : null,
    requires_human_arbitration: true,
  };
}

export class SwarmService {
  constructor({ llm = null, memory = null, registry = null, systemAgents = DEFAULT_SYSTEM_AGENTS, auditSink = null, profileImporter = null, store = null } = {}) {
    this.llm = llm;
    this.memory = memory;
    this.registry = registry || new AgentRegistry({ systemAgents });
    this.auditSink = auditSink;
    this.profileImporter = profileImporter || new ProfileImportService();
    this.store = store;
    this.configurations = new Map();
    this.runs = new Map();
    this.pendingPersistence = new Set();
  }

  _key(tenantId, id) { return `${tenantKey(tenantId)}:${id}`; }
  _audit(event) {
    const entry = { ...event, ts: event.ts || now() };
    try { this.auditSink?.(entry); } catch { /* audit must not break a decision run */ }
    return entry;
  }

  _persist(operation) {
    if (!operation || typeof operation.then !== 'function') return;
    const tracked = Promise.resolve(operation).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
    this.pendingPersistence.add(tracked);
    tracked.then(() => this.pendingPersistence.delete(tracked));
  }

  async flush() {
    if (!this.pendingPersistence.size) return true;
    const results = await Promise.all([...this.pendingPersistence]);
    const failure = results.find((result) => !result.ok);
    if (failure) throw failure.error;
    return true;
  }

  async hydrateTenant(tenantId = null) {
    if (!this.store?.loadTenant) return false;
    const scope = tenantKey(tenantId);
    const snapshot = await this.store.loadTenant(scope);
    for (const agent of snapshot.agents || []) this.registry.upsert(agent, { tenantId: scope });
    for (const config of snapshot.configurations || []) {
      this.configurations.set(this._key(scope, config.swarm_id), clone(config));
    }
    for (const run of snapshot.runs || []) this.runs.set(this._key(scope, run.run_id), clone(run));
    return true;
  }

  createAgent(input, { tenantId = null, by = null } = {}) {
    const payload = clone(input);
    if (payload.human_profile && !(payload.human_profile.profile_sources || []).length) {
      payload.human_profile = normalizeHumanProfile({
        ...payload.human_profile,
        profile_sources: [{
          source: 'manual', import_mode: 'agent_creation', imported_by: by,
          fields: Object.keys(payload.human_profile), consent_confirmed: payload.human_profile.consent_confirmed === true,
        }],
      });
    }
    const agent = this.registry.create(payload, { tenantId });
    this._persist(this.store?.saveAgent?.(agent, { tenantId: tenantKey(tenantId) }));
    this._audit({ type: 'swarm.agent.created', agent_id: agent.agent_id, tenant_id: tenantKey(tenantId), by });
    return agent;
  }

  updateAgentRules(agentId, patch, { tenantId = null, by = null } = {}) {
    const agent = this.registry.updateRules(agentId, patch, { tenantId });
    this._persist(this.store?.saveAgent?.(agent, { tenantId: tenantKey(tenantId) }));
    this._audit({
      type: 'swarm.agent.rules_updated', agent_id: agentId, tenant_id: tenantKey(tenantId), by,
      disabled_rules: strings(patch?.disabled_rules),
      modified_rules: patch?.modified_rules ? clone(patch.modified_rules) : {},
      added_rules_count: Array.isArray(patch?.added_rules) ? patch.added_rules.length : 0,
    });
    return agent;
  }

  assignPersonality(agentId, humanProfile, { tenantId = null, by = null } = {}) {
    let profile = normalizeHumanProfile(humanProfile);
    if (!(profile.profile_sources || []).length) {
      profile = normalizeHumanProfile({
        ...profile,
        profile_sources: [{
          source: 'manual', import_mode: 'manual_assignment', imported_by: by,
          fields: Object.keys(profile), consent_confirmed: profile.consent_confirmed === true,
        }],
      });
    }
    const agent = this.registry.assignHumanProfile(agentId, profile, { tenantId });
    this._persist(this.store?.saveAgent?.(agent, { tenantId: tenantKey(tenantId) }));
    this._audit({
      type: 'swarm.agent.personality_assigned', agent_id: agentId,
      tenant_id: tenantKey(tenantId), by,
      sources: (agent.human_profile?.profile_sources || []).map((s) => s.source),
    });
    return agent;
  }

  async importAndAssignPersonality(agentId, { imports = [], manual_profile = null, consent_confirmed = false } = {}, { tenantId = null, by = null } = {}) {
    if (consent_confirmed !== true) throw new Error('profile import: consentement explicite requis');
    const fragments = [];
    for (const item of imports || []) {
      fragments.push(await this.profileImporter.importProfile({
        ...item, consent_confirmed: true, imported_by: by,
      }));
    }
    if (manual_profile) {
      const manual = normalizeHumanProfile({
        ...manual_profile, consent_confirmed: true,
        profile_sources: [
          ...(manual_profile.profile_sources || []),
          { source: 'manual', import_mode: 'manual', imported_by: by, fields: Object.keys(manual_profile), consent_confirmed: true },
        ],
      });
      fragments.push(manual);
    }
    if (!fragments.length) throw new Error('profile import: au moins une source ou un profil manuel requis');
    return this.assignPersonality(agentId, mergeHumanProfiles(...fragments), { tenantId, by });
  }

  createConfiguration(input, { tenantId = null, by = null } = {}) {
    const swarm_id = String(input?.swarm_id || '').trim() || makeId('swarm');
    const swarm_name = String(input?.swarm_name || '').trim();
    const active_agents = [...new Set(strings(input?.active_agents))];
    const voting_threshold = input?.voting_threshold || 'majority';
    const personality_simulation_enabled = input?.personality_simulation_enabled === true;
    if (!swarm_name) throw new Error('swarm_name requis');
    if (this.configurations.has(this._key(tenantId, swarm_id))) throw new Error(`swarm déjà existant: ${swarm_id}`);
    if (!active_agents.length) throw new Error('active_agents: au moins un agent requis');
    assertOneOf(voting_threshold, VOTING_THRESHOLDS, 'voting_threshold');
    for (const id of active_agents) if (!this.registry.get(id, { tenantId })) throw new Error(`agent actif introuvable: ${id}`);
    const overrides = clone(input?.agent_rule_overrides || {});
    for (const [id, patch] of Object.entries(overrides)) {
      const definition = this.registry.get(id, { tenantId });
      if (!definition || !active_agents.includes(id)) throw new Error(`override d'un agent inactif ou introuvable: ${id}`);
      applyAgentPatchToDefinition(definition, patch, { personalityEnabled: personality_simulation_enabled });
    }
    const config = {
      swarm_id, swarm_name, active_agents, voting_threshold, personality_simulation_enabled,
      agent_rule_overrides: overrides, tenant_id: tenantKey(tenantId),
      created_by: by, created_at: now(), updated_at: now(),
    };
    this.configurations.set(this._key(tenantId, swarm_id), config);
    this._persist(this.store?.saveConfiguration?.(config, { tenantId: tenantKey(tenantId) }));
    this._audit({ type: 'swarm.configuration.created', swarm_id, tenant_id: tenantKey(tenantId), by });
    return clone(config);
  }

  /** Rehydrate a shared configuration without creating a second logical swarm. */
  restoreConfiguration(input, { tenantId = null } = {}) {
    const config = clone(input || {});
    if (!config.swarm_id || !config.swarm_name || !Array.isArray(config.active_agents) || !config.active_agents.length) {
      throw new Error('configuration persistée invalide');
    }
    for (const agentId of config.active_agents) {
      if (!this.registry.get(agentId, { tenantId })) throw new Error(`agent actif introuvable: ${agentId}`);
    }
    this.configurations.set(this._key(tenantId, config.swarm_id), config);
    return clone(config);
  }

  getConfiguration(id, { tenantId = null } = {}) { return clone(this.configurations.get(this._key(tenantId, id)) || null); }
  getRun(id, { tenantId = null } = {}) { return clone(this.runs.get(this._key(tenantId, id)) || null); }

  async run(configurationOrId, { tenantId = null, question, context = '', provider, sovereignty, model, by = null, agentResults = null } = {}) {
    const config = typeof configurationOrId === 'string'
      ? this.getConfiguration(configurationOrId, { tenantId })
      : this.createConfiguration(configurationOrId, { tenantId, by });
    if (!config) throw new Error(`swarm introuvable: ${configurationOrId}`);
    if (!String(question || '').trim()) throw new Error('question de décision requise');
    const run_id = makeId('swarmrun');
    const definitions = config.active_agents.map((id) => {
      const base = this.registry.get(id, { tenantId });
      return applyAgentPatchToDefinition(base, config.agent_rule_overrides?.[id] || {}, {
        personalityEnabled: config.personality_simulation_enabled,
      });
    });
    const executions = definitions.map(async (definition) => {
      const effective_rules = resolveEffectiveRules(definition);
      let raw = agentResults?.[definition.agent_id];
      if (raw == null) {
        const agent = new SpecializedDecisionAgent({
          definition, effectiveContext: compileEffectiveAgentContext(definition),
          personalityEnabled: config.personality_simulation_enabled,
          llm: this.llm, memory: this.memory,
        });
        raw = await agent.executeDecision({ question, context, provider, sovereignty, model, runId: run_id, traceId: run_id });
      }
      return {
        ...normalizeAgentAnalysis(raw, definition, { personalityEnabled: config.personality_simulation_enabled }),
        effective_rules,
      };
    });
    const analyses = await Promise.all(executions);
    const consensus = aggregateSwarmConsensus(analyses, config.voting_threshold);
    const audit = analyses.map((analysis) => this._audit({
      type: 'swarm.agent.verdict', run_id, swarm_id: config.swarm_id,
      tenant_id: tenantKey(tenantId), agent_id: analysis.agent_id,
      verdict: analysis.verdict, veto_power: analysis.veto_power,
    }));
    audit.push(this._audit({ type: 'swarm.run.completed', run_id, swarm_id: config.swarm_id, tenant_id: tenantKey(tenantId), by, consensus: consensus.verdict }));
    const run = {
      run_id, swarm_id: config.swarm_id, swarm_name: config.swarm_name,
      tenant_id: tenantKey(tenantId), question: String(question), context: String(context || ''),
      configuration: config, analyses, consensus,
      status: 'pending_human_arbitration', human_decision: null,
      audit,
      created_at: now(), updated_at: now(),
    };
    this.runs.set(this._key(tenantId, run_id), run);
    if (this.store?.saveRun) await this.store.saveRun(run, { tenantId: tenantKey(tenantId) });
    return clone(run);
  }

  arbitrate(runId, { tenantId = null, action, by, justification = '', decision = null } = {}) {
    assertOneOf(action, HUMAN_ACTIONS, 'action');
    if (!by) throw new Error('arbitrage: auteur humain requis');
    const key = this._key(tenantId, runId);
    const run = this.runs.get(key);
    if (!run) throw new Error(`run introuvable: ${runId}`);
    if (run.human_decision) throw new Error('run déjà arbitré');
    let finalVerdict = run.consensus.verdict;
    let status;
    if (action === 'override_veto') {
      if (!String(justification).trim()) throw new Error('override_veto: justification requise');
      finalVerdict = normalizeSwarmVerdict(decision);
      if (!['GO', 'CONDITIONAL_GO'].includes(finalVerdict)) throw new Error('override_veto: décision GO ou CONDITIONAL_GO requise');
      status = 'overridden_human';
    } else if (action === 'reevaluate') {
      status = 'reevaluation_requested';
      finalVerdict = null;
    } else {
      status = finalVerdict === 'GO' ? 'approved_human' : finalVerdict === 'NO_GO' ? 'rejected_human' : 'conditional_human';
    }
    const human_decision = { action, verdict: finalVerdict, by: String(by), justification: String(justification || ''), decided_at: now() };
    run.status = status;
    run.human_decision = human_decision;
    run.updated_at = now();
    run.audit.push(this._audit({ type: 'swarm.run.arbitrated', run_id: runId, tenant_id: tenantKey(tenantId), ...human_decision }));
    this._persist(this.store?.saveRun?.(run, { tenantId: tenantKey(tenantId) }));
    return clone(run);
  }
}

function verdictLabel(v) { return v === 'NO_GO' ? 'NO-GO' : v === 'CONDITIONAL_GO' ? 'CONDITIONAL GO' : 'GO'; }
function bulletList(items, fallback = 'None reported.') {
  return items?.length ? items.map((x) => `- ${x}`).join('\n') : `- ${fallback}`;
}

export function renderAgentAnalysisMarkdown(analysis) {
  const metrics = analysis.metrics?.length
    ? analysis.metrics.map((m) => `| ${m.metric} | ${m.value} | ${m.persona_skepticism_level || m.confidence_impact} |`).join('\n')
    : '| — | — | — |';
  const persona = analysis.assigned_human
    ? ` — ${analysis.assigned_human}${analysis.disc_type ? ` (\`${analysis.disc_type}\`)` : ''}` : '';
  const feedback = analysis.simulated_stakeholder_feedback
    ? `### Simulated Stakeholder Feedback\n> *${analysis.simulated_stakeholder_feedback}*\n\n` : '';
  return `## ${analysis.role_name || analysis.agent_id} Analysis & Challenge${persona}\n\n` +
    `### Decision Verdict\n**Verdict:** \`${verdictLabel(analysis.verdict)}\`  \n**Primary Reason:** ${analysis.primary_reason}\n\n` +
    feedback +
    `### Strengths / Opportunities\n${bulletList(analysis.strengths_opportunities)}\n\n` +
    `### Critical Risks & Failure Points\n${bulletList(analysis.critical_risks)}\n\n` +
    `### Quantitative & Behavioral Assessment\n| Metric / Parameter | Value / Scenario | Persona Skepticism / Confidence |\n| :--- | :--- | :--- |\n${metrics}\n\n` +
    `### Mandatory Conditions / Required Mitigations\n${bulletList(analysis.required_mitigations)}\n\n` +
    `### Unverified Assumptions\n${bulletList(analysis.unverified_assumptions)}`;
}

export function renderSwarmDossierMarkdown(run) {
  const matrix = run.analyses.map((a) => {
    const person = a.assigned_human ? `${a.assigned_human}${a.disc_type ? ` (\`${a.disc_type}\`)` : ''}` : '—';
    return `| **${a.role_name || a.agent_id}** | ${person} | \`${verdictLabel(a.verdict)}\` | ${a.simulated_stakeholder_feedback || a.primary_reason} | ${a.critical_risks?.[0] || '—'} | ${a.required_mitigations?.[0] || '—'} |`;
  }).join('\n');
  const risks = [...new Set(run.analyses.flatMap((a) => a.critical_risks || []))];
  const mitigations = [...new Set(run.analyses.flatMap((a) => a.required_mitigations || []))];
  const overrides = Object.keys(run.configuration.agent_rule_overrides || {});
  return `# KAYROSLAB AGENT SWARM DECISION DOSSIER\n\n` +
    `## 1. Swarm Configuration Summary\n- **Swarm Name:** ${run.swarm_name}\n- **Participating Agents:** ${run.analyses.map((a) => a.agent_id).join(', ')}\n- **Voting Threshold:** ${run.configuration.voting_threshold}\n- **Personality Simulation:** ${run.configuration.personality_simulation_enabled ? 'Enabled' : 'Disabled'}\n- **Active Rule Overrides:** ${overrides.length ? overrides.join(', ') : 'None'}\n- **Overall Swarm Consensus:** \`${verdictLabel(run.consensus.verdict)}\`\n- **Status:** ${run.status}\n\n` +
    `## 2. GO / NO-GO Decision Matrix\n\n| Agent / Role | Assigned Person & DISC | Verdict | Simulated Stakeholder Reaction | Major Risk / Challenge | Required Mitigation |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n${matrix}\n\n` +
    `## 3. Consolidated Challenges & Stakeholder Friction Points\n${bulletList(risks)}\n\n` +
    `### Required Mitigations\n${bulletList(mitigations)}\n\n` +
    `## 4. Human-in-the-Loop Arbitration Panel\n- [ ] **Accept Swarm Consensus**\n- [ ] **Override Agent Veto** (justification required)\n- [ ] **Re-evaluate Swarm** (modify rules or personalities)\n\n` +
    `> The swarm consensus is advisory until a human decision is recorded. Stakeholder feedback is simulated, not a real quotation.`;
}
