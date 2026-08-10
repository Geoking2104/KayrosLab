// KayrosLab — Connecteurs conversationnels (Slack · Teams · Discord)
// Ref. SPECIFICATIONS_CONNECTEURS_CHAT.md (EF-88 a EF-109)
//
// Principe :
//   1. Le coeur expose des INTENTIONS (arbitrer_gate, voter, soumettre_idee…)
//      et des VUES ABSTRAITES. Chaque adaptateur traduit dans sa syntaxe native.
//   2. L'identite et l'habilitation viennent du COMPTE KAYROSLAB lie,
//      jamais du chat. Le RBAC existant reste seul juge.
//   3. Aucune action sans verification cryptographique prealable.

import { GateType, HUMAN_ROLES, canResolve } from './governance.mjs';
import { aggregateVotes } from './evaluation.mjs';
import {
  getBearerToken,
  verifyTeamsToken,
  fetchJwks,
  TeamsKeyCache,
  BOTFRAMEWORK_OPENID_CONFIG,
  BOTFRAMEWORK_ISSUER,
} from './connectors-teams-deep.mjs';

// ---- Types abstraits (intentions) ----

/** @typedef {'gate_opened'|'gate_resolved'|'vote_recorded'|'kpi_alert'|'idea_submitted'|'digest'} EventType */

/**
 * Vue abstraite d'une carte de message.
 * Chaque adaptateur la traduit dans son format natif (Block Kit, Adaptive Card, Embed).
 */
export class AbstractView {
  constructor({ title, text, fields = [], actions = [], color = null, ts = null } = {}) {
    this.title = title; this.text = text; this.fields = fields;
    this.actions = actions; this.color = color; this.ts = ts;
  }
  /** @returns {{title:string, text:string, fields:object[], actions:object[], color:string|null, ts:string|null}} */
  toJSON() { return { title: this.title, text: this.text, fields: this.fields, actions: this.actions, color: this.color, ts: this.ts }; }
}

/** Action cliquable. */
export class AbstractAction {
  constructor({ id, label, style = 'default', confirm = null } = {}) {
    this.id = id; this.label = label; this.style = style; this.confirm = confirm;
  }
}

/** Reponse d'une interaction entrante. */
export class InteractionResponse {
  constructor({ type = 'ack', view = null, ephemeral = false, text = null } = {}) {
    this.type = type; this.view = view; this.ephemeral = ephemeral; this.text = text;
  }
}

/** Evenement entrant normalise (plateforme -> coeur). */
export class InteractionEvent {
  constructor({ platform, actionId, userId, channelId, teamId, payload, raw } = {}) {
    this.platform = platform; this.actionId = actionId; this.userId = userId;
    this.channelId = channelId; this.teamId = teamId; this.payload = payload; this.raw = raw;
    this.ts = new Date().toISOString();
  }
}

// ---- Service de liaison de compte ----

/**
 * Gere le lien entre identifiants de plateforme (slack:U123, teams:29:1abc)
 * et comptes KayrosLab. Le rattachement se fait via un jeton a usage unique
 * genere depuis le back-office.
 */
export class AccountLinkService {
  constructor({ store = null } = {}) {
    this._links = new Map();       // platformId -> { kayrosUserId, email, role, tenantId, linkedAt }
    this._tokens = new Map();      // jeton -> { platformId, userId, expiresAt }
    this._store = store;
  }

  /**
   * Cree un jeton de liaison pour un utilisateur plateforme.
   * @param {{platformId:string, userId:string, platform:string}} opts
   * @returns {{token:string, expiresAt:string}}
   */
  createToken({ platformId, userId, platform }) {
    const randomBytes = new Uint8Array(16);
    globalThis.crypto?.getRandomValues?.(randomBytes) ?? randomBytes.forEach((_, i, arr) => { arr[i] = Math.floor(Math.random() * 256); });
    const token = `link_${Date.now()}_${Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    this._tokens.set(token, { platformId, userId, platform, expiresAt });
    return { token, expiresAt };
  }

  /**
   * Lie un jeton a un compte KayrosLab (appele depuis le back-office apres auth).
   * @param {string} token
   * @param {{id:string, email:string, role:string, tenantId:string}} kayrosUser
   * @returns {{ok:boolean, platformId:string}|Error}
   */
  link(token, kayrosUser) {
    const rec = this._tokens.get(token);
    if (!rec) throw new Error('Jeton invalide ou deja utilise');
    if (new Date(rec.expiresAt) < new Date()) { this._tokens.delete(token); throw new Error('Jeton expire'); }
    this._tokens.delete(token);
    this._links.set(rec.platformId, {
      kayrosUserId: kayrosUser.id, email: kayrosUser.email,
      role: kayrosUser.role, tenantId: kayrosUser.tenantId, platform: rec.platform,
      platformId: rec.platformId, linkedAt: new Date().toISOString(),
    });
    return { ok: true, platformId: rec.platformId };
  }

  /** Verifie qu'un utilisateur plateforme est lie et renvoie son profil. */
  get(platformId) { return this._links.get(platformId) ?? null; }

  /** Supprime une liaison. */
  unlink(platformId) { return this._links.delete(platformId); }
}

// ---- Adaptateur de base ----

export class ChatAdapter {
  constructor({ name, platform, linkService = null } = {}) {
    if (!name || !platform) throw new Error('ChatAdapter: name et platform requis');
    this.name = name; this.platform = platform;
    this.linkService = linkService;
  }

  /**
   * Verifie la signature d'une requete entrante.
   * @param {object} req - requete HTTP entrante
   * @returns {boolean}
   */
  verifySignature(req) { throw new Error('verifySignature: implementer dans le sous-type'); }

  /**
   * Normalise une requete entrante en InteractionEvent.
   * @param {object} req
   * @returns {InteractionEvent|null}
   */
  parseRequest(req) { throw new Error('parseRequest: implementer dans le sous-type'); }

  /**
   * Publie un message dans un canal.
   * @param {string} channelId
   * @param {AbstractView} view
   * @returns {Promise<{ok:boolean, messageId?:string}>}
   */
  async postMessage(channelId, view) { throw new Error('postMessage: implementer dans le sous-type'); }

  /**
   * Met a jour un message existant.
   * @param {string} channelId
   * @param {string} messageId
   * @param {AbstractView} view
   * @returns {Promise<{ok:boolean}>}
   */
  async updateMessage(channelId, messageId, view) { throw new Error('updateMessage: implementer dans le sous-type'); }

  /**
   * Envoie un message ephemere visible d'un seul utilisateur.
   * @param {string} channelId
   * @param {string} userId
   * @param {string} text
   * @returns {Promise<{ok:boolean}>}
   */
  async ephemeralMessage(channelId, userId, text) { throw new Error('ephemeralMessage: implementer dans le sous-type'); }

  /**
   * Ouvre un formulaire modal.
   * @param {string} triggerId
   * @param {AbstractView} form
   * @returns {Promise<{ok:boolean}>}
   */
  async openModal(triggerId, form) { throw new Error('openModal: implementer dans le sous-type'); }

  /**
   * Traduit une vue abstraite en format natif.
   * @param {AbstractView} view
   * @returns {object} format natif de la plateforme
   */
  renderView(view) { throw new Error('renderView: implementer dans le sous-type'); }
}

// ---- Adaptateur Slack (webhook + API) ----

export class SlackAdapter extends ChatAdapter {
  /**
   * @param {{signingSecret?:string, botToken?:string, webhookUrl?:string, fetchImpl?:Function, linkService?:AccountLinkService}} opts
   */
  constructor({ signingSecret = '', botToken = '', webhookUrl = '', fetchImpl, linkService } = {}) {
    super({ name: 'slack', platform: 'slack', linkService });
    this.signingSecret = signingSecret;
    this.botToken = botToken;
    this.webhookUrl = webhookUrl;
    this._fetch = fetchImpl ?? globalThis.fetch;
    if (!this._fetch) throw new Error('SlackAdapter: fetch indisponible');
  }

  _api(method, endpoint, body) {
    if (!this.botToken) { const e = new Error('botToken non configure'); e.code = 'NO_TOKEN'; throw e; }
    return this._fetch(`https://slack.com/api/${endpoint}`, {
      method, headers: { 'Authorization': `Bearer ${this.botToken}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());
  }

  /**
   * Verifie la signature HMAC-SHA256 d'une requete Slack.
   * Rejette les requetes de plus de 5 minutes (anti-rejeu).
   */
  async verifySignature(req) {
    if (!this.signingSecret) return true;
    const sig = req.headers['x-slack-signature'];
    const ts = req.headers['x-slack-request-timestamp'];
    if (!sig || !ts) return false;
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 300) return false;
    const base = `v0:${ts}:${req.rawBody ?? ''}`;
    const crypto = globalThis.crypto?.subtle;
    if (!crypto) return false;
    const encoder = new TextEncoder();
    const key = await crypto.importKey('raw', encoder.encode(this.signingSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.sign('HMAC', key, encoder.encode(base));
    const expected = `v0=${Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('')}`;
    return expected === sig;
  }

  parseRequest(req) {
    const body = req.body ?? {};
    if (body.type === 'block_actions') {
      return new InteractionEvent({
        platform: 'slack', actionId: body.actions?.[0]?.action_id,
        userId: body.user?.id, channelId: body.container?.channel_id,
        teamId: body.team?.id, payload: body.actions?.[0]?.value ?? body,
        raw: body,
      });
    }
    if (body.type === 'view_submission') {
      const values = body.view?.state?.values ?? {};
      const flat = {};
      for (const block of Object.values(values)) {
        for (const [key, val] of Object.entries(block)) { flat[key] = val.value ?? val.selected_option?.value; }
      }
      return new InteractionEvent({
        platform: 'slack', actionId: body.view?.callback_id,
        userId: body.user?.id, channelId: body.view?.private_metadata,
        teamId: body.team?.id, payload: flat, raw: body,
      });
    }
    if (body.command) {
      return new InteractionEvent({
        platform: 'slack', actionId: `slash_${body.command.replace('/', '')}`,
        userId: body.user_id, channelId: body.channel_id,
        teamId: body.team_id, payload: { text: body.text, command: body.command }, raw: body,
      });
    }
    return null;
  }

  async postMessage(channelId, view) {
    const blocks = this.renderView(view);
    const res = await this._api('POST', 'chat.postMessage', { channel: channelId, blocks, text: view.title });
    return { ok: res.ok, messageId: res.ts ?? null };
  }

  async updateMessage(channelId, messageId, view) {
    const blocks = this.renderView(view);
    const res = await this._api('POST', 'chat.update', { channel: channelId, ts: messageId, blocks, text: view.title });
    return { ok: res.ok };
  }

  async ephemeralMessage(channelId, userId, text) {
    const res = await this._api('POST', 'chat.postEphemeral', { channel: channelId, user: userId, text });
    return { ok: res.ok };
  }

  async openModal(triggerId, form) {
    const blocks = this.renderView(form);
    const res = await this._api('POST', 'views.open', {
      trigger_id: triggerId,
      view: { type: 'modal', callback_id: form.title ?? 'modal', title: { text: form.title ?? 'KayrosLab' }, blocks, submit: { text: 'Valider' } },
    });
    return { ok: res.ok };
  }

  renderView(view) {
    const blocks = [];
    if (view.text) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: view.text } });
    for (const f of view.fields ?? []) {
      blocks.push({
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*${f.label}:*` },
          { type: 'mrkdwn', text: String(f.value ?? '—') },
        ],
      });
    }
    if (view.actions.length) {
      blocks.push({
        type: 'actions',
        elements: view.actions.map((a) => ({
          type: 'button', text: { type: 'plain_text', text: a.label },
          action_id: a.id, style: a.style ?? 'default', value: a.id,
          ...(a.confirm ? { confirm: { title: { text: a.confirm }, confirm: { text: 'Oui' }, deny: { text: 'Non' } } } : {}),
        })),
      });
    }
    return blocks;
  }

  /** Construit la vue d'arbitrage de gate (EF-94/95). */
  buildGateView(evt, { ideaTitre, gateType, agregat } = {}) {
    const roleLabel = { comex: 'COMEX', red_team: 'Red Team', expert_metier: 'Expert', facilitateur: 'Facilitateur' };
    const fields = [
      { label: 'Idée', value: ideaTitre ?? evt.ideaId ?? '—' },
      { label: 'Type de gate', value: gateType ?? evt.type ?? '—' },
      { label: 'Rôle requis', value: roleLabel[evt.requiredRole] ?? evt.requiredRole ?? '—' },
    ];
    if (agregat) {
      fields.push({ label: 'Vote', value: `${agregat.moyennePonderee ?? '—'}/100 (${agregat.count ?? 0} évaluateur(s))` });
    }
    const actions = [
      new AbstractAction({ id: `approve:${evt.gateId}`, label: '✓ Approuver', style: 'primary' }),
      new AbstractAction({ id: `revise:${evt.gateId}`, label: '↻ Réviser', style: 'default' }),
      new AbstractAction({ id: `reject:${evt.gateId}`, label: '✕ Refuser', style: 'danger', confirm: 'Confirmer le refus ?' }),
    ];
    return new AbstractView({
      title: `🔔 Arbitrage requis — ${ideaTitre ?? evt.ideaId ?? 'idée'}`,
      text: agregat?.count
        ? `Vote pondéré : *${agregat.moyennePonderee}* /100 — ${agregat.recommandation ?? 'décision'}`
        : '_Aucun vote préalable : la décision ne sera pas instruite._',
      fields, actions, color: '#3b82f6',
    });
  }

  /** Construit la vue de resultat de gate (apres resolution). */
  buildGateResultView(resolution, { ideaTitre } = {}) {
    const decisionLabel = { approve: '✓ Approuvé', reject: '✕ Refusé (veto)', revise: '↻ Révision demandée' };
    return new AbstractView({
      title: `${decisionLabel[resolution.decision] ?? resolution.decision} — ${ideaTitre ?? ''}`,
      text: `Par : ${resolution.by ?? '—'}\nMotif : ${resolution.reason ?? '—'}\nLe : ${resolution.resolvedAt ?? '—'}`,
      actions: [], color: resolution.decision === 'approve' ? '#22c55e' : '#ef4444',
    });
  }
}

// ---- Adaptateur Microsoft Teams (Adaptive Cards) ----

export class TeamsAdapter extends ChatAdapter {
  /**
   * @param {{webhookUrl?:string, botId?:string, botPassword?:string, openIdConfigUrl?:string, issuers?:string[], fetchImpl?:Function, linkService?:AccountLinkService}} opts
   */
  constructor({ webhookUrl = '', botId = '', botPassword = '', openIdConfigUrl = BOTFRAMEWORK_OPENID_CONFIG, issuers = [BOTFRAMEWORK_ISSUER], fetchImpl, linkService } = {}) {
    super({ name: 'teams', platform: 'teams', linkService });
    this.webhookUrl = webhookUrl;
    this.botId = botId;
    this.botPassword = botPassword;
    this.openIdConfigUrl = openIdConfigUrl;
    this.issuers = issuers;
    this._fetch = fetchImpl ?? globalThis.fetch;
    this._keyCache = new TeamsKeyCache();
    this._tokenCache = { token: null, expiresAt: 0 };
    if (!this._fetch) throw new Error('TeamsAdapter: fetch indisponible');
  }

  /**
   * Verifie le JWT RS256 d'une requete Teams (Azure Bot Service).
   * Controle signature, issuer, audience (App ID) et expiration.
   */
  async verifySignature(req) {
    const auth = req.headers?.authorization || req.headers?.Authorization || '';
    const token = getBearerToken(auth);
    if (!token || !this.botId) return false;
    let keys = this._keyCache.get();
    if (keys) {
      const ok = await verifyTeamsToken(token, { appId: this.botId, issuers: this.issuers, keys, nowMs: Date.now() });
      if (ok) return true;
    }
    keys = await fetchJwks({ fetchImpl: this._fetch, openIdConfigUrl: this.openIdConfigUrl });
    if (!Array.isArray(keys)) return false;
    this._keyCache.set(keys);
    return verifyTeamsToken(token, { appId: this.botId, issuers: this.issuers, keys, nowMs: Date.now() });
  }

  /** Jeton OAuth2 du bot (client_credentials) avec cache court. */
  async _botAccessToken() {
    if (!this.botId || !this.botPassword) return null;
    if (this._tokenCache.token && this._tokenCache.expiresAt > Date.now()) return this._tokenCache.token;
    const res = await this._fetch('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.botId,
        client_secret: this.botPassword,
        scope: 'https://api.botframework.com/.default',
      }).toString(),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    if (!data.access_token) return null;
    const ttl = (Number(data.expires_in) || 3600) - 60;
    this._tokenCache = { token: data.access_token, expiresAt: Date.now() + ttl * 1000 };
    return data.access_token;
  }

  _activityPayload(view) {
    return {
      type: 'message',
      attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: this.renderView(view) }],
    };
  }

  parseRequest(req) {
    const body = req.body ?? {};
    if (body.type === 'message' && body.text) {
      const text = String(body.text || '').trim();
      if (text.startsWith('/')) {
        return new InteractionEvent({
          platform: 'teams', actionId: `slash_${text.slice(1).split(' ')[0]}`,
          userId: body.from?.aadObjectId || body.from?.id,
          channelId: body.conversation?.id,
          teamId: body.channelData?.team?.id,
          payload: { text: text.slice(1), command: text.split(' ')[0] },
          raw: body,
        });
      }
    }
    if (body.type === 'invoke' && body.name === 'adaptiveCard/action') {
      const action = body.value?.action;
      return new InteractionEvent({
        platform: 'teams', actionId: action?.id || 'unknown',
        userId: body.from?.aadObjectId || body.from?.id,
        channelId: body.conversation?.id,
        teamId: body.channelData?.team?.id,
        payload: action?.data || {},
        raw: body,
      });
    }
    return null;
  }

  async postMessage(channelId, view) {
    const payload = this._activityPayload(view);
    if (this.webhookUrl) {
      const res = await this._fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return { ok: res.ok };
    }
    if (channelId && this.botId && this.botPassword) {
      const token = await this._botAccessToken();
      if (!token) return { ok: false, error: 'botAccessToken indisponible' };
      const res = await this._fetch(`https://smba.trafficmanager.net/amer/v3/conversations/${channelId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return { ok: false, error: await res.text().catch(() => '') };
      const data = await res.json().catch(() => ({}));
      return { ok: true, messageId: data.id ?? null };
    }
    return { ok: false, error: 'webhookUrl ou botId+botPassword requis' };
  }

  async updateMessage(channelId, messageId, view) {
    if (!channelId || !messageId || !this.botId || !this.botPassword) {
      return { ok: false, error: 'conversation/token non configure' };
    }
    const token = await this._botAccessToken();
    if (!token) return { ok: false, error: 'botAccessToken indisponible' };
    const url = `https://smba.trafficmanager.net/amer/v3/conversations/${channelId}/activities/${messageId}`;
    const res = await this._fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(this._activityPayload(view)),
    });
    return { ok: res.ok };
  }

  async ephemeralMessage(channelId, userId, text) {
    // Teams n'a pas de message ephemere natif. On utilise un message normal.
    return this.postMessage(channelId, new AbstractView({ title: text, text }));
  }

  async openModal(triggerId, form) {
    // Teams Task Module : equivalent du modal Slack.
    const card = this.renderView(form);
    return { ok: true, task: { type: 'continue', value: { card: { contentType: 'application/vnd.microsoft.card.adaptive', content: card } } } };
  }

  /** Carte Task Module avec saisie du motif (EF-20). */
  renderMotifCard({ title, data }) {
    const card = {
      type: 'AdaptiveCard',
      version: '1.5',
      $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
      body: [
        { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true },
        { type: 'Input.Text', id: 'reason', isMultiline: true, isRequired: true, placeholder: 'Motif horodaté et conservé dans l\'audit…' },
      ],
      actions: [
        { type: 'Action.Submit', id: data.actionId, title: 'Valider', data: { actionId: data.actionId } },
      ],
    };
    return card;
  }

  renderView(view) {
    const body = [];
    if (view.title) {
      body.push({ type: 'TextBlock', text: view.title, weight: 'Bolder', size: 'Medium', wrap: true });
    }
    if (view.text) {
      body.push({ type: 'TextBlock', text: view.text, wrap: true, isSubtle: !view.title });
    }
    for (const f of view.fields ?? []) {
      body.push({
        type: 'FactSet',
        facts: [
          { title: f.label || '', value: String(f.value ?? '—') },
        ],
      });
    }
    const actions = [];
    for (const a of view.actions ?? []) {
      const cardAction = {
        type: 'Action.Submit',
        id: a.id,
        title: a.label,
        data: { actionId: a.id },
      };
      if (a.style === 'danger') cardAction.style = 'destructive';
      if (a.confirm) cardAction.tooltip = a.confirm;
      actions.push(cardAction);
    }

    const card = {
      type: 'AdaptiveCard',
      version: '1.5',
      $schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
      body,
    };
    if (actions.length) card.actions = actions;
    if (view.color) {
      const accentMap = { '#ef4444': 'attention', '#22c55e': 'good', '#3b82f6': 'accent' };
      const fallbackColor = '#3b82f6';
      card.backgroundColor = view.color;
      card.accent = accentMap[view.color] || fallbackColor;
    }
    return card;
  }

  buildGateView(evt, { ideaTitre, gateType, agregat } = {}) {
    const roleLabel = { comex: 'COMEX', red_team: 'Red Team', expert_metier: 'Expert', facilitateur: 'Facilitateur' };
    const fields = [
      { label: 'Idee', value: ideaTitre ?? evt.ideaId ?? '—' },
      { label: 'Type de gate', value: gateType ?? evt.type ?? '—' },
      { label: 'Role requis', value: roleLabel[evt.requiredRole] ?? evt.requiredRole ?? '—' },
    ];
    if (agregat) {
      fields.push({ label: 'Vote', value: `${agregat.moyennePonderee ?? '—'}/100 (${agregat.count ?? 0} evaluateur(s))` });
    }
    const actions = [
      { id: `approve:${evt.gateId}`, label: 'Approuver', style: 'primary' },
      { id: `revise:${evt.gateId}`, label: 'Reviser', style: 'default' },
      { id: `reject:${evt.gateId}`, label: 'Refuser', style: 'danger', confirm: 'Confirmer le refus ?' },
    ];
    return new AbstractView({
      title: `Arbitrage requis — ${ideaTitre ?? evt.ideaId ?? 'idee'}`,
      text: agregat?.count
        ? `Vote pondere : ${agregat.moyennePonderee}/100 — ${agregat.recommandation ?? 'decision'}`
        : 'Aucun vote prealable : la decision ne sera pas instruite.',
      fields, actions, color: '#3b82f6',
    });
  }

  buildGateResultView(resolution, { ideaTitre } = {}) {
    const decisionLabel = { approve: 'Approuve', reject: 'Refuse (veto)', revise: 'Revision demandee' };
    return new AbstractView({
      title: `${decisionLabel[resolution.decision] ?? resolution.decision} — ${ideaTitre ?? ''}`,
      text: `Par : ${resolution.by ?? '—'}\nMotif : ${resolution.reason ?? '—'}\nLe : ${resolution.resolvedAt ?? '—'}`,
      actions: [], color: resolution.decision === 'approve' ? '#22c55e' : '#ef4444',
    });
  }
}

// ---- Service de routage des connecteurs ----

export class ConnectorService {
  constructor({ adapters = [], linkService = null, governance = null, ideas = null, users = null } = {}) {
    this.adapters = new Map(adapters.map((a) => [a.platform, a]));
    this.linkService = linkService ?? new AccountLinkService();
    this.governance = governance;
    this.ideas = ideas;
    this.users = users;
  }

  register(adapter) { this.adapters.set(adapter.platform, adapter); }

  get(platform) { return this.adapters.get(platform); }

  /**
   * Dispatch un evenement entrant vers le handler approprie.
   * @param {InteractionEvent} evt
   * @returns {Promise<InteractionResponse>}
   */
  async handleInteraction(evt) {
    const adapter = this.adapters.get(evt.platform);
    if (!adapter) return new InteractionResponse({ type: 'error', ephemeral: true, text: 'Adaptateur non configure' });

    // Verification identite
    const profile = adapter.linkService?.get(evt.userId);
    if (!profile && !evt.actionId.startsWith('slash_')) {
      return new InteractionResponse({
        type: 'ephemeral', ephemeral: true,
        text: 'Votre compte n\'est pas lié à KayrosLab. Liez-le depuis le back-office (jeton à usage unique).',
      });
    }

    // Routage par action
    if (evt.actionId.startsWith('approve:')) return this._handleGate(evt, 'approve', profile);
    if (evt.actionId.startsWith('revise:')) return this._handleGate(evt, 'revise', profile);
    if (evt.actionId.startsWith('reject:')) return this._handleGate(evt, 'reject', profile);
    if (evt.actionId.startsWith('slash_submit')) return this._handleSubmit(evt, profile, adapter);

    return new InteractionResponse({ type: 'ephemeral', ephemeral: true, text: `Action inconnue : ${evt.actionId}` });
  }

  async _handleGate(evt, decision, profile) {
    const gateId = evt.actionId.split(':')[1];
    if (!gateId || !this.governance) return new InteractionResponse({ ephemeral: true, text: 'Gate introuvable ou gouvernance non configuree' });
    try {
      const rec = this.governance.list().find((g) => g.gateId === gateId);
      if (!rec) return new InteractionResponse({ ephemeral: true, text: 'Gate deja resolue ou introuvable' });
      if (rec.requiredRole && !canResolve(profile?.role, rec.type)) {
        return new InteractionResponse({ ephemeral: true, text: `Action reservee au role ${rec.requiredRole}` });
      }
      if (decision === 'revise' || decision === 'reject') {
        if (evt._motifConfirmed) {
          const reason = String(evt.payload?.reason ?? evt.payload?.fields?.reason ?? '').trim();
          if (reason.length < 3) {
            return new InteractionResponse({ type: 'ephemeral', ephemeral: true, text: 'Motif obligatoire pour rejeter/réviser (EF-20)' });
          }
          const resolution = this.governance.resolve(gateId, {
            decision, by: profile.email, role: profile.role, reason,
          });
          if (this.ideas && rec.ideaId) {
            const idea = await this.ideas.get(rec.ideaId);
            if (idea) {
              const { setStatus, setStage } = await import('./model.mjs');
              const map = { reject: 'non_poursuivi', revise: 'en_revue' };
              let out = setStatus(idea, map[decision] ?? idea.status, { by: profile.email, motif: reason });
              if (decision === 'revise') out = setStage(out, 'eprouver', { by: profile.email, motif: 'revision via chat' });
              await this.ideas.save(out);
            }
          }
          return new InteractionResponse({ type: 'ack', text: `Décision "${decision}" enregistrée.` });
        }
        return new InteractionResponse({
          type: 'modal', ephemeral: false,
          text: null, view: new AbstractView({
            title: decision === 'reject' ? 'Motif du refus (obligatoire)' : 'Motif de la revision',
            fields: [], actions: [], text: 'Ce motif sera horodaté et conservé dans l\'audit.',
          }),
        });
      }
      const resolution = this.governance.resolve(gateId, {
        decision, by: profile.email, role: profile.role, reason: evt.payload?.reason ?? '',
      });
      // Repercussion sur l'idee
      if (this.ideas && rec.ideaId) {
        const idea = await this.ideas.get(rec.ideaId);
        if (idea) {
          const { setStatus, setStage } = await import('./model.mjs');
          const map = { approve: 'en_developpement', reject: 'non_poursuivi', revise: 'en_revue' };
          let out = setStatus(idea, map[decision] ?? idea.status, { by: profile.email, motif: resolution.reason || decision });
          if (decision === 'approve') out = setStage(out, 'projeter', { by: profile.email, motif: 'gate approuve via chat' });
          if (decision === 'revise') out = setStage(out, 'eprouver', { by: profile.email, motif: 'revision via chat' });
          await this.ideas.save(out);
        }
      }
      return new InteractionResponse({ type: 'ack', text: `Décision "${decision}" enregistrée.` });
    } catch (e) {
      return new InteractionResponse({ ephemeral: true, text: `Erreur : ${e.message}` });
    }
  }

  async _handleSubmit(evt, profile, adapter) {
    if (!this.ideas) return new InteractionResponse({ ephemeral: true, text: 'Depot d\'idees non disponible' });
    try {
      const { createIdea, processIntake } = await import('./index.mjs');
      const idea = createIdea({
        id: `chat_${Date.now()}`, title: evt.payload?.titre ?? 'Soumission chat',
        author: profile?.email ?? evt.userId, tenantId: profile?.tenantId ?? 'default',
      });
      const derive = evt.payload ? processIntake(evt.payload) : null;
      await this.ideas.save(idea);
      const msg = `Idée créée : ${idea.title}${derive ? ` (${derive.hypotheses?.length ?? 0} hypothèses, ${derive.attackTargets?.length ?? 0} cibles d'attaque)` : ''}`;
      return new InteractionResponse({ type: 'ack', text: msg });
    } catch (e) {
      return new InteractionResponse({ ephemeral: true, text: `Erreur : ${e.message}` });
    }
  }

  /**
   * Hook pour GovernanceService : quand un gate s'ouvre, publie dans le canal approprie.
   */
  gateNotificationHook() {
    return async (evt) => {
      for (const adapter of this.adapters.values()) {
        try {
          const agregat = evt.evaluation ?? null;
          const view = adapter.buildGateView(evt, { agregat });
          await adapter.postMessage(evt.channelId ?? 'general', view);
        } catch { /* panne d'un canal non bloquante */ }
      }
    };
  }
}
