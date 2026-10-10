import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import Fastify from 'fastify';
import connectorsRoute from '../routes/connectors.mjs';
import { isSignedChatWebhook, registerBodyParsers } from '../lib/body-parsers.mjs';
import { chatReplies } from '../lib/chat-handlers.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { ConnectorConfigurationService } from '../../../core/connector-config.mjs';
import { SlackAdapter, TeamsAdapter } from '../../../core/connectors.mjs';
import { arbitrationActionId } from '../../../core/chat-replies.mjs';

const SLACK_SECRET = 'fixture-signing-secret';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const DISCORD_PUBLIC_KEY = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');

function slackHeaders(raw, contentType = 'application/json') {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    'content-type': contentType,
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': `v0=${createHmac('sha256', SLACK_SECRET).update(`v0:${timestamp}:${raw}`).digest('hex')}`,
  };
}
function slackForm(payload) {
  return `payload=${encodeURIComponent(JSON.stringify(payload))}`;
}
function discordHeaders(raw) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    'content-type': 'application/json',
    'x-signature-timestamp': timestamp,
    'x-signature-ed25519': sign(null, Buffer.from(timestamp + raw), privateKey).toString('hex'),
  };
}

const LINKS = {
  'slack:U-COMEX': { kayrosUserId: 'u1', email: 'comex@kayros.test', role: 'comex', tenantId: 'tenant-a' },
  'discord:D-COMEX': { kayrosUserId: 'u1', email: 'comex@kayros.test', role: 'comex', tenantId: 'tenant-a' },
  'teams:T-COMEX': { kayrosUserId: 'u1', email: 'comex@kayros.test', role: 'comex', tenantId: 'tenant-a' },
};

async function buildApp(platform) {
  const calls = [];
  let counter = 0;
  const fetchImpl = async (url, init = {}) => {
    const body = init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body;
    calls.push({ url: String(url), method: init.method || 'GET', body, auth: init.headers?.Authorization || null });
    counter += 1;
    return { ok: true, status: 200, json: async () => ({ ok: true, ts: `171.${counter}`, id: `msg-${counter}`, access_token: 'bf-token', expires_in: 3600 }), text: async () => '' };
  };
  const swarm = new SwarmService();
  const hybridGateway = new HybridAgentGateway({ swarm });
  const connectorConfig = new ConnectorConfigurationService({ encryptionKey: randomBytes(32).toString('base64'), publicApiUrl: 'https://api.example.test', fetchImpl });
  const secrets = platform === 'slack' ? { bot_token: 'xoxb-fixture', signing_secret: SLACK_SECRET }
    : platform === 'discord' ? { application_id: '123456789012', bot_token: 'discord-bot', public_key: DISCORD_PUBLIC_KEY }
      : { app_id: '00000000-0000-0000-0000-000000000001', bot_password: 'pwd' };
  const connector = await connectorConfig.configure('tenant-a', platform, { secrets });
  await hybridGateway.createRoom({ platform, external_room_id: 'CH-1', name: 'Production', mode: 'always' }, { tenantId: 'tenant-a' });
  const tokens = [];
  const linkService = {
    get: (id) => LINKS[id] || null,
    createToken: ({ platformId }) => { tokens.push(platformId); return { token: `link_fixture_${tokens.length}`, expiresAt: 'soon' }; },
  };
  const app = Fastify();
  registerBodyParsers(app);
  const ctx = {
    connectorConfig, hybridGateway, slackAdapter: null, discordAdapter: null, teamsAdapter: null,
    connectorService: { handleInteraction: async () => ({ type: 'ack' }) }, linkService,
    userStore: { findById: async (id) => (id === 'u1' ? { id, email: 'comex@kayros.test', role: 'comex', tenantId: 'tenant-a' } : null) },
    consoleUrl: 'https://console.example.test/console',
  };
  app.decorate('kayrosContext', ctx);
  await app.register(connectorsRoute);
  ctx.fetchImpl = fetchImpl;
  return { app, ctx, calls, connector, url: `/v1/connectors/${platform}/configured/${connector.connection_id}`, tokens };
}

/** Retient les runs du collectif jusqu'à `release()` (prouve l'acquittement avant la fin). */
function holdRuns(swarm) {
  const run = swarm.run.bind(swarm);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  swarm.run = async (...args) => { await gate; return run(...args); };
  return () => { swarm.run = run; release(); };
}

async function settle(ctx, threadId) {
  const thread = await ctx.hybridGateway.waitForThread(threadId, { tenantId: 'tenant-a' });
  await chatReplies(ctx).idle();
  return thread;
}

test('signed chat webhooks bypass the shared KAYROS_SECRET gate, nothing else does', () => {
  assert.equal(isSignedChatWebhook('/v1/connectors/slack/events'), true);
  assert.equal(isSignedChatWebhook('/v1/connectors/slack/interactive'), true);
  assert.equal(isSignedChatWebhook('/v1/connectors/discord/interactive'), true);
  assert.equal(isSignedChatWebhook('/v1/connectors/teams/interactive'), true);
  assert.equal(isSignedChatWebhook('/v1/connectors/teams/configured/8f6c1c1e-0000-4000-8000-000000000000'), true);
  assert.equal(isSignedChatWebhook('/v1/connectors/link'), false);
  assert.equal(isSignedChatWebhook('/v1/console/threads/x/arbitrate'), false);
});

test('Slack (per-workspace connection): event acked at once, verdict posted in thread, arbitrated by button, double click is a no-op', async (t) => {
  const { app, ctx, calls, url } = await buildApp('slack');
  t.after(() => app.close());
  const event = { type: 'event_callback', event: { type: 'app_mention', channel: 'CH-1', user: 'U-COMEX', text: '<@BOT> faut-il lancer ?', ts: '170.1', client_msg_id: 'cm-1' } };
  const raw = JSON.stringify(event);
  const release = holdRuns(ctx.hybridGateway.swarm);
  const response = await app.inject({ method: 'POST', url, headers: slackHeaders(raw), payload: raw });
  assert.equal(response.statusCode, 200, response.body);
  const ack = response.json();
  assert.ok(ack.thread_id);
  assert.equal((await ctx.hybridGateway.getThread(ack.thread_id, { tenantId: 'tenant-a' })).status, 'running', 'acked before the collective finished');

  const retry = await app.inject({ method: 'POST', url, headers: { ...slackHeaders(raw), 'x-slack-retry-num': '1' }, payload: raw });
  assert.equal(retry.json().duplicate, true);
  assert.equal(retry.json().thread_id, ack.thread_id);
  release();

  const thread = await settle(ctx, ack.thread_id);
  assert.equal(thread.status, 'awaiting_arbitration');
  const posts = calls.filter((c) => c.url.endsWith('chat.postMessage'));
  const updates = calls.filter((c) => c.url.endsWith('chat.update'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.thread_ts, '170.1');
  assert.equal(updates.length, 1);
  const actionIds = updates[0].body.blocks.find((b) => b.type === 'actions').elements.map((e) => e.action_id);
  assert.ok(actionIds.includes(arbitrationActionId('accept_consensus', ack.thread_id)));

  const click = (user) => {
    const form = slackForm({ type: 'block_actions', user: { id: user }, channel: { id: 'CH-1' }, message: { ts: posts.length && '171.1' }, trigger_id: 'trig', response_url: 'https://hooks.slack.com/actions/T/1/abc', actions: [{ action_id: arbitrationActionId('accept_consensus', ack.thread_id) }] });
    return app.inject({ method: 'POST', url, headers: slackHeaders(form, 'application/x-www-form-urlencoded'), payload: form });
  };
  assert.equal((await click('U-COMEX')).statusCode, 200);
  await chatReplies(ctx).idle();
  const resolved = await ctx.hybridGateway.getThread(ack.thread_id, { tenantId: 'tenant-a' });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.messages.find((m) => m.kind === 'arbitration').decision.by, 'comex@kayros.test');
  const outcome = calls.filter((c) => c.url.endsWith('chat.update')).at(-1);
  assert.equal(outcome.body.blocks.some((b) => b.type === 'actions'), false, 'buttons removed after the decision');

  await click('U-COMEX');
  const ephemeral = calls.filter((c) => c.url.startsWith('https://hooks.slack.com/')).at(-1);
  assert.match(ephemeral.body.text, /déjà enregistrée/);
  assert.equal(resolved.messages.filter((m) => m.kind === 'arbitration').length, 1);
});

test('Slack: revise opens a reason modal, the submission arbitrates; unlinked users get a link token privately', async (t) => {
  const { app, ctx, calls, url, tokens } = await buildApp('slack');
  t.after(() => app.close());
  const raw = JSON.stringify({ type: 'event_callback', event: { type: 'app_mention', channel: 'CH-1', user: 'U-COMEX', text: '<@BOT> on y va ?', ts: '170.2' } });
  const { thread_id: threadId } = (await app.inject({ method: 'POST', url, headers: slackHeaders(raw), payload: raw })).json();
  await settle(ctx, threadId);

  const unlinked = slackForm({ type: 'block_actions', user: { id: 'U-NOBODY' }, channel: { id: 'CH-1' }, message: { ts: '171.1' }, trigger_id: 't1', response_url: 'https://hooks.slack.com/actions/T/2/x', actions: [{ action_id: arbitrationActionId('reevaluate', threadId) }] });
  await app.inject({ method: 'POST', url, headers: slackHeaders(unlinked, 'application/x-www-form-urlencoded'), payload: unlinked });
  assert.deepEqual(tokens, ['slack:U-NOBODY']);
  const privateNote = calls.filter((c) => c.url.startsWith('https://hooks.slack.com/')).at(-1);
  assert.equal(privateNote.body.response_type, 'ephemeral');
  assert.match(privateNote.body.text, /link_fixture_1/);

  const revise = slackForm({ type: 'block_actions', user: { id: 'U-COMEX' }, channel: { id: 'CH-1' }, message: { ts: '171.1' }, trigger_id: 't2', response_url: 'https://hooks.slack.com/actions/T/3/x', actions: [{ action_id: arbitrationActionId('reevaluate', threadId) }] });
  await app.inject({ method: 'POST', url, headers: slackHeaders(revise, 'application/x-www-form-urlencoded'), payload: revise });
  const modal = calls.find((c) => c.url.endsWith('views.open'));
  assert.ok(modal, 'views.open called with the trigger id');
  assert.equal(modal.body.trigger_id, 't2');

  const submitWithout = slackForm({ type: 'view_submission', user: { id: 'U-COMEX' }, view: { callback_id: modal.body.view.callback_id, private_metadata: modal.body.view.private_metadata, state: { values: { reason_block: { reason: { value: '' } } } } } });
  const refused = await app.inject({ method: 'POST', url, headers: slackHeaders(submitWithout, 'application/x-www-form-urlencoded'), payload: submitWithout });
  assert.equal(refused.json().response_action, 'errors');

  const submit = slackForm({ type: 'view_submission', user: { id: 'U-COMEX' }, view: { callback_id: modal.body.view.callback_id, private_metadata: modal.body.view.private_metadata, state: { values: { reason_block: { reason: { value: 'Chiffrer le scénario bas' } } } } } });
  const accepted = await app.inject({ method: 'POST', url, headers: slackHeaders(submit, 'application/x-www-form-urlencoded'), payload: submit });
  assert.equal(accepted.json().response_action, 'clear');
  const thread = await ctx.hybridGateway.getThread(threadId, { tenantId: 'tenant-a' });
  assert.equal(thread.status, 'reevaluation_requested');
  assert.equal(thread.messages.find((m) => m.kind === 'arbitration').decision.justification, 'Chiffrer le scénario bas');
});

test('Slack: form-encoded interactions keep the signature check', async (t) => {
  const { app, url } = await buildApp('slack');
  t.after(() => app.close());
  const form = slackForm({ type: 'block_actions', user: { id: 'U-COMEX' }, actions: [{ action_id: 'kayros_arb:accept_consensus:thread_x' }] });
  const response = await app.inject({ method: 'POST', url, headers: { ...slackHeaders(form, 'application/x-www-form-urlencoded'), 'x-slack-signature': 'v0=bad' }, payload: form });
  assert.equal(response.statusCode, 401);
});

test('Discord (per-server connection): /kayros is deferred (type 5), the verdict edits the original response, buttons arbitrate in place', async (t) => {
  const { app, ctx, calls, url } = await buildApp('discord');
  t.after(() => app.close());
  const command = JSON.stringify({ id: 'int-1', application_id: '123456789012', token: 'tok-1', type: 2, channel_id: 'CH-1', guild_id: 'G1', member: { user: { id: 'D-COMEX' } }, data: { name: 'kayros', options: [{ name: 'question', value: 'Ouvrir le marché DE ?' }] } });
  const deferred = await app.inject({ method: 'POST', url, headers: discordHeaders(command), payload: command });
  assert.deepEqual(deferred.json(), { type: 5 });
  const [thread] = await ctx.hybridGateway.listThreads({ tenantId: 'tenant-a' });
  await settle(ctx, thread.thread_id);
  const edit = calls.find((c) => c.method === 'PATCH' && c.url.includes('/webhooks/123456789012/tok-1/messages/@original'));
  assert.ok(edit, 'verdict published by editing the deferred response');
  assert.ok(edit.body.components[0].components.some((b) => b.custom_id === arbitrationActionId('accept_consensus', thread.thread_id)));

  const unlinked = JSON.stringify({ id: 'int-2', type: 3, token: 'tok-2', channel_id: 'CH-1', member: { user: { id: 'D-NOBODY' } }, data: { custom_id: arbitrationActionId('accept_consensus', thread.thread_id) } });
  const denied = await app.inject({ method: 'POST', url, headers: discordHeaders(unlinked), payload: unlinked });
  assert.equal(denied.json().type, 4);
  assert.equal(denied.json().data.flags, 64, 'link token only visible to the clicking user');
  assert.match(denied.json().data.content, /link_fixture_1/);

  const click = JSON.stringify({ id: 'int-3', type: 3, token: 'tok-3', channel_id: 'CH-1', member: { user: { id: 'D-COMEX' } }, data: { custom_id: arbitrationActionId('accept_consensus', thread.thread_id) } });
  const updated = await app.inject({ method: 'POST', url, headers: discordHeaders(click), payload: click });
  assert.equal(updated.json().type, 7);
  assert.deepEqual(updated.json().data.components, []);
  const again = await app.inject({ method: 'POST', url, headers: discordHeaders(click), payload: click });
  assert.equal(again.json().type, 7, 'double click: card shows the recorded outcome again');
  const resolved = await ctx.hybridGateway.getThread(thread.thread_id, { tenantId: 'tenant-a' });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.messages.filter((m) => m.kind === 'arbitration').length, 1);
});

test('Discord: revise asks for the reason in a modal and arbitrates on submit', async (t) => {
  const { app, ctx, url } = await buildApp('discord');
  t.after(() => app.close());
  const command = JSON.stringify({ id: 'int-10', application_id: '123456789012', token: 'tok-10', type: 2, channel_id: 'CH-1', member: { user: { id: 'D-COMEX' } }, data: { name: 'kayros', options: [{ name: 'question', value: 'Lancer ?' }] } });
  await app.inject({ method: 'POST', url, headers: discordHeaders(command), payload: command });
  const [thread] = await ctx.hybridGateway.listThreads({ tenantId: 'tenant-a' });
  await settle(ctx, thread.thread_id);
  const click = JSON.stringify({ id: 'int-11', type: 3, token: 'tok-11', channel_id: 'CH-1', member: { user: { id: 'D-COMEX' } }, data: { custom_id: arbitrationActionId('override_veto', thread.thread_id) } });
  const modal = (await app.inject({ method: 'POST', url, headers: discordHeaders(click), payload: click })).json();
  assert.equal(modal.type, 9);
  const submit = JSON.stringify({ id: 'int-12', type: 5, token: 'tok-12', channel_id: 'CH-1', member: { user: { id: 'D-COMEX' } }, data: { custom_id: modal.data.custom_id, components: [{ type: 1, components: [{ custom_id: 'reason', value: 'Pilote limité à 2 pays' }] }] } });
  const done = (await app.inject({ method: 'POST', url, headers: discordHeaders(submit), payload: submit })).json();
  assert.equal(done.type, 7);
  const resolved = await ctx.hybridGateway.getThread(thread.thread_id, { tenantId: 'tenant-a' });
  assert.equal(resolved.messages.find((m) => m.kind === 'arbitration').decision.action, 'override_veto');
});

test('Teams (per-tenant connection): 200 at once, proactive verdict card, Action.Submit arbitrates and replaces the card', async (t) => {
  const original = TeamsAdapter.prototype.verifySignature;
  TeamsAdapter.prototype.verifySignature = async () => true; // JWT Bot Framework couvert par connectors.teams.test.mjs
  t.after(() => { TeamsAdapter.prototype.verifySignature = original; });
  const { app, ctx, calls, url } = await buildApp('teams');
  t.after(() => app.close());
  const activity = { type: 'message', id: 'act-1', text: '<at>KayrosLab</at> on signe ?', serviceUrl: 'https://smba.trafficmanager.net/emea/', conversation: { id: 'CH-1' }, from: { id: 'T-COMEX' } };
  const response = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', authorization: 'Bearer x' }, payload: activity });
  assert.equal(response.statusCode, 200);
  const [thread] = await ctx.hybridGateway.listThreads({ tenantId: 'tenant-a' });
  assert.equal(thread.question, 'on signe ?');
  await settle(ctx, thread.thread_id);
  const conv = 'https://smba.trafficmanager.net/emea/v3/conversations/CH-1/activities';
  assert.ok(calls.some((c) => c.url === conv && c.body?.type === 'typing'));
  const card = calls.find((c) => c.url === `${conv}/act-1` && c.body?.attachments);
  assert.ok(card, 'placeholder replied to the original activity');
  const verdict = calls.filter((c) => c.method === 'PUT' && c.url.startsWith(`${conv}/`)).at(-1);
  const content = verdict.body.attachments[0].content;
  const accept = content.actions.find((a) => a.data.actionId === arbitrationActionId('accept_consensus', thread.thread_id));
  assert.ok(accept);
  const messageId = verdict.url.split('/').at(-1);

  const submit = { type: 'message', id: 'act-2', replyToId: messageId, value: { actionId: accept.data.actionId, reason: '' }, serviceUrl: 'https://smba.trafficmanager.net/emea/', conversation: { id: 'CH-1' }, from: { id: 'T-COMEX' } };
  const clicked = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', authorization: 'Bearer x' }, payload: submit });
  assert.equal(clicked.statusCode, 200);
  await chatReplies(ctx).idle();
  assert.equal((await ctx.hybridGateway.getThread(thread.thread_id, { tenantId: 'tenant-a' })).status, 'resolved');
  const outcome = calls.filter((c) => c.method === 'PUT').at(-1);
  assert.equal(outcome.url, `${conv}/${messageId}`);
  assert.equal(outcome.body.attachments[0].content.actions, undefined, 'outcome card has no buttons');

  const stranger = { ...submit, id: 'act-3', from: { id: 'T-NOBODY' }, conversation: { id: 'CH-1', conversationType: 'channel' } };
  await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', authorization: 'Bearer x' }, payload: stranger });
  const notice = calls.filter((c) => c.body?.type === 'message' && c.body?.text).at(-1);
  assert.match(notice.body.text, /conversation privée/);
  assert.doesNotMatch(notice.body.text, /link_fixture/, 'no link token in a shared channel');
});

test('Slack server app in one-click (OAuth) mode: signing secret only, replies with the workspace token; refused without a signing secret', async (t) => {
  const { app, ctx, calls } = await buildApp('slack');
  t.after(() => app.close());
  ctx.slackAdapter = new SlackAdapter({ signingSecret: SLACK_SECRET, botToken: '', fetchImpl: ctx.fetchImpl });
  const raw = JSON.stringify({ type: 'event_callback', event: { type: 'app_mention', channel: 'CH-1', user: 'U-COMEX', text: '<@BOT> go ?', ts: '180.1' } });
  const response = await app.inject({ method: 'POST', url: '/v1/connectors/slack/events', headers: slackHeaders(raw), payload: raw });
  assert.equal(response.statusCode, 200);
  await settle(ctx, response.json().thread_id);
  const posted = calls.find((c) => c.url.endsWith('chat.postMessage'));
  assert.equal(posted.auth, 'Bearer xoxb-fixture', 'workspace token from the encrypted connection');

  ctx.slackAdapter = new SlackAdapter({ signingSecret: '', botToken: 'xoxb-server', fetchImpl: ctx.fetchImpl });
  const unsigned = await app.inject({ method: 'POST', url: '/v1/connectors/slack/events', headers: { 'content-type': 'application/json' }, payload: raw });
  assert.equal(unsigned.statusCode, 401);
});
