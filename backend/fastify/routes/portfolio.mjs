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

  // Matrice de risques probabilises (EF-42) : add/update/remove + declencheurs.
  app.post('/v1/ideas/:id/risques', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { z } = await import('zod');
    const parsed = z.object({
      action: z.enum(['add', 'update', 'remove']),
      risque: z.object({ id: z.string().optional(), libelle: z.string().optional(), probabilite: z.number().min(0).max(1), impact: z.number().min(0).max(1), statut: z.enum(['actif', 'traite', 'accepte']).optional(), trigger: z.string().optional() }).optional(),
      risqueId: z.string().optional(),
      patch: z.object({ libelle: z.string().optional(), probabilite: z.number().min(0).max(1).optional(), impact: z.number().min(0).max(1).optional(), statut: z.enum(['actif', 'traite', 'accepte']).optional(), trigger: z.string().optional() }).optional(),
      openGate: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'schema invalide', issues: parsed.error.issues });
    try {
      const { addRisque, updateRisque, removeRisque, rapportRisques, detectDeclencheurs } = await import('../../../core/index.mjs');
      const base = idea.roadmap?.risques ?? [];
      let risques;
      if (parsed.data.action === 'add') risques = addRisque(base, parsed.data.risque);
      else if (parsed.data.action === 'update') risques = updateRisque(base, parsed.data.risqueId, parsed.data.patch ?? {});
      else risques = removeRisque(base, parsed.data.risqueId);
      const rapport = rapportRisques(risques);
      const d = detectDeclencheurs(rapport.risques);
      let reArbitrage = null;
      if (d.necessaire && parsed.data.openGate !== false) {
        const { gateId } = ctx.governance.open({ ideaId: idea.id, type: 're_arbitrage', requiredRole: 'comex', payload: d.raisons.join(' ; ') });
        reArbitrage = { type: 're-arbitrage', gateId, raisons: d.raisons };
      } else if (d.necessaire) {
        reArbitrage = { type: 're-arbitrage', raisons: d.raisons };
      }
      const out = {
        ...idea,
        roadmap: { ...idea.roadmap, risques, risquesResume: risques.length },
        updatedAt: new Date().toISOString(),
      };
      await ctx.ideas.save(out);
      ctx.journal({ type: `risque.${parsed.data.action}`, by: me.email, ideaId: idea.id, risqueId: parsed.data.risque?.id ?? parsed.data.risqueId ?? null });
      if (d.necessaire) ctx.journal({ type: 'risque.rearbitrage', by: me.email, ideaId: idea.id, raisons: d.raisons, gateId: reArbitrage?.gateId ?? null });
      return { risques, matrice: rapport.matrice, declencheurs: d, reArbitrage };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.get('/v1/ideas/:id/risques', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { rapportRisques } = await import('../../../core/index.mjs');
    const rapport = rapportRisques(idea.roadmap?.risques ?? []);
    return { risques: rapport.risques, matrice: rapport.matrice, declencheurs: rapport.declencheurs };
  });

  // Dossier de capitalisation No-Go (EF-44) : apprentissages + conditions de reactivation.
  app.post('/v1/ideas/:id/capitalisation', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { z } = await import('zod');
    const parsed = z.object({
      apprentissages: z.array(z.union([z.string(), z.object({ contenu: z.string(), categorie: z.string().optional() })])).optional().default([]),
      reactivation: z.union([
        z.string(),
        z.object({ condition: z.string().optional(), conditions: z.array(z.string()).optional(), delai: z.string().optional(), signaux: z.array(z.string()).optional() }),
      ]).optional().default(null),
      signaux: z.array(z.union([z.string(), z.object({ libelle: z.string() })])).optional().default([]),
      motif: z.string().optional().nullable().default(null),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'schema invalide', issues: parsed.error.issues });
    try {
      if (idea.status !== 'non_poursuivi') return reply.code(409).send({ error: "l'idee doit etre No-Go (status non_poursuivi)" });
      const { buildCapitalisation, reactivationReady, resumeCapitalisation } = await import('../../../core/index.mjs');
      const dossier = buildCapitalisation(parsed.data);
      const out = { ...idea, capitalisation: dossier, updatedAt: new Date().toISOString() };
      await ctx.ideas.save(out);
      ctx.journal({ type: 'capitalisation.build', by: me.email, ideaId: idea.id, apprentissages: dossier.apprentissages.length, conditions: dossier.reactivation.conditions.length });
      return { capitalisation: dossier, resume: resumeCapitalisation(dossier) };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.get('/v1/ideas/:id/capitalisation', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    if (!idea.capitalisation) return reply.code(404).send({ error: 'pas de dossier de capitalisation' });
    const { reactivationReady, resumeCapitalisation } = await import('../../../core/index.mjs');
    const signaux = (req.query?.signaux ? String(req.query.signaux).split(',') : []).filter(Boolean);
    return {
      capitalisation: idea.capitalisation,
      resume: resumeCapitalisation(idea.capitalisation),
      reactivation: reactivationReady(idea.capitalisation, { contexteSignaux: signaux }),
    };
  });

  // Jalons de gouvernance futurs (EF-45) : gates COMEX dates.
  app.post('/v1/ideas/:id/gates-futurs', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { z } = await import('zod');
    const parsed = z.object({
      gates: z.array(z.object({
        id: z.string().optional(), libelle: z.string(), date: z.string(),
        type: z.string().optional(), requiredRole: z.string().optional(), questions: z.array(z.string()).optional(),
      })),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'gates futurs requis (libelle + date)', issues: parsed.error.issues });
    try {
      const { setGatesFuturs, gatesFutursStatus } = await import('../../../core/index.mjs');
      const roadmap = setGatesFuturs(idea.roadmap ?? {}, parsed.data.gates);
      const out = { ...idea, roadmap, updatedAt: new Date().toISOString() };
      await ctx.ideas.save(out);
      ctx.journal({ type: 'gatesfuturs.plan', by: me.email, ideaId: idea.id, gates: roadmap.gatesFuturs.length });
      const status = gatesFutursStatus(roadmap.gatesFuturs);
      return { gatesFuturs: roadmap.gatesFuturs, status };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.get('/v1/ideas/:id/gates-futurs', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { gatesFutursStatus } = await import('../../../core/index.mjs');
    return { gatesFuturs: idea.roadmap?.gatesFuturs ?? [], status: gatesFutursStatus(idea.roadmap?.gatesFuturs ?? []) };
  });

  app.post('/v1/ideas/:id/gates-futurs/materialise', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    try {
      const { dueGates, materialiserGate, gatesFutursStatus } = await import('../../../core/index.mjs');
      const gates = idea.roadmap?.gatesFuturs ?? [];
      const dus = dueGates(gates);
      const materialises = dus.map((g) => {
        const { gateId } = ctx.governance.open({ ideaId: idea.id, type: g.type, requiredRole: g.requiredRole, payload: g.questions.length ? `${g.libelle} — ${g.questions.join(' ; ')}` : g.libelle });
        return materialiserGate(g, { gateId });
      });
      const byId = new Map(materialises.map((m) => [m.id, m]));
      const roadmap = { ...(idea.roadmap ?? {}), gatesFuturs: gates.map((g) => byId.get(g.id) ?? g) };
      const out = { ...idea, roadmap, updatedAt: new Date().toISOString() };
      await ctx.ideas.save(out);
      if (materialises.length) ctx.journal({ type: 'gatesfuturs.materialise', by: me.email, ideaId: idea.id, gates: materialises.map((m) => m.id), gateIds: materialises.map((m) => m.materialise.gateId) });
      return { materialises, status: gatesFutursStatus(roadmap.gatesFuturs) };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });
}
