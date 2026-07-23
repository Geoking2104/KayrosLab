export default async function portfolioRoute(app) {
  app.get('/v1/portfolio', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const { portfolio } = await import('../../core/index.mjs');
    const board = await portfolio(ctx.ideas, { tenantId: me.tenantId });
    const all = await ctx.ideas.list({ tenantId: me.tenantId });
    const byStatus = {};
    for (const i of all) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    return { ...board, byStatus };
  });

  app.get('/v1/scorecards', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const { stage } = req.query || {};
    const list = stage ? app.kayrosContext.scorecards.forStage(stage) : app.kayrosContext.scorecards.list();
    return { scorecards: list.map((s) => ({ id: s.id, stage: s.stage, label: s.label, scale: s.scale, criteria: s.criteria })) };
  });

  app.get('/v1/activity', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const mesIdees = new Set((await ctx.ideas.list({ tenantId: me.tenantId })).map((i) => i.id));
    return { activites: ctx.activites.filter((a) => mesIdees.has(a.ideaId)).slice(-100).reverse() };
  });

  app.get('/v1/digest', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const { depuis, jusqua, periode = 'quotidien' } = req.query || {};
    const mesIdees = new Set((await ctx.ideas.list({ tenantId: me.tenantId })).map((i) => i.id));
    const { buildDigest, formatDigest } = await import('../../core/index.mjs');
    const d = buildDigest(ctx.activites.filter((a) => mesIdees.has(a.ideaId)), { depuis, jusqua, periode });
    return { digest: d, message: formatDigest(d, { destinataires: [me.email] }) };
  });

  app.post('/v1/ideas/:id/votes', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { z } = await import('zod');
    const parsed = z.object({ score: z.number().min(0).max(100), comment: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'score numerique requis', issues: parsed.error.issues });
    const { score, comment } = parsed.data;
    const { aggregateVotes } = await import('../../core/index.mjs');
    const votes = [...(idea.votes ?? []).filter((v) => v.by !== me.email), { by: me.email, role: me.role, score, comment }];
    const out = { ...idea, votes, updatedAt: new Date().toISOString() };
    await ctx.ideas.save(out);
    ctx.journal({ type: 'vote', by: me.email, score, ideaId: idea.id, titre: idea.title });
    return { agregat: aggregateVotes(votes) };
  });

  app.post('/v1/ideas/:id/execution', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    if (!idea.roadmap?.jalons?.length && !req.body?.roadmap?.jalons?.length) return reply.code(400).send({ error: "aucune roadmap" });
    try {
      const { startExecution, setStage, progression } = await import('../../core/index.mjs');
      const execution = startExecution({ roadmap: req.body?.roadmap ?? idea.roadmap });
      const out = setStage({ ...idea, execution }, 'realiser', { by: me.email, motif: 'demarrage execution' });
      await ctx.ideas.save(out);
      return reply.code(201).send({ execution, progression: progression(execution) });
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.patch('/v1/ideas/:id/execution', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    if (!idea.execution) return reply.code(400).send({ error: 'execution non demarree' });
    const { jalonId, patch, action, force, verdict, enseignements } = req.body || {};
    try {
      const { updateJalon, advancePhase, cloturer, progression, setStatus } = await import('../../core/index.mjs');
      let execution = idea.execution;
      if (jalonId) execution = updateJalon(execution, jalonId, patch ?? {}, { by: me.email });
      if (action === 'phase_suivante') execution = advancePhase(execution, { force: !!force, by: me.email });
      if (action === 'cloturer') execution = cloturer(execution, { verdict, enseignements, by: me.email });
      let out = { ...idea, execution, updatedAt: new Date().toISOString() };
      if (action === 'cloturer') out = setStatus(out, 'termine', { by: me.email, motif: `bilan ${verdict}` });
      await ctx.ideas.save(out);
      return { execution, progression: progression(execution) };
    } catch (e) { return reply.code(e.code === 'JALONS_OUVERTS' ? 409 : 400).send({ error: e.message, code: e.code ?? null }); }
  });
}
