import { z } from 'zod';

const createIdeaSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  intake: z.any().optional(),
  category: z.string().optional(),
  campagneId: z.string().optional(),
});

const patchIdeaSchema = z.object({
  stage: z.string().optional(),
  status: z.string().optional(),
  motif: z.string().optional(),
});

export default async function ideasRoute(app) {
  app.get('/v1/ideas', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const { stage, status, category, q, inclureModeration } = req.query || {};
    const list = await app.kayrosContext.ideas.list({ tenantId: me.tenantId, stage, status, category, q });
    if (inclureModeration !== 'true') { const { estPubliee } = await import('../../core/index.mjs'); return { ideas: list.filter((i) => estPubliee(i)) }; }
    return { ideas: list };
  });

  app.post('/v1/ideas', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = createIdeaSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'title requis', issues: parsed.error.issues });
    const { id, title, intake, category, campagneId } = parsed.data;
    const ctx = app.kayrosContext;
    try {
      const campagne = campagneId ? ctx.campagnes.get(campagneId) : null;
      if (campagneId && !campagne) return reply.code(404).send({ error: 'campagne introuvable' });
      if (campagne && campagne.tenantId !== me.tenantId) return reply.code(404).send({ error: 'campagne introuvable' });
      const { estOuverte } = await import('../../core/index.mjs');
      const fenetre = estOuverte(campagne);
      if (!fenetre.ouverte) return reply.code(409).send({ error: `campagne ${fenetre.raison}`, code: fenetre.raison });
      const { processIntake, createIdea, etatInitial } = await import('../../core/index.mjs');
      const derive = intake ? processIntake(intake) : null;
      const idea = {
        ...createIdea({ id: id || `D${Date.now()}`, title, author: me.email, category, intake, tenantId: me.tenantId }),
        campagneId: campagne?.id ?? null,
        moderation: etatInitial(campagne),
        comments: [],
      };
      await ctx.ideas.save(idea);
      return reply.code(201).send({ idea, derive, enModeration: !idea.moderation?.publiee });
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.get('/v1/ideas/:id', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const idea = await app.kayrosContext.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    return { idea };
  });

  app.patch('/v1/ideas/:id', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const parsed = patchIdeaSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    const { stage, status, motif } = parsed.data;
    try {
      let out = idea;
      if (stage) { const { setStage } = await import('../../core/index.mjs'); out = setStage(out, stage, { by: me.email, motif }); }
      if (status) { const { setStatus } = await import('../../core/index.mjs'); out = setStatus(out, status, { by: me.email, motif }); }
      await ctx.ideas.save(out);
      if (stage) ctx.journal({ type: 'etape', by: me.email, de: idea.stage, a: stage, ideaId: idea.id, titre: idea.title });
      if (status) ctx.journal({ type: 'statut', by: me.email, de: idea.status, a: status, ideaId: idea.id, titre: idea.title });
      return { idea: out };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });
}
