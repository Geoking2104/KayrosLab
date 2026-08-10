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

  // Synthese d'arbitrage (Etape 5, F1) : dossier consolide pour l'arbitre COMEX.
  app.get('/v1/ideas/:id/arbitrage', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { buildSyntheseArbitrage } = await import('../../../core/index.mjs');
    const wg = ctx.workingGroups.get(idea.id);
    const wgAggregat = wg ? ctx.workingGroups.aggregate(idea.id) : null;
    const enAttente = ctx.governance.list().filter((g) => g.ideaId === idea.id && !g.resolvedAt);
    const synthèse = buildSyntheseArbitrage({
      idea,
      wgAggregat,
      risques: idea.roadmap?.risques ?? [],
      projection: idea.projection ?? null,
      pendingGates: enAttente,
    });
    return synthèse;
  });

  // Journal des decisions Go/No-Go/Revision (EF-14) : immuable, horodate, signe.
  app.get('/v1/ideas/:id/decisions', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { decisionsTimeline, lastDecision } = await import('../../../core/index.mjs');
    const decisions = decisionsTimeline(idea);
    return { decisions, count: decisions.length, derniere: lastDecision(idea) };
  });

  // Etape 1 — Ecouter (EF-01/EF-02) : signal faible -> qualifie + score explique.
  app.post('/v1/ideas/:id/signals', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { z } = await import('zod');
    const parsed = z.object({
      signal: z.object({
        contenu: z.string(),
        source: z.string().optional(),
        date: z.string().optional(),
        url: z.string().optional(),
        tags: z.array(z.string()).optional().default([]),
      }),
      scores: z.object({ pertinence: z.number().min(0).max(100).optional(), impact: z.number().min(0).max(100).optional() }).optional().default({}),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'signal requis (contenu)', issues: parsed.error.issues });
    try {
      const { normalizeSignal, scoreSignal } = await import('../../../core/index.mjs');
      const brut = normalizeSignal(parsed.data.signal, { index: (idea.signals ?? []).length });
      const scored = { ...brut, ...scoreSignal(brut, parsed.data.scores) };
      const liste = idea.signals ?? [];
      const idx = liste.findIndex((s) => s.id === scored.id);
      const signals = idx >= 0 ? [...liste.slice(0, idx), scored, ...liste.slice(idx + 1)] : [...liste, scored];
      const out = { ...idea, signals, updatedAt: new Date().toISOString() };
      await ctx.ideas.save(out);
      ctx.journal({ type: 'ecouter.add', by: me.email, ideaId: idea.id, signalId: scored.id, source: scored.source, note: scored.note ?? null });
      return { signal: scored };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.get('/v1/ideas/:id/signals', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { rapportEcoute } = await import('../../../core/index.mjs');
    const seuil = req.query?.seuil != null ? Number(req.query.seuil) : (idea.ecouter?.seuil ?? undefined);
    const rapport = rapportEcoute(idea.signals ?? [], { seuil });
    return { signals: idea.signals ?? [], ...rapport };
  });

  app.post('/v1/ideas/:id/signals/promote', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { z } = await import('zod');
    const parsed = z.object({ signalId: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'signalId requis', issues: parsed.error.issues });
    try {
      const { promoteSignal } = await import('../../../core/index.mjs');
      const liste = idea.signals ?? [];
      const idx = liste.findIndex((s) => s.id === parsed.data.signalId);
      if (idx < 0) return reply.code(404).send({ error: 'signal introuvable' });
      const qualifie = promoteSignal(liste[idx], { by: me.email, ideaId: idea.id });
      const signals = [...liste.slice(0, idx), qualifie, ...liste.slice(idx + 1)];
      const out = { ...idea, signals, updatedAt: new Date().toISOString() };
      await ctx.ideas.save(out);
      ctx.journal({ type: 'ecouter.promote', by: me.email, ideaId: idea.id, signalId: qualifie.id, ts: qualifie.promote.ts });
      return { signal: qualifie };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.post('/v1/ideas/:id/signals/noise', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { z } = await import('zod');
    const parsed = z.object({ seuil: z.number().min(0).max(100) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'seuil 0..100 requis', issues: parsed.error.issues });
    const { rapportEcoute } = await import('../../../core/index.mjs');
    const out = { ...idea, ecouter: { seuil: parsed.data.seuil }, updatedAt: new Date().toISOString() };
    await ctx.ideas.save(out);
    ctx.journal({ type: 'ecouter.noise', by: me.email, ideaId: idea.id, seuil: parsed.data.seuil });
    const rapport = rapportEcoute(idea.signals ?? [], { seuil: parsed.data.seuil });
    return { seuil: parsed.data.seuil, ...rapport };
  });

  // Etape 2 — Cartographier (EF-03/EF-04) : reseau de tendances + ponts de bisociation.
  app.post('/v1/ideas/:id/tendances', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { z } = await import('zod');
    const parsed = z.object({
      tendances: z.array(z.object({
        nom: z.string(), description: z.string().optional(), horizon: z.enum(['court', 'moyen', 'long']).optional(), tags: z.array(z.string()).optional().default([]),
      })).optional().default([]),
      aretes: z.array(z.object({ de: z.string(), vers: z.string(), type: z.string().optional().default('correlation') })).optional().default([]),
      ponts: z.array(z.object({ de: z.string(), vers: z.string(), plausibilite: z.number().min(0).max(100).optional() })).optional().default([]),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'tendances requises', issues: parsed.error.issues });
    try {
      const { buildReseau, suggestPonts, rapportCartographie, scorePont } = await import('../../../core/index.mjs');
      let tendances = parsed.data.tendances;
      if (!tendances.length) {
        tendances = (idea.signals ?? []).filter((s) => s.qualifie).map((s, i) => ({
          nom: s.contenu.length > 80 ? `${s.contenu.slice(0, 80)}…` : s.contenu,
          tags: s.tags,
          source: `signal:${s.id}`,
        }));
      }
      const reseau = buildReseau(tendances, parsed.data.aretes);
      const suggestions = suggestPonts(reseau.noeuds, { reseau });
      const pontsImportes = parsed.data.ponts.map((p) => {
        const s = suggestions.find((x) => (x.de === p.de && x.vers === p.vers) || (x.de === p.vers && x.vers === p.de));
        if (!s) return null;
        return scorePont(s, { plausibilite: p.plausibilite });
      }).filter(Boolean);
      const rapport = rapportCartographie(reseau, { ponts: [...pontsImportes, ...suggestions] });
      const out = { ...idea, cartographie: { tendances: reseau.noeuds, aretes: reseau.aretes, ponts: rapport.ponts }, updatedAt: new Date().toISOString() };
      await ctx.ideas.save(out);
      ctx.journal({ type: 'carto.build', by: me.email, ideaId: idea.id, noeuds: reseau.noeuds.length, aretes: reseau.aretes.length, ponts: rapport.ponts.length });
      return { ...rapport, rendu: `Réseau : ${rapport.totalNoeuds} tendance(s), ${rapport.totalAretes} lien(s), ${rapport.ponts.length} pont(s) de bisociation.` };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.get('/v1/ideas/:id/tendances', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { rapportCartographie } = await import('../../../core/index.mjs');
    if (!idea.cartographie) return { reseau: { noeuds: [], aretes: [] }, centralite: { degres: {}, pivots: [] }, zonesTension: [], ponts: [], totalNoeuds: 0, totalAretes: 0 };
    const reseau = { noeuds: idea.cartographie.tendances, aretes: idea.cartographie.aretes };
    return rapportCartographie(reseau, { ponts: idea.cartographie.ponts });
  });

  app.post('/v1/ideas/:id/tendances/ponts', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    if (!idea.cartographie) return reply.code(404).send({ error: 'réseau non construit' });
    const { z } = await import('zod');
    const parsed = z.object({
      plausibilite: z.array(z.object({ de: z.string(), vers: z.string(), valeur: z.number().min(0).max(100) })).optional().default([]),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'schema invalide', issues: parsed.error.issues });
    const { suggestPonts, scorePont } = await import('../../../core/index.mjs');
    const reseau = { noeuds: idea.cartographie.tendances, aretes: idea.cartographie.aretes };
    let ponts = suggestPonts(reseau.noeuds, { reseau, plausibilite: null });
    for (const p of parsed.data.plausibilite) {
      const idx = ponts.findIndex((x) => (x.de === p.de && x.vers === p.vers) || (x.de === p.vers && x.vers === p.de));
      if (idx >= 0) ponts[idx] = scorePont(ponts[idx], { plausibilite: p.valeur });
    }
    ponts = ponts.sort((a, b) => (b.score ?? b.nouveaute) - (a.score ?? a.nouveaute));
    const out = { ...idea, cartographie: { ...idea.cartographie, ponts }, updatedAt: new Date().toISOString() };
    await ctx.ideas.save(out);
    ctx.journal({ type: 'carto.ponts', by: me.email, ideaId: idea.id, ponts: ponts.length });
    return { ponts, rendu: `${ponts.length} pont(s) de bisociation — fournir la plausibilité pour scorer (nouveauté × plausibilité).` };
  });

  app.post('/v1/ideas/:id/tendances/selection', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    if (!idea.cartographie) return reply.code(404).send({ error: 'réseau non construit' });
    const { z } = await import('zod');
    const parsed = z.object({
      noeuds: z.array(z.string()).optional().default([]),
      ponts: z.array(z.string()).optional().default([]),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'schema invalide', issues: parsed.error.issues });
    const { sendNetworkSelectionToScenario } = await import('../../../core/index.mjs');
    const noeuds = idea.cartographie.tendances.filter((t) => parsed.data.noeuds.includes(t.id));
    const ponts = idea.cartographie.ponts.filter((p) => parsed.data.ponts.includes(p.id));
    const { payload } = sendNetworkSelectionToScenario({ noeuds, ponts });
    const out = { ...idea, cartographie: { ...idea.cartographie, selection: payload }, updatedAt: new Date().toISOString() };
    await ctx.ideas.save(out);
    ctx.journal({ type: 'carto.selection', by: me.email, ideaId: idea.id, noeuds: noeuds.length, ponts: ponts.length });
    return { selection: payload };
  });

  // Etape 3 — Construire (EF-05 / F1) : canvas de scenario editable.
  app.post('/v1/ideas/:id/scenarios/canvas', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { z } = await import('zod');
    const parsed = z.object({
      noeuds: z.array(z.any()).optional().default([]),
      ponts: z.array(z.any()).optional().default([]),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'schema invalide', issues: parsed.error.issues });
    const { canvasConstruire, rapportConstruire } = await import('../../../core/index.mjs');
    const selection = idea.cartographie?.selection ?? null;
    const canvas = { ...canvasConstruire(selection, { noeuds: parsed.data.noeuds, ponts: parsed.data.ponts }), scenarios: idea.construire?.scenarios ?? [] };
    const out = { ...idea, construire: canvas, updatedAt: new Date().toISOString() };
    await ctx.ideas.save(out);
    ctx.journal({ type: 'construire.canvas', by: me.email, ideaId: idea.id, noeuds: canvas.noeuds.length, ponts: canvas.ponts.length });
    return { ...rapportConstruire(out.construire), rendu: `Canvas initialisé depuis ${selection ? 'la sélection Cartographier' : 'les entrées fournies'}.` };
  });

  app.get('/v1/ideas/:id/scenarios', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { rapportConstruire } = await import('../../../core/index.mjs');
    if (!idea.construire) return { canvas: { noeuds: [], ponts: [] }, scenarios: [], totalScenarios: 0, totalNoeuds: 0, totalPonts: 0, types: [], rendu: 'Canvas vide : composer un scénario ou initialiser le canvas.' };
    return rapportConstruire(idea.construire);
  });

  app.post('/v1/ideas/:id/scenarios', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { z } = await import('zod');
    const parsed = z.object({
      scenario: z.object({
        nom: z.string(), type: z.enum(['rupture', 'prudente', 'optimiste']).optional(),
        description: z.string().optional(), probleme: z.string().optional(), proposition: z.string().optional(), cible: z.string().optional(),
        hypotheses: z.array(z.string()).optional().default([]), metriques: z.array(z.string()).optional().default([]),
        noeuds: z.array(z.string()).optional().default([]), ponts: z.array(z.string()).optional().default([]),
      }),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'scenario requis (nom)', issues: parsed.error.issues });
    try {
      const { canvasConstruire, addScenario, rapportConstruire } = await import('../../../core/index.mjs');
      const base = idea.construire ?? { ...canvasConstruire(idea.cartographie?.selection ?? null), scenarios: [] };
      const { canvas, scenario } = addScenario(base, parsed.data.scenario);
      const out = { ...idea, construire: canvas, updatedAt: new Date().toISOString() };
      await ctx.ideas.save(out);
      ctx.journal({ type: 'construire.add', by: me.email, ideaId: idea.id, scenarioId: scenario.id, scenarioType: scenario.type ?? null });
      return { scenario, ...rapportConstruire(canvas) };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.patch('/v1/ideas/:id/scenarios/:scenarioId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    if (!idea.construire) return reply.code(404).send({ error: 'canvas non initialisé' });
    const { z } = await import('zod');
    const parsed = z.object({ scenario: z.object({}).passthrough() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'patch scenario requis', issues: parsed.error.issues });
    try {
      const { updateScenario } = await import('../../../core/index.mjs');
      const { canvas, scenario } = updateScenario(idea.construire, req.params.scenarioId, parsed.data.scenario);
      const out = { ...idea, construire: canvas, updatedAt: new Date().toISOString() };
      await ctx.ideas.save(out);
      ctx.journal({ type: 'construire.update', by: me.email, ideaId: idea.id, scenarioId: scenario.id });
      return { scenario };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.delete('/v1/ideas/:id/scenarios/:scenarioId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    if (!idea.construire) return reply.code(404).send({ error: 'canvas non initialisé' });
    try {
      const { removeScenario } = await import('../../../core/index.mjs');
      const { canvas } = removeScenario(idea.construire, req.params.scenarioId);
      const out = { ...idea, construire: canvas, updatedAt: new Date().toISOString() };
      await ctx.ideas.save(out);
      ctx.journal({ type: 'construire.remove', by: me.email, ideaId: idea.id, scenarioId: req.params.scenarioId });
      return { supprimé: true };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });
}
