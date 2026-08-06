// KayrosLab — Discord adapter (V16 scaffold)
import {
  ChatAdapter,
  InteractionEvent,
  AccountLinkService,
} from './connectors.mjs';

// ---- Adaptateur Discord (Interactions + Webhook) — V16 scaffold ----

export class DiscordAdapter extends ChatAdapter {
  /**
   * @param {{
   *   botToken?: string,
   *   publicKey?: string,
   *   applicationId?: string,
   *   webhookUrl?: string,
   *   fetchImpl?: Function,
   *   linkService?: AccountLinkService
   * }} opts
   */
  constructor({ botToken = '', publicKey = '', applicationId = '', webhookUrl = '', fetchImpl, linkService } = {}) {
    super({ name: 'discord', platform: 'discord', linkService });
    this.botToken = botToken;
    this.publicKey = publicKey;
    this.applicationId = applicationId;
    this.webhookUrl = webhookUrl;
    this._fetch = fetchImpl ?? globalThis.fetch;
    if (!this._fetch) throw new Error('DiscordAdapter: fetch indisponible');
  }

  /**
   * Verifie la signature Ed25519 des interactions Discord.
   * Headers: X-Signature-Ed25519, X-Signature-Timestamp + raw body.
   * Full crypto verification requires the public key; without it, returns false.
   */
  verifySignature(req) {
    const sig = req.headers?.['x-signature-ed25519'] || req.headers?.['X-Signature-Ed25519'];
    const ts = req.headers?.['x-signature-timestamp'] || req.headers?.['X-Signature-Timestamp'];
    if (!sig || !ts || !this.publicKey) return false;
    // Scaffold: real Ed25519 verify should use tweetnacl / Web Crypto against publicKey
    // Reject when crypto not wired — safer than accepting unsigned traffic.
    return false;
  }

  /**
   * Normalise une interaction Discord (PING, APPLICATION_COMMAND, MESSAGE_COMPONENT, MODAL_SUBMIT).
   */
  parseRequest(req) {
    const body = req.body ?? {};
    const type = body.type;

    // 1 = PING (must respond with type 1 pong)
    if (type === 1) {
      return new InteractionEvent({
        platform: 'discord',
        actionId: 'ping',
        userId: null,
        channelId: null,
        payload: { ping: true },
        raw: body,
      });
    }

    const userId = body.member?.user?.id || body.user?.id || null;
    const channelId = body.channel_id || body.channel?.id || null;
    const guildId = body.guild_id || null;

    // 2 = APPLICATION_COMMAND (slash)
    if (type === 2) {
      const name = body.data?.name || 'unknown';
      const options = body.data?.options || [];
      return new InteractionEvent({
        platform: 'discord',
        actionId: `slash_${name}`,
        userId,
        channelId,
        teamId: guildId,
        payload: {
          command: name,
          options,
          interactionId: body.id,
          interactionToken: body.token,
        },
        raw: body,
      });
    }

    // 3 = MESSAGE_COMPONENT (button / select)
    if (type === 3) {
      return new InteractionEvent({
        platform: 'discord',
        actionId: body.data?.custom_id || 'component',
        userId,
        channelId,
        teamId: guildId,
        payload: {
          customId: body.data?.custom_id,
          values: body.data?.values,
          interactionId: body.id,
          interactionToken: body.token,
        },
        raw: body,
      });
    }

    // 5 = MODAL_SUBMIT
    if (type === 5) {
      const fields = {};
      for (const row of body.data?.components || []) {
        for (const c of row.components || []) {
          if (c.custom_id) fields[c.custom_id] = c.value;
        }
      }
      return new InteractionEvent({
        platform: 'discord',
        actionId: body.data?.custom_id || 'modal_submit',
        userId,
        channelId,
        teamId: guildId,
        payload: {
          fields,
          interactionId: body.id,
          interactionToken: body.token,
        },
        raw: body,
      });
    }

    return null;
  }

  async postMessage(channelId, view) {
    const content = this.renderView(view);
    if (this.webhookUrl) {
      const res = await this._fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      });
      return { ok: res.ok };
    }
    if (!this.botToken || !channelId) return { ok: false, error: 'botToken/channelId manquant' };
    const res = await this._fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${this.botToken}`,
      },
      body: JSON.stringify(content),
    });
    if (!res.ok) return { ok: false, error: await res.text() };
    const data = await res.json().catch(() => ({}));
    return { ok: true, messageId: data.id };
  }

  async updateMessage(channelId, messageId, view) {
    if (!this.botToken || !channelId || !messageId) return { ok: false, error: 'botToken/channelId/messageId manquant' };
    const content = this.renderView(view);
    const res = await this._fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${this.botToken}`,
      },
      body: JSON.stringify(content),
    });
    return { ok: res.ok };
  }

  async ephemeralMessage(channelId, userId, text) {
    return {
      ok: true,
      deferred: true,
      response: {
        type: 4,
        data: { content: String(text || ''), flags: 64 },
      },
    };
  }

  async openModal(triggerId, form) {
    const view = this.renderView(form);
    return {
      ok: true,
      deferred: true,
      response: {
        type: 9,
        data: view,
      },
    };
  }

  renderView(view) {
    if (!view) return { content: '' };
    const title = view.title || view.heading || '';
    const body = view.body || view.text || view.message || '';
    const content = [title, body].filter(Boolean).join('\n').slice(0, 2000);

    const embeds = [];
    if (view.fields && Array.isArray(view.fields)) {
      embeds.push({
        title: title || 'KayrosLab',
        description: body || undefined,
        fields: view.fields.slice(0, 25).map((f) => ({
          name: String(f.name || f.label || '—').slice(0, 256),
          value: String(f.value || '—').slice(0, 1024),
          inline: Boolean(f.inline),
        })),
        color: 0x7c3aed,
      });
    }

    const components = [];
    if (view.actions && Array.isArray(view.actions) && view.actions.length) {
      const row = {
        type: 1,
        components: view.actions.slice(0, 5).map((a) => ({
          type: 2,
          style: a.style === 'danger' ? 4 : a.style === 'primary' ? 1 : 2,
          label: String(a.label || a.id || 'Action').slice(0, 80),
          custom_id: String(a.id || a.actionId || 'action').slice(0, 100),
        })),
      };
      components.push(row);
    }

    const payload = { content: embeds.length ? (content || undefined) : content };
    if (embeds.length) payload.embeds = embeds;
    if (components.length) payload.components = components;
    if (view.type === 'modal' || view.modal) {
      return {
        custom_id: view.id || view.custom_id || 'kayros_modal',
        title: String(title || 'KayrosLab').slice(0, 45),
        components: (view.inputs || []).slice(0, 5).map((inp) => ({
          type: 1,
          components: [{
            type: 4,
            custom_id: String(inp.id || inp.custom_id || 'field').slice(0, 100),
            label: String(inp.label || inp.name || 'Field').slice(0, 45),
            style: inp.multiline ? 2 : 1,
            required: Boolean(inp.required),
            placeholder: inp.placeholder ? String(inp.placeholder).slice(0, 100) : undefined,
          }],
        })),
      };
    }
    return payload;
  }

  pongResponse() {
    return { type: 1 };
  }
}
