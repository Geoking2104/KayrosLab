import { z } from 'zod';

// KayrosLab — Routes HTTP du canvas d'ideation.
// Expose `core/canvas/` derriere l'authentification et l'isolation tenant du
// backend. Le `tenantId` provient TOUJOURS du jeton, jamais du corps de requete
// (EF-48 / EF-206) : c'est la regle du backend, et elle vaut ici aussi.

const noeudSchema = z.object({
  id: z.string().optional(),
  titre: z.string().min(1),
  type: z.string().optional(),
  corps: z.string().optional(),
  x: z.number().optional(), y: z.number().optional(),
  provenance: z.any().optional(),
});

const areteSchema = z.object({
  id: z.string().optional(),
  from: z.string().min(1), to: z.string().min(1),
  relation: z.enum(['soutient', 'contredit', 'derive', 'depend', 'remplace']),
  label: z.string().nullish(),
});

export default async function canvasRoutes(app) {
  const ctx = () => app.kayrosContext;

  /**
   * Diffuse le nouvel etat aux autres participants (EF-220).
   * Silencieux si le temps reel n'est pas configure : la mutation a deja
   * reussi, l'absence de diffusion ne doit pas la faire echouer.
   */
  const diffuser = (ws) => { try { ctx().canvasHub?.publish(ws.id, ws); } catch { /* diffusion non critique */ } };

  /** Charge un canvas en verifiant l'appartenance au tenant du jeton. */
  async function charger(req, reply, me) {
    const ws = await ctx().canvas.repo.get(req.params.id);
    if (!ws) { reply.code(404).send({ error: 'canvas introuvable' }); return null; }
    // Un canvas d'un autre tenant est INTROUVABLE, pas « interdit » : repondre
    // 403 confirmerait son existence a qui n'y a pas droit.
    if ((ws.tenantId ?? 'default') !== me.tenantId) { reply.code(404).send({ error: 'canvas introuvable' }); return null; }
    return ws;
  }

  // --- Espaces ------------------------------------------------------------

  app.get('/v1/canvas', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const { q, ideaId } = req.query || {};
    return { workspaces: await ctx().canvas.repo.list({ tenantId: me.tenantId, q, ideaId }) };
  });

  app.post('/v1/canvas', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const parsed = z.object({ id: z.string().optional(), nom: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'nom requis', issues: parsed.error.issues });
    const ws = await ctx().canvas.create({
      id: parsed.data.id ?? `ws_${Date.now()}`,
      nom: parsed.data.nom, tenantId: me.tenantId, createdBy: me.email,
    });
    return reply.code(201).send({ workspace: ws });
  });

  app.get('/v1/canvas/:id', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    const { stats } = await import('../../../core/canvas/index.mjs');
    return { workspace: ws, stats: stats(ws) };
  });

  // --- Noeuds et aretes ---------------------------------------------------

  app.post('/v1/canvas/:id/nodes', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    const parsed = noeudSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'titre requis', issues: parsed.error.issues });
    try {
      const next = await ctx().canvas.addNode(ws.id, { ...parsed.data, authorId: me.email, authorKind: 'human' });
      diffuser(next);
      return reply.code(201).send({ workspace: next });
    } catch (e) { return reply.code(409).send({ error: e.message }); }
  });

  app.patch('/v1/canvas/:id/nodes/:nodeId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    const { updateNode } = await import('../../../core/canvas/index.mjs');
    try {
      const next = updateNode(ws, req.params.nodeId, req.body ?? {}, { by: me.email });
      await ctx().canvas.repo.save(next);
      diffuser(next);
      return { workspace: next };
    } catch (e) { return reply.code(404).send({ error: e.message }); }
  });

  app.delete('/v1/canvas/:id/nodes/:nodeId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    const { removeNode } = await import('../../../core/canvas/index.mjs');
    try {
      const next = removeNode(ws, req.params.nodeId, { by: me.email });
      await ctx().canvas.repo.save(next);
      diffuser(next);
      return { workspace: next };
    } catch (e) { return reply.code(404).send({ error: e.message }); }
  });

  app.post('/v1/canvas/:id/edges', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    const parsed = areteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'arete invalide', issues: parsed.error.issues });
    const { addEdge } = await import('../../../core/canvas/index.mjs');
    try {
      const next = addEdge(ws, { ...parsed.data, authorId: me.email, authorKind: 'human' });
      await ctx().canvas.repo.save(next);
      diffuser(next);
      return reply.code(201).send({ workspace: next });
    } catch (e) { return reply.code(409).send({ error: e.message }); }
  });

  // --- Structuration ------------------------------------------------------

  app.post('/v1/canvas/:id/recluster', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    const r = await ctx().canvas.recluster(ws.id, { llm: ctx().engine.llm, seuil: req.body?.seuil });
    diffuser(r.workspace);
    return { clusters: r.clusters, nonIndexes: r.nonIndexes, singletons: r.singletons, workspace: r.workspace };
  });

  app.get('/v1/canvas/:id/duplicates', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    // EF-217 : suggestions uniquement. Aucune route n'applique une fusion
    // automatiquement — la fusion exige un appel explicite du client.
    return { suggestions: await ctx().canvas.duplicates(ws.id) };
  });

  app.get('/v1/canvas/:id/search', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    const { q, k } = req.query || {};
    if (!q) return reply.code(400).send({ error: 'parametre q requis' });
    return { resultats: await ctx().canvas.search(ws.id, q, Number(k) || 10) };
  });

  // --- Ingestion ----------------------------------------------------------

  app.get('/v1/canvas/:id/quota', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    return ctx().canvas.quota(ws.id, Number(req.query?.taille) || 0);
  });

  app.post('/v1/canvas/:id/sources', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    const parsed = z.object({ nom: z.string().min(1), mime: z.string().optional(), contenu: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'nom et contenu requis', issues: parsed.error.issues });
    const r = await ctx().canvas.ingest(ws.id, { ...parsed.data, by: me.email });
    // Un refus (plafond, sensibilite) est un 422 motive, pas un 500 : le client
    // doit pouvoir distinguer « refuse pour telle raison » d'une panne.
    return r.ok ? reply.code(201).send(r) : reply.code(422).send(r);
  });

  app.delete('/v1/canvas/:id/sources/:docId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    try {
      const r = await ctx().canvas.retireDoc(ws.id, req.params.docId, { by: me.email });
      return { docId: r.docId, chunksRetires: r.chunkIds.length, workspace: r.workspace };
    } catch (e) { return reply.code(404).send({ error: e.message }); }
  });

  // --- Sparring -----------------------------------------------------------

  app.post('/v1/canvas/:id/nodes/:nodeId/swarm', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    try {
      const r = await ctx().canvas.swarm(ws.id, req.params.nodeId, { personaIds: req.body?.personaIds ?? null, by: me.email });
      return { crees: r.crees, desaccords: r.desaccords, appuis: r.appuis, echecs: r.echecs, cout: r.cout, workspace: r.workspace };
    } catch (e) { return reply.code(404).send({ error: e.message }); }
  });

  app.post('/v1/canvas/:id/nodes/:nodeId/framework', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    const nom = req.body?.nom;
    try {
      const r = nom === 'pre-mortem'
        ? await ctx().canvas.preMortem(ws.id, req.params.nodeId, { horizon: req.body?.horizon, by: me.email })
        : await ctx().canvas.framework(ws.id, req.params.nodeId, nom, { by: me.email });
      return { crees: r.crees, echecs: r.echecs ?? [], causes: r.causes, couverture: r.couverture, workspace: r.workspace };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  // --- Convergence --------------------------------------------------------

  app.post('/v1/canvas/:id/matrix', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    const { buildMatrix } = await import('../../../core/canvas/index.mjs');
    return buildMatrix(ws, req.body?.notes ?? {});
  });

  app.post('/v1/canvas/:id/promote', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    const parsed = z.object({ nodeId: z.string().optional(), clusterId: z.string().optional(), ideaId: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'requete invalide' });
    const { promote, createIdea } = await import('../../../core/canvas/index.mjs');
    const ideaId = parsed.data.ideaId ?? `D${Date.now()}`;
    try {
      const r = promote(ws, { ...parsed.data, ideaId, author: me.email, tenantId: me.tenantId });
      await ctx().canvas.repo.save(r.workspace);
      // L'idee rejoint le portefeuille : c'est la charniere du produit.
      if (ctx().ideas?.save) await ctx().ideas.save(r.idea);
      return reply.code(201).send({ idea: r.idea, traitement: r.traitement });
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.get('/v1/canvas/:id/origin/:ideaId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    const { originOf } = await import('../../../core/canvas/index.mjs');
    const o = originOf(ws, req.params.ideaId);
    return o ? o : reply.code(404).send({ error: 'idee non issue de ce canvas' });
  });

  // --- Journal ------------------------------------------------------------

  app.get('/v1/canvas/:id/journal/verify', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    if (!ctx().canvasJournal) return reply.code(503).send({ error: 'journal non configure' });
    return ctx().canvasJournal.verify(ws.id);
  });

  app.get('/v1/canvas/:id/journal/export', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = await charger(req, reply, me); if (!ws) return;
    if (!ctx().canvasJournal) return reply.code(503).send({ error: 'journal non configure' });
    const log = await ctx().canvasJournal.load(ws.id);
    reply.header('content-type', 'application/x-ndjson');
    return log.toJSONL();
  });
}
