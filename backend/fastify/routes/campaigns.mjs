import { z } from 'zod';

export default async function campaignsRoute(app) {
  app.get('/v1/campaigns', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const list = [...ctx.campagnes.values()].filter((c) => c.tenantId === me.tenantId);
    const toutes = await ctx.ideas.list({ tenantId: me.tenantId });
    const { statsCampagne, estOuverte } = await import('../../core/index.mjs');
    return { campaigns: list.map((c) => ({ ...c, stats: statsCampagne(toutes, c.id), ...estOuverte(c) })) };
  });

  app.post('/v1/campaigns', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    try {
      ctx.auth.requireRole(me, ['comex', 'facilitateur']);
      const { createCampaign } = await import('../../core/index.mjs');
      const c = createCampaign({ ...req.body, id: req.body?.id || `camp_${Date.now()}`, tenantId: me.tenantId });
      ctx.campagnes.set(c.id, c);
      return reply.code(201).send({ campaign: c });
    } catch (e) { return reply.code(e.code === 'AUTH_FORBIDDEN' ? 403 : 400).send({ error: e.message }); }
  });

  app.get('/v1/moderation', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const toutes = await ctx.ideas.list({ tenantId: me.tenantId });
    const { fileModeration } = await import('../../core/index.mjs');
    return { file: fileModeration(toutes, { tenantId: me.tenantId }), monRole: me.role };
  });

  app.post('/v1/ideas/:id/moderate', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const parsed = z.object({ decision: z.string().min(1), motif: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'decision requise', issues: parsed.error.issues });
    const { decision, motif } = parsed.data;
    try {
      ctx.auth.requireRole(me, ['comex', 'facilitateur']);
      const { moderer } = await import('../../core/index.mjs');
      const out = moderer(idea, { decision, by: me.email, motif });
      await ctx.ideas.save(out);
      ctx.journal({ type: 'moderation', by: me.email, a: decision, ideaId: idea.id, titre: idea.title });
      return { idea: out };
    } catch (e) { return reply.code(e.code === 'AUTH_FORBIDDEN' ? 403 : 400).send({ error: e.message }); }
  });
}
