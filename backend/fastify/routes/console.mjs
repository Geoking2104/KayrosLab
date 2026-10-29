import { z } from 'zod';
import { compileEffectiveAgentContext, resolveEffectiveRules } from '../../../core/swarm.mjs';
import { impersonatorAgentDefinition, personaClues, impersonatorGuardrails } from '../../../core/impersonator.mjs';
import { hasConsentedHumanProfile, makeThreadId } from '../../../core/hybrid-agent-gateway.mjs';
import { workspaceStoreFor } from '../lib/workspace-roles.mjs';
import { agentNodesFor, chainContext, needsApproval, pipelineStatus, pipelineSteps, readySteps, stepDeps, stepOutcome } from '../lib/project-pipeline.mjs';
import { EXECUTION_PROFILES, DEFAULT_PROFILE, profileRunOptions } from '../../../core/integrations/profiles.mjs';
import { collectiveAttachmentsContext } from './console-workspace.mjs';
import { agentAttributesFromProfile, normalizeDiscType, profileFromDiscType } from '../../../core/personality.mjs';

// La console est un harness d'agents : elle compose des collectifs, exécute des
// missions gouvernées et arbitre les verdicts. Les surfaces du produit de
// conversation dérivé n'apparaissent plus ici.

const missionSchema = z.object({ question: z.string().min(1).max(12000), text: z.string().min(1).max(12000).optional(), context: z.string().max(24000).optional(), profile: z.enum(EXECUTION_PROFILES).optional() });
const ruleConfigurationSchema = z.object({
  system_proposed_rules: z.array(z.object({ rule_id: z.string().min(1).max(120), rule_text: z.string().min(1).max(2000), status: z.enum(['active', 'overridden', 'disabled']).optional() })).optional(),
  user_added_rules: z.array(z.union([z.string().min(1).max(2000), z.object({ rule_id: z.string().max(120).optional(), rule_text: z.string().min(1).max(2000) })])).optional(),
  user_modified_rules: z.array(z.object({ replaces_rule_id: z.string().min(1).max(120), modified_text: z.string().min(1).max(2000) })).optional(),
}).optional();
// Descriptif de personnalité éditable (cf. core/personality-descriptif.mjs).
const descriptifSchema = z.object({
  disc_type: z.string().max(8).nullable().optional(), archetype: z.string().max(120).nullable().optional(),
  disc_intensity: z.number().min(0).max(100).nullable().optional(), overview: z.string().max(4000).nullable().optional(),
  qualities: z.array(z.string().max(80)).max(6).optional(),
  traits: z.record(z.string().max(40), z.number().min(0).max(100)).optional(),
  sections: z.record(z.string().max(40), z.array(z.string().max(500)).max(12)).optional(),
  source: z.string().max(40).optional(),
}).nullable().optional();
const humanProfileSchema = z.object({
  assigned_name: z.string().max(200).optional(), linkedin_url: z.string().max(1000).optional(), crystalknows_report_url: z.string().max(1000).optional(),
  disc_type: z.string().max(80).optional(), enneagram_type: z.string().max(80).optional(), myers_briggs_type: z.string().max(80).optional(),
  behavioral_archetype: z.string().max(160).optional(), descriptif: descriptifSchema, core_motivators: z.array(z.string().max(500)).max(30).optional(),
  skepticism_factor: z.string().max(500).optional(), profile_summary: z.array(z.string().max(1000)).max(30).optional(),
  professional_context: z.object({ headline: z.string().max(500).optional(), current_role: z.string().max(300).optional(), company: z.string().max(300).optional(), location: z.string().max(300).optional(), skills: z.array(z.string().max(300)).max(100).optional(), qualities: z.array(z.string().max(300)).max(100).optional() }).optional(),
  communication_style: z.object({ tone: z.string().max(160).optional(), preferred_format: z.string().max(300).optional(), decision_triggers: z.array(z.string().max(500)).max(30).optional(), stress_triggers: z.array(z.string().max(500)).max(30).optional(), objection_patterns: z.array(z.string().max(500)).max(30).optional(), communication_directives: z.array(z.string().max(500)).max(30).optional() }).optional(),
  avatar_url: z.string().max(3000).optional(),
  disc_intensity: z.number().int().min(0).max(100).optional(),
  behavioral_traits: z.record(z.string().max(40), z.number().min(0).max(100)).optional(),
  // Provenance renvoyée par l'aperçu d'import (Crystal, DISC, export) et conservée telle quelle.
  profile_sources: z.array(z.object({
    source: z.enum(['linkedin', 'crystalknows', 'manual']), source_url: z.string().max(1000).nullable().optional(),
    import_mode: z.string().max(80).optional(), imported_at: z.string().max(40).optional(), imported_by: z.string().max(320).nullable().optional(),
    fields: z.array(z.string().max(80)).max(40).optional(), consent_confirmed: z.boolean().optional(),
    external_profile_id: z.string().max(200).nullable().optional(), verified: z.boolean().nullable().optional(),
  })).max(8).optional(),
  consent_confirmed: z.boolean().optional(),
}).optional();
// Caractéristiques déclarées d'un agent (personnalité de rôle) : injectées dans son contexte d'exécution.
const behavioralProfileSchema = z.object({ descriptif: descriptifSchema }).catchall(z.union([z.string().max(1000), z.number(), z.boolean(), z.array(z.string().max(500)).max(20)])).optional();
const seniorityEnum = z.enum(['intern', 'junior', 'senior', 'executive']);
// « Nouvelle session » : ajustement d'un agent proposé pour ce seul collectif (le registre reste intact).
const sessionOverrideSchema = z.object({
  display_name: z.string().min(1).max(160).optional(), role_name: z.string().min(1).max(160).optional(),
  department: z.string().min(1).max(160).optional(), seniority: seniorityEnum.optional(),
  mission: z.string().min(1).max(4000).optional(), instructions: z.string().max(12000).optional(),
  constraints: z.array(z.string().min(1).max(1000)).max(50).optional(), veto_power: z.boolean().optional(),
  behavioral_profile: behavioralProfileSchema,
  disabled_rules: z.array(z.string().min(1).max(120)).max(50).optional(),
  modified_rules: z.array(z.object({ replaces_rule_id: z.string().min(1).max(120), modified_text: z.string().min(1).max(2000) })).max(50).optional(),
  added_rules: z.array(z.string().min(1).max(2000)).max(50).optional(),
});
// Agent composé pour la session (ou issu d'un profil réel importé) : n'entre pas dans le registre du tenant.
const sessionAgentSchema = z.object({
  agent_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/).optional(),
  display_name: z.string().min(1).max(160), role_name: z.string().min(1).max(160), department: z.string().min(1).max(160),
  seniority: seniorityEnum.optional().default('senior'), mission: z.string().min(1).max(4000),
  instructions: z.string().max(12000).optional(), constraints: z.array(z.string().min(1).max(1000)).max(50).optional(),
  rules: z.array(z.string().min(1).max(2000)).max(30).optional(), veto_power: z.boolean().optional(),
  behavioral_profile: behavioralProfileSchema, human_profile: humanProfileSchema,
});
// Enregistrement d'un agent de session dans le registre partagé du tenant.
const promoteSchema = z.object({
  agent_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/).optional(),
  display_name: z.string().min(1).max(160).optional(),
  include_human_profile: z.boolean().optional().default(true),
  // Exigé quand un profil réel est partagé : tout membre du tenant le verra.
  share_consent_confirmed: z.boolean().optional(),
});
// Tenants dont le registre est commun à des comptes qui ne se connaissent pas
// (inscription self-service → tenant « default ») : un profil réel n'y est jamais publié.
const SHARED_TENANTS = new Set(String(process.env.KAYROS_SHARED_TENANT_IDS ?? 'default').split(',').map((item) => item.trim()).filter(Boolean));
function sharedTenant(tenantId) { return SHARED_TENANTS.has(String(tenantId ?? 'default')); }
const MAX_CUSTOM_AGENTS_PER_SESSION = Number(process.env.KAYROS_MAX_CUSTOM_AGENTS_PER_SESSION || 8);
const sessionSchema = z.object({
  name: z.string().min(1).max(120),
  active_agents: z.array(z.string()).optional(),
  swarm_name: z.string().max(120).optional(),
  voting_threshold: z.enum(['unanimous', 'majority', 'veto_power_csuite']).optional(),
  personality_simulation_enabled: z.boolean().optional(),
  agent_overrides: z.record(z.string().max(80), sessionOverrideSchema).optional(),
  custom_agents: z.array(sessionAgentSchema).max(MAX_CUSTOM_AGENTS_PER_SESSION).optional(),
// `active_agents` absent (et aucun agent composé) : collectif par défaut du serveur.
}).refine((value) => (value.active_agents === undefined && !value.custom_agents?.length) || (value.active_agents?.length || 0) + (value.custom_agents?.length || 0) > 0, { message: 'au moins un agent requis dans le collectif' });
// Aperçu d'un profil réel avant de l'ajouter à un comité (Crystal Knows API, export JSON ou type DISC).
const personalityPreviewSchema = z.object({
  consent_confirmed: z.literal(true),
  source: z.enum(['crystalknows', 'export', 'disc']),
  email: z.string().email().max(320).optional(), linkedin_url: z.string().max(1000).optional(),
  full_name: z.string().max(200).optional(), company_name: z.string().max(200).optional(), job_title: z.string().max(200).optional(),
  profile_data: z.record(z.string(), z.unknown()).optional(),
  disc_type: z.string().max(10).optional(), assigned_name: z.string().max(200).optional(),
});
const personalityImportSchema = z.object({
  consent_confirmed: z.literal(true),
  imports: z.array(z.object({
    source: z.enum(['linkedin', 'crystalknows']),
    profile_url: z.string().max(1000).optional(), linkedin_url: z.string().max(1000).optional(),
    email: z.string().email().max(320).optional(), profile_data: z.record(z.string(), z.unknown()).optional(),
    full_name: z.string().max(200).optional(), company_name: z.string().max(200).optional(), job_title: z.string().max(200).optional(),
  })).max(4).optional().default([]),
  manual_profile: humanProfileSchema,
}).refine((value) => value.imports.length > 0 || !!value.manual_profile, { message: 'au moins un import ou un profil manuel requis' });
const agentFields = {
  agent_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/), display_name: z.string().min(1).max(160).optional(),
  role_name: z.string().min(1).max(160), department: z.string().min(1).max(160),
  seniority: z.enum(['intern', 'junior', 'senior', 'executive']), primary_focus: z.string().min(1).max(4000),
  mission: z.string().min(1).max(4000).optional(), instructions: z.string().max(12000).optional(),
  constraints: z.array(z.string().min(1).max(1000)).max(50).optional(), provider: z.enum(['mock', 'ollama', 'mistral', 'anthropic', 'nvidia']).nullable().optional(),
  model: z.string().max(200).nullable().optional(), tools: z.array(z.string().min(1).max(160)).max(100).optional(),
  connectors: z.array(z.enum(['slack', 'discord', 'teams', 'console'])).max(4).optional(), veto_power: z.boolean().optional(), enabled: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(), behavioral_profile: z.record(z.string(), z.unknown()).optional(), rule_configuration: ruleConfigurationSchema,
  human_profile: humanProfileSchema,
};
const agentCreateSchema = z.object(agentFields);
const agentPatchSchema = z.object(agentFields).partial().omit({ agent_id: true });
const crystalImportSchema = z.object({ consent_confirmed: z.literal(true), email: z.string().email().max(320).optional(), linkedin_url: z.string().url().max(1000).optional() })
  .refine((value) => !!value.email || !!value.linkedin_url, { message: 'email ou linkedin_url requis' });
const connectorSchema = z.object({ enabled: z.boolean().optional().default(true), settings: z.record(z.string(), z.unknown()).optional().default({}), secrets: z.record(z.string(), z.string().max(4000)).optional().default({}) });
const connectorStateSchema = z.object({ enabled: z.boolean() });
const replySchema = z.object({ text: z.string().min(1).max(12000) });
const collectiveSchema = z.object({
  add_agent_ids: z.array(z.string().min(1).max(80)).max(30).optional().default([]),
  remove_agent_ids: z.array(z.string().min(1).max(80)).max(30).optional().default([]),
  add_custom_agents: z.array(sessionAgentSchema).max(MAX_CUSTOM_AGENTS_PER_SESSION).optional().default([]),
}).refine((value) => value.add_agent_ids.length > 0 || value.remove_agent_ids.length > 0 || value.add_custom_agents.length > 0, { message: 'aucun changement de collectif demandé' });
const arbitrationSchema = z.object({ action: z.enum(['accept_consensus', 'override_veto', 'reevaluate']), justification: z.string().max(4000).optional(), decision: z.enum(['GO', 'CONDITIONAL_GO']).optional() });
const impersonatorSchema = z.object({
  agent_id: z.string().max(64).optional(),
  name: z.string().min(1).max(200),
  role: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  source: z.enum(['linkedin', 'crystalknows', 'export', 'manual']),
  linkedin_url: z.string().max(1000).optional(),
  report_url: z.string().max(1000).optional(),
  email: z.string().email().max(320).optional(),
  profile_data: z.record(z.string(), z.unknown()).optional(),
  export_source: z.enum(['linkedin', 'crystalknows']).optional(),
  clues: z.array(z.string().max(500)).max(30).optional(),
  portrait_url: z.string().max(3000000).regex(/^(https:\/\/|data:image\/)/i, 'portrait_url doit être une URL https ou une image data-URI').optional(),
  purpose: z.enum(['idea_test', 'objection_rehearsal', 'pitch_review']).optional(),
  veto_power: z.boolean().optional(),
  consent_reference: z.string().max(300).optional(),
  consent_confirmed: z.literal(true),
});
const impersonatorMemberSchema = impersonatorSchema.omit({ consent_confirmed: true, purpose: true, veto_power: true });
const impersonatorTeamSchema = z.object({
  name: z.string().min(1).max(120),
  members: z.array(impersonatorMemberSchema).min(2).max(12),
  purpose: z.enum(['idea_test', 'objection_rehearsal', 'pitch_review']).optional(),
  voting_threshold: z.enum(['unanimous', 'majority', 'veto_power_csuite']).optional(),
  veto_power: z.boolean().optional(),
  personality_simulation_enabled: z.boolean().optional(),
  consent_confirmed: z.literal(true),
});

// Limites de la version en ligne (surchargeables par environnement).
const MAX_SESSIONS_PER_USER = Number(process.env.KAYROS_MAX_SESSIONS_PER_USER || process.env.KAYROS_MAX_ROOMS_PER_USER || 3);
const MAX_BUILT_AGENTS_PER_SESSION = Number(process.env.KAYROS_MAX_BUILT_AGENTS_PER_SESSION || process.env.KAYROS_MAX_BUILT_AGENTS_PER_ROOM || 3);

function agentView(agent) { return { ...agent, effective_rules: resolveEffectiveRules(agent), effective_context: compileEffectiveAgentContext(agent) }; }
// Le rôle effectif tient compte de la fiche membre de l'espace (Réglages → Membres).
async function permitted(app, me, reply, permission) {
  try {
    const { can, PERMISSION_ERROR } = await import('./console-workspace.mjs');
    if (await can(app, me, permission)) return true;
    reply.code(403).send({ error: PERMISSION_ERROR[permission] || 'rôle insuffisant' }); return false;
  } catch {
    // Espace indisponible : rôle du jeton.
    if (permission === 'run' || ['comex', 'admin'].includes(me.role)) return true;
    reply.code(403).send({ error: 'rôle comex ou admin requis' }); return false;
  }
}
const manager = (app, me, reply) => permitted(app, me, reply, 'manage');
async function withGates(app, tenantId, thread) {
  try { const { applyGates } = await import('./console-workspace.mjs'); return await applyGates(app, tenantId, thread); }
  catch { return thread; }
}
// La console ne doit jamais exposer le vocabulaire d'une application tierce.
function surface(message) {
  return String(message || '')
    .replace(/du salons?/gi, 'de la session')
    .replace(/salons/gi, 'sessions')
    .replace(/salon/gi, 'session');
}
/** `?wait=true` : ancien mode synchrone (la réponse attend la fin des analyses). */
function waitRequested(req) { return /^(1|true|yes|oui)$/i.test(String(req.query?.wait ?? '')); }
/** Vue d'exécution asynchrone renvoyée en 202 et utilisée par le polling. */
function executionView(thread, runId) {
  return {
    thread_id: thread?.thread_id || null, run_id: runId || thread?.active_run_id || thread?.current_run_id || null,
    status: thread?.status || null, progress: thread?.progress || null, error: thread?.error || null,
  };
}
/** Options d'exécution d'un profil (demo / fast / deep) selon la configuration LLM du serveur. */
function runProfile(app, profile) {
  const cfg = app.kayrosContext?.llmConfig;
  return profileRunOptions(profile || DEFAULT_PROFILE, {
    fastAvailable: !!cfg?.fast?.available, fastModel: cfg?.fast?.model, deepModel: cfg?.model, deepProvider: cfg?.provider,
  });
}
function slug(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}
/** Agent composé → définition d'agent de session (identifiant unique, règles ajoutées, profil consenti). */
function sessionAgentDefinition(input) {
  const base = slug(input.display_name || input.role_name) || 'agent';
  const agent_id = input.agent_id || `${/^[a-z]/.test(base) ? base : `a_${base}`}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 64);
  const definition = {
    agent_id, display_name: input.display_name, role_name: input.role_name, department: input.department,
    seniority: input.seniority || 'senior', primary_focus: input.mission, mission: input.mission,
    instructions: input.instructions || '', constraints: input.constraints || [], connectors: ['console'],
    veto_power: input.veto_power === true, behavioral_profile: input.behavioral_profile || {},
    rule_configuration: { system_proposed_rules: [], user_modified_rules: [], user_added_rules: (input.rules || []).map((rule_text, index) => ({ rule_id: `USR_${agent_id.toUpperCase()}_${index + 1}`, rule_text })) },
  };
  if (input.human_profile) {
    if (input.human_profile.consent_confirmed !== true) throw new Error('profil humain : consentement explicite requis');
    definition.human_profile = input.human_profile;
  }
  return definition;
}
function sessionOverrides(overrides = {}) {
  return Object.fromEntries(Object.entries(overrides).map(([id, patch]) => [id, {
    ...patch, ...(patch.added_rules ? { added_rules: patch.added_rules.map((rule_text) => ({ rule_text })) } : {}),
  }]));
}
function makeSessionId() { return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

// --- Isolation par propriétaire (EF-21 / EF-22 / ENF-08) -------------------
// comex/admin gardent la vue du tenant ; un contributeur ne lit et n'écrit que
// ses propres sessions et les fils, l'activité et les exécutions qui en dépendent.
// Une ressource d'autrui répond 404 (son existence n'est pas révélée).
function tenantWide(me) { return ['comex', 'admin'].includes(me?.role); }
function ownsRoom(me, room) {
  if (!room) return false;
  if (room.owner_id) return !!me?.sub && String(room.owner_id) === String(me.sub);
  // Sessions antérieures à `owner_id` : `created_by` (e-mail posé par le serveur
  // depuis le jeton) fait foi ; sans lui, la session reste invisible aux contributeurs.
  return !!room.created_by && !!me?.email && String(room.created_by).toLowerCase() === String(me.email).toLowerCase();
}
function canAccessRoom(me, room) { return !!room && (tenantWide(me) || ownsRoom(me, room)); }
async function consoleRooms(app, me) {
  return app.kayrosContext.hybridGateway.listRooms({ tenantId: me.tenantId, platform: 'console' });
}
export async function accessibleRooms(app, me) {
  const rooms = await consoleRooms(app, me);
  return tenantWide(me) ? rooms : rooms.filter((room) => ownsRoom(me, room));
}
/** Quota « par utilisateur » : seules les sessions dont l'utilisateur est propriétaire comptent. */
async function ownedSessionCount(app, me) {
  return (await consoleRooms(app, me)).filter((room) => ownsRoom(me, room)).length;
}
async function accessibleRoom(app, me, roomId) {
  const room = await app.kayrosContext.hybridGateway.getRoom(roomId, { tenantId: me.tenantId });
  return canAccessRoom(me, room) ? room : null;
}
async function accessibleThread(app, me, threadId) {
  const { hybridGateway } = app.kayrosContext;
  const thread = await hybridGateway.getThread(threadId, { tenantId: me.tenantId });
  if (!thread) return null;
  if (tenantWide(me)) return thread;
  return ownsRoom(me, await hybridGateway.getRoom(thread.room_id, { tenantId: me.tenantId })) ? thread : null;
}
function boundedLimit(limit) { return Math.max(1, Math.min(250, Number(limit) || 100)); }
/** Fils visibles ; `null` si une session explicitement demandée n'est pas accessible. */
export async function scopedThreads(app, me, { roomId = null, limit = 100 } = {}) {
  const { hybridGateway } = app.kayrosContext;
  if (roomId) {
    const room = await accessibleRoom(app, me, roomId);
    return room ? hybridGateway.listThreads({ tenantId: me.tenantId, roomId: room.room_id, limit }) : null;
  }
  if (tenantWide(me)) return hybridGateway.listThreads({ tenantId: me.tenantId, limit });
  const rooms = await accessibleRooms(app, me);
  const lists = await Promise.all(rooms.map((room) => hybridGateway.listThreads({ tenantId: me.tenantId, roomId: room.room_id, limit })));
  return lists.flat().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, boundedLimit(limit));
}
/** Activité visible ; `null` si une session explicitement demandée n'est pas accessible. */
async function scopedActivity(app, me, { roomId = null, after = 0, limit = 100 } = {}) {
  const { hybridGateway } = app.kayrosContext;
  if (roomId) {
    const room = await accessibleRoom(app, me, roomId);
    return room ? hybridGateway.activity({ tenantId: me.tenantId, roomId: room.room_id, after, limit }) : null;
  }
  if (tenantWide(me)) return hybridGateway.activity({ tenantId: me.tenantId, after, limit });
  const rooms = await accessibleRooms(app, me);
  const lists = await Promise.all(rooms.map((room) => hybridGateway.activity({ tenantId: me.tenantId, roomId: room.room_id, after, limit })));
  return lists.flat().sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0)).slice(-boundedLimit(limit));
}

/** Crée un agent impersonator (persona + garde-fous) et renvoie l'agent, la persona et une éventuelle erreur d'enrichissement. */
async function buildImpersonatorAgent(app, me, d) {
  const impersonator = {
    persona_name: d.name, persona_role: d.role || null, persona_company: d.company || null,
    source: d.source, source_url: d.linkedin_url || d.report_url || null, purpose: d.purpose || 'idea_test',
    consent_confirmed: true, consent_reference: d.consent_reference || null, clues: d.clues || [], portrait_url: d.portrait_url || null,
  };
  const definition = impersonatorAgentDefinition({
    agent_id: d.agent_id, impersonator, veto_power: d.veto_power !== false,
    human_profile: { assigned_name: d.name, avatar_url: d.portrait_url || null, professional_context: { current_role: d.role || null, company: d.company || null } },
  });
  let agent = app.kayrosContext.engine.swarm.createAgent(definition, { tenantId: me.tenantId, by: me.email });
  const imports = [];
  if (d.source === 'linkedin' && d.linkedin_url) imports.push({ source: 'linkedin', linkedin_url: d.linkedin_url });
  if (d.source === 'crystalknows' && (d.email || d.linkedin_url || d.report_url)) {
    imports.push({ source: 'crystalknows', email: d.email || undefined, linkedin_url: d.linkedin_url || undefined, profile_url: d.report_url || undefined });
  }
  if (d.source === 'export' && d.profile_data) imports.push({ source: d.export_source || 'crystalknows', profile_data: d.profile_data });
  let enrichment_error = null;
  if (imports.length) {
    try {
      agent = await app.kayrosContext.engine.swarm.importAndAssignPersonality(agent.agent_id, { consent_confirmed: true, imports }, { tenantId: me.tenantId, by: me.email });
    } catch (error) { enrichment_error = error.message; }
  }
  try {
    agent = app.kayrosContext.engine.swarm.updateAgent(agent.agent_id, {
      metadata: { ...(agent.metadata || {}), persona_clues: personaClues(agent.human_profile) },
    }, { tenantId: me.tenantId, by: me.email });
  } catch { /* la persona de base reste valide */ }
  return { agent, impersonator, enrichment_error };
}

function collectiveView(swarm, configuration, tenantId) {
  const active = configuration?.active_agents || [];
  return {
    swarm_id: configuration?.swarm_id || null,
    voting_threshold: configuration?.voting_threshold || 'majority',
    personality_simulation_enabled: configuration?.personality_simulation_enabled === true,
    active_agents: active,
    agents: active.map((id) => (swarm.effectiveConfigurationAgent
      ? swarm.effectiveConfigurationAgent(configuration, id, { tenantId })
      : swarm.registry.get(id, { tenantId }))).filter(Boolean).map((agent) => ({
      agent_id: agent.agent_id, role_name: agent.role_name, display_name: agent.display_name || agent.role_name,
      department: agent.department, seniority: agent.seniority, tools: agent.tools || [], provider: agent.provider || null, model: agent.model || null,
      veto_power: agent.veto_power === true, hybrid: !!agent.human_profile, impersonator: !!agent.metadata?.impersonator,
      session_scoped: agent.metadata?.session_scoped === true, session_override: agent.metadata?.session_override === true,
      disc_type: agent.human_profile?.disc_type || agent.behavioral_profile?.disc_type || null,
      human_profile: agent.human_profile ? { assigned_name: agent.human_profile.assigned_name || null, avatar_url: agent.human_profile.avatar_url || null, consent_confirmed: agent.human_profile.consent_confirmed === true } : null,
    })),
  };
}

function sessionView(room, swarm, tenantId, { threads = null } = {}) {
  if (!room) return null;
  const configuration = swarm.getConfiguration(room.swarm_id, { tenantId });
  const view = {
    session_id: room.room_id, name: room.name, status: room.status,
    created_by: room.created_by, created_at: room.created_at, updated_at: room.updated_at,
    last_activity_at: room.last_activity_at || null,
    collective: collectiveView(swarm, configuration, tenantId),
  };
  if (threads) view.executions = threads.filter((thread) => thread.room_id === room.room_id);
  return view;
}

async function connections(app, tenantId) {
  const configured = await app.kayrosContext.connectorConfig?.list(tenantId) || [];
  const runtime = await app.kayrosContext.hybridGateway.connections({ tenantId });
  for (const item of configured.filter((entry) => entry.enabled)) {
    try {
      const adapter = await app.kayrosContext.connectorConfig.adapterFor(tenantId, item.platform);
      if (adapter) app.kayrosContext.hybridGateway.setTenantAdapter(tenantId, adapter);
    } catch { /* an invalid encrypted record remains visible as an error state */ }
  }
  return configured.map((item) => {
    const fallback = runtime.find((entry) => entry.platform === item.platform);
    const usingEnvironment = fallback?.status === 'connected' && item.status === 'not_configured';
    const oauth = app.kayrosContext.connectorOAuth;
    return { ...item, status: usingEnvironment ? 'connected' : item.status, source: usingEnvironment ? 'environment' : 'console', one_click: oauth?.available(item.platform) === true, connect_mode: oauth?.mode(item.platform) || null };
  });
}

// --- Enchaînement de collectifs le long du graphe d'un projet ------------
const pipelineLocks = new Map();
function withPipelineLock(id, fn) {
  const prior = pipelineLocks.get(id) || Promise.resolve();
  const next = prior.then(fn, fn);
  pipelineLocks.set(id, next.catch(() => {}));
  return next;
}
/** Applique les nœuds « agent » du graphe à la session du collectif (ajout / exclusion). */
export async function applyGraphAgents(app, tenantId, graph, node, by) {
  const { add, remove } = agentNodesFor(graph, node.id);
  if (!add.length && !remove.length) return null;
  const gateway = app.kayrosContext.hybridGateway;
  const room = await gateway.getRoom(node.config.session_id, { tenantId });
  if (!room) return { added: [], removed: [], error: 'session introuvable' };
  const swarm = app.kayrosContext.engine.swarm;
  await swarm.hydrateTenant?.(tenantId);
  const active = swarm.getConfiguration(room.swarm_id, { tenantId })?.active_agents || [];
  const adds = add.filter((id) => !active.includes(id));
  const removes = remove.filter((id) => active.includes(id));
  if (!adds.length && !removes.length) return { added: [], removed: [], error: null };
  try {
    await gateway.updateRoomAgents(room.room_id, { addAgentIds: adds, removeAgentIds: removes, maxBuiltAgents: MAX_BUILT_AGENTS_PER_SESSION, tenantId, by });
    return { added: adds, removed: removes, error: null };
  } catch (error) { return { added: [], removed: [], error: surface(error?.message || error) }; }
}

// Composition temporaire : les agents ajoutés / exclus par le graphe sont rétablis
// à la fin de la dernière mission qui les utilise. Le bail est persisté (type
// `graph_leases`, un par session) : un redémarrage ne laisse pas la composition modifiée.
function leaseLock(tenantId, sessionId, fn) { return withPipelineLock(`lease:${tenantId}:${sessionId}`, fn); }
async function findLease(ws, tenantId, sessionId) {
  return (await ws.list(tenantId, 'graph_leases', { session_id: sessionId }))[0] || null;
}
/** Applique la composition du graphe pour une mission (fil pré-attribué) et retient quoi rétablir. */
export async function acquireGraphAgents(app, tenantId, graph, node, by, threadId) {
  const ws = workspaceStoreFor(app.kayrosContext);
  const sessionId = node.config.session_id;
  return leaseLock(tenantId, sessionId, async () => {
    const change = await applyGraphAgents(app, tenantId, graph, node, by);
    const lease = await findLease(ws, tenantId, sessionId) || await ws.create(tenantId, 'graph_leases', { session_id: sessionId, threads: [], added: [], removed: [] }, { by });
    const added = new Set(lease.added); const removed = new Set(lease.removed);
    for (const id of change?.added || []) { if (removed.has(id)) removed.delete(id); else added.add(id); }
    for (const id of change?.removed || []) { if (added.has(id)) added.delete(id); else removed.add(id); }
    const threads = [...new Set([...(lease.threads || []), threadId].filter(Boolean))];
    await ws.update(tenantId, 'graph_leases', lease.id, { threads, added: [...added], removed: [...removed] });
    return change;
  });
}
async function restoreLease(app, tenantId, lease) {
  const ws = workspaceStoreFor(app.kayrosContext);
  await ws.remove(tenantId, 'graph_leases', lease.id);
  const addAgentIds = lease.removed || []; const removeAgentIds = lease.added || [];
  if (!addAgentIds.length && !removeAgentIds.length) return { restored: [], removed: [] };
  const gateway = app.kayrosContext.hybridGateway;
  try {
    const room = await gateway.getRoom(lease.session_id, { tenantId });
    if (room) await gateway.updateRoomAgents(room.room_id, { addAgentIds, removeAgentIds, maxBuiltAgents: MAX_BUILT_AGENTS_PER_SESSION, tenantId, by: lease.created_by });
  } catch (error) { app.log?.warn?.({ err: error?.message }, 'rétablissement de la composition du collectif'); }
  return { restored: addAgentIds, removed: removeAgentIds };
}
/** Fin de mission : rend la session dans sa composition d'origine si plus aucune mission du graphe n'y tourne. */
export async function releaseGraphAgents(app, threadId, tenantHint = null) {
  if (!threadId) return null;
  const ws = workspaceStoreFor(app.kayrosContext);
  const found = await ws.findAcross('graph_leases', (l) => (l.threads || []).includes(threadId));
  if (!found || (tenantHint && found.tenantId !== tenantHint)) return null;
  return leaseLock(found.tenantId, found.item.session_id, async () => {
    const lease = await ws.get(found.tenantId, 'graph_leases', found.item.id);
    if (!lease) return null;
    const threads = (lease.threads || []).filter((t) => t !== threadId);
    if (threads.length) { await ws.update(found.tenantId, 'graph_leases', lease.id, { threads }); return null; }
    return restoreLease(app, found.tenantId, lease);
  });
}
/** Démarrage : les baux dont plus aucune mission ne tourne (redémarrage en cours de mission) sont rétablis. */
export async function recoverGraphLeases(app) {
  const ws = workspaceStoreFor(app.kayrosContext);
  const gateway = app.kayrosContext.hybridGateway;
  const out = [];
  for (const { tenantId, item } of await ws.listAcross('graph_leases')) {
    await leaseLock(tenantId, item.session_id, async () => {
      const lease = await ws.get(tenantId, 'graph_leases', item.id);
      if (!lease) return;
      const alive = [];
      for (const id of lease.threads || []) {
        // Une mission vivante a une tâche dans ce processus (reprise comprise) ; sinon elle a été interrompue.
        if (gateway.jobs?.has?.(String(id))) alive.push(id);
      }
      if (alive.length) { await ws.update(tenantId, 'graph_leases', lease.id, { threads: alive }); return; }
      out.push({ tenantId, session_id: lease.session_id, ...await restoreLease(app, tenantId, lease) });
    });
  }
  return out;
}

async function savePipeline(app, tenantId, pipeline) {
  return workspaceStoreFor(app.kayrosContext).update(tenantId, 'pipelines', pipeline.id, pipeline);
}
function settle(pipeline) {
  const status = pipelineStatus(pipeline);
  const finished = ['completed', 'failed', 'cancelled'].includes(status) && !pipeline.steps.some((s) => s.status === 'running');
  return { ...pipeline, status, current: pipeline.steps.findIndex((s) => s.status === 'running'), finished_at: finished ? (pipeline.finished_at || new Date().toISOString()) : null };
}
/** Démarre une étape (mission sur la session du collectif, contexte de ses branches amont). Mute `pipeline`. */
async function startPipelineStep(app, tenantId, pipeline, project, step) {
  const node = (project?.graph?.nodes || []).find((n) => n.id === step.node_id);
  const gateway = app.kayrosContext.hybridGateway;
  const room = node ? await gateway.getRoom(step.session_id, { tenantId }) : null;
  if (!room) { Object.assign(step, { status: 'failed', error: 'session du collectif introuvable' }); return; }
  step.thread_id = makeThreadId();
  step.agents = await acquireGraphAgents(app, tenantId, project.graph, node, pipeline.created_by, step.thread_id);
  const attached = await collectiveAttachmentsContext(app, tenantId, room.room_id);
  const context = [`Session de harness « ${room.name} » · collectif ${room.swarm_id}`, chainContext(pipeline, project, step), attached].filter(Boolean).join('\n\n').slice(0, 24000);
  const profile = runProfile(app, pipeline.profile);
  Object.assign(step, { status: 'running', started_at: new Date().toISOString(), error: null });
  // Enregistré avant le lancement : la fin de mission (autre tâche) doit retrouver l'étape.
  await savePipeline(app, tenantId, settle(pipeline));
  try {
    const started = await gateway.startMessage({
      platform: 'console', room_id: room.room_id, tenantId, thread_id: step.thread_id,
      user_id: pipeline.created_sub, by: pipeline.created_by, explicit: true, text: pipeline.question, context,
      provider: profile.provider, model: profile.model || undefined, profile: profile.effective_profile,
      origin: 'pipeline', allowConcurrent: true,
    });
    step.run_id = started.run_id || null;
  } catch (error) {
    Object.assign(step, { status: 'failed', error: surface(error?.message || error) });
    await releaseGraphAgents(app, step.thread_id);
  }
}
/** Lance toutes les étapes prêtes (branches parallèles), puis enregistre l'état. À appeler sous verrou. */
async function startReadySteps(app, tenantId, pipeline) {
  const project = await workspaceStoreFor(app.kayrosContext).get(tenantId, 'projects', pipeline.project_id);
  for (const step of readySteps(pipeline)) {
    // Une branche en échec arrête le lancement des suivantes.
    if (pipelineStatus(pipeline) === 'failed') break;
    await startPipelineStep(app, tenantId, pipeline, project, step);
  }
  return savePipeline(app, tenantId, settle(pipeline));
}
/** Fin d'une mission : l'étape se termine ; les étapes devenues prêtes démarrent, ou l'enchaînement se bloque / attend un arbitrage / échoue. */
export async function advancePipelines(app, kind, thread) {
  if (!thread?.thread_id || !['completed', 'failed'].includes(kind)) return null;
  const tenantId = thread.tenant_id || 'default';
  const ws = workspaceStoreFor(app.kayrosContext);
  const candidate = (await ws.list(tenantId, 'pipelines')).find((p) => p.steps.some((s) => s.thread_id === thread.thread_id && s.status === 'running'));
  if (!candidate) return null;
  return withPipelineLock(candidate.id, async () => {
    const pipeline = await ws.get(tenantId, 'pipelines', candidate.id);
    const step = pipeline?.steps.find((s) => s.thread_id === thread.thread_id);
    if (!step || step.status !== 'running') return pipeline;
    const at = new Date().toISOString();
    step.finished_at = at;
    if (kind === 'failed') {
      Object.assign(step, { status: 'failed', error: thread.error?.message || thread.error || 'mission en échec' });
      return savePipeline(app, tenantId, settle(pipeline));
    }
    const project = await ws.get(tenantId, 'projects', pipeline.project_id);
    const outcome = stepOutcome(project?.graph, step.node_id, thread);
    Object.assign(step, { verdict: outcome.verdict, rationale: outcome.rationale, gates: outcome.results });
    if (outcome.status === 'blocked') {
      step.status = 'blocked';
      // Les branches sœurs en cours sont suspendues : leur résultat sera ignoré et elles repartiront à la levée de la porte.
      for (const other of pipeline.steps.filter((x) => x.status === 'running')) {
        Object.assign(other, { status: 'halted', halted: { by_gate_of: step.node_id, thread_id: other.thread_id, at } });
      }
    }
    else if (pipeline.steps.some((x) => (x.deps || []).includes(step.node_id)) && needsApproval(project?.graph, step.node_id, pipeline)) step.status = 'awaiting_approval';
    else step.status = 'completed';
    if (pipeline.status === 'cancelled') return savePipeline(app, tenantId, settle(pipeline));
    return startReadySteps(app, tenantId, pipeline);
  });
}

export default async function consoleRoute(app) {
  // Fin de mission asynchrone : les portes du graphe sont évaluées avant la diffusion de l'événement.
  const gateway = app.kayrosContext?.hybridGateway;
  if (gateway && !gateway.gatesWrapped) {
    const prior = gateway.eventSink;
    gateway.eventSink = async (kind, thread) => {
      let next = thread;
      if (kind === 'completed' && thread) next = await withGates(app, thread.tenant_id, thread);
      if (prior) await prior(kind, next);
      // Composition temporaire du graphe : rétablie à la fin de la mission.
      if (['completed', 'failed'].includes(kind) && thread?.thread_id) {
        try { await releaseGraphAgents(app, thread.thread_id); } catch (error) { app.log?.warn?.({ err: error?.message }, 'composition du collectif'); }
      }
      // Collectif suivant du graphe (après la diffusion de l'événement de cette mission).
      try { await advancePipelines(app, kind, next); } catch (error) { app.log?.warn?.({ err: error?.message }, 'enchaînement de collectifs'); }
    };
    gateway.gatesWrapped = true;
  }
  // Reprise : composition des collectifs rétablie si le serveur a redémarré en cours de mission.
  app.addHook('onReady', async () => {
    try { const restored = await recoverGraphLeases(app); if (restored.length) app.log?.info?.({ restored }, 'composition des collectifs rétablie'); } catch (error) { app.log?.warn?.({ err: error?.message }, 'reprise des baux de composition'); }
  });
  // --- Vue d'ensemble du harness -----------------------------------------
  app.get('/v1/console/overview', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const { engine } = app.kayrosContext;
    await engine.swarm.hydrateTenant?.(me.tenantId);
    const rooms = await accessibleRooms(app, me);
    const agents = engine.swarm.registry.list({ tenantId: me.tenantId }).map(agentView);
    const activity = await scopedActivity(app, me, { limit: 24 });
    const threads = await scopedThreads(app, me, { limit: 30 });
    const sessions = rooms.map((room) => sessionView(room, engine.swarm, me.tenantId, { threads }));
    return {
      user: { id: me.sub, email: me.email, role: me.role, tenantId: me.tenantId },
      summary: {
        // Tout agent doté d'un profil humain consenti (console, hybride, impersonator) : EF-29.
        hybrid_agents: agents.filter(hasConsentedHumanProfile).length,
        agents: agents.filter((agent) => agent.enabled !== false).length,
        sessions: sessions.length,
        executions: threads.length,
        impersonators: agents.filter((agent) => !!agent.metadata?.impersonator).length,
        // Une mission en cours ou en échec n'attend pas encore d'arbitrage.
        pending_human_decisions: threads.filter((thread) => !['resolved', 'running', 'failed'].includes(thread.status)).length,
        running_executions: threads.filter((thread) => thread.status === 'running').length,
      },
      connections: await connections(app, me.tenantId), sessions, agents, activity, threads,
      capabilities: { crystal_knows: app.kayrosContext.crystalKnowsConfigured === true, crystal_knows_api: app.kayrosContext.crystalKnowsApi || { version: 'v4', predictions: false }, max_custom_agents_per_session: MAX_CUSTOM_AGENTS_PER_SESSION, registry_promotion: { allowed: ['comex', 'admin'].includes(me.role), real_profiles: !sharedTenant(me.tenantId) }, encrypted_connector_storage: app.kayrosContext.connectorEncryptionConfigured === true, providers: ['mock', 'ollama', 'mistral', 'anthropic', 'nvidia'], connector_oauth: app.kayrosContext.connectorOAuthConfigured || { slack: false, discord: false, teams: false } },
    };
  });

  // --- Registre d'agents -------------------------------------------------
  app.get('/v1/console/agents', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    await app.kayrosContext.engine.swarm.hydrateTenant?.(me.tenantId);
    const agents = app.kayrosContext.engine.swarm.registry.list({ tenantId: me.tenantId })
      .filter((a) => !a.metadata?.literary && !String(a.agent_id || '').startsWith('auteur_'))
      .map(agentView);
    return { agents };
  });
  app.post('/v1/console/agents', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await manager(app, me, reply)) return;
    const parsed = agentCreateSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'agent invalide', issues: parsed.error.issues });
    try { const agent = app.kayrosContext.engine.swarm.createAgent(parsed.data, { tenantId: me.tenantId, by: me.email }); await app.kayrosContext.engine.swarm.flush?.(); return reply.code(201).send({ agent: agentView(agent) }); }
    catch (error) { return reply.code(/existant/.test(error.message) ? 409 : 400).send({ error: surface(error.message) }); }
  });
  app.patch('/v1/console/agents/:agentId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await manager(app, me, reply)) return;
    const parsed = agentPatchSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'modification agent invalide', issues: parsed.error.issues });
    try { const agent = app.kayrosContext.engine.swarm.updateAgent(req.params.agentId, parsed.data, { tenantId: me.tenantId, by: me.email }); await app.kayrosContext.engine.swarm.flush?.(); return { agent: agentView(agent) }; }
    catch (error) { return reply.code(/introuvable/.test(error.message) ? 404 : 400).send({ error: surface(error.message) }); }
  });
  app.post('/v1/console/agents/:agentId/crystal', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await manager(app, me, reply)) return;
    if (!app.kayrosContext.crystalKnowsConfigured) return reply.code(503).send({ error: 'Crystal Knows n’est pas configuré côté serveur' });
    const parsed = crystalImportSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'import Crystal invalide', issues: parsed.error.issues });
    try {
      const agent = await app.kayrosContext.engine.swarm.importAndAssignPersonality(req.params.agentId, { consent_confirmed: true, imports: [{ source: 'crystalknows', email: parsed.data.email, linkedin_url: parsed.data.linkedin_url }] }, { tenantId: me.tenantId, by: me.email });
      await app.kayrosContext.engine.swarm.flush?.(); return { agent: agentView(agent) };
    } catch (error) { return reply.code(400).send({ error: surface(error.message) }); }
  });
  // Profil humain d'un agent hybride : import Crystal/LinkedIn ou export autorisé.
  app.post('/v1/console/agents/:agentId/personality', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await manager(app, me, reply)) return;
    const parsed = personalityImportSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'import de profil invalide', issues: parsed.error.issues });
    try {
      const agent = await app.kayrosContext.engine.swarm.importAndAssignPersonality(req.params.agentId, parsed.data, { tenantId: me.tenantId, by: me.email });
      await app.kayrosContext.engine.swarm.flush?.(); return { agent: agentView(agent) };
    } catch (error) { return reply.code(400).send({ error: surface(error.message) }); }
  });
  // Profil humain fourni directement (saisie ou export de fichier), sans API tierce.
  app.put('/v1/console/agents/:agentId/human-profile', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await manager(app, me, reply)) return;
    const parsed = humanProfileSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'profil humain invalide', issues: parsed.error.issues });
    if (parsed.data?.consent_confirmed !== true) return reply.code(400).send({ error: 'consentement explicite requis pour un profil humain' });
    try {
      const agent = app.kayrosContext.engine.swarm.assignPersonality(req.params.agentId, parsed.data, { tenantId: me.tenantId, by: me.email });
      await app.kayrosContext.engine.swarm.flush?.(); return { agent: agentView(agent) };
    } catch (error) { return reply.code(/introuvable/.test(error.message) ? 404 : 400).send({ error: surface(error.message) }); }
  });

  // Aperçu d'un profil réel (Crystal Knows / export / DISC) : profil normalisé et
  // attributs d'agent proposés, sans rien enregistrer. L'appel à l'API Crystal
  // consomme des crédits du compte : réservé à comex/admin ; export et DISC restent ouverts.
  app.post('/v1/console/personality/preview', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = personalityPreviewSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'aperçu de profil invalide', issues: parsed.error.issues });
    const d = parsed.data;
    try {
      let profile;
      if (d.source === 'disc') {
        if (!normalizeDiscType(d.disc_type)) return reply.code(400).send({ error: 'type DISC invalide (ex. D, Di, Sc, C)' });
        profile = profileFromDiscType(d.disc_type, { assigned_name: d.assigned_name || null, imported_by: me.email });
      } else if (d.source === 'export') {
        if (!d.profile_data) return reply.code(400).send({ error: 'export JSON du profil requis' });
        profile = await app.kayrosContext.engine.swarm.previewPersonality({ consent_confirmed: true, imports: [{ source: 'crystalknows', profile_data: d.profile_data }] }, { by: me.email });
        if (d.assigned_name && !profile.assigned_name) profile.assigned_name = d.assigned_name;
      } else {
        if (!await manager(app, me, reply)) return;
        if (!app.kayrosContext.crystalKnowsConfigured) return reply.code(503).send({ error: 'Crystal Knows n’est pas configuré côté serveur (CRYSTALKNOWS_API_TOKEN). Utilisez l’import d’un export JSON ou la saisie DISC.' });
        if (!d.email && !d.linkedin_url && !d.full_name) return reply.code(400).send({ error: 'e-mail, URL LinkedIn ou nom complet requis' });
        profile = await app.kayrosContext.engine.swarm.previewPersonality({ consent_confirmed: true, imports: [{
          source: 'crystalknows', email: d.email, linkedin_url: d.linkedin_url, full_name: d.full_name, company_name: d.company_name, job_title: d.job_title,
        }] }, { by: me.email });
      }
      return { profile, agent: agentAttributesFromProfile(profile, { role: d.job_title || null, company: d.company_name || null }) };
    } catch (error) {
      const status = /crédits/.test(error.message) ? 402 : /aucun profil/.test(error.message) ? 404 : /limite de débit/.test(error.message) ? 429 : 400;
      return reply.code(status).send({ error: surface(error.message) });
    }
  });

  // --- Agents impersonateurs : persona reconstruite pour éprouver une idée ---
  app.post('/v1/console/impersonators', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await manager(app, me, reply)) return;
    const parsed = impersonatorSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'agent impersonateur invalide', issues: parsed.error.issues });
    const d = parsed.data;
    try {
      await app.kayrosContext.engine.swarm.hydrateTenant?.(me.tenantId);
      const { agent, impersonator, enrichment_error } = await buildImpersonatorAgent(app, me, d);
      await app.kayrosContext.engine.swarm.flush?.();
      return reply.code(201).send({ agent: agentView(agent), persona: personaClues(agent.human_profile), guardrails: impersonatorGuardrails(impersonator), enrichment_error });
    } catch (error) { return reply.code(/existant/.test(error.message) ? 409 : 400).send({ error: surface(error.message) }); }
  });

  // --- Équipe d'impersonators : panel de personas pour éprouver une idée ---
  app.post('/v1/console/impersonator-teams', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await manager(app, me, reply)) return;
    const parsed = impersonatorTeamSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'équipe impersonator invalide', issues: parsed.error.issues });
    const d = parsed.data;
    try {
      await app.kayrosContext.engine.swarm.hydrateTenant?.(me.tenantId);
      if (await ownedSessionCount(app, me) >= MAX_SESSIONS_PER_USER) {
        return reply.code(403).send({ error: `Limite de la version en ligne atteinte : ${MAX_SESSIONS_PER_USER} sessions maximum par utilisateur.` });
      }
      const created = []; const personas = []; const errors = [];
      for (const member of d.members) {
        try {
          const result = await buildImpersonatorAgent(app, me, { ...member, purpose: d.purpose, veto_power: d.veto_power === true });
          created.push(result.agent);
          personas.push({ agent_id: result.agent.agent_id, name: member.name, ...personaClues(result.agent.human_profile) });
          if (result.enrichment_error) errors.push({ member: member.name, error: result.enrichment_error });
        } catch (error) { errors.push({ member: member.name, error: surface(error.message) }); }
      }
      if (!created.length) return reply.code(400).send({ error: 'aucun agent impersonator créé', errors });
      const room = await app.kayrosContext.hybridGateway.createRoom({
        name: d.name, platform: 'console', external_room_id: makeSessionId(), mode: 'always',
        swarm_name: `${d.name} — panel de personas`,
        active_agents: created.map((agent) => agent.agent_id),
        voting_threshold: d.voting_threshold || 'majority',
        // Absent : activée par défaut, chaque persona portant un profil consenti (EF-28).
        personality_simulation_enabled: d.personality_simulation_enabled,
      }, { tenantId: me.tenantId, by: me.email, ownerId: me.sub });
      await app.kayrosContext.engine.swarm.flush?.();
      return reply.code(201).send({ session: sessionView(room, app.kayrosContext.engine.swarm, me.tenantId), agents: created.map(agentView), personas, errors });
    } catch (error) { return reply.code(/existant/.test(error.message) ? 409 : 400).send({ error: surface(error.message) }); }
  });

  // --- Connecteurs de canaux externes ------------------------------------
  app.get('/v1/console/connectors', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    return { connectors: await connections(app, me.tenantId), encrypted_storage: app.kayrosContext.connectorEncryptionConfigured === true };
  });
  app.put('/v1/console/connectors/:platform', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await manager(app, me, reply)) return;
    const parsed = connectorSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'configuration connecteur invalide', issues: parsed.error.issues });
    try {
      const connector = await app.kayrosContext.connectorConfig.configure(me.tenantId, req.params.platform, parsed.data);
      if (connector.enabled) { const adapter = await app.kayrosContext.connectorConfig.adapterFor(me.tenantId, req.params.platform); if (adapter) app.kayrosContext.hybridGateway.setTenantAdapter(me.tenantId, adapter); }
      return { connector };
    } catch (error) { return reply.code(400).send({ error: surface(error.message) }); }
  });
  app.patch('/v1/console/connectors/:platform', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await manager(app, me, reply)) return;
    const parsed = connectorStateSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'état connecteur invalide' });
    try {
      const connector = await app.kayrosContext.connectorConfig.setEnabled(me.tenantId, req.params.platform, parsed.data.enabled);
      if (connector.enabled) { const adapter = await app.kayrosContext.connectorConfig.adapterFor(me.tenantId, req.params.platform); if (adapter) app.kayrosContext.hybridGateway.setTenantAdapter(me.tenantId, adapter); }
      return { connector };
    } catch (error) { return reply.code(400).send({ error: surface(error.message) }); }
  });
  app.post('/v1/console/connectors/:platform/connect', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await manager(app, me, reply)) return;
    const platform = String(req.params.platform || '').toLowerCase();
    if (!['slack', 'discord', 'teams'].includes(platform)) return reply.code(404).send({ error: 'plateforme inconnue' });
    const oauth = app.kayrosContext.connectorOAuth;
    if (!oauth?.available(platform)) {
      return reply.code(409).send({ error: `Connexion simplifiée ${platform} indisponible : identifiants d’application côté serveur manquants.` });
    }
    if (!app.kayrosContext.publicApiUrl) return reply.code(409).send({ error: 'KAYROS_PUBLIC_API_URL requis pour la connexion simplifiée.' });
    const redirectUri = `${app.kayrosContext.publicApiUrl}/v1/connectors/${platform}/oauth/callback`;
    try {
      const started = oauth.start(platform, { tenantId: me.tenantId, redirectUri });
      return { platform, mode: started.mode, url: started.url, redirect_uri: redirectUri };
    } catch (error) { return reply.code(400).send({ error: surface(error.message) }); }
  });
  app.post('/v1/console/connectors/:platform/test', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await manager(app, me, reply)) return;
    try {
      const connector = await app.kayrosContext.connectorConfig.test(me.tenantId, req.params.platform);
      if (connector.ok && connector.enabled) { const adapter = await app.kayrosContext.connectorConfig.adapterFor(me.tenantId, req.params.platform); if (adapter) app.kayrosContext.hybridGateway.setTenantAdapter(me.tenantId, adapter); }
      return reply.code(connector.ok ? 200 : 502).send({ connector });
    } catch (error) { return reply.code(400).send({ error: surface(error.message) }); }
  });

  // --- Sessions de harness : collectifs exécutables ----------------------
  app.get('/v1/console/sessions', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    await app.kayrosContext.engine.swarm.hydrateTenant?.(me.tenantId);
    const rooms = await accessibleRooms(app, me);
    return { sessions: rooms.map((room) => sessionView(room, app.kayrosContext.engine.swarm, me.tenantId)) };
  });
  app.post('/v1/console/sessions', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await permitted(app, me, reply, 'run')) return;
    const parsed = sessionSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'session invalide', issues: parsed.error.issues });
    try {
      await app.kayrosContext.engine.swarm.hydrateTenant?.(me.tenantId);
      if (await ownedSessionCount(app, me) >= MAX_SESSIONS_PER_USER) {
        return reply.code(403).send({ error: `Limite de la version en ligne atteinte : ${MAX_SESSIONS_PER_USER} sessions maximum par utilisateur.` });
      }
      const custom = (parsed.data.custom_agents || []).map(sessionAgentDefinition);
      const active = [...(parsed.data.active_agents || []), ...custom.map((agent) => agent.agent_id)];
      if (active.length) {
        const agents = app.kayrosContext.engine.swarm.registry.list({ tenantId: me.tenantId });
        const built = agents.filter((agent) => active.includes(agent.agent_id) && !!agent.metadata?.literary).length;
        if (built > MAX_BUILT_AGENTS_PER_SESSION) {
          return reply.code(403).send({ error: `Limite de la version en ligne atteinte : ${MAX_BUILT_AGENTS_PER_SESSION} agents construits maximum par session.` });
        }
      }
      const room = await app.kayrosContext.hybridGateway.createRoom({
        name: parsed.data.name, platform: 'console', external_room_id: makeSessionId(), mode: 'always',
        swarm_name: parsed.data.swarm_name || parsed.data.name,
        active_agents: active.length ? active : undefined,
        voting_threshold: parsed.data.voting_threshold,
        personality_simulation_enabled: parsed.data.personality_simulation_enabled,
        agent_rule_overrides: sessionOverrides(parsed.data.agent_overrides),
        session_agents: custom,
      }, { tenantId: me.tenantId, by: me.email, ownerId: me.sub });
      await app.kayrosContext.engine.swarm.flush?.();
      return reply.code(201).send({ session: sessionView(room, app.kayrosContext.engine.swarm, me.tenantId) });
    } catch (error) { return reply.code(400).send({ error: surface(error.message) }); }
  });
  app.get('/v1/console/sessions/:sessionId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const room = await accessibleRoom(app, me, req.params.sessionId);
    if (!room) return reply.code(404).send({ error: 'session introuvable' });
    const threads = await app.kayrosContext.hybridGateway.listThreads({ tenantId: me.tenantId, roomId: room.room_id, limit: 100 });
    const activity = await app.kayrosContext.hybridGateway.activity({ tenantId: me.tenantId, roomId: room.room_id, limit: 100 });
    return { session: sessionView(room, app.kayrosContext.engine.swarm, me.tenantId, { threads }), activity };
  });
  app.patch('/v1/console/sessions/:sessionId/collective', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await permitted(app, me, reply, 'run')) return;
    const parsed = collectiveSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'collectif invalide', issues: parsed.error.issues });
    if (!await accessibleRoom(app, me, req.params.sessionId)) return reply.code(404).send({ error: 'session introuvable' });
    try {
      await app.kayrosContext.engine.swarm.hydrateTenant?.(me.tenantId);
      const room = await app.kayrosContext.hybridGateway.updateRoomAgents(req.params.sessionId, {
        addAgentIds: parsed.data.add_agent_ids, removeAgentIds: parsed.data.remove_agent_ids,
        addSessionAgents: parsed.data.add_custom_agents.map(sessionAgentDefinition),
        maxBuiltAgents: MAX_BUILT_AGENTS_PER_SESSION, tenantId: me.tenantId, by: me.email,
      });
      return { session: sessionView(room, app.kayrosContext.engine.swarm, me.tenantId) };
    } catch (error) {
      const shown = surface(error?.message || error);
      const status = /^(session introuvable|configuration de la session introuvable)$/.test(shown) ? 404
        : /Limite/.test(shown) ? 403 : 400;
      return reply.code(status).send({ error: shown });
    }
  });
  // Agent de session (composé, ajusté ou importé Crystal/DISC) → registre partagé du tenant.
  // Même droit que la création d'agent (comex/admin). Un profil réel exige un
  // consentement de partage explicite et reste interdit dans un tenant partagé.
  app.post('/v1/console/sessions/:sessionId/agents/:agentId/promote', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await manager(app, me, reply)) return;
    const parsed = promoteSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'enregistrement invalide', issues: parsed.error.issues });
    const room = await accessibleRoom(app, me, req.params.sessionId);
    if (!room) return reply.code(404).send({ error: 'session introuvable' });
    const swarm = app.kayrosContext.engine.swarm;
    await swarm.hydrateTenant?.(me.tenantId);
    const configuration = swarm.getConfiguration(room.swarm_id, { tenantId: me.tenantId });
    const source = configuration && swarm.effectiveConfigurationAgent(configuration, req.params.agentId, { tenantId: me.tenantId });
    if (!source || !configuration.active_agents?.includes(req.params.agentId)) return reply.code(404).send({ error: 'agent absent de la session' });
    const d = parsed.data;
    if (source.human_profile && d.include_human_profile) {
      if (sharedTenant(me.tenantId)) {
        return reply.code(403).send({ error: 'Ce registre est partagé par tous les comptes en libre-service : un profil réel n’y est pas publié. Enregistrez les seuls attributs (sans profil réel, sous un nom neutre) ou utilisez un espace dédié.', code: 'shared_tenant_real_profile' });
      }
      if (d.share_consent_confirmed !== true) {
        return reply.code(400).send({ error: 'Confirmez que la personne a consenti au partage de son profil avec tous les membres de l’espace.', code: 'share_consent_required' });
      }
    }
    try {
      const agent = swarm.promoteSessionAgent(room.swarm_id, req.params.agentId, d, { tenantId: me.tenantId, by: me.email });
      await swarm.flush?.();
      const updatedRoom = await accessibleRoom(app, me, req.params.sessionId);
      return reply.code(201).send({ agent: agentView(agent), session: sessionView(updatedRoom || room, swarm, me.tenantId) });
    } catch (error) {
      const shown = surface(error?.message || error);
      return reply.code(/existant|déjà dans le registre/.test(shown) ? 409 : 400).send({ error: shown });
    }
  });
  // Mission : par défaut asynchrone (202 + fil `running`, collectif exécuté en
  // tâche de fond, suivi par GET /threads/:id ou /sessions/:id). Un LLM lent
  // (≈75 s par agent) dépasserait sinon le délai du proxy (≈60 s) et la
  // mission ne serait pas enregistrée. `?wait=true` conserve le mode synchrone.
  app.post('/v1/console/sessions/:sessionId/run', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await permitted(app, me, reply, 'run')) return;
    const parsed = missionSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'mission invalide', issues: parsed.error.issues });
    const room = await accessibleRoom(app, me, req.params.sessionId);
    if (!room) return reply.code(404).send({ error: 'session introuvable' });
    const question = parsed.data.question || parsed.data.text;
    const baseContext = parsed.data.context || `Session de harness « ${room.name} » · collectif ${room.swarm_id}`;
    // Skills et sources de contexte rattachés au collectif (Bibliothèque).
    // Nœuds « agent » des graphes de projet reliés à ce collectif : composition appliquée avant la mission.
    // Composition temporaire : rétablie à la fin de cette mission (fil pré-attribué).
    const threadId = makeThreadId();
    for (const project of await workspaceStoreFor(app.kayrosContext).list(me.tenantId, 'projects')) {
      for (const node of (project.graph?.nodes || []).filter((n) => n.type === 'collectif' && n.config?.session_id === room.room_id)) {
        if (agentNodesFor(project.graph, node.id).add.length || agentNodesFor(project.graph, node.id).remove.length) {
          await acquireGraphAgents(app, me.tenantId, project.graph, node, me.email, threadId);
        }
      }
    }
    const attached = await collectiveAttachmentsContext(app, me.tenantId, room.room_id);
    const context = attached ? `${baseContext}\n\n${attached}`.slice(0, 24000) : baseContext;
    const profile = runProfile(app, parsed.data.profile);
    const input = {
      platform: 'console', room_id: room.room_id, tenantId: me.tenantId, thread_id: threadId,
      user_id: me.sub, by: me.email, explicit: true, text: question, context,
      provider: profile.provider, model: profile.model || undefined, profile: profile.effective_profile,
    };
    if (waitRequested(req)) {
      try {
        let result;
        try { result = await app.kayrosContext.hybridGateway.handleMessage(input); } finally { await releaseGraphAgents(app, threadId); }
        // `llm` expose le provider effectif des agents : un repli mock est visible (ENF-09).
        const thread = result.thread ? await withGates(app, me.tenantId, result.thread) : result.thread;
        return { session_id: room.room_id, run: result.run, thread, summary: result.summary, llm: result.run?.llm || null };
      } catch (error) { return reply.code(400).send({ error: surface(error.message) }); }
    }
    try {
      const started = await app.kayrosContext.hybridGateway.startMessage(input);
      const execution = executionView(started.thread, started.run_id);
      return reply.code(202).send({
        session_id: room.room_id, ...execution, profile: profile.effective_profile, eta_seconds: profile.eta_seconds,
        run: { run_id: started.run_id, status: 'running' }, thread: started.thread,
        poll: `/v1/console/threads/${encodeURIComponent(execution.thread_id)}`,
      });
    } catch (error) {
      await releaseGraphAgents(app, threadId);
      return reply.code(error?.code === 'RUN_IN_PROGRESS' ? 409 : 400).send({ error: surface(error.message) });
    }
  });

  // --- Enchaînement de collectifs (graphe de projet) ----------------------
  const pipelineSchema = z.object({ question: z.string().trim().min(3).max(4000), profile: z.enum(EXECUTION_PROFILES).optional(), pause_between: z.boolean().optional() });
  app.post('/v1/console/projects/:projectId/pipelines', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await permitted(app, me, reply, 'run')) return;
    const parsed = pipelineSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'question invalide (3 caractères minimum)', issues: parsed.error.issues });
    const ws = workspaceStoreFor(app.kayrosContext);
    const project = await ws.get(me.tenantId, 'projects', req.params.projectId);
    if (!project) return reply.code(404).send({ error: 'projet introuvable' });
    const nodes = pipelineSteps(project.graph);
    if (!nodes.length) return reply.code(400).send({ error: 'aucun collectif lié à une session dans le graphe', code: 'no_collective' });
    for (const node of nodes) {
      if (!await accessibleRoom(app, me, node.config.session_id)) return reply.code(404).send({ error: `session introuvable pour le collectif « ${node.label || node.id} »` });
    }
    if ((await ws.list(me.tenantId, 'pipelines', { project_id: project.id })).some((p) => !['completed', 'failed', 'cancelled'].includes(p.status))) {
      return reply.code(409).send({ error: 'un enchaînement est déjà en cours sur ce projet', code: 'pipeline_running' });
    }
    const created = await ws.create(me.tenantId, 'pipelines', {
      project_id: project.id, question: parsed.data.question, profile: parsed.data.profile || null,
      status: 'running', current: 0, created_sub: me.sub, pause_between: parsed.data.pause_between === true,
      steps: nodes.map((n) => ({ node_id: n.id, label: n.label || '', session_id: n.config.session_id, deps: stepDeps(project.graph, n.id), status: 'pending', thread_id: null, run_id: null, verdict: null })),
    }, { by: me.email });
    const pipeline = await withPipelineLock(created.id, () => startReadySteps(app, me.tenantId, created));
    return reply.code(202).send({ pipeline });
  });
  app.get('/v1/console/projects/:projectId/pipelines', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const items = await workspaceStoreFor(app.kayrosContext).list(me.tenantId, 'pipelines', { project_id: req.params.projectId });
    return { pipelines: items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 20) };
  });
  app.get('/v1/console/pipelines/:pipelineId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const pipeline = await workspaceStoreFor(app.kayrosContext).get(me.tenantId, 'pipelines', req.params.pipelineId);
    return pipeline ? { pipeline } : reply.code(404).send({ error: 'enchaînement introuvable' });
  });
  // Porte bloquée : un comex/admin lève la porte (motif obligatoire) et le collectif suivant démarre.
  app.post('/v1/console/pipelines/:pipelineId/resume', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await permitted(app, me, reply, 'arbitrate')) return;
    const justification = String(req.body?.justification || '').trim();
    if (justification.length < 3) return reply.code(400).send({ error: 'motif obligatoire (3 caractères minimum)', code: 'reason_required' });
    const ws = workspaceStoreFor(app.kayrosContext);
    const result = await withPipelineLock(req.params.pipelineId, async () => {
      const pipeline = await ws.get(me.tenantId, 'pipelines', req.params.pipelineId);
      if (!pipeline) return { code: 404, body: { error: 'enchaînement introuvable' } };
      const blocked = pipeline.steps.filter((s) => s.status === 'blocked');
      if (pipeline.status === 'cancelled' || !blocked.length) return { code: 409, body: { error: 'aucune porte bloquée sur cet enchaînement', code: 'not_blocked' } };
      const at = new Date().toISOString();
      for (const step of blocked) Object.assign(step, { status: 'overridden', override: { by: me.email, justification, at } });
      // Branches suspendues par le blocage : relancées depuis le début.
      for (const step of pipeline.steps.filter((x) => x.status === 'halted')) Object.assign(step, { status: 'pending', thread_id: null, run_id: null, verdict: null, rationale: null, gates: [] });
      return { code: 200, body: { pipeline: await startReadySteps(app, me.tenantId, pipeline) } };
    });
    return reply.code(result.code).send(result.body);
  });
  // Pause d'arbitrage : une porte passée attend une validation humaine avant les collectifs suivants.
  app.post('/v1/console/pipelines/:pipelineId/approve', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await permitted(app, me, reply, 'arbitrate')) return;
    const comment = String(req.body?.comment || '').trim().slice(0, 2000);
    const ws = workspaceStoreFor(app.kayrosContext);
    const result = await withPipelineLock(req.params.pipelineId, async () => {
      const pipeline = await ws.get(me.tenantId, 'pipelines', req.params.pipelineId);
      if (!pipeline) return { code: 404, body: { error: 'enchaînement introuvable' } };
      // Validation branche par branche (`node_id`), ou de toutes les étapes en attente sans `node_id`.
      const nodeId = req.body?.node_id ? String(req.body.node_id) : null;
      const waiting = pipeline.steps.filter((s) => s.status === 'awaiting_approval' && (!nodeId || s.node_id === nodeId));
      if (pipeline.status === 'cancelled' || !waiting.length) return { code: 409, body: { error: nodeId ? 'cette étape n’attend pas de validation' : 'aucune étape en attente de validation', code: 'not_awaiting' } };
      const at = new Date().toISOString();
      for (const step of waiting) Object.assign(step, { status: 'approved', approval: { by: me.email, comment: comment || null, at } });
      return { code: 200, body: { pipeline: await startReadySteps(app, me.tenantId, pipeline) } };
    });
    return reply.code(result.code).send(result.body);
  });
  app.post('/v1/console/pipelines/:pipelineId/cancel', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await permitted(app, me, reply, 'run')) return;
    const ws = workspaceStoreFor(app.kayrosContext);
    const pipeline = await ws.get(me.tenantId, 'pipelines', req.params.pipelineId);
    if (!pipeline) return reply.code(404).send({ error: 'enchaînement introuvable' });
    if (['completed', 'failed', 'cancelled'].includes(pipeline.status)) return { pipeline };
    const at = new Date().toISOString();
    // Les missions en cours sont détachées : leur résultat ne sera pas pris en compte.
    for (const step of pipeline.steps.filter((x) => x.status === 'running')) Object.assign(step, { status: 'halted', halted: { by_cancel: me.email, thread_id: step.thread_id, at } });
    return { pipeline: await savePipeline(app, me.tenantId, { ...pipeline, status: 'cancelled', finished_at: at, cancelled_by: me.email }) };
  });

  // --- Journal d'exécution du harness ------------------------------------
  app.get('/v1/console/activity', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const events = await scopedActivity(app, me, { roomId: req.query?.session_id || req.query?.room_id || null, after: req.query?.after || 0, limit: req.query?.limit || 100 });
    return events ? { events } : reply.code(404).send({ error: 'session introuvable' });
  });

  // --- Fils de décision + arbitrage humain -------------------------------
  app.get('/v1/console/threads', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const threads = await scopedThreads(app, me, { roomId: req.query?.session_id || req.query?.room_id || null, limit: req.query?.limit || 100 });
    if (!threads) return reply.code(404).send({ error: 'session introuvable' });
    return { threads: await Promise.all(threads.map((t) => withGates(app, me.tenantId, t))) };
  });
  app.get('/v1/console/threads/:threadId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const thread = await accessibleThread(app, me, req.params.threadId);
    return thread ? { thread: await withGates(app, me.tenantId, thread) } : reply.code(404).send({ error: 'fil introuvable' });
  });
  app.post('/v1/console/threads/:threadId/messages', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await permitted(app, me, reply, 'run')) return;
    const parsed = replySchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'réponse invalide', issues: parsed.error.issues });
    const existing = await accessibleThread(app, me, req.params.threadId);
    if (!existing) return reply.code(404).send({ error: 'fil introuvable' });
    // La relance garde le profil de la mission d'origine (un fil sans profil : configuration du serveur).
    const profile = existing.profile ? runProfile(app, existing.profile) : null;
    const options = { tenantId: me.tenantId, text: parsed.data.text, by: me.email, provider: profile?.provider || null, model: profile?.model || null };
    try {
      if (waitRequested(req)) {
        const thread = await app.kayrosContext.hybridGateway.continueThread(req.params.threadId, options);
        return reply.code(202).send({ thread });
      }
      // Relance asynchrone du collectif : même contrat que /run (fil `running`, polling).
      const started = await app.kayrosContext.hybridGateway.startContinueThread(req.params.threadId, options);
      return reply.code(202).send({ ...executionView(started.thread, started.run_id), thread: started.thread });
    } catch (error) { return reply.code(/introuvable/.test(error.message) ? 404 : 409).send({ error: surface(error.message) }); }
  });
  app.post('/v1/console/threads/:threadId/arbitrate', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await permitted(app, me, reply, 'arbitrate')) return;
    const parsed = arbitrationSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'arbitrage invalide', issues: parsed.error.issues });
    const current = await accessibleThread(app, me, req.params.threadId);
    if (!current) return reply.code(404).send({ error: 'fil introuvable' });
    // Une porte du graphe de projet bloquée interdit d'accepter un verdict favorable :
    // il faut le rejeter (réévaluation) ou passer outre avec une justification.
    const gated = await withGates(app, me.tenantId, current);
    const evaluation = gated?.gate_evaluation;
    if (evaluation?.status === 'blocked' && parsed.data.action === 'accept_consensus' && evaluation.consensus_verdict !== 'NO_GO') {
      const reasons = evaluation.results.filter((r) => r.status === 'blocked').flatMap((r) => r.reasons);
      return reply.code(409).send({ error: `porte du projet bloquante : ${reasons.join(' ; ')}. Demandez une réévaluation ou passez outre avec une justification.`, code: 'gate_blocked', gate_evaluation: evaluation });
    }
    try {
      const thread = await app.kayrosContext.hybridGateway.arbitrateThread(req.params.threadId, parsed.data, { tenantId: me.tenantId, by: me.email });
      // Les parties prenantes « informé » des projets concernés reçoivent la décision.
      try { const { notifyInformed } = await import('./console-workspace.mjs'); await notifyInformed(app, me.tenantId, thread, { by: me.email }); }
      catch (error) { app.log?.warn?.({ err: error }, 'notification des informés impossible'); }
      return { thread };
    }
    catch (error) { return reply.code(/introuvable/.test(error.message) ? 404 : 409).send({ error: surface(error.message) }); }
  });
}
