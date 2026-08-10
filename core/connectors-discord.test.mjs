import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  DiscordAdapter,
} from './connectors-discord.mjs';
import {
  verifyDiscordSignature,
  discordInteractionId,
  discordEmbedColor,
} from './connectors-discord-deep.mjs';
import {
  ConnectorService,
  AccountLinkService,
  InteractionEvent,
  AbstractView,
} from './connectors.mjs';
import { GovernanceService, GateType } from './governance.mjs';

function rawPubHex(keypair) {
  const der = keypair.publicKey.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32).toString('hex');
}

describe('discord signature verification', () => {
  const kp = generateKeyPairSync('ed25519');
  const publicKey = rawPubHex(kp);
  const rawBody = JSON.stringify({ type: 3, data: { custom_id: 'approve:g1' } });

  function signedReq({ body = rawBody, sigBody = body, offset = 0, sigOverride } = {}) {
    const ts = String(Math.floor(Date.now() / 1000) + offset);
    const sig = sigOverride ?? sign(null, Buffer.from(ts + sigBody), kp.privateKey).toString('hex');
    return { headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts }, rawBody: body };
  }

  it('accepts a valid signed interaction', async () => {
    const adapter = new DiscordAdapter({ publicKey, fetchImpl: async () => ({ ok: true }) });
    assert.equal(await adapter.verifySignature(signedReq()), true);
  });

  it('rejects a tampered body', async () => {
    const adapter = new DiscordAdapter({ publicKey, fetchImpl: async () => ({ ok: true }) });
    const req = signedReq({ body: `${rawBody}tampered!`, sigBody: rawBody });
    assert.equal(await adapter.verifySignature(req), false);
  });

  it('rejects a forged signature', async () => {
    const adapter = new DiscordAdapter({ publicKey, fetchImpl: async () => ({ ok: true }) });
    const req = signedReq({ sigOverride: '00'.repeat(64) });
    assert.equal(await adapter.verifySignature(req), false);
  });

  it('rejects a stale timestamp (anti-rejeu > 5 min)', async () => {
    const adapter = new DiscordAdapter({ publicKey, fetchImpl: async () => ({ ok: true }) });
    const req = signedReq({ offset: -400 });
    assert.equal(await adapter.verifySignature(req), false);
  });

  it('rejects unsigned requests and missing public key (safe default)', async () => {
    const adapter = new DiscordAdapter({ publicKey, fetchImpl: async () => ({ ok: true }) });
    assert.equal(await adapter.verifySignature({ headers: {}, rawBody }), false);
    assert.equal(await adapter.verifySignature({ headers: { 'x-signature-ed25519': 'ab', 'x-signature-timestamp': '1' }, rawBody }), false);
    const noKey = new DiscordAdapter({ fetchImpl: async () => ({ ok: true }) });
    assert.equal(await noKey.verifySignature(signedReq()), false);
  });

  it('verifyDiscordSignature pure helper handles malformed keys', () => {
    assert.equal(verifyDiscordSignature({ publicKey: 'ff', timestamp: '1', rawBody: 'x', signature: '00'.repeat(64) }), false);
    assert.equal(verifyDiscordSignature({ publicKey, timestamp: 'abc', rawBody, signature: '00'.repeat(64) }), false);
    assert.equal(verifyDiscordSignature({}), false);
  });
});

describe('discord helpers', () => {
  it('discordEmbedColor parses #rrggbb with fallback', () => {
    assert.equal(discordEmbedColor('#ef4444'), 0xef4444);
    assert.equal(discordEmbedColor('22c55e'), 0x22c55e);
    assert.equal(discordEmbedColor('nope'), 0x3b82f6);
    assert.equal(discordEmbedColor(), 0x3b82f6);
  });

  it('discordInteractionId stable ids', () => {
    const component = { type: 3, id: 'i3', user: { id: 'U1' }, message: { id: 'm1' }, data: { custom_id: 'approve:g1' } };
    assert.equal(discordInteractionId(component), 'discord:U1:approve:g1:m1');
    const modal = { type: 5, id: 'i5', user: { id: 'U1' }, data: { custom_id: 'motif:g1' } };
    assert.equal(discordInteractionId(modal), 'discord:modal:U1:motif:g1:i5');
    const slash = { type: 2, id: 'i2', user: { id: 'U1' }, data: { name: 'submit' } };
    assert.equal(discordInteractionId(slash), 'discord:slash:U1:submit:i2');
    assert.equal(discordInteractionId({ type: 1 }), null);
  });
});

describe('discord parseRequest', () => {
  const adapter = new DiscordAdapter({});
  it('normalizes MESSAGE_COMPONENT (type 3)', () => {
    const evt = adapter.parseRequest({
      body: {
        type: 3,
        id: 'i1',
        member: { user: { id: 'U1' } },
        channel: { id: 'C1' },
        guild_id: 'G1',
        data: { custom_id: 'approve:g1', values: [] },
      },
    });
    assert.equal(evt.platform, 'discord');
    assert.equal(evt.actionId, 'approve:g1');
    assert.equal(evt.userId, 'U1');
    assert.equal(evt.channelId, 'C1');
    assert.equal(evt.teamId, 'G1');
    assert.equal(evt.payload.customId, 'approve:g1');
  });

  it('normalizes slash command (type 2)', () => {
    const evt = adapter.parseRequest({
      body: {
        type: 2,
        user: { id: 'U2' },
        channel_id: 'C2',
        guild_id: 'G2',
        data: { name: 'submit', options: [{ name: 'titre', type: 3, value: 'Lancer un depot' }] },
      },
    });
    assert.equal(evt.actionId, 'slash_submit');
    assert.equal(evt.payload.command, 'submit');
    assert.equal(evt.payload.interactionId, undefined);
  });

  it('flattens MODAL_SUBMIT fields (type 5)', () => {
    const evt = adapter.parseRequest({
      body: {
        type: 5,
        member: { user: { id: 'U3' } },
        channel: { id: 'C3' },
        data: {
          custom_id: 'motif:g1',
          components: [{ type: 1, components: [{ type: 4, custom_id: 'reason', value: 'risque regulatoire' }] }],
        },
      },
    });
    assert.equal(evt.actionId, 'motif:g1');
    assert.equal(evt.payload.fields.reason, 'risque regulatoire');
  });

  it('PING (type 1) yields a ping event and unknown types null', () => {
    const ping = adapter.parseRequest({ body: { type: 1 } });
    assert.equal(ping.actionId, 'ping');
    assert.equal(ping.payload.ping, true);
    assert.equal(adapter.parseRequest({ body: { type: 4 } }), null);
  });
});

describe('discord renderView', () => {
  const adapter = new DiscordAdapter({});

  it('renders embeds + buttons with color and style mapping', () => {
    const out = adapter.renderView(new AbstractView({
      title: 'Gate open',
      text: 'Arbitrage requis',
      fields: [{ label: 'Idee', value: 'Demarche LTL' }],
      color: '#ef4444',
      actions: [
        { id: 'a', label: 'Primary', style: 'primary' },
        { id: 'b', label: 'Secondary', style: 'default' },
        { id: 'c', label: 'Danger', style: 'danger' },
      ],
    }));
    assert.equal(out.embeds.length, 1);
    assert.equal(out.embeds[0].title, 'Gate open');
    assert.equal(out.embeds[0].color, 0xef4444);
    assert.equal(out.embeds[0].fields[0].name, 'Idee');
    const buttons = out.components[0].components;
    assert.equal(buttons.length, 3);
    assert.equal(buttons[0].style, 1);
    assert.equal(buttons[1].style, 2);
    assert.equal(buttons[2].style, 4);
    assert.equal(buttons[0].custom_id, 'a');
  });

  it('caps buttons at 5 per row and readers to plain content without fields', () => {
    const actions = Array.from({ length: 7 }, (_, i) => ({ id: `x${i}`, label: `X${i}` }));
    const out = adapter.renderView(new AbstractView({ title: 'Hi', actions }));
    assert.equal(out.components[0].components.length, 5);
    const plain = adapter.renderView(new AbstractView({ text: 'juste un texte', title: '' }));
    assert.equal(plain.content, 'juste un texte');
    assert.equal(plain.embeds, undefined);
  });

  it('renderModalData builds a Discord modal (type 9 body)', () => {
    const modal = adapter.renderModalData(new AbstractView({
      title: 'Motif du refus',
      fields: [{ label: 'Motif' }],
    }));
    assert.equal(modal.title, 'Motif du refus');
    assert.equal(modal.components[0].components[0].type, 4);
    assert.equal(modal.components[0].components[0].label, 'Motif');
  });
});

describe('discord postMessage / updateMessage', () => {
  it('posts through webhookUrl with rendered payload', async () => {
    const calls = [];
    const adapter = new DiscordAdapter({
      webhookUrl: 'https://discord.com/api/webhooks/1/2',
      fetchImpl: async (url, opts) => {
        calls.push({ url, opts });
        return { ok: true };
      },
    });
    const res = await adapter.postMessage('general', new AbstractView({ title: 'T', fields: [{ label: 'F', value: 'V' }] }));
    assert.equal(res.ok, true);
    assert.equal(calls[0].url, 'https://discord.com/api/webhooks/1/2');
    assert.equal(calls[0].opts.method, 'POST');
    assert.ok(calls[0].opts.body.includes('"embeds"'));
  });

  it('posts through bot token to channel endpoint and returns messageId', async () => {
    let called = false;
    const adapter = new DiscordAdapter({
      botToken: 'secret',
      fetchImpl: async (url, opts) => {
        called = true;
        assert.equal(opts.headers.Authorization, 'Bot secret');
        assert.match(url, /channels\/C1\/messages/);
        return { ok: true, json: async () => ({ id: 'msg1' }) };
      },
    });
    const res = await adapter.postMessage('C1', new AbstractView({ title: 'T' }));
    assert.equal(called, true);
    assert.equal(res.messageId, 'msg1');
  });

  it('updateMessage PATCHes the message endpoint', async () => {
    const calls = [];
    const adapter = new DiscordAdapter({
      botToken: 'secret',
      fetchImpl: async (url, opts) => { calls.push({ url, method: opts.method }); return { ok: true }; },
    });
    const res = await adapter.updateMessage('C1', 'msg1', new AbstractView({ title: 'T2' }));
    assert.equal(res.ok, true);
    assert.match(calls[0].url, /messages\/msg1$/);
    assert.equal(calls[0].method, 'PATCH');
  });
});

describe('discord gate flow via ConnectorService', () => {
  function setup({ role = 'comex' } = {}) {
    const gov = new GovernanceService();
    const kp = generateKeyPairSync('ed25519');
    const linkService = new AccountLinkService();
    const { token } = linkService.createToken({ platformId: 'discord:U1', userId: 'U1', platform: 'discord' });
    linkService.link(token, { id: 'k1', email: 'comex@k.com', role, tenantId: 't1' });
    const adapter = new DiscordAdapter({ publicKey: rawPubHex(kp), linkService, fetchImpl: async () => ({ ok: true }) });
    const connector = new ConnectorService({ adapters: [adapter], linkService, governance: gov });
    const { gateId } = gov.open({ type: GateType.COMEX_ARBITRAGE, ideaId: 'idea1', requiredRole: 'comex' });
    return { gov, adapter, connector, gateId };
  }

  it('approve resolves the gate and records role', async () => {
    const { gov, connector, gateId } = setup();
    const evt = new InteractionEvent({ platform: 'discord', actionId: `approve:${gateId}`, userId: 'discord:U1', channelId: 'C1' });
    const res = await connector.handleInteraction(evt);
    assert.equal(res.type, 'ack');
    assert.equal(gov.list().length, 0);
  });

  it('reject demands a motif (modal) then resolves with reason', async () => {
    const { gov, connector, gateId } = setup();
    const evt = new InteractionEvent({ platform: 'discord', actionId: `reject:${gateId}`, userId: 'discord:U1', channelId: 'C1' });
    const modal = await connector.handleInteraction(evt);
    assert.equal(modal.type, 'modal');
    assert.equal(gov.list().length, 1);

    const confirmed = await connector.handleInteraction({
      ...evt,
      _motifConfirmed: true,
      payload: { reason: 'Dette technique trop elevee' },
    });
    assert.equal(confirmed.type, 'ack');
    assert.equal(gov.list().length, 0);
  });

  it('blocks unlinked users', async () => {
    const { connector, gateId } = setup();
    const evt = new InteractionEvent({ platform: 'discord', actionId: `approve:${gateId}`, userId: 'discord:STRANGER', channelId: 'C1' });
    const res = await connector.handleInteraction(evt);
    assert.equal(res.type, 'ephemeral');
  });

  it('enforces RBAC on gate resolution', async () => {
    const { connector, gateId } = setup({ role: 'facilitateur' });
    const evt = new InteractionEvent({ platform: 'discord', actionId: `approve:${gateId}`, userId: 'discord:U1', channelId: 'C1' });
    const res = await connector.handleInteraction(evt);
    assert.match(res.text, /reservee au role/);
  });

  it('buildGateView renders three resolvable buttons', () => {
    const { adapter } = setup();
    const view = adapter.buildGateView({ gateId: 'g1', requiredRole: 'comex', type: 'comex_arbitrage', ideaId: 'idea1' });
    const out = adapter.renderView(view);
    const ids = out.components[0].components.map((b) => b.custom_id);
    assert.deepEqual(ids, ['approve:g1', 'revise:g1', 'reject:g1']);
  });
});