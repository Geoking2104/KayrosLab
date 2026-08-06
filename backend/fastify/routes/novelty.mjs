// KayrosLab — POST /v1/novelty/score (V16)
// Scores idea collisions with the engine-side embedding novelty module.

import { scoreCollisions, buildCollisionEmbedText } from '../../../core/novelty.mjs';

/**
 * @param {import('fastify').FastifyInstance} app
 */
export default async function noveltyRoutes(app) {
  app.post('/v1/novelty/score', async (req, reply) => {
    const body = req.body || {};
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    if (!candidates.length) {
      return reply.code(400).send({ error: 'candidates[] requis' });
    }

    const embeddings = app.kayrosContext?.embeddings;
    if (!embeddings || typeof embeddings.embedBatch !== 'function') {
      return reply.code(503).send({ error: 'embeddings provider indisponible' });
    }

    try {
      const scored = await scoreCollisions(candidates, {
        embeddings,
        inputText: body.inputText || body.idea || '',
        memoryHits: Array.isArray(body.memoryHits) ? body.memoryHits : [],
      });
      return {
        candidates: scored,
        model: embeddings.model || null,
        count: scored.length,
      };
    } catch (e) {
      return reply.code(502).send({ error: String(e.message || e) });
    }
  });

  app.post('/v1/novelty/embed-text', async (req, reply) => {
    const collision = req.body?.collision || req.body || {};
    const text = buildCollisionEmbedText(collision);
    return { text };
  });
}
