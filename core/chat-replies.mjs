// KayrosLab — réponses asynchrones et arbitrage depuis Slack, Teams et Discord.
//
// 1. Le webhook de la plateforme est acquitté tout de suite (Slack < 3 s,
//    Discord réponse différée type 5, Teams 200 + « en train d'écrire »), le
//    fil de décision passe `running` et le collectif tourne en tâche de fond
//    (même mécanisme que la console : HybridAgentGateway.startMessage, file
//    Postgres si elle est branchée).
// 2. À la fin, le verdict est publié dans le canal d'origine : mise à jour du
//    message « analyse en cours », sinon nouveau message. Un échec publie un
//    message d'échec lisible.
// 3. Un fil en attente d'arbitrage porte les boutons de la console
//    (accepter le consensus · réévaluer · passer sous conditions). Le clic
//    passe par HybridAgentGateway.arbitrateThread, exactement comme la console :
//    l'utilisateur du chat doit être lié à un compte KayrosLab du même tenant
//    avec le rôle comex ou admin ; un double clic est sans effet.

import { AbstractView, AbstractAction } from './connectors.mjs';
import { summarizeSwarmRun } from './hybrid-agent-gateway.mjs';

export const ARBITRATION_PREFIX = 'kayros_arb';
export const ARBITRATION_REASON_PREFIX = 'kayros_arb_reason';
/** Rôles autorisés à arbitrer, identiques à la console (routes/console.mjs `manager`). */
export const ARBITRATION_ROLES = Object.freeze(['comex', 'admin']);
/** Actions de la console, proposées telles quelles dans le chat. */
export const CHAT_ARBITRATION_ACTIONS = Object.freeze({
  accept_consensus: Object.freeze({ reasonRequired: false }),
  reevaluate: Object.freeze({ reasonRequired: true, label: '↻ Réviser (demander une réévaluation)', style: 'default' }),
  override_veto: Object.freeze({ reasonRequired: true, label: 'Passer sous conditions', style: 'danger', decision: 'CONDITIONAL_GO' }),
});
const ACTION_PATTERN = /^(kayros_arb|kayros_arb_reason):(accept_consensus|reevaluate|override_veto):([A-Za-z0-9_.-]{1,80})$/;
const DISCORD_TOKEN_TTL_MS = 14 * 60 * 1000; // jeton d'interaction Discord : 15 min
const MAX_REFS = 5000;

export function arbitrationActionId(action, threadId, prefix = ARBITRATION_PREFIX) {
  return `${prefix}:${action}:${threadId}`;
}

/** `kayros_arb:<action>:<thread_id>` → `{ action, threadId, reasonStep }` ou null. */
export function parseArbitrationActionId(value) {
  const match = ACTION_PATTERN.exec(String(value || '').trim());
  if (!match) return null;
  return { action: match[2], threadId: match[3], reasonStep: match[1] === ARBITRATION_REASON_PREFIX };
}

function verdictText(verdict) { return String(verdict || 'CONDITIONAL_GO').replaceAll('_', ' '); }
function clip(text, max) { const value = String(text || ''); return value.length > max ? `${value.slice(0, max - 1)}…` : value; }
function color(verdict) { return verdict === 'GO' ? '#22c55e' : verdict === 'NO_GO' ? '#ef4444' : '#f59e0b'; }

export function latestRun(thread) {
  const runs = (thread?.messages || []).filter((message) => message.kind === 'run' && message.run);
  return runs.length ? runs[runs.length - 1].run : null;
}

function latestDecision(thread) {
  const decisions = (thread?.messages || []).filter((message) => message.kind === 'arbitration' && message.decision);
  return decisions.length ? decisions[decisions.length - 1].decision : null;
}

export function consoleThreadUrl(consoleUrl, threadId) {
  const base = String(consoleUrl || '').replace(/\/$/, '');
  return base && threadId ? `${base}/#activity?thread=${encodeURIComponent(threadId)}` : null;
}

/** Libellé du bouton « accepter le consensus » selon le verdict (Approuver / Refuser). */
function acceptLabel(verdict) {
  if (verdict === 'NO_GO') return '✕ Refuser (accepter le NO GO)';
  if (verdict === 'GO') return '✓ Approuver (accepter le GO)';
  return '✓ Approuver sous conditions (accepter le consensus)';
}

export function arbitrationActions(thread, verdict) {
  return [
    new AbstractAction({ id: arbitrationActionId('accept_consensus', thread.thread_id), label: acceptLabel(verdict), style: verdict === 'NO_GO' ? 'danger' : 'primary' }),
    new AbstractAction({ id: arbitrationActionId('reevaluate', thread.thread_id), label: CHAT_ARBITRATION_ACTIONS.reevaluate.label, style: 'default' }),
    new AbstractAction({ id: arbitrationActionId('override_veto', thread.thread_id), label: CHAT_ARBITRATION_ACTIONS.override_veto.label, style: 'default' }),
  ];
}

export function pendingView(thread) {
  const total = Number(thread?.progress?.total) || 0;
  return new AbstractView({
    title: '⏳ Le collectif Kayros analyse votre question',
    text: `« ${clip(thread?.question, 300)} »\nRéponse ici dès la fin des analyses${total ? ` (${total} agent${total > 1 ? 's' : ''})` : ''}.`,
    color: '#3b82f6',
  });
}

/** Verdict publié à la fin du run : boutons d'arbitrage si le fil attend une décision humaine. */
export function verdictView(thread, { consoleUrl = '' } = {}) {
  const run = latestRun(thread);
  const summary = summarizeSwarmRun(run || {});
  const url = consoleThreadUrl(consoleUrl, thread?.thread_id);
  const lines = [summary.text];
  let actions = [];
  let inputs = [];
  let status = 'En attente d’arbitrage humain';
  if (thread?.status === 'needs_clarification') {
    status = 'Précisions demandées';
    const questions = thread.clarification_questions || [];
    if (questions.length) lines.push('', 'Précisions attendues :', ...questions.map((question) => `• ${question}`));
    lines.push(url ? `Répondez depuis la console : ${url}` : 'Répondez depuis la console KayrosLab.');
  } else if (thread?.status === 'awaiting_arbitration') {
    actions = arbitrationActions(thread, summary.verdict);
    inputs = [{ id: 'reason', label: 'Motif (obligatoire pour réviser ou passer sous conditions)', placeholder: 'Motif horodaté et conservé dans l’audit…' }];
    lines.push('', 'Arbitrage réservé aux comptes KayrosLab liés (rôle COMEX ou admin).');
  }
  return new AbstractView({
    title: summary.title,
    text: lines.join('\n'),
    fields: [
      { label: 'Dossier', value: summary.run_id || '—' },
      { label: 'Statut', value: status },
      ...(url ? [{ label: 'Console', value: url }] : []),
    ],
    actions, inputs, color: color(summary.verdict),
  });
}

const OUTCOME_TITLES = {
  accept_consensus: (verdict) => (verdict === 'NO_GO' ? '✕ Refusé — consensus NO GO accepté' : `✓ Approuvé — consensus ${verdictText(verdict)} accepté`),
  override_veto: () => 'Passé sous conditions (veto levé)',
  reevaluate: () => '↻ Réévaluation demandée',
};

/** Issue d'un arbitrage (chat ou console) : remplace la carte à boutons. */
export function outcomeView(thread, { consoleUrl = '' } = {}) {
  const run = latestRun(thread);
  const summary = summarizeSwarmRun(run || {});
  const decision = latestDecision(thread) || run?.human_decision || {};
  const title = (OUTCOME_TITLES[decision.action] || (() => 'Décision enregistrée'))(decision.verdict || summary.verdict);
  const url = consoleThreadUrl(consoleUrl, thread?.thread_id);
  const lines = [`Question : ${clip(thread?.question, 300)}`, `Verdict du collectif : ${verdictText(summary.verdict)}`];
  lines.push(`Décision : ${decision.by || '—'}${decision.decided_at ? ` · ${decision.decided_at}` : ''}`);
  if (decision.justification) lines.push(`Motif : ${clip(decision.justification, 800)}`);
  if (decision.action === 'reevaluate') lines.push('Complétez la mission depuis la console pour relancer le collectif.');
  return new AbstractView({
    title, text: lines.join('\n'),
    fields: [{ label: 'Dossier', value: summary.run_id || '—' }, ...(url ? [{ label: 'Console', value: url }] : [])],
    actions: [], color: decision.action === 'reevaluate' ? '#3b82f6' : color(decision.verdict || summary.verdict),
  });
}

export function failureView(thread, { consoleUrl = '' } = {}) {
  const url = consoleThreadUrl(consoleUrl, thread?.thread_id);
  return new AbstractView({
    title: '⚠️ La mission n’a pas abouti',
    text: `${clip(thread?.error || 'erreur inconnue', 500)}\nReposez la question ou relancez-la depuis la console${url ? ` : ${url}` : '.'}`,
    color: '#ef4444',
  });
}

/** Vue adaptée à la plateforme (titre en gras pour Slack, champs dépliés pour Discord). */
export function viewForPlatform(platform, view) {
  if (platform === 'slack') {
    return new AbstractView({
      ...view, text: clip(`*${view.title}*\n${view.text || ''}`, 2900),
      inputs: [], fields: (view.fields || []).map((field) => ({ ...field, value: clip(field.value, 1900) })),
    });
  }
  if (platform === 'discord') {
    const fieldLines = (view.fields || []).map((field) => `${field.label} : ${field.value}`);
    return new AbstractView({ ...view, title: clip(view.title, 200), text: clip([view.text, ...fieldLines].filter(Boolean).join('\n'), 1700), fields: [], inputs: [] });
  }
  return view;
}

export class ChatReplyService {
  /**
   * @param {{ gateway: import('./hybrid-agent-gateway.mjs').HybridAgentGateway,
   *   resolveAdapter?: (platform:string, tenantId:string) => Promise<object|null>,
   *   linkService?: object, users?: { findById?: Function }, consoleUrl?: string,
   *   logger?: { warn?: Function }, now?: () => number }} options
   */
  constructor({ gateway, resolveAdapter = null, linkService = null, users = null, consoleUrl = '', logger = null, now = Date.now } = {}) {
    if (!gateway) throw new Error('ChatReplyService: gateway requis');
    this.gateway = gateway;
    this.resolveAdapter = resolveAdapter;
    this.linkService = linkService;
    this.users = users;
    this.consoleUrl = consoleUrl;
    this.logger = logger;
    this.now = now;
    this.chains = new Map();
    this.refs = new Map(); // thread_id → { message_ts | message_id } publiés par ce processus
    this.interactions = new Map(); // thread_id → jeton d'interaction Discord (jamais persisté)
    this.inline = new Set(); // fils dont la carte a déjà été mise à jour dans la réponse HTTP
  }

  attach() {
    this.gateway.chatNotifier = (kind, thread, extra) => this.notify(kind, thread, extra);
    return this;
  }

  _warn(message, detail) {
    try { this.logger?.warn?.({ detail }, `[kayros][chat] ${message}`); } catch { /* journal facultatif */ }
  }

  /** Jeton d'interaction Discord (réponse différée ou clic) : conservé en mémoire 14 min. */
  rememberInteraction(threadId, { application_id: applicationId, token } = {}) {
    if (!threadId || !applicationId || !token) return;
    this.interactions.set(threadId, { application_id: String(applicationId), token: String(token), expires_at: this.now() + DISCORD_TOKEN_TTL_MS });
    if (this.interactions.size > MAX_REFS) this.interactions.delete(this.interactions.keys().next().value);
  }

  /** La carte a été mise à jour dans la réponse HTTP du clic : pas de seconde mise à jour. */
  markInline(threadId) { if (threadId) this.inline.add(threadId); }

  notify(kind, thread, extra = null) {
    if (!thread?.chat?.platform || !thread.thread_id) return Promise.resolve();
    const id = thread.thread_id;
    if (kind === 'started' && extra?.discord) this.rememberInteraction(id, extra.discord);
    const previous = this.chains.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => this._handle(kind, thread)).catch((error) => {
      this._warn(`publication ${kind} impossible`, error?.message || String(error));
    });
    this.chains.set(id, next);
    next.finally(() => { if (this.chains.get(id) === next) this.chains.delete(id); });
    return next;
  }

  async idle() { while (this.chains.size) await Promise.allSettled([...this.chains.values()]); }

  async _adapter(platform, tenantId) {
    if (this.resolveAdapter) {
      try {
        const adapter = await this.resolveAdapter(platform, tenantId);
        if (adapter) return adapter;
      } catch { /* connexion par espace absente : application du serveur */ }
    }
    return this.gateway.adapterFor(platform, tenantId);
  }

  _ref(thread) { return { ...(thread?.chat || {}), ...(this.refs.get(thread?.thread_id) || {}) }; }

  async _saveRef(thread, patch) {
    const id = thread.thread_id;
    const local = { ...(this.refs.get(id) || {}), ...patch };
    this.refs.set(id, local);
    if (this.refs.size > MAX_REFS) this.refs.delete(this.refs.keys().next().value);
    const chat = { ...(thread.chat || {}), ...local };
    const store = this.gateway.store;
    try {
      if (store?.updateThreadChat) await store.updateThreadChat(id, chat, { tenantId: thread.tenant_id });
      else await store?.updateThread?.(id, { chat }, { tenantId: thread.tenant_id });
    } catch (error) { this._warn('référence du message non enregistrée', error?.message); }
  }

  async _handle(kind, thread) {
    if (kind === 'started') return this._acknowledge(thread);
    if (kind === 'completed') return this.deliver(thread, verdictView(thread, { consoleUrl: this.consoleUrl }));
    if (kind === 'failed') return this.deliver(thread, failureView(thread, { consoleUrl: this.consoleUrl }));
    if (kind === 'arbitrated') {
      if (this.inline.delete(thread.thread_id)) return null;
      return this.deliver(thread, outcomeView(thread, { consoleUrl: this.consoleUrl }));
    }
    return null;
  }

  async _acknowledge(thread) {
    const ref = this._ref(thread);
    // Discord : la réponse différée (type 5) affiche déjà « réfléchit… ».
    if (ref.platform === 'discord') return null;
    if (ref.platform === 'teams') {
      const adapter = await this._adapter('teams', thread.tenant_id);
      if (adapter?.sendTyping && ref.teams) await adapter.sendTyping(ref.teams).catch(() => null);
    }
    return this.deliver(thread, pendingView(thread));
  }

  /** Publie ou met à jour le message du fil dans son canal d'origine. */
  async deliver(thread, view) {
    const ref = this._ref(thread);
    const adapter = await this._adapter(ref.platform, thread.tenant_id);
    if (!adapter) { this._warn(`connecteur ${ref.platform} non configuré`, thread.thread_id); return { ok: false, error: 'not_configured' }; }
    const native = viewForPlatform(ref.platform, view);
    if (ref.platform === 'slack') {
      if (ref.message_ts) {
        const updated = await adapter.updateMessage(ref.channel_id, ref.message_ts, native);
        if (updated?.ok) return updated;
      }
      const posted = await adapter.postMessage(ref.channel_id, native, { threadTs: ref.thread_ts || null });
      if (posted?.ok && posted.messageId) await this._saveRef(thread, { message_ts: posted.messageId });
      if (!posted?.ok) this._warn('message Slack refusé', posted?.error);
      return posted;
    }
    if (ref.platform === 'discord') {
      const payload = adapter.renderView(native);
      const interaction = this.interactions.get(thread.thread_id);
      if (interaction && interaction.expires_at > this.now() && adapter.editInteractionResponse) {
        const edited = await adapter.editInteractionResponse(interaction.application_id, interaction.token, payload, '@original');
        if (edited?.ok) {
          if (edited.messageId && edited.messageId !== ref.message_id) await this._saveRef(thread, { message_id: edited.messageId });
          return edited;
        }
      }
      if (ref.message_id) {
        const updated = await adapter.updateMessage(ref.channel_id, ref.message_id, native);
        if (updated?.ok) return updated;
      }
      const posted = adapter.postChannelMessage
        ? await adapter.postChannelMessage(ref.channel_id, payload)
        : await adapter.postMessage(ref.channel_id, native);
      if (posted?.ok && posted.messageId) await this._saveRef(thread, { message_id: posted.messageId });
      if (!posted?.ok) this._warn('message Discord refusé', posted?.error);
      return posted;
    }
    if (ref.platform === 'teams') {
      if (!ref.teams) return { ok: false, error: 'conversation Teams inconnue' };
      if (ref.message_id) {
        const updated = await adapter.updateInConversation(ref.teams, ref.message_id, native);
        if (updated?.ok) return updated;
      }
      const posted = await adapter.sendToConversation(ref.teams, native);
      if (posted?.ok && posted.messageId) await this._saveRef(thread, { message_id: posted.messageId });
      if (!posted?.ok) this._warn('message Teams refusé', posted?.error);
      return posted;
    }
    return { ok: false, error: 'plateforme inconnue' };
  }

  async _link(platformUserId) {
    if (!this.linkService || !platformUserId) return null;
    try { return (await this.linkService.get(platformUserId)) || null; } catch { return null; }
  }

  /** Jeton de liaison à usage unique (15 min) pour l'utilisateur du chat. */
  linkToken(platform, platformUserId) {
    if (!this.linkService?.createToken || !platformUserId) return null;
    try { return this.linkService.createToken({ platformId: platformUserId, userId: platformUserId, platform }); } catch { return null; }
  }

  notLinkedMessage(platform, platformUserId) {
    const link = this.linkToken(platform, platformUserId);
    const base = `Votre compte ${platform} n’est pas lié à KayrosLab.`;
    if (!link) return `${base} Liez-le depuis la console KayrosLab.`;
    return `${base} Dans la console : Réglages → « Lier un compte chat », collez ce jeton (valable 15 min) : ${link.token}`;
  }

  /**
   * Arbitre un fil depuis le chat avec la logique de la console.
   * @returns {Promise<{ok:boolean, code?:string, message:string, thread?:object, view?:AbstractView}>}
   */
  async arbitrate({ platform, platformUserId, threadId, action, reason = '', channelId = null, inline = false } = {}) {
    const spec = CHAT_ARBITRATION_ACTIONS[action];
    if (!spec) return { ok: false, code: 'invalid', message: 'Action d’arbitrage inconnue.' };
    const link = await this._link(platformUserId);
    if (!link) return { ok: false, code: 'not_linked', message: this.notLinkedMessage(platform, platformUserId) };
    const tenantId = String(link.tenantId || 'default');
    const thread = await this.gateway.getThread(threadId, { tenantId });
    const room = thread ? await this.gateway.getRoom(thread.room_id, { tenantId }) : null;
    // Le fil doit appartenir au tenant du compte lié ET au canal où le bouton a été cliqué.
    if (!thread || !room || room.platform !== platform || (channelId && thread.chat?.channel_id && String(thread.chat.channel_id) !== String(channelId))) {
      return { ok: false, code: 'not_found', message: 'Mission introuvable pour votre compte KayrosLab.' };
    }
    let user = null;
    if (this.users?.findById && link.kayrosUserId) {
      user = await this.users.findById(link.kayrosUserId).catch(() => null);
      if (!user) return { ok: false, code: 'forbidden', message: 'Compte KayrosLab lié introuvable : liez de nouveau votre compte.' };
    }
    const role = user?.role || link.role;
    if (user?.tenantId && String(user.tenantId) !== tenantId) return { ok: false, code: 'forbidden', message: 'Compte KayrosLab lié à un autre espace.' };
    if (!ARBITRATION_ROLES.includes(role)) return { ok: false, code: 'forbidden', message: 'Arbitrage réservé aux rôles COMEX ou admin de KayrosLab.' };
    const by = user?.email || link.email || platformUserId;
    if (['resolved', 'reevaluation_requested'].includes(thread.status)) {
      const decision = latestDecision(thread);
      return { ok: false, code: 'already', thread, view: outcomeView(thread, { consoleUrl: this.consoleUrl }), message: `Décision déjà enregistrée${decision?.by ? ` par ${decision.by}` : ''}.` };
    }
    if (thread.status === 'running') return { ok: false, code: 'busy', message: 'Mission en cours : arbitrage possible à la fin des analyses.' };
    if (thread.status === 'failed') return { ok: false, code: 'not_ready', message: 'Mission en échec : rien à arbitrer, relancez-la.' };
    const justification = String(reason || '').trim();
    if (spec.reasonRequired && justification.length < 3) return { ok: false, code: 'reason_required', message: 'Motif obligatoire (3 caractères minimum) pour cette décision.' };
    // `inline` : la réponse HTTP du clic remplace déjà la carte (Discord type 7).
    if (inline) this.markInline(threadId);
    try {
      const arbitrated = await this.gateway.arbitrateThread(threadId, {
        action, justification: justification || undefined, ...(spec.decision ? { decision: spec.decision } : {}),
      }, { tenantId, by });
      return { ok: true, code: 'arbitrated', thread: arbitrated, view: outcomeView(arbitrated, { consoleUrl: this.consoleUrl }), message: 'Décision enregistrée.' };
    } catch (error) {
      if (inline) this.inline.delete(threadId);
      const message = String(error?.message || error);
      if (/déjà arbitré/.test(message)) {
        const current = await this.gateway.getThread(threadId, { tenantId });
        return { ok: false, code: 'already', thread: current, view: current ? outcomeView(current, { consoleUrl: this.consoleUrl }) : null, message: 'Décision déjà enregistrée.' };
      }
      if (error?.code === 'RUN_IN_PROGRESS') return { ok: false, code: 'busy', message: 'Mission en cours : arbitrage possible à la fin des analyses.' };
      return { ok: false, code: 'error', message: `Arbitrage impossible : ${message.slice(0, 300)}` };
    }
  }
}
