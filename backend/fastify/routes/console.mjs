import { z } from 'zod';
import { compileEffectiveAgentContext, resolveEffectiveRules } from '../../../core/swarm.mjs';
import { impersonatorAgentDefinition, personaClues, impersonatorGuardrails } from '../../../core/impersonator.mjs';

// La console est un harness d'agents : elle compose des collectifs, exécute des
// missions gouvernées et arbitre les verdicts. Les surfaces du produit de
// conversation dérivé n'apparaissent plus ici.

const sessionSchema = z.object({
  name: z.string().min(1).max(120),
  active_agents: z.array(z.string()).min(1).optional(),
  swarm_name: z.string().max(120).optional(),
  voting_threshold: z.enum(['unanimous', 'majority', 'veto_power_csuite']).optional(),
  personality_simulation_enabled: z.boolean().optional(),
});
const missionSchema = z.object({ question: z.string().min(1).max(12000), text: z.string().min(1).max(12000).optional(), context: z.string().max(24000).optional() });
const ruleConfigurationSchema = z.object({
  system_proposed_rules: z.array(z.object({ rule_id: z.string().min(1).max(120), rule_text: z.string().min(1).max(2000), status: z.enum(['active', 'overridden', 'disabled']).optional() })).optional(),
  user_added_rules: z.array(z.union([z.string().min(1).max(2000), z.object({ rule_id: z.string().max(120).optional(), rule_text: z.string().min(1).max(2000) })])).optional(),
  user_modified_rules: z.array(z.object({ replaces_rule_id: z.string().min(1).max(120), modified_text: z.string().min(1).max(2000) })).optional(),
}).optional();
const humanProfileSchema = z.object({
  assigned_name: z.string().max(200).optional(), linkedin_url: z.string().max(1000).optional(), crystalknows_report_url: z.string().max(1000).optional(),
  disc_type: z.string().max(80).optional(), enneagram_type: z.string().max(80).optional(), myers_briggs_type: z.string().max(80).optional(),
  behavioral_archetype: z.string().max(160).optional(), core_motivators: z.array(z.string().max(500)).max(30).optional(),
  skepticism_factor: z.string().max(500).optional(), profile_summary: z.array(z.string().max(1000)).max(30).optional(),
  professional_context: z.object({ headline: z.string().max(500).optional(), current_role: z.string().max(300).optional(), company: z.string().max(300).optional(), location: z.string().max(300).optional(), skills: z.array(z.string().max(300)).max(100).optional(), qualities: z.array(z.string().max(300)).max(100).optional() }).optional(),
  communication_style: z.object({ tone: z.string().max(160).optional(), preferred_format: z.string().max(300).optional(), decision_triggers: z.array(z.string().max(500)).max(30).optional(), stress_triggers: z.array(z.string().max(500)).max(30).optional(), objection_patterns: z.array(z.string().max(500)).max(30).optional(), communication_directives: z.array(z.string().max(500)).max(30).optional() }).optional(),
  consent_confirmed: z.boolean().optional(),
}).optional();
const personalityImportSchema = z.object({
  consent_confirmed: z.literal(true),
  imports: z.array(z.object({
    source: z.enum(['linkedin', 'crystalknows']),
    profile_url: z.string().max(1000).optional(), linkedin_url: z.string().max(1000).optional(),
    email: z.string().email().max(320).optional(), profile_data: z.record(z.string(), z.unknown()).optional(),
  })).max(4).optional().default([]),
  manual_profile: humanProfileSchema,
}).refine((value) => value.imports.length > 0 || !!value.manual_profile, { message: 'au moins un import ou un profil manuel requis' });
const agentFields = {
  agent_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/), display_name: z.string().min(1).max(160).optional(),
  role_name: z.string().min(1).max(160), department: z.string().min(1).max(160),
  seniority: z.enum(['intern', 'junior', 'senior', 'executive']), primary_focus: z.string().min(1).max(4000),
  mission: z.string().min(1).max(4000).optional(), instructions: z.string().max(12000).optional(),
  constraints: z.array(z.string().min(1).max(1000)).max(50).optional(), provider: z.enum(['mock', 'ollama', 'mistral', 'anthropic']).nullable().optional(),
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
}).refine((value) => value.add_agent_ids.length > 0 || value.remove_agent_ids.length > 0, { message: 'aucun changement de collectif demandé' });
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
  consent_confirmed: z.literal(true),
});

// Limites de la version en ligne (surchargeables par environnement).
const MAX_SESSIONS_PER_USER = Number(process.env.KAYROS_MAX_SESSIONS_PER_USER || process.env.KAYROS_MAX_ROOMS_PER_USER || 3);
const MAX_BUILT_AGENTS_PER_SESSION = Number(process.env.KAYROS_MAX_BUILT_AGENTS_PER_SESSION || process.env.KAYROS_MAX_BUILT_AGENTS_PER_ROOM || 3);

function agentView(agent) { return { ...agent, effective_rules: resolveEffectiveRules(agent), effective_context: compileEffectiveAgentContext(agent) }; }
function manager(me, reply) { if (['comex', 'admin'].includes(me.role)) return true; reply.code(403).send({ error: 'rôle comex ou admin requis' }); return false; }
// La console ne doit jamais exposer le vocabulaire d'une application tierce.
function surface(message) {
  return String(message || '')
    .replace(/du salons?/gi, 'de la session')
    .replace(/salons/gi, 'sessions')
    .replace(/salon/gi, 'session');
}
function makeSessionId() { return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

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
    agents: active.map((id) => swarm.registry.get(id, { tenantId })).filter(Boolean).map((agent) => ({
      agent_id: agent.agent_id, role_name: agent.role_name, display_name: agent.display_name || agent.role_name,
      department: agent.department, tools: agent.tools || [], provider: agent.provider || null, model: agent.model || null,
      veto_power: agent.veto_power === true, hybrid: !!agent.human_profile, impersonator: !!agent.metadata?.impersonator,
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

export default async function consoleRoute(app) {
  // --- Vue d'ensemble du harness -----------------------------------------
  app.get('/v1/console/overview', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const { hybridGateway, engine } = app.kayrosContext;
    await engine.swarm.hydrateTenant?.(me.tenantId);
    const rooms = await hybridGateway.listRooms({ tenantId: me.tenantId, platform: 'console' });
    const agents = engine.swarm.registry.list({ tenantId: me.tenantId }).map(agentView);
    const activity = await hybridGateway.activity({ tenantId: me.tenantId, limit: 24 });
    const threads = await hybridGateway.listThreads({ tenantId: me.tenantId, limit: 30 });
    const sessions = rooms.map((room) => sessionView(room, engine.swarm, me.tenantId, { threads }));
    return {
      user: { id: me.sub, email: me.email, role: me.role, tenantId: me.tenantId },
      summary: {
        hybrid_agents: agents.filter((agent) => agent.agent_type === 'hybrid_modified').length,
        agents: agents.filter((agent) => agent.enabled !== false).length,
        sessions: sessions.length,
        executions: threads.length,
        impersonators: agents.filter((agent) => !!agent.metadata?.impersonator).length,
        pending_human_decisions: threads.filter((thread) => thread.status !== 'resolved').length,
      },
      connections: await connections(app, me.tenantId), sessions, agents, activity, threads,
      capabilities: { crystal_knows: app.kayrosContext.crystalKnowsConfigured === true, encrypted_connector_storage: app.kayrosContext.connectorEncryptionConfigured === true, providers: ['mock', 'ollama', 'mistral', 'anthropic'], connector_oauth: app.kayrosContext.connectorOAuthConfigured || { slack: false, discord: false, teams: false } },
    };
  });

  // --- Registre d'agents -------------------------------------------------
  app.get('/v1/console/agents', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    await app.kayrosContext.engine.swarm.hydrateTenant?.(me.tenantId);
    return { agents: app.kayrosContext.engine.swarm.registry.list({ tenantId: me.tenantId }).map(agentView) };
  });
  app.post('/v1/console/agents', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    const parsed = agentCreateSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'agent invalide', issues: parsed.error.issues });
    try { const agent = app.kayrosContext.engine.swarm.createAgent(parsed.data, { tenantId: me.tenantId, by: me.email }); await app.kayrosContext.engine.swarm.flush?.(); return reply.code(201).send({ agent: agentView(agent) }); }
    catch (error) { return reply.code(/existant/.test(error.message) ? 409 : 400).send({ error: surface(error.message) }); }
  });
  app.patch('/v1/console/agents/:agentId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    const parsed = agentPatchSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'modification agent invalide', issues: parsed.error.issues });
    try { const agent = app.kayrosContext.engine.swarm.updateAgent(req.params.agentId, parsed.data, { tenantId: me.tenantId, by: me.email }); await app.kayrosContext.engine.swarm.flush?.(); return { agent: agentView(agent) }; }
    catch (error) { return reply.code(/introuvable/.test(error.message) ? 404 : 400).send({ error: surface(error.message) }); }
  });
  app.post('/v1/console/agents/:agentId/crystal', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    if (!app.kayrosContext.crystalKnowsConfigured) return reply.code(503).send({ error: 'Crystal Knows n’est pas configuré côté serveur' });
    const parsed = crystalImportSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'import Crystal invalide', issues: parsed.error.issues });
    try {
      const agent = await app.kayrosContext.engine.swarm.importAndAssignPersonality(req.params.agentId, { consent_confirmed: true, imports: [{ source: 'crystalknows', email: parsed.data.email, linkedin_url: parsed.data.linkedin_url }] }, { tenantId: me.tenantId, by: me.email });
      await app.kayrosContext.engine.swarm.flush?.(); return { agent: agentView(agent) };
    } catch (error) { return reply.code(400).send({ error: surface(error.message) }); }
  });
  // Profil humain d'un agent hybride : import Crystal/LinkedIn ou export autorisé.
  app.post('/v1/console/agents/:agentId/personality', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    const parsed = personalityImportSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'import de profil invalide', issues: parsed.error.issues });
    try {
      const agent = await app.kayrosContext.engine.swarm.importAndAssignPersonality(req.params.agentId, parsed.data, { tenantId: me.tenantId, by: me.email });
      await app.kayrosContext.engine.swarm.flush?.(); return { agent: agentView(agent) };
    } catch (error) { return reply.code(400).send({ error: surface(error.message) }); }
  });
  // Profil humain fourni directement (saisie ou export de fichier), sans API tierce.
  app.put('/v1/console/agents/:agentId/human-profile', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    const parsed = humanProfileSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'profil humain invalide', issues: parsed.error.issues });
    if (parsed.data?.consent_confirmed !== true) return reply.code(400).send({ error: 'consentement explicite requis pour un profil humain' });
    try {
      const agent = app.kayrosContext.engine.swarm.assignPersonality(req.params.agentId, parsed.data, { tenantId: me.tenantId, by: me.email });
      await app.kayrosContext.engine.swarm.flush?.(); return { agent: agentView(agent) };
    } catch (error) { return reply.code(/introuvable/.test(error.message) ? 404 : 400).send({ error: surface(error.message) }); }
  });

  // --- Agents impersonateurs : persona reconstruite pour éprouver une idée ---
  app.post('/v1/console/impersonators', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
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
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    const parsed = impersonatorTeamSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'équipe impersonator invalide', issues: parsed.error.issues });
    const d = parsed.data;
    try {
      await app.kayrosContext.engine.swarm.hydrateTenant?.(me.tenantId);
      const existing = await app.kayrosContext.hybridGateway.listRooms({ tenantId: me.tenantId, platform: 'console' });
      if (existing.length >= MAX_SESSIONS_PER_USER) {
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
      }, { tenantId: me.tenantId, by: me.email });
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
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    const parsed = connectorSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'configuration connecteur invalide', issues: parsed.error.issues });
    try {
      const connector = await app.kayrosContext.connectorConfig.configure(me.tenantId, req.params.platform, parsed.data);
      if (connector.enabled) { const adapter = await app.kayrosContext.connectorConfig.adapterFor(me.tenantId, req.params.platform); if (adapter) app.kayrosContext.hybridGateway.setTenantAdapter(me.tenantId, adapter); }
      return { connector };
    } catch (error) { return reply.code(400).send({ error: surface(error.message) }); }
  });
  app.patch('/v1/console/connectors/:platform', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    const parsed = connectorStateSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'état connecteur invalide' });
    try {
      const connector = await app.kayrosContext.connectorConfig.setEnabled(me.tenantId, req.params.platform, parsed.data.enabled);
      if (connector.enabled) { const adapter = await app.kayrosContext.connectorConfig.adapterFor(me.tenantId, req.params.platform); if (adapter) app.kayrosContext.hybridGateway.setTenantAdapter(me.tenantId, adapter); }
      return { connector };
    } catch (error) { return reply.code(400).send({ error: surface(error.message) }); }
  });
  app.post('/v1/console/connectors/:platform/connect', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
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
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
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
    const rooms = await app.kayrosContext.hybridGateway.listRooms({ tenantId: me.tenantId, platform: 'console' });
    return { sessions: rooms.map((room) => sessionView(room, app.kayrosContext.engine.swarm, me.tenantId)) };
  });
  app.post('/v1/console/sessions', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = sessionSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'session invalide', issues: parsed.error.issues });
    try {
      await app.kayrosContext.engine.swarm.hydrateTenant?.(me.tenantId);
      const existing = await app.kayrosContext.hybridGateway.listRooms({ tenantId: me.tenantId, platform: 'console' });
      if (existing.length >= MAX_SESSIONS_PER_USER) {
        return reply.code(403).send({ error: `Limite de la version en ligne atteinte : ${MAX_SESSIONS_PER_USER} sessions maximum par utilisateur.` });
      }
      const active = parsed.data.active_agents || [];
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
      }, { tenantId: me.tenantId, by: me.email });
      await app.kayrosContext.engine.swarm.flush?.();
      return reply.code(201).send({ session: sessionView(room, app.kayrosContext.engine.swarm, me.tenantId) });
    } catch (error) { return reply.code(400).send({ error: surface(error.message) }); }
  });
  app.get('/v1/console/sessions/:sessionId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const room = await app.kayrosContext.hybridGateway.getRoom(req.params.sessionId, { tenantId: me.tenantId });
    if (!room) return reply.code(404).send({ error: 'session introuvable' });
    const threads = await app.kayrosContext.hybridGateway.listThreads({ tenantId: me.tenantId, roomId: room.room_id, limit: 100 });
    const activity = await app.kayrosContext.hybridGateway.activity({ tenantId: me.tenantId, roomId: room.room_id, limit: 100 });
    return { session: sessionView(room, app.kayrosContext.engine.swarm, me.tenantId, { threads }), activity };
  });
  app.patch('/v1/console/sessions/:sessionId/collective', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = collectiveSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'collectif invalide', issues: parsed.error.issues });
    try {
      await app.kayrosContext.engine.swarm.hydrateTenant?.(me.tenantId);
      const room = await app.kayrosContext.hybridGateway.updateRoomAgents(req.params.sessionId, {
        addAgentIds: parsed.data.add_agent_ids, removeAgentIds: parsed.data.remove_agent_ids,
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
  app.post('/v1/console/sessions/:sessionId/run', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = missionSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'mission invalide', issues: parsed.error.issues });
    const room = await app.kayrosContext.hybridGateway.getRoom(req.params.sessionId, { tenantId: me.tenantId });
    if (!room) return reply.code(404).send({ error: 'session introuvable' });
    const question = parsed.data.question || parsed.data.text;
    const context = parsed.data.context || `Session de harness « ${room.name} » · collectif ${room.swarm_id}`;
    try {
      const result = await app.kayrosContext.hybridGateway.handleMessage({
        platform: 'console', room_id: room.room_id, tenantId: me.tenantId,
        user_id: me.sub, by: me.email, explicit: true, text: question, context,
      });
      return { session_id: room.room_id, run: result.run, thread: result.thread, summary: result.summary };
    } catch (error) { return reply.code(400).send({ error: surface(error.message) }); }
  });

  // --- Journal d'exécution du harness ------------------------------------
  app.get('/v1/console/activity', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    return { events: await app.kayrosContext.hybridGateway.activity({ tenantId: me.tenantId, roomId: req.query?.session_id || req.query?.room_id || null, after: req.query?.after || 0, limit: req.query?.limit || 100 }) };
  });

  // --- Fils de décision + arbitrage humain -------------------------------
  app.get('/v1/console/threads', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    return { threads: await app.kayrosContext.hybridGateway.listThreads({ tenantId: me.tenantId, roomId: req.query?.session_id || req.query?.room_id || null, limit: req.query?.limit || 100 }) };
  });
  app.get('/v1/console/threads/:threadId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const thread = await app.kayrosContext.hybridGateway.getThread(req.params.threadId, { tenantId: me.tenantId });
    return thread ? { thread } : reply.code(404).send({ error: 'fil introuvable' });
  });
  app.post('/v1/console/threads/:threadId/messages', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = replySchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'réponse invalide', issues: parsed.error.issues });
    try { const thread = await app.kayrosContext.hybridGateway.continueThread(req.params.threadId, { tenantId: me.tenantId, text: parsed.data.text, by: me.email }); return reply.code(202).send({ thread }); }
    catch (error) { return reply.code(/introuvable/.test(error.message) ? 404 : 409).send({ error: surface(error.message) }); }
  });
  app.post('/v1/console/threads/:threadId/arbitrate', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    const parsed = arbitrationSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'arbitrage invalide', issues: parsed.error.issues });
    try { const thread = await app.kayrosContext.hybridGateway.arbitrateThread(req.params.threadId, parsed.data, { tenantId: me.tenantId, by: me.email }); return { thread }; }
    catch (error) { return reply.code(/introuvable/.test(error.message) ? 404 : 409).send({ error: surface(error.message) }); }
  });
}
