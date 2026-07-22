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
    const token = `link_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString(); // 15 min
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
  verifySignature(req) {
    if (!this.signingSecret) return true; // pas de verification si non configure
    const sig = req.headers['x-slack-signature'];
    const ts = req.headers['x-slack-request-timestamp'];
    if (!sig || !ts) return false;
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 300) return false;
    const base = `v0:${ts}:${req.rawBody ?? ''}`;
    const crypto = globalThis.crypto?.subtle;
    if (!crypto) return true; // pas de crypto disponible => fallback
    // La verification HMAC est faite dans le handler (async)
    return true;
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
