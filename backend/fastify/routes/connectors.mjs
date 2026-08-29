import {
  createIdempotenceStore,
  platformUserId,
  slackInteractionId,
} from '../../../core/connectors-slack-deep.mjs';
import {
  discordInteractionId,
} from '../../../core/connectors-discord-deep.mjs';
import {
  teamsActivityId,
} from '../../../core/connectors-teams-deep.mjs';
import {
  buildMotifModal,
  parseMotifSubmission,
  updateGateMessage,
  isMotifCallback,
} from '../../../core/connectors-motif.mjs';

const interactionIds = createIdempotenceStore(4000);
const discordInteractions = createIdempotenceStore(4000);
const teamsInteractions = createIdempotenceStore(4000);

function discordCommandText(body) {
  const options = body?.data?.options || [];
  const flattened = options.flatMap((option) => option?.options || [option]);
  return String(flattened.find((option) => ['question', 'prompt', 'message'].includes(option?.name))?.value || '').trim();
}

function compactChatReply(summary) {
  return String(summary?.text || 'Le collectif n’a pas produit de synthèse.').slice(0, 1900);
}

export default async function connectorsRoute(app) {
  async function configured(req, reply, platform) {
    try {
      const connection = await app.kayrosContext.connectorConfig.connection(req.params.connectionId, platform);
      app.kayrosContext.hybridGateway.setTenantAdapter(connection.row.tenant_id, connection.adapter);
      return connection;
    } catch (error) {
      req.log.warn({ err: error, platform }, 'configured connector rejected');
      reply.code(404).send({ error: 'connexion active introuvable' });
      return null;
    }
  }

  app.post('/v1/connectors/slack/configured/:connectionId', async (req, reply) => {
    const connection = await configured(req, reply, 'slack'); if (!connection) return;
    const rawBody = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body ?? {});
    if (!(await connection.adapter.verifySignature({ headers: req.headers, rawBody }))) return reply.code(401).send({ error: 'invalid slack signature' });
    const body = req.body || {};
    if (body.type === 'url_verification') return reply.send({ challenge: body.challenge });
    const event = body.event || {};
    if (!['app_mention', 'message'].includes(event.type) || event.bot_id || event.subtype) return reply.send({ ok: true });
    try {
      const result = await app.kayrosContext.hybridGateway.handleMessage({
        platform: 'slack', external_room_id: event.channel, message_id: event.client_msg_id || event.ts,
        user_id: platformUserId('slack', event.user), text: event.text,
        explicit: event.type === 'app_mention' || event.channel_type === 'im',
        context: event.thread_ts ? `Thread Slack ${event.thread_ts}` : '', publish: true,
        tenantId: connection.row.tenant_id,
      });
      return reply.send({ ok: true, ignored: !!result.ignored, thread_id: result.thread?.thread_id || null });
    } catch (error) {
      req.log.warn({ err: error }, 'configured slack message ignored');
      return reply.send({ ok: true, ignored: true, reason: error.message });
    }
  });

  app.post('/v1/connectors/discord/configured/:connectionId', async (req, reply) => {
    const connection = await configured(req, reply, 'discord'); if (!connection) return;
    const rawBody = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body ?? {});
    if (!(await connection.adapter.verifySignature({ headers: req.headers, rawBody, body: req.body }))) return reply.code(401).send({ error: 'invalid discord signature' });
    const body = req.body || {};
    if (body.type === 1) return reply.send({ type: 1 });
    if (body.type !== 2 || String(body.data?.name || '').toLowerCase() !== 'kayros') return reply.send({ type: 4, data: { content: 'Interaction non prise en charge.', flags: 64 } });
    const text = discordCommandText(body);
    if (!text) return reply.send({ type: 4, data: { content: 'Ajoutez une question après /kayros.', flags: 64 } });
    try {
      const result = await app.kayrosContext.hybridGateway.handleMessage({
        platform: 'discord', external_room_id: body.channel_id || body.channel?.id, message_id: body.id,
        user_id: platformUserId('discord', body.member?.user?.id || body.user?.id), text, explicit: true,
        context: `Commande Discord · serveur ${body.guild_id || 'direct'}`, tenantId: connection.row.tenant_id,
      });
      return reply.send({ type: 4, data: { content: compactChatReply(result.summary) } });
    } catch (error) {
      return reply.send({ type: 4, data: { content: `Kayros n’a pas pu traiter ce salon : ${error.message}`, flags: 64 } });
    }
  });

  app.post('/v1/connectors/teams/configured/:connectionId', async (req, reply) => {
    const connection = await configured(req, reply, 'teams'); if (!connection) return;
    if (!(await connection.adapter.verifySignature({ headers: req.headers }))) return reply.code(401).send({ error: 'invalid teams token' });
    const body = req.body || {};
    if (body.type !== 'message' || !body.text) return reply.send({ statusCode: 200 });
    try {
      const result = await app.kayrosContext.hybridGateway.handleMessage({
        platform: 'teams', external_room_id: body.conversation?.id, message_id: body.id,
        user_id: platformUserId('teams', body.from?.id), text: body.text, explicit: true,
        context: `Conversation Teams · ${body.channelData?.team?.name || body.conversation?.name || 'direct'}`,
        tenantId: connection.row.tenant_id,
      });
      return reply.send({ type: 'message', text: compactChatReply(result.summary) });
    } catch (error) {
      return reply.send({ type: 'message', text: `Kayros n’a pas pu traiter ce salon : ${error.message}` });
    }
  });

  // Slack Events API — app_mention and direct messages are routed to a room.
  app.post('/v1/connectors/slack/events', async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.slackAdapter) return reply.code(200).send({ ok: true });
    const rawBody = typeof req.rawBody === 'string'
      ? req.rawBody
      : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    const okSig = await ctx.slackAdapter.verifySignature({ headers: req.headers, rawBody });
    if (!okSig) return reply.code(401).send({ error: 'invalid slack signature' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (body.type === 'url_verification') return reply.code(200).send({ challenge: body.challenge });
    const event = body.event || {};
    if (!['app_mention', 'message'].includes(event.type) || event.bot_id || event.subtype) return reply.code(200).send({ ok: true });
    try {
      const result = await ctx.hybridGateway.handleMessage({
        platform: 'slack', external_room_id: event.channel,
        message_id: event.client_msg_id || event.ts,
        user_id: platformUserId('slack', event.user),
        text: event.text,
        explicit: event.type === 'app_mention' || event.channel_type === 'im',
        context: event.thread_ts ? `Thread Slack ${event.thread_ts}` : '',
        publish: true,
      });
      return reply.code(200).send({ ok: true, ignored: result.ignored || false, run_id: result.run?.run_id || null });
    } catch (error) {
      req.log.warn({ err: error }, 'slack hybrid-agent message ignored');
      return reply.code(200).send({ ok: true, ignored: true, reason: error.message });
    }
  });

  // Slack interactive endpoint (Block actions, modals, slash)
  app.post('/v1/connectors/slack/interactive', async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.slackAdapter) return reply.code(200).send('');

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

    // view_submission for motif modal (v14)
    if (payload.type === 'view_submission' && isMotifCallback(payload.view?.callback_id)) {
      const iid = slackInteractionId(payload);
      if (iid && interactionIds.seen(iid)) {
        return reply.code(200).send({ response_action: 'clear' });
      }
      const parsed = parseMotifSubmission(payload);
      if (!parsed.decision || !parsed.gateId) {
        return reply.code(200).send({
          response_action: 'errors',
          errors: { motif_block: 'Invalid gate context' },
        });
      }
      if (!parsed.reason || parsed.reason.length < 3) {
        return reply.code(200).send({
          response_action: 'errors',
          errors: { motif_block: 'Motif required (min 3 characters)' },
        });
      }
      const platformId = platformUserId('slack', parsed.userId);
      const profile = ctx.linkService?.get(platformId);
      if (!profile) {
        return reply.code(200).send({
          response_action: 'errors',
          errors: { motif_block: 'Account not linked to KayrosLab' },
        });
      }
      try {
        const evt = {
          platform: 'slack',
          actionId: `${parsed.decision}:${parsed.gateId}`,
          userId: platformId,
          channelId: parsed.channelId,
          payload: { reason: parsed.reason },
          raw: payload,
        };
        // Force resolve path with reason (skip second modal)
        const res = await ctx.connectorService.handleInteraction({
          ...evt,
          // marker so _handleGate does not re-open modal
          _motifConfirmed: true,
        });
        // Update original message if possible
        const rec = ctx.governance?.list?.()?.find?.((g) => g.gateId === parsed.gateId)
          || ctx.governance?._history?.find?.((g) => g.gateId === parsed.gateId);
        await updateGateMessage(ctx.slackAdapter, {
          channelId: parsed.channelId,
          messageTs: parsed.messageTs,
          resolution: {
            decision: parsed.decision,
            by: profile.email,
            reason: parsed.reason,
            resolvedAt: new Date().toISOString(),
          },
          ideaTitre: rec?.ideaId || '',
        });
        if (res?.type === 'ephemeral' && res.text) {
          return reply.code(200).send({ response_action: 'clear' });
        }
        return reply.code(200).send({ response_action: 'clear' });
      } catch (e) {
        return reply.code(200).send({
          response_action: 'errors',
          errors: { motif_block: e.message || 'Resolve failed' },
        });
      }
    }

    // EF-92 — idempotence for block_actions
    const iid = slackInteractionId(payload);
    if (iid && interactionIds.seen(iid)) {
      return reply.code(200).send({ response_type: 'ephemeral', text: 'Already processed.' });
    }

    const evt = ctx.slackAdapter.parseRequest({ body: payload, headers: req.headers });
    if (!evt) return reply.code(200).send('');

    if (evt.userId) evt.userId = platformUserId('slack', evt.userId);

    // Capture message ts for later chat.update
    evt._messageTs = payload.message?.ts || payload.container?.message_ts || null;
    evt.channelId = evt.channelId || payload.channel?.id || payload.container?.channel_id || null;

    const res = await ctx.connectorService.handleInteraction(evt);

    // Button path: reject/revise → push motif modal
    if (res.type === 'modal') {
      const action = String(evt.actionId || '');
      const decision = action.startsWith('reject:') ? 'reject'
        : action.startsWith('revise:') ? 'revise' : null;
      const gateId = decision ? action.slice(decision.length + 1) : null;
      if (decision && gateId) {
        const view = buildMotifModal({
          decision,
          gateId,
          channelId: evt.channelId || '',
          messageTs: evt._messageTs || '',
        });
        return reply.code(200).send({ response_action: 'push', view });
      }
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

    // Approve: update message in place
    if (res.type === 'ack' && evt.actionId?.startsWith('approve:')) {
      await updateGateMessage(ctx.slackAdapter, {
        channelId: evt.channelId,
        messageTs: evt._messageTs,
        resolution: {
          decision: 'approve',
          by: ctx.linkService?.get(evt.userId)?.email || evt.userId,
          reason: evt.payload?.reason || '',
          resolvedAt: new Date().toISOString(),
        },
        ideaTitre: '',
      });
      return reply.code(200).send('');
    }

    if (res.type === 'ack') return reply.code(200).send('');
    if (res.type === 'ephemeral') {
      return reply.code(200).send({ response_type: 'ephemeral', text: res.text });
    }
    return reply.code(200).send('');
  });

  // Discord interactive endpoint (Interactions API: PING, slash, buttons, modal)
  app.post('/v1/connectors/discord/interactive', async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.discordAdapter) return reply.code(200).send('');

    const rawBody = typeof req.rawBody === 'string'
      ? req.rawBody
      : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    const okSig = await ctx.discordAdapter.verifySignature({ headers: req.headers, rawBody });
    if (!okSig) return reply.code(401).send({ error: 'invalid discord signature' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});

    // Interactions framework: PING must always be answered with a pong (type 1)
    if (body.type === 1) return reply.code(200).send({ type: 1 });

    // /kayros question: execute the room's hybrid team and answer in-channel.
    if (body.type === 2 && String(body.data?.name || '').toLowerCase() === 'kayros') {
      const text = discordCommandText(body);
      if (!text) return reply.code(200).send({ type: 4, data: { content: 'Ajoutez une question après /kayros.', flags: 64 } });
      try {
        const result = await ctx.hybridGateway.handleMessage({
          platform: 'discord', external_room_id: body.channel_id || body.channel?.id,
          message_id: body.id,
          user_id: platformUserId('discord', body.member?.user?.id || body.user?.id),
          text,
          explicit: true,
          context: `Commande Discord · serveur ${body.guild_id || 'direct'}`,
        });
        return reply.code(200).send({ type: 4, data: { content: compactChatReply(result.summary) } });
      } catch (error) {
        return reply.code(200).send({ type: 4, data: { content: `Kayros n’a pas pu traiter ce salon : ${error.message}`, flags: 64 } });
      }
    }

    const iid = discordInteractionId(body);
    if (iid && discordInteractions.seen(iid)) {
      return reply.code(200).send({ type: 4, data: { content: 'Déjà traité.', flags: 64 } });
    }

    let evt = ctx.discordAdapter.parseRequest({ body, headers: req.headers });
    if (!evt) return reply.code(200).send('');

    if (evt.userId) evt.userId = platformUserId('discord', evt.userId);
    evt.channelId = evt.channelId || body.channel?.id || null;

    // Modal submit for a gate motif → resolve with reason (EF-20)
    const callback = String(evt.actionId || '');
    if (body.type === 5 && callback.startsWith('gate_motif:')) {
      const parts = callback.split(':');
      const decision = parts[1];
      const gateId = parts.slice(2).join(':');
      evt.actionId = `${decision}:${gateId}`;
      evt._motifConfirmed = true;
      evt.payload = { reason: String(evt.payload.fields?.reason ?? '').trim() };
    }

    const res = await ctx.connectorService.handleInteraction(evt);

    if (res.type === 'modal') {
      const action = String(evt.actionId || '');
      const decision = action.startsWith('reject:') ? 'reject' : action.startsWith('revise:') ? 'revise' : null;
      const gateId = decision ? action.slice(decision.length + 1) : null;
      const modal = ctx.discordAdapter.renderModalData({
        title: decision === 'reject' ? 'Motif du refus (obligatoire)' : 'Motif de la revision',
        custom_id: `gate_motif:${decision}:${gateId ?? 'g'}`,
        fields: [{ id: 'reason', label: 'Motif (obligatoire)', multiline: true, required: true }],
      });
      return reply.code(200).send({ type: 9, data: modal });
    }
    if (res.type === 'ack') return reply.code(200).send({ type: 4, data: { content: res.text ?? 'OK' } });
    if (res.type === 'ephemeral') {
      return reply.code(200).send({ type: 4, data: { content: res.text ?? '', flags: 64 } });
    }

    try {
      const om = await ctx.discordAdapter.openModal(evt.payload?.interactionToken || '', res.view);
      return reply.code(200).send(om.response ?? { type: 4, data: { content: '' } });
    } catch {
      return reply.code(200).send({ type: 4, data: { content: '' } });
    }
  });

  app.post('/v1/connectors/teams/interactive', async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.teamsAdapter) return reply.code(200).send('');

    const okSig = await ctx.teamsAdapter.verifySignature({ headers: req.headers });
    if (!okSig) return reply.code(401).send({ error: 'invalid teams token' });

    const body = req.body ?? {};

    // Direct Bot Framework message. Interactive card submissions keep using
    // the existing governance path below.
    const teamsRoomId = body.conversation?.id;
    const hasTeamsRoom = (await ctx.hybridGateway.listRooms({ platform: 'teams' }))
      .some((room) => room.external_room_id === teamsRoomId);
    if (body.type === 'message' && body.text && !body.value && hasTeamsRoom) {
      try {
        const result = await ctx.hybridGateway.handleMessage({
          platform: 'teams', external_room_id: teamsRoomId,
          message_id: body.id,
          user_id: platformUserId('teams', body.from?.id),
          text: body.text,
          explicit: true,
          context: `Conversation Teams · ${body.channelData?.team?.name || body.conversation?.name || 'direct'}`,
        });
        return reply.code(200).send({ type: 'message', text: compactChatReply(result.summary) });
      } catch (error) {
        return reply.code(200).send({ type: 'message', text: `Kayros n’a pas pu traiter ce salon : ${error.message}` });
      }
    }

    // Idempotence sur les activities recues (retries Bot Framework)
    const iid = teamsActivityId(body);
    if (iid && teamsInteractions.seen(iid)) {
      return reply.code(200).send({ statusCode: 200 });
    }

    let evt = ctx.teamsAdapter.parseRequest({ body, headers: req.headers });
    if (!evt) return reply.code(200).send({ statusCode: 200 });

    if (evt.userId) evt.userId = platformUserId('teams', evt.userId);
    evt.channelId = evt.channelId || body.conversation?.id || null;

    // Resoumission du motif (Adaptive Card) → resolve avec raison (EF-20)
    const callback = String(evt.actionId || '');
    if (callback.startsWith('gate_motif:')) {
      const parts = callback.split(':');
      const decision = parts[1];
      const gateId = parts.slice(2).join(':');
      evt.actionId = `${decision}:${gateId}`;
      evt._motifConfirmed = true;
      evt.payload = { reason: String(evt.payload?.reason ?? '').trim() };
    }

    const res = await ctx.connectorService.handleInteraction(evt);

    if (res.type === 'modal') {
      const action = String(evt.actionId || '');
      const decision = action.startsWith('reject:') ? 'reject' : action.startsWith('revise:') ? 'revise' : null;
      const gateId = decision ? action.slice(decision.length + 1) : null;
      const card = ctx.teamsAdapter.renderMotifCard({
        title: decision === 'reject' ? 'Motif du refus (obligatoire)' : 'Motif de la revision',
        data: { actionId: `gate_motif:${decision}:${gateId ?? 'g'}` },
      });
      return reply.code(200).send({ statusCode: 200, type: 'application/vnd.microsoft.card.adaptive', value: card });
    }
    if (res.type === 'ack' || res.type === 'ephemeral') {
      return reply.code(200).send({ statusCode: 200 });
    }
    return reply.code(200).send({ statusCode: 200 });
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
      const result = await app.kayrosContext.linkService.link(req.params.token, {
        id: me.sub, email: me.email, role: me.role, tenantId: me.tenantId,
      });
      return { ok: true, platformId: result.platformId };
    } catch (e) {
      return reply.code(400).send({ error: e.message });
    }
  });

  app.get('/v1/connectors/links', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const all = typeof app.kayrosContext.linkService.list === 'function'
      ? app.kayrosContext.linkService.list()
      : [];
    return { links: all.filter((l) => l.tenantId === me.tenantId || l.kayrosUserId === me.sub) };
  });
}
