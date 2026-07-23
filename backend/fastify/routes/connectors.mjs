export default async function connectorsRoute(app) {
  app.post('/v1/connectors/slack/interactive', async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.slackAdapter) return reply.code(200).send('');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    let payload = body;
    if (body.payload) try { payload = JSON.parse(body.payload); } catch { payload = body; }
    const evt = ctx.slackAdapter?.parseRequest({ body: payload, headers: req.headers });
    if (!evt) return reply.code(200).send('');
    const res = await ctx.connectorService.handleInteraction(evt);
    if (res.type === 'ack') return reply.code(200).send('');
    if (res.type === 'ephemeral') return reply.code(200).send({ response_type: 'ephemeral', text: res.text });
    if (res.type === 'modal' && res.view) {
      const blocks = ctx.slackAdapter.renderView(res.view);
      return reply.code(200).send({ response_action: 'push', view: { type: 'modal', callback_id: 'gate_motif', title: { text: res.view.title }, blocks, submit: { text: 'Confirmer' } } });
    }
    return reply.code(200).send('');
  });

  app.post('/v1/connectors/link', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const { platformId, userId, platform = 'slack' } = req.body || {};
    if (!platformId || !userId) return reply.code(400).send({ error: 'platformId et userId requis' });
    const { token, expiresAt } = app.kayrosContext.linkService.createToken({ platformId, userId, platform });
    return { token, expiresAt, modeEmploi: `Dans KayrosLab, allez dans Profil > Lier un compte et saisissez ce jeton (expire dans 15 min).` };
  });

  app.post('/v1/connectors/link/:token', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    try {
      const result = app.kayrosContext.linkService.link(req.params.token, { id: me.sub, email: me.email, role: me.role, tenantId: me.tenantId });
      return { ok: true, platformId: result.platformId };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });
}
