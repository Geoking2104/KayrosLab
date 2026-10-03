import { createSalonKb } from '../lib/salon-kb.mjs';

/**
 * Routes Salon × OpenKB — pont mémoire contextuelle.
 * Voir docs/SALON-OPENKB.md §9.2. Auth : Bearer Salon (comme les autres routes
 * /v1/salon/*), pas d'accès hors loopback pour le service OpenKB lui-même.
 */
export default async function salonKbRoutes(app) {
  const kb = createSalonKb({});

  app.get('/v1/salon/kb/manifest', async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    return { ok: true, manifest: kb.manifest() };
  });

  app.get('/v1/salon/kb/status/:authorId', async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    const status = kb.status(String(req.params.authorId || ''));
    if (!status) return reply.code(404).send({ ok: false, error: 'auteur inconnu' });
    return { ok: true, status };
  });

  app.post('/v1/salon/kb/query', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    const { authorId, question, context, mode, k } = req.body || {};
    if (!authorId || !question) return reply.code(400).send({ ok: false, error: 'authorId et question requis' });
    const out = await kb.query({
      authorId: String(authorId),
      question: String(question),
      context: context && typeof context === 'object' ? context : {},
      mode: mode === 'answer' ? 'answer' : 'retrieval',
      k: Number(k) || 3,
    });
    if (!out.ok && out.degraded === 'unknown_author') return reply.code(404).send(out);
    return out;
  });
}
