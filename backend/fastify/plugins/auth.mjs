import fp from 'fastify-plugin';

export default fp(async function authPlugin(app) {
  app.decorate('requireAuth', async function (req, reply) {
    const { auth } = app.kayrosContext;
    if (!auth) { reply.code(503).send({ error: 'authentification non configuree (KAYROS_AUTH_SECRET)' }); return null; }
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) { reply.code(401).send({ error: 'jeton requis' }); return null; }
    try { return await auth.verify(token); }
    catch (e) { reply.code(401).send({ error: e.message }); return null; }
  });
});
