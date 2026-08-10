import { z } from 'zod';

export default async function reportingRoute(app) {
  app.get('/v1/reporting/dashboard', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const list = await app.kayrosContext.ideas.list({ tenantId: me.tenantId });
    const { dashboard, funnel, tempsParEtape } = await import('../../../core/index.mjs');
    return { dashboard: dashboard(list), funnel: funnel(list), tempsParEtape: tempsParEtape(list) };
  });

  app.get('/v1/reporting/export', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const list = await app.kayrosContext.ideas.list({ tenantId: me.tenantId });
    const { exportCsv } = await import('../../../core/index.mjs');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="portefeuille-${me.tenantId}.csv"`);
    return exportCsv(list);
  });

  app.post('/v1/reporting/compare', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = z.object({ ids: z.array(z.string()).min(2) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'au moins 2 idees a comparer', issues: parsed.error.issues });
    const list = (await app.kayrosContext.ideas.list({ tenantId: me.tenantId })).filter((i) => parsed.data.ids.includes(i.id));
    const { compare } = await import('../../../core/index.mjs');
    return { comparaison: compare(list) };
  });

  app.post('/v1/reporting/leaderboard', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = z.object({ critere: z.string().optional().default('ki'), sens: z.string().optional().default('desc'), top: z.number().optional().default(20), campagneId: z.string().nullable().optional().default(null) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    const { critere, sens, top, campagneId } = parsed.data;
    const list = await app.kayrosContext.ideas.list({ tenantId: me.tenantId });
    const { leaderboard } = await import('../../../core/index.mjs');
    return { leaderboard: leaderboard(list, { critere, sens, top, campagneId }) };
  });
}
