export default async function portfolioRoute(app) {
  app.get('/v1/portfolio', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const { portfolio } = await import('../../../core/index.mjs');
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
    const { buildDigest, formatDigest } = await import('../../../core/index.mjs');
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
    const { aggregateVotes } = await import('../../../core/index.mjs');
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
      const { startExecution, setStage, progression } = await import('../../../core/index.mjs');
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
      const { updateJalon, advancePhase, cloturer, progression, setStatus } = await import('../../../core/index.mjs');
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

  app.post('/v1/ideas/:id/roadmap', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { z } = await import('zod');
    const { buildRoadmap } = await import('../../../core/index.mjs');
    const parsed = z.object({
      milestones: z.array(z.object({ name: z.string().optional(), effortPersonMonths: z.number().min(0), durationMonths: z.number().positive().optional() })).optional().default([]),
      raci: z.array(z.any()).optional().default([]),
      kpis: z.array(z.any()).optional().default([]),
      risques: z.array(z.any()).optional().default([]),
      gatesFuturs: z.array(z.any()).optional().default([]),
      costHypotheses: z.object({ costPerPersonMonth: z.number().optional(), overheadRate: z.number().optional(), expectedRevenue: z.number().optional(), runRateMonthly: z.number().optional(), horizonMonths: z.number().positive().optional() }).optional().default({}),
      scenarios: z.array(z.object({ name: z.string().optional(), probability: z.number().min(0), value: z.number() })).optional().default([]),
      variables: z.array(z.object({ name: z.string().optional(), min: z.number(), max: z.number() })).optional().default([]),
      iterations: z.number().int().positive().optional(),
      seed: z.number().int().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    try {
      const { roadmap, ressources, projections } = buildRoadmap({
        milestones: parsed.data.milestones, raci: parsed.data.raci, kpis: parsed.data.kpis,
        risques: parsed.data.risques, gatesFuturs: parsed.data.gatesFuturs,
        costHypotheses: parsed.data.costHypotheses, scenarios: parsed.data.scenarios,
        variables: parsed.data.variables, iterations: parsed.data.iterations, seed: parsed.data.seed,
      });
      const out = {
        ...idea, roadmap,
        projection: { scenarios: parsed.data.scenarios, variables: parsed.data.variables, costHypotheses: parsed.data.costHypotheses, iterations: parsed.data.iterations ?? 10000, seed: parsed.data.seed ?? 42 },
        updatedAt: new Date().toISOString(),
      };
      await ctx.ideas.save(out);
      try { ctx.journal?.({ type: 'project.roadmap', by: me.email, ideaId: idea.id, jalons: roadmap.jalons.length }); } catch (e) {}
      return { roadmap, ressources, projections };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.get('/v1/ideas/:id/roadmap', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { projectFromIdea, impactReport, emptyImpact } = await import('../../../core/index.mjs');
    const { roadmap, ressources, projections } = projectFromIdea(idea);
    const rapport = projections ? impactReport(projections, idea.impact ?? emptyImpact()) : { variance: null };
    return { roadmap, ressources, projections, rapport, phase: idea.execution?.phase ?? 'projeter' };
  });

  app.get('/v1/ideas/:id/execution', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    if (!idea.execution) return reply.code(404).send({ error: 'execution non demarree' });
    const { progression, impactReport, emptyImpact } = await import('../../../core/index.mjs');
    return {
      execution: idea.execution,
      progression: progression(idea.execution),
      loop: idea.loop ?? null,
      impact: impactReport(idea.projection ?? {}, idea.impact ?? emptyImpact()),
    };
  });

  // Boucle Projeter -> Ecouter (EF-43) : releves KPI constates en Realiser,
  // evaluation seuils + derive, re-injection signaux, re-arbitrage propose.
  app.post('/v1/ideas/:id/execution/monitor', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { z } = await import('zod');
    const parsed = z.object({
      readings: z.array(z.object({ kpiId: z.string(), value: z.number(), ts: z.string().optional() })),
      openGate: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'readings requis (kpiId + value)', issues: parsed.error.issues });
    try {
      const { emptyImpact, recordActual, evaluateKpisWithDrift, progression } = await import('../../../core/index.mjs');
      const kpis = idea.roadmap?.kpis ?? [];
      let impact = idea.impact ?? emptyImpact();
      for (const r of parsed.data.readings) impact = recordActual(impact, { kpiId: r.kpiId, value: r.value, ts: r.ts });
      const { alerts, drifts, signals, ok } = evaluateKpisWithDrift(kpis, impact.releves, { ideaId: idea.id });
      let reArbitrage = null;
      if (signals.length) {
        const payload = signals.map((s) => s.contenu).join(' ; ');
        if (parsed.data.openGate !== false) {
          const { gateId } = ctx.governance.open({ ideaId: idea.id, type: 're_arbitrage', requiredRole: 'comex', payload });
          reArbitrage = { type: 're-arbitrage', gateId, reasons: [...new Set(signals.map((s) => s.kpiId).filter(Boolean))] };
        } else {
          reArbitrage = { type: 're-arbitrage', reasons: [...new Set(signals.map((s) => s.kpiId).filter(Boolean))] };
        }
      }
      let out = { ...idea, impact, updatedAt: new Date().toISOString() };
      if (signals.length) out.loop = { ts: new Date().toISOString(), alerts, drifts, reArbitrage, by: me.email };
      await ctx.ideas.save(out);
      ctx.journal({ type: 'loop.monitor', by: me.email, ideaId: idea.id, releves: parsed.data.readings.length, alerts: alerts.length, drifts: drifts.length });
      if (signals.length) ctx.journal({ type: 'loop.alert', by: me.email, ideaId: idea.id, kpis: signals.map((s) => s.kpiId), gateId: reArbitrage?.gateId ?? null });
      return {
        alerts, drifts, signals, ok, reArbitrage,
        progression: idea.execution ? progression(idea.execution) : null,
      };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });
}
