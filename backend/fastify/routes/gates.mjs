import { z } from 'zod';

const voteSchema = z.object({ score: z.number().min(0).max(100), comment: z.string().optional() });
const gateOpenSchema = z.object({ type: z.string().optional().default('validation'), requiredRole: z.string().optional().default('comex') });
const gateResolveSchema = z.object({ decision: z.string().min(1), reason: z.string().optional().default('') });

export default async function gatesRoute(app) {
  app.post('/v1/ideas/:id/gates', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const parsed = gateOpenSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });
    const { type, requiredRole } = parsed.data;
    const { aggregateVotes } = await import('../../core/index.mjs');
    const agregat = aggregateVotes(idea.votes ?? []);
    const { gateId } = ctx.governance.open({ ideaId: idea.id, type, requiredRole, payload: idea.title, evaluation: agregat });
    return reply.code(201).send({ gateId, agregat });
  });

  app.get('/v1/gates', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const enrichis = await Promise.all(ctx.governance.list().map(async (g) => {
      const idea = g.ideaId ? await ctx.ideas.get(g.ideaId) : null;
      return {
        gateId: g.gateId, type: g.type, requiredRole: g.requiredRole, ideaId: g.ideaId ?? null,
        titre: idea?.title ?? g.payload ?? g.ideaId,
        agregat: g.evaluation ?? null, createdAt: g.createdAt,
        tenantId: idea?.tenantId ?? 'default', pourMoi: g.requiredRole === me.role,
      };
    }));
    return { gates: enrichis.filter((g) => g.tenantId === me.tenantId).map(({ tenantId, ...g }) => g), monRole: me.role };
  });

  app.post('/v1/gates/:gateId/resolve', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const rec = ctx.governance.list().find((g) => g.gateId === req.params.gateId);
    if (!rec) return reply.code(404).send({ error: 'gate introuvable' });
    const cible = rec.ideaId ? await ctx.ideas.get(rec.ideaId) : null;
    if (cible && (cible.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const parsed = gateResolveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'decision requise', issues: parsed.error.issues });
    const { decision, reason } = parsed.data;
    try {
      const resolution = ctx.governance.resolve(req.params.gateId, { decision, by: me.email, role: me.role, reason });
      if (cible) {
        const { setStatus, setStage } = await import('../../core/index.mjs');
        const map = { approve: 'en_developpement', reject: 'non_poursuivi', revise: 'en_revue' };
        let out = setStatus(cible, map[decision] ?? cible.status, { by: me.email, motif: reason || decision });
        if (decision === 'approve') out = setStage(out, 'projeter', { by: me.email, motif: 'gate approuve' });
        if (decision === 'revise') out = setStage(out, 'eprouver', { by: me.email, motif: 'revision demandee' });
        await ctx.ideas.save(out);
      }
      return { resolution };
    } catch (e) { return reply.code(403).send({ error: e.message }); }
  });
}
