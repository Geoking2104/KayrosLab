import { z } from 'zod';
import {
  compileEffectiveAgentContext,
  renderSwarmDossierMarkdown,
  resolveEffectiveRules,
} from '../../../core/swarm.mjs';

const ruleConfigurationSchema = z.object({
  system_proposed_rules: z.array(z.object({
    rule_id: z.string().min(1), rule_text: z.string().min(1),
    status: z.enum(['active', 'overridden', 'disabled']).optional(),
  })).optional(),
  user_added_rules: z.array(z.union([
    z.string().min(1),
    z.object({ rule_id: z.string().min(1).optional(), rule_text: z.string().min(1) }),
  ])).optional(),
  user_modified_rules: z.array(z.object({
    replaces_rule_id: z.string().min(1), modified_text: z.string().min(1),
  })).optional(),
}).optional();

const communicationStyleSchema = z.object({
  tone: z.string().max(160).optional(),
  preferred_format: z.string().max(300).optional(),
  decision_triggers: z.array(z.string().max(500)).max(30).optional(),
  stress_triggers: z.array(z.string().max(500)).max(30).optional(),
  objection_patterns: z.array(z.string().max(500)).max(30).optional(),
  communication_directives: z.array(z.string().max(500)).max(30).optional(),
}).optional();

const humanProfileSchema = z.object({
  assigned_name: z.string().min(1).max(200).optional(),
  linkedin_url: z.string().max(1000).optional(),
  crystalknows_report_url: z.string().max(1000).optional(),
  disc_type: z.string().max(80).optional(),
  enneagram_type: z.string().max(80).optional(),
  myers_briggs_type: z.string().max(80).optional(),
  behavioral_archetype: z.string().max(160).optional(),
  core_motivators: z.array(z.string().max(500)).max(30).optional(),
  skepticism_factor: z.string().max(500).optional(),
  profile_summary: z.array(z.string().max(1000)).max(30).optional(),
  professional_context: z.object({
    headline: z.string().max(500).optional(), current_role: z.string().max(300).optional(),
    company: z.string().max(300).optional(), location: z.string().max(300).optional(),
    skills: z.array(z.string().max(300)).max(100).optional(),
    qualities: z.array(z.string().max(300)).max(100).optional(),
  }).optional(),
  communication_style: communicationStyleSchema,
  consent_confirmed: z.boolean().optional(),
}).optional();

const agentSchema = z.object({
  agent_id: z.string().min(2).max(64),
  role_name: z.string().min(1).max(160),
  department: z.string().min(1).max(160),
  seniority: z.enum(['intern', 'junior', 'senior', 'executive']),
  primary_focus: z.string().min(1).max(2000),
  veto_power: z.boolean().optional(),
  human_profile: humanProfileSchema,
  rule_configuration: ruleConfigurationSchema,
  tenantId: z.string().max(128).optional(),
});

const rulePatchSchema = z.object({
  disabled_rules: z.array(z.string().min(1)).optional(),
  modified_rules: z.union([
    z.record(z.string(), z.string().min(1)),
    z.array(z.object({ replaces_rule_id: z.string().min(1), modified_text: z.string().min(1) })),
  ]).optional(),
  added_rules: z.array(z.union([
    z.string().min(1),
    z.object({ rule_id: z.string().min(1).optional(), rule_text: z.string().min(1) }),
  ])).optional(),
  human_profile: humanProfileSchema,
  assigned_human: z.string().max(200).optional(),
  linkedin_profile: z.string().max(1000).optional(),
  crystalknows_url: z.string().max(1000).optional(),
  disc_type: z.string().max(80).optional(),
  consent_confirmed: z.boolean().optional(),
  tenantId: z.string().max(128).optional(),
});

const configurationSchema = z.object({
  swarm_id: z.string().min(1).max(128).optional(),
  swarm_name: z.string().min(1).max(300),
  active_agents: z.array(z.string().min(1)).min(1),
  voting_threshold: z.enum(['unanimous', 'majority', 'veto_power_csuite']),
  personality_simulation_enabled: z.boolean().optional().default(false),
  agent_rule_overrides: z.record(z.string(), rulePatchSchema.omit({ tenantId: true })).optional(),
  tenantId: z.string().max(128).optional(),
});

const personalityImportSchema = z.object({
  consent_confirmed: z.literal(true),
  imports: z.array(z.object({
    source: z.enum(['linkedin', 'crystalknows']),
    profile_url: z.string().max(1000).optional(),
    linkedin_url: z.string().max(1000).optional(),
    email: z.string().email().max(320).optional(),
    profile_data: z.record(z.string(), z.unknown()).optional(),
  })).max(4).optional().default([]),
  manual_profile: humanProfileSchema,
}).refine((value) => value.imports.length > 0 || !!value.manual_profile, {
  message: 'au moins un import ou manual_profile requis',
});

const runSchema = z.object({
  question: z.string().min(1).max(12000),
  context: z.string().max(100000).optional(),
  provider: z.string().max(80).optional(),
  sovereignty: z.string().max(80).optional(),
  model: z.string().max(160).optional(),
  tenantId: z.string().max(128).optional(),
});

const arbitrationSchema = z.object({
  action: z.enum(['accept_consensus', 'override_veto', 'reevaluate']),
  justification: z.string().max(4000).optional(),
  decision: z.enum(['GO', 'CONDITIONAL_GO']).optional(),
  by: z.string().min(1).max(160).optional(),
  tenantId: z.string().max(128).optional(),
});

async function sessionFor(app, req) {
  const auth = app.kayrosContext?.auth;
  const header = req.headers.authorization || '';
  if (!auth || !header.startsWith('Bearer ')) return null;
  try { return await auth.verify(header.slice(7)); } catch { return null; }
}

async function actorScope(app, req, body = {}) {
  const session = req.swarmSession || await sessionFor(app, req);
  return {
    tenantId: session?.tenantId || body.tenantId || req.query?.tenantId || null,
    by: session?.sub || body.by || null,
  };
}

function serviceFor(app, reply) {
  const service = app.kayrosContext?.engine?.swarm;
  if (!service) reply.code(503).send({ error: 'swarm service non disponible' });
  return service;
}

function fail(reply, error, status = 400) {
  return reply.code(status).send({ error: String(error?.message || error) });
}

export default async function swarmRoutes(app) {
  // Swarm definitions, evidence and verdicts are tenant data. Unlike public
  // demos, no swarm endpoint may derive its tenant from a caller-provided body.
  app.addHook('preHandler', async (req, reply) => {
    const session = await sessionFor(app, req);
    if (!session?.sub) return reply.code(401).send({ error: 'session humaine authentifiée requise' });
    req.swarmSession = session;
    await app.kayrosContext?.engine?.swarm?.hydrateTenant?.(session.tenantId || null);
  });

  app.get('/v1/swarm/agents', async (req, reply) => {
    const service = serviceFor(app, reply); if (!service) return reply;
    const scope = await actorScope(app, req);
    return {
      agents: service.registry.list(scope).map((agent) => ({
        ...agent,
        effective_rules: resolveEffectiveRules(agent),
        effective_context: compileEffectiveAgentContext(agent),
      })),
    };
  });

  app.post('/v1/swarm/agents', async (req, reply) => {
    const parsed = agentSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'agent invalide', issues: parsed.error.issues });
    const service = serviceFor(app, reply); if (!service) return reply;
    const scope = await actorScope(app, req, parsed.data);
    try {
      const agent = service.createAgent(parsed.data, scope);
      await service.flush?.();
      return reply.code(201).send(agent);
    }
    catch (error) { return fail(reply, error, /existant/.test(error.message) ? 409 : 400); }
  });

  app.patch('/v1/swarm/agents/:agentId/rules', async (req, reply) => {
    const parsed = rulePatchSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'override invalide', issues: parsed.error.issues });
    const service = serviceFor(app, reply); if (!service) return reply;
    const scope = await actorScope(app, req, parsed.data);
    try {
      const agent = service.updateAgentRules(req.params.agentId, parsed.data, scope);
      await service.flush?.();
      return agent;
    }
    catch (error) { return fail(reply, error, /introuvable/.test(error.message) ? 404 : 400); }
  });

  app.post('/v1/swarm/agents/:agentId/personality/import', async (req, reply) => {
    const parsed = personalityImportSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'import de personnalité invalide', issues: parsed.error.issues });
    const service = serviceFor(app, reply); if (!service) return reply;
    const scope = await actorScope(app, req, parsed.data);
    try {
      const agent = await service.importAndAssignPersonality(req.params.agentId, parsed.data, scope);
      await service.flush?.();
      return reply.code(201).send(agent);
    } catch (error) {
      return fail(reply, error, /introuvable/.test(error.message) ? 404 : 400);
    }
  });

  app.post('/v1/swarm/configurations', async (req, reply) => {
    const parsed = configurationSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'configuration invalide', issues: parsed.error.issues });
    const service = serviceFor(app, reply); if (!service) return reply;
    const scope = await actorScope(app, req, parsed.data);
    try {
      const configuration = service.createConfiguration(parsed.data, scope);
      await service.flush?.();
      return reply.code(201).send(configuration);
    }
    catch (error) { return fail(reply, error); }
  });

  app.get('/v1/swarm/configurations/:swarmId', async (req, reply) => {
    const service = serviceFor(app, reply); if (!service) return reply;
    const scope = await actorScope(app, req);
    const config = service.getConfiguration(req.params.swarmId, scope);
    return config || reply.code(404).send({ error: 'swarm introuvable' });
  });

  app.post('/v1/swarm/configurations/:swarmId/run', async (req, reply) => {
    const parsed = runSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'requête swarm invalide', issues: parsed.error.issues });
    const service = serviceFor(app, reply); if (!service) return reply;
    const scope = await actorScope(app, req, parsed.data);
    try {
      const run = await service.run(req.params.swarmId, { ...parsed.data, ...scope });
      return reply.code(202).send(run);
    } catch (error) { return fail(reply, error, /introuvable/.test(error.message) ? 404 : 502); }
  });

  app.get('/v1/swarm/runs/:runId', async (req, reply) => {
    const service = serviceFor(app, reply); if (!service) return reply;
    const scope = await actorScope(app, req);
    const run = service.getRun(req.params.runId, scope);
    return run || reply.code(404).send({ error: 'run introuvable' });
  });

  app.get('/v1/swarm/runs/:runId/dossier', async (req, reply) => {
    const service = serviceFor(app, reply); if (!service) return reply;
    const scope = await actorScope(app, req);
    const run = service.getRun(req.params.runId, scope);
    if (!run) return reply.code(404).send({ error: 'run introuvable' });
    return reply.type('text/markdown; charset=utf-8').send(renderSwarmDossierMarkdown(run));
  });

  app.post('/v1/swarm/runs/:runId/arbitrate', async (req, reply) => {
    const parsed = arbitrationSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'arbitrage invalide', issues: parsed.error.issues });
    const service = serviceFor(app, reply); if (!service) return reply;
    const session = req.swarmSession;
    if (!session?.sub) return reply.code(401).send({ error: 'session humaine authentifiée requise' });
    if (session.role !== 'comex') return reply.code(403).send({ error: 'rôle comex requis pour arbitrer un swarm' });
    const scope = { tenantId: session.tenantId || null, by: session.sub };
    try {
      const run = service.arbitrate(req.params.runId, { ...parsed.data, ...scope });
      await service.flush?.();
      return run;
    }
    catch (error) { return fail(reply, error, /introuvable/.test(error.message) ? 404 : 409); }
  });
}
