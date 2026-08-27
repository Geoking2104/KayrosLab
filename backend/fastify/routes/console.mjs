import { z } from 'zod';

const roomSchema = z.object({
  name: z.string().min(1).max(120),
  platform: z.enum(['slack', 'discord', 'teams', 'console']),
  external_room_id: z.string().min(1).max(240),
  mode: z.enum(['mention_only', 'always']).optional(),
  swarm_id: z.string().optional(),
  active_agents: z.array(z.string()).min(1).optional(),
  swarm_name: z.string().max(120).optional(),
  voting_threshold: z.enum(['unanimous', 'majority', 'veto_power_csuite']).optional(),
  personality_simulation_enabled: z.boolean().optional(),
});

const messageSchema = z.object({
  text: z.string().min(1).max(12000),
  message_id: z.string().max(240).optional(),
  context: z.string().max(24000).optional(),
});

export default async function consoleRoute(app) {
  app.get('/v1/console/overview', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const { hybridGateway, engine } = app.kayrosContext;
    await engine.swarm.hydrateTenant?.(me.tenantId);
    const rooms = await hybridGateway.listRooms({ tenantId: me.tenantId });
    const agents = engine.swarm.registry.list({ tenantId: me.tenantId });
    const activity = await hybridGateway.activity({ tenantId: me.tenantId, limit: 12 });
    const pendingHumanDecisions = await hybridGateway.pendingDecisionCount(me.tenantId);
    return {
      user: { id: me.sub, email: me.email, role: me.role, tenantId: me.tenantId },
      summary: {
        rooms: rooms.length,
        hybrid_agents: agents.filter((agent) => agent.agent_type === 'hybrid_modified').length,
        agents: agents.length,
        pending_human_decisions: pendingHumanDecisions,
      },
      connections: await hybridGateway.connections({ tenantId: me.tenantId }),
      rooms,
      agents,
      activity,
    };
  });

  app.get('/v1/console/rooms', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    return { rooms: await app.kayrosContext.hybridGateway.listRooms({ tenantId: me.tenantId, platform: req.query?.platform || null }) };
  });

  app.post('/v1/console/rooms', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = roomSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'configuration du salon invalide', issues: parsed.error.issues });
    try {
      const room = await app.kayrosContext.hybridGateway.createRoom(parsed.data, { tenantId: me.tenantId, by: me.email });
      return reply.code(201).send({ room });
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });

  app.get('/v1/console/activity', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    return {
      events: await app.kayrosContext.hybridGateway.activity({
        tenantId: me.tenantId,
        roomId: req.query?.room_id || null,
        after: req.query?.after || 0,
        limit: req.query?.limit || 100,
      }),
    };
  });

  app.post('/v1/console/rooms/:roomId/messages', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'message invalide', issues: parsed.error.issues });
    const room = await app.kayrosContext.hybridGateway.getRoom(req.params.roomId, { tenantId: me.tenantId });
    if (!room) return reply.code(404).send({ error: 'salon introuvable' });
    try {
      return await app.kayrosContext.hybridGateway.handleMessage({
        platform: room.platform,
        room_id: room.room_id,
        tenantId: me.tenantId,
        user_id: me.sub,
        by: me.email,
        explicit: true,
        ...parsed.data,
      });
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });
}
