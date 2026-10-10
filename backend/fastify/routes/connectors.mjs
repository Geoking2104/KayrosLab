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

import {
  handleDiscordInteraction,
  handleSlackArbitration,
  handleSlackCommand,
  handleSlackEvent,
  handleTeamsActivity,
} from '../lib/chat-handlers.mjs';

const interactionIds = createIdempotenceStore(4000);
const discordInteractions = createIdempotenceStore(4000);
const teamsInteractions = createIdempotenceStore(4000);

/** Corps Slack : JSON (Events API) ou formulaire (`payload=` des interactions, commandes slash). */
function slackBody(req) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  if (typeof body.payload === 'string') {
    try { return { interactive: true, payload: JSON.parse(body.payload) }; } catch { return { interactive: true, payload: {} }; }
  }
  if (body.command) return { command: true, payload: body };
  return { payload: body };
}

function rawBodyOf(req) {
  return typeof req.rawBody === 'string'
    ? req.rawBody
    : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
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

  // Connexions par espace (console) : même URL pour Events API, interactivité et /kayros.
  app.post('/v1/connectors/slack/configured/:connectionId', async (req, reply) => {
    const connection = await configured(req, reply, 'slack'); if (!connection) return;
    if (!(await connection.adapter.verifySignature({ headers: req.headers, rawBody: rawBodyOf(req) }))) return reply.code(401).send({ error: 'invalid slack signature' });
    const { payload, interactive, command } = slackBody(req);
    if (payload.type === 'url_verification') return reply.send({ challenge: payload.challenge });
    const tenantId = connection.row.tenant_id;
    if (command) return reply.send(await handleSlackCommand(app.kayrosContext, payload, { tenantId }) || '');
    if (interactive) {
      const handled = await handleSlackArbitration(app.kayrosContext, connection.adapter, payload);
      return reply.code(200).send(handled ?? '');
    }
    const result = await handleSlackEvent(app.kayrosContext, payload, { tenantId });
    if (result.reason) req.log.warn({ reason: result.reason }, 'configured slack message ignored');
    return reply.send(result);
  });

  app.post('/v1/connectors/discord/configured/:connectionId', async (req, reply) => {
    const connection = await configured(req, reply, 'discord'); if (!connection) return;
    if (!(await connection.adapter.verifySignature({ headers: req.headers, rawBody: rawBodyOf(req), body: req.body }))) return reply.code(401).send({ error: 'invalid discord signature' });
    const body = req.body || {};
    if (body.type === 1) return reply.send({ type: 1 });
    const handled = await handleDiscordInteraction(app.kayrosContext, connection.adapter, body, { tenantId: connection.row.tenant_id });
    return reply.send(handled || { type: 4, data: { content: 'Interaction non prise en charge.', flags: 64 } });
  });

  app.post('/v1/connectors/teams/configured/:connectionId', async (req, reply) => {
    const connection = await configured(req, reply, 'teams'); if (!connection) return;
    if (!(await connection.adapter.verifySignature({ headers: req.headers }))) return reply.code(401).send({ error: 'invalid teams token' });
    const result = await handleTeamsActivity(app.kayrosContext, connection.adapter, req.body || {}, { tenantId: connection.row.tenant_id });
    return reply.send(result.response || { statusCode: 200 });
  });

  // Slack Events API — app_mention and direct messages are routed to a room.
  app.post('/v1/connectors/slack/events', async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.slackAdapter) return reply.code(200).send({ ok: true });
    if (!ctx.slackAdapter.signingSecret) return reply.code(401).send({ error: 'SLACK_SIGNING_SECRET requis' });
    const okSig = await ctx.slackAdapter.verifySignature({ headers: req.headers, rawBody: rawBodyOf(req) });
    if (!okSig) return reply.code(401).send({ error: 'invalid slack signature' });
    const { payload: body } = slackBody(req);
    if (body.type === 'url_verification') return reply.code(200).send({ challenge: body.challenge });
    // Acquittement immédiat (< 3 s) : le collectif tourne en tâche de fond, le verdict est publié ensuite.
    const result = await handleSlackEvent(ctx, body);
    if (result.reason) req.log.warn({ reason: result.reason }, 'slack hybrid-agent message ignored');
    return reply.code(200).send(result);
  });

  // Slack interactive endpoint (Block actions, modals, slash)
  app.post('/v1/connectors/slack/interactive', async (req, reply) => {
    const ctx = app.kayrosContext;
    if (!ctx.slackAdapter) return reply.code(200).send('');
    if (!ctx.slackAdapter.signingSecret) return reply.code(401).send({ error: 'SLACK_SIGNING_SECRET requis' });

    const okSig = await ctx.slackAdapter.verifySignature({ headers: req.headers, rawBody: rawBodyOf(req) });
    if (!okSig) return reply.code(401).send({ error: 'invalid slack signature' });

    const { payload, command } = slackBody(req);
    if (command) {
      const answered = await handleSlackCommand(ctx, payload);
      if (answered) return reply.code(200).send(answered);
    }
    // Arbitrage des missions (boutons du verdict, modale du motif).
    const arbitration = await handleSlackArbitration(ctx, ctx.slackAdapter, payload);
    if (arbitration !== null) return reply.code(200).send(arbitration);

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

    const okSig = await ctx.discordAdapter.verifySignature({ headers: req.headers, rawBody: rawBodyOf(req) });
    if (!okSig) return reply.code(401).send({ error: 'invalid discord signature' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});

    // Interactions framework: PING must always be answered with a pong (type 1)
    if (body.type === 1) return reply.code(200).send({ type: 1 });

    // /kayros (réponse différée type 5) et arbitrage des missions par boutons.
    const handled = await handleDiscordInteraction(ctx, ctx.discordAdapter, body);
    if (handled) return reply.code(200).send(handled);

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

    // Questions au collectif (salon Teams connecté), « lier » en privé et
    // cartes d'arbitrage des missions ; les gates historiques suivent le chemin ci-dessous.
    const handled = await handleTeamsActivity(ctx, ctx.teamsAdapter, body, { requireRoom: true });
    if (handled.handled) return reply.code(200).send(handled.response || { statusCode: 200 });

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

  // Retour OAuth public des connecteurs : « un bouton » côté console.
  // L'état (state) est à usage unique et expire ; aucun secret ne transite par le navigateur.
  for (const platform of ['slack', 'discord', 'teams']) {
    app.get(`/v1/connectors/${platform}/oauth/callback`, async (req, reply) => {
      const ctx = app.kayrosContext;
      const consoleUrl = String(ctx.consoleUrl || 'https://www.kayroslab.com/console').replace(/\/$/, '');
      try {
        if (!ctx.connectorOAuth) throw new Error('connexion simplifiée indisponible');
        const result = await ctx.connectorOAuth.complete(platform, { state: req.query?.state, query: req.query || {} });
        await ctx.connectorConfig.configure(result.tenantId, platform, { secrets: result.secrets, settings: result.settings, enabled: true });
        const adapter = await ctx.connectorConfig.adapterFor(result.tenantId, platform);
        if (adapter) ctx.hybridGateway.setTenantAdapter(result.tenantId, adapter);
        return reply.redirect(`${consoleUrl}/#settings?connected=${platform}`);
      } catch (error) {
        req.log.warn({ err: error, platform }, 'connector oauth callback failed');
        return reply.redirect(`${consoleUrl}/#settings?connect_error=${encodeURIComponent(error.message)}`);
      }
    });
  }
}
