// KayrosLab — Specialized Agent Swarms v6.
// Dynamic agent definitions, personality-enriched hybrid agents, three-layer
// rule resolution, audited formal verdicts and absolute human arbitration.

import { SpecializedDecisionAgent } from './agents/specialized-agent.mjs';
import { stripReasoning } from './kayros-llm.mjs';
import { mapWithConcurrency } from './resilience.mjs';

/** Agents du swarm interrogés simultanément par défaut (LLM_MAX_CONCURRENCY côté serveur). */
export const DEFAULT_SWARM_MAX_CONCURRENCY = 2;
import {
  ProfileImportService,
  mergeHumanProfiles,
  normalizeHumanProfile,
  profileFromAgentOverride,
} from './personality.mjs';
import { impersonatorContext, impersonatorGuardrails, impersonatorOf, normalizeImpersonator } from './impersonator.mjs';

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
function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
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
  d.display_name = String(d.display_name || d.role_name || '').trim();
  d.mission = String(d.mission || d.primary_focus || '').trim();
  d.instructions = String(d.instructions || '').trim();
  d.constraints = strings(d.constraints);
  d.provider = String(d.provider || '').trim() || null;
  d.model = String(d.model || '').trim() || null;
  d.tools = strings(d.tools);
  d.connectors = strings(d.connectors);
  d.metadata = plainObject(d.metadata);
  if (d.metadata.impersonator) d.metadata.impersonator = normalizeImpersonator(d.metadata.impersonator);
  d.behavioral_profile = plainObject(d.behavioral_profile);
  d.enabled = d.enabled !== false;
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

/**
 * Champs d'identité qu'une session peut surcharger pour son seul collectif
 * (« Nouvelle session » : vérifier puis ajuster un agent proposé) sans modifier
 * le registre du tenant.
 */
export const SESSION_OVERRIDE_FIELDS = Object.freeze(['display_name', 'role_name', 'department', 'seniority', 'mission', 'instructions', 'constraints', 'veto_power', 'behavioral_profile']);

export function applyIdentityOverrides(definition, patch = {}) {
  const d = clone(definition);
  let changed = false;
  for (const field of SESSION_OVERRIDE_FIELDS) {
    if (patch[field] === undefined) continue;
    changed = true;
    if (field === 'mission') { d.mission = String(patch.mission || '').trim() || d.mission; continue; }
    d[field] = clone(patch[field]);
  }
  if (!changed) return d;
  d.metadata = { ...plainObject(d.metadata), session_override: true };
  return d;
}

/** Apply rules plus the optional personality fields carried by v6 overrides. */
export function applyAgentPatchToDefinition(definition, patch = {}, { personalityEnabled = false } = {}) {
  let d = applyRulePatchToDefinition(applyIdentityOverrides(validateAgentDefinition(definition), patch), patch);
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
  const impersonator = impersonatorOf(d);
  if (impersonator) {
    for (const guardrail of impersonatorGuardrails(impersonator)) rules.push({ ...guardrail, origin: 'impersonator' });
  }
  return rules;
}

const BEHAVIORAL_LABELS = Object.freeze({
  disc_type: 'Profil DISC', archetype: 'Archétype', tone: 'Ton', decision_style: 'Style de décision',
  risk_appetite: 'Appétence au risque', traits: 'Traits', communication_directives: 'Directives de communication',
  biases: 'Biais à surveiller', motivators: 'Motivations',
});
/** Caractéristiques déclarées de l'agent (personnalité de rôle, pas un profil humain réel). */
export function behavioralContext(profile = {}) {
  const lines = Object.entries(plainObject(profile)).map(([key, value]) => {
    const text = Array.isArray(value) ? strings(value).join('; ') : value != null && typeof value !== 'object' ? String(value).trim() : '';
    return text ? `- ${BEHAVIORAL_LABELS[key] || key}: ${text}` : null;
  }).filter(Boolean);
  return lines.length ? `Profil comportemental de l'agent:\n${lines.join('\n')}` : '';
}

export function compileEffectiveAgentContext(definition) {
  const d = validateAgentDefinition(definition);
  const rules = resolveEffectiveRules(d);
  const sections = [
    `Mission: ${d.mission}`,
    d.instructions ? `Instructions: ${d.instructions}` : null,
    d.constraints.length ? `Contraintes:\n${d.constraints.map((item) => `- ${item}`).join('\n')}` : null,
    d.tools.length ? `Outils autorisés: ${d.tools.join(', ')}` : null,
    d.connectors.length ? `Connecteurs autorisés: ${d.connectors.join(', ')}` : null,
    `Règles de décision:\n${rules.length
      ? rules.map((r) => `- [${r.rule_id}] (${r.origin}) ${r.rule_text}`).join('\n')
      : '- Aucune règle active; signaler explicitement cette lacune de gouvernance.'}`,
    behavioralContext(d.behavioral_profile) || null,
    impersonatorContext(d) || null,
  ];
  return sections.filter(Boolean).join('\n\n');
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

  update(agentId, patch, { tenantId = null } = {}) {
    const registry = this._registry(tenantId);
    const current = registry.get(agentId);
    if (!current) throw new Error(`agent introuvable: ${agentId}`);
    if (patch.agent_id && patch.agent_id !== agentId) throw new Error('agent_id est immuable');
    const next = validateAgentDefinition({ ...current, ...clone(patch), agent_id: agentId });
    if (next.human_profile && next.human_profile.consent_confirmed !== true) {
      throw new Error('human_profile: consentement explicite requis');
    }
    registry.set(agentId, next);
    return clone(next);
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
  // Tolère la mise en forme courante des LLM : `**NO-GO**`, "GO.", « CONDITIONAL GO ».
  const t = String(raw || '').trim().toUpperCase()
    .replace(/[^A-Z0-9_\s-]+/g, ' ').trim().replace(/[\s-]+/g, '_');
  if (['GO', 'APPROVED', 'APPROVE'].includes(t)) return 'GO';
  if (['NO_GO', 'NOGO', 'REJECTED', 'REJECT', 'VETO'].includes(t)) return 'NO_GO';
  if (['CONDITIONAL_GO', 'CONDITIONAL', 'REVISE', 'REVISION', 'GO_CONDITIONNEL', 'CONDITIONNEL'].includes(t)) return 'CONDITIONAL_GO';
  return null;
}

/** Hypothèse technique ajoutée quand la sortie d'un agent ne contient pas de verdict formel. */
export const UNPARSABLE_VERDICT_ASSUMPTION = 'Agent output did not contain a parsable formal verdict; human review required.';

/** Objet équilibré commençant à `start` : `{ value, end }` (`end` = -1 si tronqué). */
function jsonObjectAt(src, start) {
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
      try { return { value: JSON.parse(src.slice(start, i + 1)), end: i }; } catch { return { value: null, end: i }; }
    }
  }
  return { value: null, end: -1 };
}

/**
 * Premier objet JSON valide du texte. Une accolade de prose équilibrée mais
 * non JSON (« {brève} ») est sautée ; un objet tronqué (limite de jetons)
 * arrête la recherche, comme auparavant, pour ne pas prendre un sous-objet.
 */
function firstJsonObject(text) {
  const src = String(text || '');
  let start = src.indexOf('{');
  while (start >= 0) {
    const { value, end } = jsonObjectAt(src, start);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (end < 0) return null;
    start = src.indexOf('{', end + 1);
  }
  return null;
}

/**
 * Objet JSON d'une sortie d'agent. Les modèles à raisonnement (Kimi K3,
 * DeepSeek…) entourent souvent leur JSON d'un bloc Markdown ```json … ``` :
 * le contenu du bloc est préféré à toute accolade de la prose environnante.
 */
export function extractAgentJson(text) {
  const src = String(text || '');
  const fence = /```[ \t]*(?:json|JSON|json5)?[ \t]*\r?\n?([\s\S]*?)```/g;
  let match;
  while ((match = fence.exec(src))) {
    const value = firstJsonObject(match[1]);
    if (value) return value;
  }
  return firstJsonObject(src);
}

export function normalizeAgentAnalysis(raw, definition = {}, { personalityEnabled = !!definition.human_profile } = {}) {
  let value = raw?.structured || raw?.output || raw;
  // Un modèle à raisonnement peut renvoyer `<think>…</think>` avant le JSON :
  // un « GO » ou une accolade du raisonnement ne doit jamais faire le verdict.
  if (typeof value === 'string') value = stripReasoning(value);
  if (typeof value === 'string') value = extractAgentJson(value) || { primary_reason: value.slice(0, 500) };
  value = value && typeof value === 'object' ? value : {};
  let verdict = normalizeSwarmVerdict(value.verdict || value.decision);
  const unverified = strings(value.unverified_assumptions);
  const rawText = typeof (raw?.output ?? raw) === 'string' ? stripReasoning(String(raw?.output ?? raw)) : '';
  if (!verdict) {
    // JSON tronqué (limite de jetons) ou entouré de prose : le champ "verdict" reste lisible.
    verdict = normalizeSwarmVerdict(rawText.match(/"(?:verdict|decision)"\s*:\s*"([^"]{1,40})"/i)?.[1]);
  }
  if (!verdict) {
    // Majuscules seulement : un « go » de prose (ou l'écho de la question par le mock) n'est pas un verdict.
    verdict = normalizeSwarmVerdict(rawText.match(/\b(CONDITIONAL[\s_-]?GO|NO[\s_-]?GO|GO)\b/)?.[1]);
  }
  if (!verdict) {
    verdict = 'CONDITIONAL_GO';
    unverified.push(UNPARSABLE_VERDICT_ASSUMPTION);
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
    // Provider LLM effectif de l'agent (ENF-09) : un repli `mock` ne doit jamais être silencieux.
    llm_provider: raw?.provider || null,
    llm_degraded: raw?.degraded || null,
  };
}

/** Synthèse des providers effectivement utilisés par les agents d'un run (ENF-09). */
export function summarizeRunProviders(analyses = []) {
  const providers = [...new Set(analyses.map((a) => a.llm_provider).filter(Boolean))];
  const degraded = analyses.filter((a) => a.llm_degraded).map((a) => ({ agent_id: a.agent_id, ...a.llm_degraded }));
  const mockAgents = analyses.filter((a) => a.llm_provider === 'mock').map((a) => a.agent_id);
  return { providers, mock: mockAgents.length > 0, mock_agents: mockAgents, degraded };
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
  constructor({ llm = null, memory = null, registry = null, systemAgents = DEFAULT_SYSTEM_AGENTS, auditSink = null, profileImporter = null, store = null, logger = console, maxConcurrency = DEFAULT_SWARM_MAX_CONCURRENCY } = {}) {
    this.llm = llm;
    // Appels LLM simultanés pendant un run : borné pour ne pas déclencher les
    // 429 des fournisseurs à quota par minute (NVIDIA, Mistral).
    this.maxConcurrency = maxConcurrency;
    this.logger = logger;
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

  updateAgent(agentId, patch, { tenantId = null, by = null } = {}) {
    const agent = this.registry.update(agentId, patch, { tenantId });
    this._persist(this.store?.saveAgent?.(agent, { tenantId: tenantKey(tenantId) }));
    this._audit({
      type: 'swarm.agent.updated', agent_id: agentId, tenant_id: tenantKey(tenantId), by,
      enabled: agent.enabled,
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

  async importAndAssignPersonality(agentId, input = {}, { tenantId = null, by = null } = {}) {
    if (!this.registry.get(agentId, { tenantId })) throw new Error(`agent introuvable: ${agentId}`);
    return this.assignPersonality(agentId, await this.previewPersonality(input, { by }), { tenantId, by });
  }

  /** Construit le profil humain fusionné (imports + saisie) sans l'attacher à un agent. */
  async previewPersonality({ imports = [], manual_profile = null, consent_confirmed = false } = {}, { by = null } = {}) {
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
    return mergeHumanProfiles(...fragments);
  }

  /** Agent du collectif : agent propre à la session, sinon agent du registre. */
  resolveConfigurationAgent(config, agentId, { tenantId = null } = {}) {
    const own = (config?.session_agents || []).find((agent) => agent.agent_id === agentId);
    return own ? clone(own) : this.registry.get(agentId, { tenantId });
  }

  /** Agent tel qu'il siège dans ce collectif (surcharges de session appliquées). */
  effectiveConfigurationAgent(config, agentId, { tenantId = null } = {}) {
    const base = this.resolveConfigurationAgent(config, agentId, { tenantId });
    if (!base) return null;
    try { return applyAgentPatchToDefinition(base, config?.agent_rule_overrides?.[agentId] || {}); } catch { return base; }
  }

  /** Valide les agents composés pour une session (ils ne rejoignent jamais le registre du tenant). */
  _sessionAgents(list, { tenantId = null, existing = [] } = {}) {
    const taken = new Set(existing.map((agent) => agent.agent_id));
    return (Array.isArray(list) ? list : []).map((input) => {
      const definition = validateAgentDefinition({
        ...clone(input), agent_type: 'user_defined', enabled: true,
        metadata: { ...plainObject(input?.metadata), session_scoped: true },
      });
      if (this.registry.get(definition.agent_id, { tenantId }) || taken.has(definition.agent_id)) {
        throw new Error(`agent déjà existant: ${definition.agent_id}`);
      }
      if (definition.human_profile && definition.human_profile.consent_confirmed !== true) {
        throw new Error('human_profile: consentement explicite requis');
      }
      taken.add(definition.agent_id);
      return definition;
    });
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
    const session_agents = this._sessionAgents(input?.session_agents, { tenantId });
    const draft = { session_agents };
    for (const id of active_agents) {
      const agent = this.resolveConfigurationAgent(draft, id, { tenantId });
      if (!agent) throw new Error(`agent actif introuvable: ${id}`);
      if (agent.enabled === false) throw new Error(`agent désactivé: ${id}`);
    }
    const overrides = clone(input?.agent_rule_overrides || {});
    for (const [id, patch] of Object.entries(overrides)) {
      const definition = this.resolveConfigurationAgent(draft, id, { tenantId });
      if (!definition || !active_agents.includes(id)) throw new Error(`override d'un agent inactif ou introuvable: ${id}`);
      applyAgentPatchToDefinition(definition, patch, { personalityEnabled: personality_simulation_enabled });
    }
    const config = {
      swarm_id, swarm_name, active_agents, voting_threshold, personality_simulation_enabled,
      agent_rule_overrides: overrides, ...(session_agents.length ? { session_agents } : {}), tenant_id: tenantKey(tenantId),
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
      if (!this.resolveConfigurationAgent(config, agentId, { tenantId })) throw new Error(`agent actif introuvable: ${agentId}`);
    }
    this.configurations.set(this._key(tenantId, config.swarm_id), config);
    return clone(config);
  }

  getConfiguration(id, { tenantId = null } = {}) { return clone(this.configurations.get(this._key(tenantId, id)) || null); }

  /** Met à jour le collectif actif d'une configuration existante (ajouts/retraits d'agents) avec validation et persistance. */
  updateConfigurationAgents(swarmId, { addAgentIds = [], removeAgentIds = [], addSessionAgents = [] } = {}, { tenantId = null, by = null } = {}) {
    const key = this._key(tenantId, swarmId);
    const config = this.configurations.get(key);
    if (!config) throw new Error(`swarm introuvable: ${swarmId}`);
    const removes = strings(removeAgentIds);
    const keptOwn = (config.session_agents || []).filter((agent) => !removes.includes(agent.agent_id));
    const newOwn = this._sessionAgents(addSessionAgents, { tenantId, existing: keptOwn });
    const adds = [...new Set([...strings(addAgentIds), ...newOwn.map((agent) => agent.agent_id)])];
    const next = config.active_agents.filter((id) => !removes.includes(id));
    for (const id of adds) if (!next.includes(id)) next.push(id);
    if (!next.length) throw new Error('active_agents: au moins un agent requis');
    const session_agents = [...keptOwn, ...newOwn];
    for (const id of next) {
      const agent = this.resolveConfigurationAgent({ session_agents }, id, { tenantId });
      if (!agent) throw new Error(`agent actif introuvable: ${id}`);
      if (agent.enabled === false) throw new Error(`agent désactivé: ${id}`);
    }
    const overrides = Object.fromEntries(Object.entries(config.agent_rule_overrides || {}).filter(([id]) => next.includes(id)));
    const updated = { ...clone(config), active_agents: next, agent_rule_overrides: overrides, updated_at: now() };
    if (session_agents.length || config.session_agents) updated.session_agents = clone(session_agents);
    this.configurations.set(key, updated);
    this._persist(this.store?.saveConfiguration?.(updated, { tenantId: tenantKey(tenantId) }));
    this._audit({ type: 'swarm.configuration.updated', swarm_id: swarmId, tenant_id: tenantKey(tenantId), added: adds, removed: removes, by });
    return clone(updated);
  }
  /**
   * Enregistre dans le registre partagé du tenant un agent composé ou ajusté dans
   * une session (profil réel Crystal/DISC compris). Le collectif n'est pas modifié,
   * sauf si l'agent de session garde son identifiant : la copie de session cède
   * alors la place à l'agent du registre (même définition).
   * `include_human_profile: false` enregistre les seuls attributs, sans profil réel.
   */
  promoteSessionAgent(swarmId, agentId, { agent_id = null, display_name = null, include_human_profile = true } = {}, { tenantId = null, by = null } = {}) {
    const key = this._key(tenantId, swarmId);
    const config = this.configurations.get(key);
    if (!config) throw new Error(`swarm introuvable: ${swarmId}`);
    if (!(config.active_agents || []).includes(agentId)) throw new Error(`agent absent du collectif: ${agentId}`);
    const own = (config.session_agents || []).some((agent) => agent.agent_id === agentId);
    const overridden = !own && Object.keys(config.agent_rule_overrides?.[agentId] || {}).length > 0;
    if (!own && !overridden) throw new Error(`agent déjà dans le registre: ${agentId}`);
    const effective = this.effectiveConfigurationAgent(config, agentId, { tenantId });
    const targetId = String(agent_id || (own ? agentId : `${agentId}_variante`)).trim();
    if (this.registry.get(targetId, { tenantId })) throw new Error(`agent déjà existant: ${targetId}`);
    const { session_scoped, session_override, ...metadata } = plainObject(effective.metadata);
    const input = {
      ...clone(effective), agent_id: targetId, agent_type: 'user_defined', enabled: true,
      metadata: { ...metadata, promoted_from_session: { swarm_id: swarmId, agent_id: agentId, by, at: now() } },
    };
    if (display_name) input.display_name = String(display_name).trim();
    if (!include_human_profile && input.human_profile) {
      // Attributs seuls : le nom de la personne importée ne doit subsister nulle part
      // (mission « Réagir comme … », instructions, règles, profil comportemental).
      const person = String(input.human_profile.assigned_name || '').trim();
      delete input.human_profile;
      if (person) {
        const chosen = String(display_name || '').trim();
        const neutral = chosen && chosen.toLowerCase() !== person.toLowerCase() ? chosen : String(effective.role_name || 'ce profil').trim();
        const pattern = new RegExp(person.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const scrub = (value) => (typeof value === 'string' ? value.replace(pattern, neutral)
          : Array.isArray(value) ? value.map(scrub)
            : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)])) : value);
        for (const field of ['display_name', 'primary_focus', 'mission', 'instructions', 'constraints', 'behavioral_profile', 'rule_configuration']) {
          if (input[field] !== undefined) input[field] = scrub(input[field]);
        }
        delete input.effective_context; delete input.effective_rules;
      }
    }
    const agent = this.createAgent(input, { tenantId, by });
    if (own && targetId === agentId) {
      const updated = { ...clone(config), session_agents: (config.session_agents || []).filter((item) => item.agent_id !== agentId), updated_at: now() };
      this.configurations.set(key, updated);
      this._persist(this.store?.saveConfiguration?.(updated, { tenantId: tenantKey(tenantId) }));
    }
    this._audit({ type: 'swarm.agent.promoted_from_session', swarm_id: swarmId, agent_id: targetId, source_agent_id: agentId, tenant_id: tenantKey(tenantId), human_profile: !!agent.human_profile, by });
    return agent;
  }
  getRun(id, { tenantId = null } = {}) { return clone(this.runs.get(this._key(tenantId, id)) || null); }

  /**
   * `runId` (facultatif) : identifiant réservé par l'appelant (exécution
   * asynchrone annoncée avant la fin des analyses). `onProgress` (facultatif)
   * est appelé après chaque analyse d'agent avec `{ completed, total, agent_id }` ;
   * une erreur levée par ce rappel n'interrompt jamais le run.
   */
  async run(configurationOrId, { tenantId = null, question, context = '', provider, sovereignty, model, by = null, agentResults = null, runId = null, onProgress = null } = {}) {
    const config = typeof configurationOrId === 'string'
      ? this.getConfiguration(configurationOrId, { tenantId })
      : this.createConfiguration(configurationOrId, { tenantId, by });
    if (!config) throw new Error(`swarm introuvable: ${configurationOrId}`);
    if (!String(question || '').trim()) throw new Error('question de décision requise');
    const run_id = String(runId || '').trim() || makeId('swarmrun');
    const definitions = config.active_agents.map((id) => {
      const base = this.resolveConfigurationAgent(config, id, { tenantId });
      if (!base || base.enabled === false) throw new Error(`agent indisponible ou désactivé: ${id}`);
      return applyAgentPatchToDefinition(base, config.agent_rule_overrides?.[id] || {}, {
        personalityEnabled: config.personality_simulation_enabled,
      });
    });
    const executeOne = async (definition) => {
      const effective_rules = resolveEffectiveRules(definition);
      let raw = agentResults?.[definition.agent_id];
      if (raw == null) {
        const agent = new SpecializedDecisionAgent({
          definition, effectiveContext: compileEffectiveAgentContext(definition),
          personalityEnabled: config.personality_simulation_enabled,
          llm: this.llm, memory: this.memory,
        });
        raw = await agent.executeDecision({
          question, context,
          provider: definition.provider || provider,
          sovereignty,
          model: definition.model || model,
          runId: run_id, traceId: run_id,
        });
      }
      return {
        ...normalizeAgentAnalysis(raw, definition, { personalityEnabled: config.personality_simulation_enabled }),
        effective_rules,
      };
    };
    let completed = 0;
    const tracked = typeof onProgress === 'function'
      ? async (definition) => {
        const analysis = await executeOne(definition);
        completed += 1;
        try { await onProgress({ completed, total: definitions.length, agent_id: definition.agent_id }); } catch { /* la progression ne bloque jamais un run */ }
        return analysis;
      }
      : executeOne;
    const analyses = await mapWithConcurrency(definitions, this.maxConcurrency, tracked);
    const llm = summarizeRunProviders(analyses);
    if (llm.mock) {
      this._audit({ type: 'swarm.run.llm_degraded', run_id, swarm_id: config.swarm_id, tenant_id: tenantKey(tenantId), mock_agents: llm.mock_agents, degraded: llm.degraded });
      try { this.logger?.warn?.(`[kayros][swarm] run ${run_id}: réponses simulées (provider mock) pour ${llm.mock_agents.join(', ')}`, llm.degraded); } catch { /* le log ne bloque jamais un run */ }
    }
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
      configuration: config, analyses, consensus, llm,
      status: 'pending_human_arbitration', human_decision: null,
      // Auteur du run : base du contrôle de propriétaire sur /v1/swarm/runs/* (F4).
      created_by: by || null,
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
