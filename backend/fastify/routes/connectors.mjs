import {
  createIdempotenceStore,
  platformUserId,
  slackInteractionId,
} from '../../../core/connectors-slack-deep.mjs';

const interactionIds = createIdempotenceStore(4000);

export default async function connectorsRoute(app) {
  // Slack interactive endpoint (Block actions, modals, slash)
  app.post('/v1/connectors/slack/interactive', async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.slackAdapter) return reply.code(200).send('');

    // EF-89 — verify signature when secret is set
    const rawBody = typeof req.rawBody === 'string'
      ? req.rawBody
      : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    const okSig = await ctx.slackAdapter.verifySignature({
      headers: req.headers,
      rawBody,
    });
    if (!okSig) return reply.code(401).send({ error: 'invalid slack signature' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    let payload = body;
    if (body.payload) {
      try { payload = JSON.parse(body.payload); } catch { payload = body; }
    }

    // EF-92 — idempotence
    const iid = slackInteractionId(payload);
    if (iid && interactionIds.seen(iid)) {
      return reply.code(200).send({ response_type: 'ephemeral', text: 'Already processed.' });
    }

    const evt = ctx.slackAdapter.parseRequest({ body: payload, headers: req.headers });
    if (!evt) return reply.code(200).send('');

    // Normalize platform user id for AccountLinkService
    if (evt.userId) evt.userId = platformUserId('slack', evt.userId);

    const res = await ctx.connectorService.handleInteraction(evt);
    if (res.type === 'ack') return reply.code(200).send('');
    if (res.type === 'ephemeral') {
      return reply.code(200).send({ response_type: 'ephemeral', text: res.text });
    }
    if (res.type === 'modal' && res.view) {
      const blocks = ctx.slackAdapter.renderView(res.view);
      return reply.code(200).send({
        response_action: 'push',
        view: {
          type: 'modal',
          callback_id: 'gate_motif',
          title: { type: 'plain_text', text: String(res.view.title || 'KayrosLab').slice(0, 24) },
          blocks,
          submit: { type: 'plain_text', text: 'Confirm' },
        },
      });
    }
    return reply.code(200).send('');
  });

  app.post('/v1/connectors/link', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const { platformId, userId, platform = 'slack' } = req.body || {};
    if (!platformId || !userId) return reply.code(400).send({ error: 'platformId and userId required' });
    const pid = platformUserId(platform, platformId);
    const { token, expiresAt } = app.kayrosContext.linkService.createToken({
      platformId: pid, userId, platform,
    });
    return {
      token,
      expiresAt,
      platformId: pid,
      instructions: 'In KayrosLab: Profile → Link account, paste this token (expires in 15 min).',
    };
  });

  app.post('/v1/connectors/link/:token', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    try {
      const result = app.kayrosContext.linkService.link(req.params.token, {
        id: me.sub, email: me.email, role: me.role, tenantId: me.tenantId,
      });
      return { ok: true, platformId: result.platformId };
    } catch (e) {
      return reply.code(400).send({ error: e.message });
    }
  });
}
