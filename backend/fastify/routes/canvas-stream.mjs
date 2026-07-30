// KayrosLab — Routes temps reel du canvas.
// EF-220 (edition collaborative), EF-221 (reconciliation), EF-230 (streaming).

export default async function canvasStreamRoutes(app) {
  const ctx = () => app.kayrosContext;

  async function autoriser(req, reply) {
    const me = await app.requireAuth(req, reply);
    if (!me) return null;
    const ws = await ctx().canvas.repo.get(req.params.id);
    if (!ws || (ws.tenantId ?? 'default') !== me.tenantId) {
      reply.code(404).send({ error: 'canvas introuvable' });
      return null;
    }
    return { me, ws };
  }

  /**
   * Flux d'evenements. `EventSource` n'emet que des GET et ne porte pas
   * d'en-tete personnalise : le jeton passe donc en parametre de requete.
   * C'est une contrainte du standard, pas un choix — d'ou le refus explicite
   * de journaliser l'URL complete cote serveur.
   */
  app.get('/v1/canvas/:id/stream', async (req, reply) => {
    if (req.query?.token && !req.headers.authorization) {
      req.headers.authorization = `Bearer ${req.query.token}`;
    }
    const a = await autoriser(req, reply); if (!a) return;
    if (!ctx().canvasHub) return reply.code(503).send({ error: 'temps reel non configure' });

    ctx().canvasHub.subscribe({ workspaceId: a.ws.id, reply, identite: a.me });
    // La reponse reste ouverte : Fastify ne doit pas la clore.
    return reply;
  });

  /** EF-221 : le client pousse son etat complet, le serveur fusionne. */
  app.post('/v1/canvas/:id/sync', async (req, reply) => {
    const a = await autoriser(req, reply); if (!a) return;
    if (!ctx().canvasHub) return reply.code(503).send({ error: 'temps reel non configure' });
    try {
      const r = await ctx().canvasHub.reconcilier(a.ws.id, req.body?.workspace, { auteurId: req.body?.abonneId });
      return { workspace: r.workspace, fusionne: r.fusionne, empreinte: r.empreinte };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });

  app.get('/v1/canvas/:id/presence', async (req, reply) => {
    const a = await autoriser(req, reply); if (!a) return;
    return { presence: ctx().canvasHub?.presence(a.ws.id) ?? [] };
  });

  /**
   * EF-230 : swarm STREAME. La variante POST renvoie tout d'un bloc ; ici
   * chaque persona est emise des qu'elle repond, avec le cout cumule. Sur un
   * swarm de six personas, l'ecart d'attente percue est considerable.
   */
  app.get('/v1/canvas/:id/nodes/:nodeId/swarm/stream', async (req, reply) => {
    if (req.query?.token && !req.headers.authorization) {
      req.headers.authorization = `Bearer ${req.query.token}`;
    }
    const a = await autoriser(req, reply); if (!a) return;

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const emettre = (type, data) => {
      try { reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client parti */ }
    };

    // Un client qui ferme l'onglet doit interrompre le swarm, pas le laisser
    // consommer des jetons dans le vide.
    const ctrl = new AbortController();
    reply.raw.on('close', () => ctrl.abort());

    try {
      const personaIds = req.query?.personaIds ? String(req.query.personaIds).split(',').filter(Boolean) : null;
      const r = await ctx().canvas.swarm(a.ws.id, req.params.nodeId, {
        personaIds, by: a.me.email, signal: ctrl.signal,
        onOutput: (s) => emettre('persona', {
          persona: s.persona?.nom, personaId: s.personaId,
          ok: s.ok, verdict: s.verdict ?? null,
          points: s.points ?? [], erreur: s.erreur ?? null,
          cout: s.cout ?? null,
        }),
      });
      emettre('fin', { crees: r.crees, desaccords: r.desaccords, appuis: r.appuis, echecs: r.echecs, cout: r.cout, avorte: r.avorte });
      ctx().canvasHub?.publish(a.ws.id, r.workspace);
    } catch (e) {
      emettre('erreur', { motif: e.message });
    } finally {
      reply.raw.end();
    }
    return reply;
  });
}
