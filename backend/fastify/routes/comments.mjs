import { z } from 'zod';

export default async function commentsRoute(app) {
  app.get('/v1/ideas/:id/comments', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const { commentTree, countComments } = await import('../../core/index.mjs');
    return { fil: commentTree(idea.comments ?? []), total: countComments(idea.comments ?? []) };
  });

  app.post('/v1/ideas/:id/comments', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    const parsed = z.object({ texte: z.string().min(1), parentId: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'texte requis', issues: parsed.error.issues });
    const { texte, parentId } = parsed.data;
    try {
      const { addComment, commentTree, countComments } = await import('../../core/index.mjs');
      const comments = addComment(idea.comments ?? [], { by: me.email, role: me.role, texte, parentId: parentId ?? null });
      await ctx.ideas.save({ ...idea, comments, updatedAt: new Date().toISOString() });
      ctx.journal({ type: 'commentaire', by: me.email, ideaId: idea.id, titre: idea.title });
      return reply.code(201).send({ fil: commentTree(comments), total: countComments(comments) });
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.delete('/v1/ideas/:id/comments/:commentId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
    try {
      const { removeComment, commentTree, countComments } = await import('../../core/index.mjs');
      const comments = removeComment(idea.comments ?? [], req.params.commentId, { by: me.email, role: me.role });
      await ctx.ideas.save({ ...idea, comments, updatedAt: new Date().toISOString() });
      return { fil: commentTree(comments), total: countComments(comments) };
    } catch (e) { return reply.code(403).send({ error: e.message }); }
  });
}
