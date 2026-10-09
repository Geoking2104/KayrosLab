// Traitement commun des webhooks Slack / Discord / Teams (application du
// serveur ET connexions par espace configurées depuis la console) :
// acquittement immédiat + mission asynchrone, puis arbitrage par boutons.
// La vérification de signature reste dans les routes, avant tout appel ici.

import { platformUserId } from '../../../core/connectors-slack-deep.mjs';
import {
  ChatReplyService,
  ARBITRATION_REASON_PREFIX,
  CHAT_ARBITRATION_ACTIONS,
  arbitrationActionId,
  parseArbitrationActionId,
  viewForPlatform,
} from '../../../core/chat-replies.mjs';

/** Service de réponses chat du contexte (créé et branché à la passerelle au premier usage). */
export function chatReplies(ctx) {
  if (ctx.chatReplies) return ctx.chatReplies;
  const service = new ChatReplyService({
    gateway: ctx.hybridGateway,
    resolveAdapter: ctx.connectorConfig ? (platform, tenantId) => ctx.connectorConfig.adapterFor(tenantId, platform) : null,
    linkService: ctx.linkService || null,
    users: ctx.userStore || null,
    consoleUrl: ctx.consoleUrl || '',
  }).attach();
  ctx.chatReplies = service;
  return service;
}

/** Lance la mission du collectif en tâche de fond pour un message de chat. */
export async function startChatMission(ctx, { platform, channelId, messageId, userId, text, explicit = false, context = '', tenantId = null, chat, chatExtra = null }) {
  chatReplies(ctx);
  return ctx.hybridGateway.startMessage({
    platform, external_room_id: channelId, message_id: messageId, dedupe: !!messageId,
    user_id: userId, text, explicit, context, ...(tenantId ? { tenantId } : {}),
    // Les missions de chat ne bloquent pas le canal : la file les sérialise.
    allowConcurrent: true, chat, chatExtra,
  });
}

// ---------------------------------------------------------------- Slack

export async function handleSlackEvent(ctx, body, { tenantId = null } = {}) {
  const event = body?.event || {};
  if (!['app_mention', 'message'].includes(event.type) || event.bot_id || event.subtype) return { ok: true };
  try {
    const result = await startChatMission(ctx, {
      platform: 'slack', channelId: event.channel, messageId: event.client_msg_id || event.ts,
      userId: platformUserId('slack', event.user), text: event.text,
      explicit: event.type === 'app_mention' || event.channel_type === 'im',
      context: event.thread_ts ? `Thread Slack ${event.thread_ts}` : '', tenantId,
      chat: { platform: 'slack', channel_id: event.channel, thread_ts: event.thread_ts || event.ts || null },
    });
    return {
      ok: true, ignored: !!result.ignored, duplicate: !!result.duplicate,
      thread_id: result.thread?.thread_id || null, run_id: result.run_id || null,
    };
  } catch (error) {
    return { ok: true, ignored: true, reason: error.message };
  }
}

/** Commande slash `/kayros <question>` : réponse éphémère immédiate, verdict publié ensuite. */
export async function handleSlackCommand(ctx, body, { tenantId = null } = {}) {
  if (!/^\/kayros$/i.test(String(body?.command || ''))) return null;
  const text = String(body.text || '').trim();
  if (!text) return { response_type: 'ephemeral', text: 'Ajoutez une question après /kayros.' };
  try {
    const result = await startChatMission(ctx, {
      platform: 'slack', channelId: body.channel_id, messageId: body.trigger_id || null,
      userId: platformUserId('slack', body.user_id), text, explicit: true, context: 'Commande Slack /kayros', tenantId,
      chat: { platform: 'slack', channel_id: body.channel_id, thread_ts: null },
    });
    if (result.ignored) return { response_type: 'ephemeral', text: 'Question ignorée par Kayros.' };
    return { response_type: 'ephemeral', text: '⏳ Question transmise au collectif : le verdict sera publié dans ce canal.' };
  } catch (error) {
    return { response_type: 'ephemeral', text: `Kayros n’a pas pu traiter ce canal : ${error.message}` };
  }
}

export function slackReasonModal({ action, threadId, channelId, messageTs }) {
  return {
    type: 'modal',
    callback_id: arbitrationActionId(action, threadId, ARBITRATION_REASON_PREFIX),
    private_metadata: JSON.stringify({ channel: channelId || null, message_ts: messageTs || null }),
    title: { type: 'plain_text', text: 'Motif de la décision' },
    submit: { type: 'plain_text', text: 'Valider' },
    close: { type: 'plain_text', text: 'Annuler' },
    blocks: [{
      type: 'input', block_id: 'reason_block',
      label: { type: 'plain_text', text: action === 'reevaluate' ? 'Que doit réexaminer le collectif ?' : 'Pourquoi passer sous conditions ?' },
      element: { type: 'plain_text_input', action_id: 'reason', multiline: true, min_length: 3, max_length: 1000 },
    }],
  };
}

/**
 * Application du serveur en mode OAuth multi-espaces : pas de jeton de bot
 * global, on utilise celui de l'espace du compte lié (connexion chiffrée).
 */
async function slackApiAdapter(ctx, adapter, userPid) {
  if (adapter?.botToken) return adapter;
  const replies = chatReplies(ctx);
  const link = await replies._link(userPid);
  return (link && await replies._adapter('slack', link.tenantId)) || adapter;
}

async function slackEphemeral(adapter, payload, text) {
  if (payload?.response_url && adapter?.respondToUrl) {
    await adapter.respondToUrl(payload.response_url, { response_type: 'ephemeral', replace_original: false, text }).catch(() => null);
  }
}

/**
 * Boutons et modale d'arbitrage Slack. Renvoie `null` si l'interaction ne
 * concerne pas l'arbitrage d'une mission (gates historiques, etc.).
 */
export async function handleSlackArbitration(ctx, adapter, payload) {
  const replies = chatReplies(ctx);
  if (payload?.type === 'view_submission') {
    const parsed = parseArbitrationActionId(payload.view?.callback_id);
    if (!parsed?.reasonStep) return null;
    let meta = {};
    try { meta = JSON.parse(payload.view?.private_metadata || '{}'); } catch { meta = {}; }
    const reason = String(payload.view?.state?.values?.reason_block?.reason?.value || '').trim();
    const result = await replies.arbitrate({
      platform: 'slack', platformUserId: platformUserId('slack', payload.user?.id),
      threadId: parsed.threadId, action: parsed.action, reason, channelId: meta.channel || null,
    });
    if (result.ok) return { response_action: 'clear' };
    if (result.code === 'already' && result.view && meta.channel && meta.message_ts) {
      const api = await slackApiAdapter(ctx, adapter, platformUserId('slack', payload.user?.id));
      await api.updateMessage(meta.channel, meta.message_ts, viewForPlatform('slack', result.view)).catch(() => null);
    }
    return { response_action: 'errors', errors: { reason_block: result.message.slice(0, 300) } };
  }
  if (payload?.type !== 'block_actions') return null;
  const action = payload.actions?.[0];
  const parsed = parseArbitrationActionId(action?.action_id);
  if (!parsed || parsed.reasonStep) return null;
  const userPid = platformUserId('slack', payload.user?.id);
  const channelId = payload.channel?.id || payload.container?.channel_id || null;
  const messageTs = payload.message?.ts || payload.container?.message_ts || null;
  if (CHAT_ARBITRATION_ACTIONS[parsed.action].reasonRequired) {
    if (!(await replies._link(userPid))) {
      await slackEphemeral(adapter, payload, replies.notLinkedMessage('slack', userPid));
      return '';
    }
    try {
      const api = await slackApiAdapter(ctx, adapter, userPid);
      const opened = await api._api('POST', 'views.open', {
        trigger_id: payload.trigger_id,
        view: slackReasonModal({ action: parsed.action, threadId: parsed.threadId, channelId, messageTs }),
      });
      if (!opened?.ok) await slackEphemeral(adapter, payload, `Saisie du motif impossible (${opened?.error || 'erreur Slack'}).`);
    } catch (error) {
      await slackEphemeral(adapter, payload, `Saisie du motif impossible : ${error.message}`);
    }
    return '';
  }
  const result = await replies.arbitrate({
    platform: 'slack', platformUserId: userPid, threadId: parsed.threadId, action: parsed.action, channelId,
  });
  if (!result.ok) {
    if (result.code === 'already' && result.view && channelId && messageTs) {
      const api = await slackApiAdapter(ctx, adapter, userPid);
      await api.updateMessage(channelId, messageTs, viewForPlatform('slack', result.view)).catch(() => null);
    }
    await slackEphemeral(adapter, payload, result.message);
  }
  // Succès : la carte est mise à jour par la notification `arbitrated` (chat.update).
  return '';
}

// ---------------------------------------------------------------- Discord

function discordCommandText(body) {
  const options = body?.data?.options || [];
  const flattened = options.flatMap((option) => option?.options || [option]);
  return String(flattened.find((option) => ['question', 'prompt', 'message'].includes(option?.name))?.value || '').trim();
}
const ephemeral = (content) => ({ type: 4, data: { content: String(content || '').slice(0, 1900), flags: 64 } });

function discordUpdate(adapter, view) {
  const data = adapter.renderView(viewForPlatform('discord', view));
  if (!data.components) data.components = [];
  return { type: 7, data };
}

/**
 * `/kayros` (réponse différée type 5 puis édition de la réponse), boutons et
 * modale d'arbitrage. Renvoie `null` pour les interactions non concernées.
 */
export async function handleDiscordInteraction(ctx, adapter, body, { tenantId = null } = {}) {
  const replies = chatReplies(ctx);
  const userPid = platformUserId('discord', body?.member?.user?.id || body?.user?.id);
  const channelId = body?.channel_id || body?.channel?.id || null;
  if (body?.type === 2 && String(body.data?.name || '').toLowerCase() === 'kayros') {
    const text = discordCommandText(body);
    if (!text) return ephemeral('Ajoutez une question après /kayros.');
    try {
      const result = await startChatMission(ctx, {
        platform: 'discord', channelId, messageId: body.id, userId: userPid, text, explicit: true,
        context: `Commande Discord · serveur ${body.guild_id || 'direct'}`, tenantId,
        chat: { platform: 'discord', channel_id: channelId, guild_id: body.guild_id || null, application_id: body.application_id || adapter?.applicationId || null },
        chatExtra: { discord: { application_id: body.application_id || adapter?.applicationId, token: body.token } },
      });
      if (result.ignored) return ephemeral('Question ignorée par Kayros.');
      if (result.duplicate) return ephemeral('Question déjà reçue : le verdict sera publié ici.');
      return { type: 5 };
    } catch (error) {
      return ephemeral(`Kayros n’a pas pu traiter ce canal : ${error.message}`);
    }
  }
  if (body?.type === 3) {
    const parsed = parseArbitrationActionId(body.data?.custom_id);
    if (!parsed || parsed.reasonStep) return null;
    if (CHAT_ARBITRATION_ACTIONS[parsed.action].reasonRequired) {
      if (!(await replies._link(userPid))) return ephemeral(replies.notLinkedMessage('discord', userPid));
      return {
        type: 9,
        data: adapter.renderModalData({
          title: 'Motif de la décision',
          custom_id: arbitrationActionId(parsed.action, parsed.threadId, ARBITRATION_REASON_PREFIX),
          fields: [{ id: 'reason', label: 'Motif (obligatoire)', multiline: true, required: true }],
        }),
      };
    }
    const result = await replies.arbitrate({ platform: 'discord', platformUserId: userPid, threadId: parsed.threadId, action: parsed.action, channelId, inline: true });
    if (result.view && (result.ok || result.code === 'already')) return discordUpdate(adapter, result.view);
    return ephemeral(result.message);
  }
  if (body?.type === 5) {
    const parsed = parseArbitrationActionId(body.data?.custom_id);
    if (!parsed?.reasonStep) return null;
    let reason = '';
    for (const row of body.data?.components || []) for (const c of row.components || []) if (c.custom_id === 'reason') reason = c.value;
    const result = await replies.arbitrate({ platform: 'discord', platformUserId: userPid, threadId: parsed.threadId, action: parsed.action, reason, channelId, inline: true });
    if (result.view && (result.ok || result.code === 'already')) return discordUpdate(adapter, result.view);
    return ephemeral(result.message);
  }
  return null;
}

// ---------------------------------------------------------------- Teams

function teamsRef(body) {
  return { service_url: body?.serviceUrl || null, conversation_id: body?.conversation?.id || null, reply_to_id: body?.id || null };
}
function teamsText(body) {
  return String(body?.text || '').replace(/<at>[^<]*<\/at>/gi, '').replace(/<[^>]+>/g, ' ').trim();
}

/**
 * Activité Teams : soumission de carte d'arbitrage, « lier » en conversation
 * privée, ou question au collectif (acquittée tout de suite, verdict proactif).
 * Renvoie `{ handled:false }` si l'activité n'est pas concernée.
 */
export async function handleTeamsActivity(ctx, adapter, body, { tenantId = null, requireRoom = false } = {}) {
  const replies = chatReplies(ctx);
  const userPid = platformUserId('teams', body?.from?.id);
  const personal = body?.conversation?.conversationType === 'personal';
  const ref = teamsRef(body);
  const isInvoke = body?.type === 'invoke' && body?.name === 'adaptiveCard/action';
  const value = isInvoke ? (body.value?.action?.data || {}) : (body?.type === 'message' && body?.value ? body.value : null);
  const say = async (text) => {
    try { await adapter.sendToConversation(ref, { type: 'message', text }); } catch { /* conversation injoignable */ }
  };
  if (value) {
    const parsed = parseArbitrationActionId(value.actionId || value.action_id);
    if (!parsed) return { handled: false };
    const result = await replies.arbitrate({
      platform: 'teams', platformUserId: userPid, threadId: parsed.threadId, action: parsed.action,
      reason: value.reason || '', channelId: body.conversation?.id || null,
    });
    if (!result.ok) {
      if (result.code === 'already' && result.view && body.replyToId) {
        await adapter.updateInConversation({ ...ref, reply_to_id: null }, body.replyToId, result.view).catch(() => null);
      }
      // Jamais de jeton de liaison dans un canal partagé : seulement en conversation privée.
      const message = result.code === 'not_linked' && !personal
        ? 'Votre compte Teams n’est pas lié à KayrosLab : envoyez « lier » au bot KayrosLab en conversation privée.'
        : result.message;
      await say(message);
    }
    return { handled: true, response: isInvoke ? { statusCode: 200, type: 'application/vnd.microsoft.activity.message', value: result.message } : { statusCode: 200 } };
  }
  if (body?.type !== 'message') return { handled: false };
  const text = teamsText(body);
  if (personal && /^(lier|link)$/i.test(text)) {
    const link = await replies._link(userPid);
    await say(link ? `Votre compte Teams est déjà lié à ${link.email || 'KayrosLab'}.` : replies.notLinkedMessage('teams', userPid));
    return { handled: true, response: { statusCode: 200 } };
  }
  if (!text) return { handled: false };
  if (requireRoom) {
    const rooms = await ctx.hybridGateway.listRooms({ platform: 'teams' });
    if (!rooms.some((room) => room.external_room_id === body.conversation?.id)) return { handled: false };
  }
  try {
    const result = await startChatMission(ctx, {
      platform: 'teams', channelId: body.conversation?.id, messageId: body.id, userId: userPid, text, explicit: true,
      context: `Conversation Teams · ${body.channelData?.team?.name || body.conversation?.name || 'direct'}`, tenantId,
      chat: { platform: 'teams', channel_id: body.conversation?.id, teams: ref },
    });
    return { handled: true, response: { statusCode: 200 }, thread_id: result.thread?.thread_id || null, ignored: !!result.ignored, duplicate: !!result.duplicate };
  } catch (error) {
    await say(`Kayros n’a pas pu traiter ce canal : ${error.message}`);
    return { handled: true, response: { statusCode: 200 }, error: error.message };
  }
}
