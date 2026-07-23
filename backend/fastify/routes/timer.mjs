import { z } from 'zod';

export default async function timerRoute(app) {
  app.post('/v1/timer/deadline', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = z.object({ ideaId: z.string().min(1), stage: z.string().min(1), maxHours: z.number().optional(), deadline: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'ideaId et stage requis', issues: parsed.error.issues });
    const { ideaId, stage, maxHours, deadline } = parsed.data;
    app.kayrosContext.stageTimer.setDeadline(ideaId, stage, { maxHours, deadline });
    return { ok: true, status: app.kayrosContext.stageTimer.status() };
  });

  app.post('/v1/timer/tick', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const result = await app.kayrosContext.stageTimer.tick();
    return { gates: result.gates.length, warnings: result.warnings.length, status: app.kayrosContext.stageTimer.status() };
  });

  app.get('/v1/timer/status', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    return { timer: app.kayrosContext.stageTimer.status() };
  });
}
