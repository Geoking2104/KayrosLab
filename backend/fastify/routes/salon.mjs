import { emptySalonState } from '../lib/salon-state.mjs';

export default async function salonRoutes(app) {
  app.get('/v1/salon/state', async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    const store = app.kayrosContext.salonState;
    if (!store) return reply.code(503).send({ error: 'salon indisponible' });
    const state = (await store.get(me.sub)) || emptySalonState();
    return { state };
  });

  app.put('/v1/salon/state', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    const store = app.kayrosContext.salonState;
    if (!store) return reply.code(503).send({ error: 'salon indisponible' });
    const incoming = req.body?.state ?? req.body;
    try {
      const state = await store.put(me.sub, incoming);
      return { ok: true, state };
    } catch (error) {
      if (error.code === 'SALON_TOO_LARGE') return reply.code(413).send({ error: error.message });
      if (error.code === 'SALON_USER') return reply.code(400).send({ error: error.message });
      return reply.code(400).send({ error: error.message });
    }
  });
}
