import { z } from 'zod';
import { compileEffectiveAgentContext, resolveEffectiveRules } from '../../../core/swarm.mjs';

const roomSchema = z.object({
  name: z.string().min(1).max(120), platform: z.enum(['slack', 'discord', 'teams', 'console']),
  external_room_id: z.string().min(1).max(240), mode: z.enum(['mention_only', 'always']).optional(),
  swarm_id: z.string().optional(), active_agents: z.array(z.string()).min(1).optional(),
  swarm_name: z.string().max(120).optional(),
  voting_threshold: z.enum(['unanimous', 'majority', 'veto_power_csuite']).optional(),
  personality_simulation_enabled: z.boolean().optional(),
});
const messageSchema = z.object({ text: z.string().min(1).max(12000), message_id: z.string().max(240).optional(), context: z.string().max(24000).optional() });
const ruleConfigurationSchema = z.object({
  system_proposed_rules: z.array(z.object({ rule_id: z.string().min(1).max(120), rule_text: z.string().min(1).max(2000), status: z.enum(['active', 'overridden', 'disabled']).optional() })).optional(),
  user_added_rules: z.array(z.union([z.string().min(1).max(2000), z.object({ rule_id: z.string().max(120).optional(), rule_text: z.string().min(1).max(2000) })])).optional(),
  user_modified_rules: z.array(z.object({ replaces_rule_id: z.string().min(1).max(120), modified_text: z.string().min(1).max(2000) })).optional(),
}).optional();
const agentFields = {
  agent_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/), display_name: z.string().min(1).max(160).optional(),
  role_name: z.string().min(1).max(160), department: z.string().min(1).max(160),
  seniority: z.enum(['intern', 'junior', 'senior', 'executive']), primary_focus: z.string().min(1).max(4000),
  mission: z.string().min(1).max(4000).optional(), instructions: z.string().max(12000).optional(),
  constraints: z.array(z.string().min(1).max(1000)).max(50).optional(), provider: z.enum(['mock', 'ollama', 'mistral', 'anthropic']).nullable().optional(),
  model: z.string().max(200).nullable().optional(), tools: z.array(z.string().min(1).max(160)).max(100).optional(),
  connectors: z.array(z.enum(['slack', 'discord', 'teams', 'console'])).max(4).optional(), veto_power: z.boolean().optional(), enabled: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(), behavioral_profile: z.record(z.string(), z.unknown()).optional(), rule_configuration: ruleConfigurationSchema,
};
const agentCreateSchema = z.object(agentFields);
const agentPatchSchema = z.object(agentFields).partial().omit({ agent_id: true });
const crystalImportSchema = z.object({ consent_confirmed: z.literal(true), email: z.string().email().max(320).optional(), linkedin_url: z.string().url().max(1000).optional() })
  .refine((value) => !!value.email || !!value.linkedin_url, { message: 'email ou linkedin_url requis' });
const connectorSchema = z.object({ enabled: z.boolean().optional().default(true), settings: z.record(z.string(), z.unknown()).optional().default({}), secrets: z.record(z.string(), z.string().max(4000)).optional().default({}) });
const connectorStateSchema = z.object({ enabled: z.boolean() });
const replySchema = z.object({ text: z.string().min(1).max(12000) });
const arbitrationSchema = z.object({ action: z.enum(['accept_consensus', 'override_veto', 'reevaluate']), justification: z.string().max(4000).optional(), decision: z.enum(['GO', 'CONDITIONAL_GO']).optional() });

function agentView(agent) { return { ...agent, effective_rules: resolveEffectiveRules(agent), effective_context: compileEffectiveAgentContext(agent) }; }
function manager(me, reply) { if (['comex', 'admin'].includes(me.role)) return true; reply.code(403).send({ error: 'rôle comex ou admin requis' }); return false; }
async function connections(app, tenantId, rooms) {
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
    return { ...item, status: usingEnvironment ? 'connected' : item.status, source: usingEnvironment ? 'environment' : 'console', rooms: rooms.filter((room) => room.platform === item.platform).length };
  });
}

export default async function consoleRoute(app) {
  app.get('/v1/console/overview', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const { hybridGateway, engine } = app.kayrosContext;
    await engine.swarm.hydrateTenant?.(me.tenantId);
    const rooms = await hybridGateway.listRooms({ tenantId: me.tenantId });
    const agents = engine.swarm.registry.list({ tenantId: me.tenantId }).map(agentView);
    const activity = await hybridGateway.activity({ tenantId: me.tenantId, limit: 24 });
    const threads = await hybridGateway.listThreads({ tenantId: me.tenantId, limit: 30 });
    return {
      user: { id: me.sub, email: me.email, role: me.role, tenantId: me.tenantId },
      summary: { rooms: rooms.length, hybrid_agents: agents.filter((agent) => agent.agent_type === 'hybrid_modified').length, agents: agents.filter((agent) => agent.enabled !== false).length, pending_human_decisions: threads.filter((thread) => thread.status !== 'resolved').length },
      connections: await connections(app, me.tenantId, rooms), rooms, agents, activity, threads,
      capabilities: { crystal_knows: app.kayrosContext.crystalKnowsConfigured === true, encrypted_connector_storage: app.kayrosContext.connectorEncryptionConfigured === true, providers: ['mock', 'ollama', 'mistral', 'anthropic'] },
    };
  });

  app.get('/v1/console/agents', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    await app.kayrosContext.engine.swarm.hydrateTenant?.(me.tenantId);
    return { agents: app.kayrosContext.engine.swarm.registry.list({ tenantId: me.tenantId }).map(agentView) };
  });
  app.post('/v1/console/agents', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    const parsed = agentCreateSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'agent invalide', issues: parsed.error.issues });
    try { const agent = app.kayrosContext.engine.swarm.createAgent(parsed.data, { tenantId: me.tenantId, by: me.email }); await app.kayrosContext.engine.swarm.flush?.(); return reply.code(201).send({ agent: agentView(agent) }); }
    catch (error) { return reply.code(/existant/.test(error.message) ? 409 : 400).send({ error: error.message }); }
  });
  app.patch('/v1/console/agents/:agentId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    const parsed = agentPatchSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'modification agent invalide', issues: parsed.error.issues });
    try { const agent = app.kayrosContext.engine.swarm.updateAgent(req.params.agentId, parsed.data, { tenantId: me.tenantId, by: me.email }); await app.kayrosContext.engine.swarm.flush?.(); return { agent: agentView(agent) }; }
    catch (error) { return reply.code(/introuvable/.test(error.message) ? 404 : 400).send({ error: error.message }); }
  });
  app.post('/v1/console/agents/:agentId/crystal', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    if (!app.kayrosContext.crystalKnowsConfigured) return reply.code(503).send({ error: 'Crystal Knows n’est pas configuré côté serveur' });
    const parsed = crystalImportSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'import Crystal invalide', issues: parsed.error.issues });
    try {
      const agent = await app.kayrosContext.engine.swarm.importAndAssignPersonality(req.params.agentId, { consent_confirmed: true, imports: [{ source: 'crystalknows', email: parsed.data.email, linkedin_url: parsed.data.linkedin_url }] }, { tenantId: me.tenantId, by: me.email });
      await app.kayrosContext.engine.swarm.flush?.(); return { agent: agentView(agent) };
    } catch (error) { return reply.code(400).send({ error: error.message }); }
  });

  app.get('/v1/console/connectors', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const rooms = await app.kayrosContext.hybridGateway.listRooms({ tenantId: me.tenantId });
    return { connectors: await connections(app, me.tenantId, rooms), encrypted_storage: app.kayrosContext.connectorEncryptionConfigured === true };
  });
  app.put('/v1/console/connectors/:platform', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    const parsed = connectorSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'configuration connecteur invalide', issues: parsed.error.issues });
    try {
      const connector = await app.kayrosContext.connectorConfig.configure(me.tenantId, req.params.platform, parsed.data);
      if (connector.enabled) { const adapter = await app.kayrosContext.connectorConfig.adapterFor(me.tenantId, req.params.platform); if (adapter) app.kayrosContext.hybridGateway.setTenantAdapter(me.tenantId, adapter); }
      return { connector };
    } catch (error) { return reply.code(400).send({ error: error.message }); }
  });
  app.patch('/v1/console/connectors/:platform', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    const parsed = connectorStateSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'état connecteur invalide' });
    try {
      const connector = await app.kayrosContext.connectorConfig.setEnabled(me.tenantId, req.params.platform, parsed.data.enabled);
      if (connector.enabled) { const adapter = await app.kayrosContext.connectorConfig.adapterFor(me.tenantId, req.params.platform); if (adapter) app.kayrosContext.hybridGateway.setTenantAdapter(me.tenantId, adapter); }
      return { connector };
    } catch (error) { return reply.code(400).send({ error: error.message }); }
  });
  app.post('/v1/console/connectors/:platform/test', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
    try {
      const connector = await app.kayrosContext.connectorConfig.test(me.tenantId, req.params.platform);
      if (connector.ok && connector.enabled) { const adapter = await app.kayrosContext.connectorConfig.adapterFor(me.tenantId, req.params.platform); if (adapter) app.kayrosContext.hybridGateway.setTenantAdapter(me.tenantId, adapter); }
      return reply.code(connector.ok ? 200 : 502).send({ connector });
    } catch (error) { return reply.code(400).send({ error: error.message }); }
  });

  app.get('/v1/console/rooms', async (req, reply) => { const me = await app.requireAuth(req, reply); if (!me) return; return { rooms: await app.kayrosContext.hybridGateway.listRooms({ tenantId: me.tenantId, platform: req.query?.platform || null }) }; });
  app.post('/v1/console/rooms', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return; const parsed = roomSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'configuration du salon invalide', issues: parsed.error.issues });
    try { const room = await app.kayrosContext.hybridGateway.createRoom(parsed.data, { tenantId: me.tenantId, by: me.email }); return reply.code(201).send({ room }); }
    catch (error) { return reply.code(400).send({ error: error.message }); }
  });
  app.get('/v1/console/activity', async (req, reply) => { const me = await app.requireAuth(req, reply); if (!me) return; return { events: await app.kayrosContext.hybridGateway.activity({ tenantId: me.tenantId, roomId: req.query?.room_id || null, after: req.query?.after || 0, limit: req.query?.limit || 100 }) }; });
  app.post('/v1/console/rooms/:roomId/messages', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return; const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'message invalide', issues: parsed.error.issues });
    const room = await app.kayrosContext.hybridGateway.getRoom(req.params.roomId, { tenantId: me.tenantId }); if (!room) return reply.code(404).send({ error: 'salon introuvable' });
    try { return await app.kayrosContext.hybridGateway.handleMessage({ platform: room.platform, room_id: room.room_id, tenantId: me.tenantId, user_id: me.sub, by: me.email, explicit: true, ...parsed.data }); }
    catch (error) { return reply.code(400).send({ error: error.message }); }
  });

  app.get('/v1/console/threads', async (req, reply) => { const me = await app.requireAuth(req, reply); if (!me) return; return { threads: await app.kayrosContext.hybridGateway.listThreads({ tenantId: me.tenantId, roomId: req.query?.room_id || null, limit: req.query?.limit || 100 }) }; });
  app.get('/v1/console/threads/:threadId', async (req, reply) => { const me = await app.requireAuth(req, reply); if (!me) return; const thread = await app.kayrosContext.hybridGateway.getThread(req.params.threadId, { tenantId: me.tenantId }); return thread ? { thread } : reply.code(404).send({ error: 'fil introuvable' }); });
  app.post('/v1/console/threads/:threadId/messages', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return; const parsed = replySchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'réponse invalide', issues: parsed.error.issues });
    try { const thread = await app.kayrosContext.hybridGateway.continueThread(req.params.threadId, { tenantId: me.tenantId, text: parsed.data.text, by: me.email }); return reply.code(202).send({ thread }); }
    catch (error) { return reply.code(/introuvable/.test(error.message) ? 404 : 409).send({ error: error.message }); }
  });
  app.post('/v1/console/threads/:threadId/arbitrate', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return; const parsed = arbitrationSchema.safeParse(req.body || {}); if (!parsed.success) return reply.code(400).send({ error: 'arbitrage invalide', issues: parsed.error.issues });
    try { const thread = await app.kayrosContext.hybridGateway.arbitrateThread(req.params.threadId, parsed.data, { tenantId: me.tenantId, by: me.email }); return { thread }; }
    catch (error) { return reply.code(/introuvable/.test(error.message) ? 404 : 409).send({ error: error.message }); }
  });
}
