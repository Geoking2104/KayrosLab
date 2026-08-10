import { z } from 'zod';

export default async function impactRoute(app) {
  const projectionSchema = z.object({
    scenarios: z.array(z.any()).optional(),
    variables: z.array(z.any()).optional(),
    milestones: z.array(z.any()).optional(),
    costHypotheses: z.object({}).passthrough().optional(),
    seed: z.number().optional(),
  });

  const impactSchema = z.object({
    type: z.enum(['investissement', 'benefice', 'releve']),
    montant: z.number().optional(),
    libelle: z.string().optional(),
    kpiId: z.string().optional(),
    value: z.number().optional(),
  });

  const scoreSchema = z.object({
    scorecardId: z.string().optional(),
    values: z.object({}).passthrough().optional().default({}),
  });

  async function chargerIdee(req, reply, me) {
    const idea = await app.kayrosContext.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) { reply.code(404).send({ error: 'introuvable' }); return null; }
    return idea;
  }

  app.post('/v1/ideas/:id/projection', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const idea = await chargerIdee(req, reply, me); if (!idea) return;
    const parsed = projectionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    const { scenarios, variables, milestones, costHypotheses, seed } = parsed.data;
    try {
      const { simulateTrajectory, estimateResources } = await import('../../../core/index.mjs');
      const projection = scenarios?.length ? simulateTrajectory({ scenarios, variables, seed }) : null;
      const ressources = milestones?.length ? estimateResources({ milestones, costHypotheses }) : null;
      const out = { ...idea, projection, ressources, updatedAt: new Date().toISOString() };
      await app.kayrosContext.ideas.save(out);
      return { projection, ressources };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.post('/v1/ideas/:id/impact', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const idea = await chargerIdee(req, reply, me); if (!idea) return;
    const parsed = impactSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'type attendu', issues: parsed.error.issues });
    const { type, montant, libelle, kpiId, value } = parsed.data;
    const { emptyImpact, recordInvestment, recordBenefit, recordActual, impactReport } = await import('../../../core/index.mjs');
    let impact = idea.impact ?? emptyImpact();
    try {
      if (type === 'investissement') impact = recordInvestment(impact, { montant, libelle });
      else if (type === 'benefice') impact = recordBenefit(impact, { montant, libelle });
      else if (type === 'releve') impact = recordActual(impact, { kpiId, value });
      const out = { ...idea, impact, updatedAt: new Date().toISOString() };
      await app.kayrosContext.ideas.save(out);
      return { rapport: impactReport(idea.projection ?? {}, impact) };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.get('/v1/ideas/:id/impact', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const idea = await chargerIdee(req, reply, me); if (!idea) return;
    const { emptyImpact, impactReport } = await import('../../../core/index.mjs');
    return { projection: idea.projection ?? null, ressources: idea.ressources ?? null, rapport: impactReport(idea.projection ?? {}, idea.impact ?? emptyImpact()) };
  });

  app.post('/v1/ideas/:id/score', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const idea = await chargerIdee(req, reply, me); if (!idea) return;
    const parsed = scoreSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    const { scorecardId, values } = parsed.data;
    const ctx = app.kayrosContext;
    const card = scorecardId ? ctx.scorecards.get(scorecardId) : (ctx.scorecards.forStage(idea.stage)[0] ?? null);
    if (!card) return reply.code(400).send({ error: `aucune grille pour l'etape "${idea.stage}"` });
    try {
      const resultat = card.score(values);
      const entree = { scorecardId: card.id, values, resultat, by: me.email, ts: new Date().toISOString() };
      const scores = { ...(idea.scores ?? {}), [card.id]: entree };
      const scoreHistory = [...(idea.scoreHistory ?? []), entree];
      await ctx.ideas.save({ ...idea, scores, scoreHistory, ki: resultat.normalise, updatedAt: entree.ts });
      return { resultat, historique: scoreHistory.length };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });
}
