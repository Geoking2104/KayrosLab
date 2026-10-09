import test from 'node:test';
import assert from 'node:assert/strict';
import { HybridAgentGateway } from './hybrid-agent-gateway.mjs';
import { SwarmService } from './swarm.mjs';
import { SlackAdapter, TeamsAdapter } from './connectors.mjs';
import {
  ChatReplyService, arbitrationActionId, parseArbitrationActionId, verdictView, outcomeView,
} from './chat-replies.mjs';

function fakeAdapter(platform) {
  const calls = [];
  let n = 0;
  const ok = (extra = {}) => ({ ok: true, messageId: `${platform}-msg-${++n}`, ...extra });
  return {
    platform, name: platform, applicationId: 'app-1', calls,
    renderView: (view) => ({ content: `${view.title}\n${view.text}`, components: view.actions?.length ? [{ type: 1, components: view.actions.map((a) => ({ custom_id: a.id })) }] : undefined }),
    postMessage: async (channel, view, options) => { calls.push({ op: 'post', channel, view, options }); return ok(); },
    updateMessage: async (channel, id, view) => { calls.push({ op: 'update', channel, id, view }); return { ok: true }; },
    postChannelMessage: async (channel, payload) => { calls.push({ op: 'channel_post', channel, payload }); return ok(); },
    editInteractionResponse: async (app, token, payload, messageId) => { calls.push({ op: 'edit_interaction', app, token, payload, messageId }); return token === 'expired' ? { ok: false, status: 401 } : ok(); },
    sendTyping: async (ref) => { calls.push({ op: 'typing', ref }); return { ok: true }; },
    sendToConversation: async (ref, view) => { calls.push({ op: 'send', ref, view }); return ok(); },
    updateInConversation: async (ref, id, view) => { calls.push({ op: 'update_activity', ref, id, view }); return { ok: true }; },
  };
}

async function setup({ platform = 'slack', links = {}, users = null, failRun = false } = {}) {
  const swarm = new SwarmService();
  const gateway = new HybridAgentGateway({ swarm });
  if (failRun) swarm.run = async () => { throw new Error('fournisseur LLM indisponible'); };
  const adapter = fakeAdapter(platform);
  gateway.setAdapter(adapter);
  const linkMap = new Map(Object.entries(links));
  const tokens = [];
  const linkService = { get: (id) => linkMap.get(id) || null, createToken: ({ platformId }) => { tokens.push(platformId); return { token: `link_test_${tokens.length}`, expiresAt: 'x' }; } };
  const replies = new ChatReplyService({ gateway, linkService, users, consoleUrl: 'https://console.test/console' }).attach();
  const room = await gateway.createRoom({ platform, external_room_id: 'CH-1', name: 'COMEX', mode: 'always' }, { tenantId: 'tenant-a' });
  return { swarm, gateway, adapter, replies, room, tokens };
}

async function startAndFinish(ctx, overrides = {}) {
  const started = await ctx.gateway.startMessage({
    platform: ctx.room.platform, external_room_id: 'CH-1', message_id: 'msg-1', dedupe: true,
    text: 'Faut-il lancer la nouvelle offre ?', allowConcurrent: true,
    chat: { platform: ctx.room.platform, channel_id: 'CH-1', thread_ts: '171.0' }, ...overrides,
  });
  assert.equal(started.thread.status, 'running');
  const thread = await ctx.gateway.waitForThread(started.thread.thread_id, { tenantId: 'tenant-a' });
  await ctx.replies.idle();
  return { started, thread };
}

const COMEX = { kayrosUserId: 'u-comex', email: 'comex@kayros.test', role: 'comex', tenantId: 'tenant-a' };

test('action ids round-trip and reject foreign ids', () => {
  const id = arbitrationActionId('override_veto', 'thread_abc_123');
  assert.deepEqual(parseArbitrationActionId(id), { action: 'override_veto', threadId: 'thread_abc_123', reasonStep: false });
  assert.equal(parseArbitrationActionId('approve:gate-1'), null);
  assert.equal(parseArbitrationActionId('kayros_arb:delete:thread_1'), null);
  assert.ok(id.length <= 100, 'Discord custom_id ≤ 100');
});

test('Slack: immediate "analysing" reply in thread, then the verdict replaces it with arbitration buttons', async () => {
  const ctx = await setup();
  const { thread } = await startAndFinish(ctx);
  assert.equal(thread.status, 'awaiting_arbitration');
  const [ack, verdict] = ctx.adapter.calls;
  assert.equal(ack.op, 'post');
  assert.equal(ack.options.threadTs, '171.0');
  assert.match(ack.view.text, /analyse/);
  assert.equal(verdict.op, 'update');
  assert.equal(verdict.id, 'slack-msg-1');
  assert.deepEqual(verdict.view.actions.map((a) => parseArbitrationActionId(a.id).action), ['accept_consensus', 'reevaluate', 'override_veto']);
  const stored = await ctx.gateway.getThread(thread.thread_id, { tenantId: 'tenant-a' });
  assert.equal(stored.chat.message_ts, 'slack-msg-1');
});

test('platform retries of the same message are deduplicated (one thread)', async () => {
  const ctx = await setup();
  const { started } = await startAndFinish(ctx);
  const retry = await ctx.gateway.startMessage({
    platform: 'slack', external_room_id: 'CH-1', message_id: 'msg-1', dedupe: true, text: 'Faut-il lancer la nouvelle offre ?', allowConcurrent: true,
    chat: { platform: 'slack', channel_id: 'CH-1' },
  });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.thread.thread_id, started.thread.thread_id);
  assert.equal((await ctx.gateway.listThreads({ tenantId: 'tenant-a' })).length, 1);
});

test('a failed run posts a readable failure message in the chat', async () => {
  const ctx = await setup({ failRun: true });
  const { thread } = await startAndFinish(ctx);
  assert.equal(thread.status, 'failed');
  const last = ctx.adapter.calls.at(-1);
  assert.equal(last.op, 'update');
  assert.match(last.view.text, /fournisseur LLM indisponible/);
  assert.match(last.view.title, /n’a pas abouti/);
});

test('arbitration from chat: unlinked user gets a one-time link token, nothing is decided', async () => {
  const ctx = await setup();
  const { thread } = await startAndFinish(ctx);
  const result = await ctx.replies.arbitrate({ platform: 'slack', platformUserId: 'slack:U-unknown', threadId: thread.thread_id, action: 'accept_consensus', channelId: 'CH-1' });
  assert.equal(result.code, 'not_linked');
  assert.match(result.message, /link_test_1/);
  assert.deepEqual(ctx.tokens, ['slack:U-unknown']);
  assert.equal((await ctx.gateway.getThread(thread.thread_id, { tenantId: 'tenant-a' })).status, 'awaiting_arbitration');
});

test('arbitration from chat enforces role, tenant and originating channel', async () => {
  const ctx = await setup({
    links: {
      'slack:U-contrib': { kayrosUserId: 'u-c', email: 'c@kayros.test', role: 'contributor', tenantId: 'tenant-a' },
      'slack:U-other': { kayrosUserId: 'u-o', email: 'o@other.test', role: 'comex', tenantId: 'tenant-b' },
      'slack:U-comex': COMEX,
      'slack:U-demoted': { ...COMEX, kayrosUserId: 'u-demoted' },
    },
    users: { findById: async (id) => ({ 'u-comex': { id, email: 'comex@kayros.test', role: 'comex', tenantId: 'tenant-a' }, 'u-demoted': { id, email: 'd@kayros.test', role: 'expert', tenantId: 'tenant-a' } })[id] || null },
  });
  const { thread } = await startAndFinish(ctx);
  const base = { platform: 'slack', threadId: thread.thread_id, action: 'accept_consensus', channelId: 'CH-1' };
  assert.equal((await ctx.replies.arbitrate({ ...base, platformUserId: 'slack:U-contrib' })).code, 'forbidden');
  assert.equal((await ctx.replies.arbitrate({ ...base, platformUserId: 'slack:U-demoted' })).code, 'forbidden', 'current role from the user store wins over the role cached at link time');
  assert.equal((await ctx.replies.arbitrate({ ...base, platformUserId: 'slack:U-other' })).code, 'not_found');
  assert.equal((await ctx.replies.arbitrate({ ...base, platformUserId: 'slack:U-comex', channelId: 'CH-OTHER' })).code, 'not_found');
  assert.equal((await ctx.replies.arbitrate({ ...base, platformUserId: 'slack:U-comex', platform: 'discord' })).code, 'not_found');
  assert.equal((await ctx.gateway.getThread(thread.thread_id, { tenantId: 'tenant-a' })).status, 'awaiting_arbitration');
});

test('arbitration from chat uses the console decision logic, requires a reason for revise, and is idempotent', async () => {
  const ctx = await setup({ links: { 'slack:U-comex': COMEX } });
  const { thread } = await startAndFinish(ctx);
  const base = { platform: 'slack', platformUserId: 'slack:U-comex', threadId: thread.thread_id, channelId: 'CH-1' };
  assert.equal((await ctx.replies.arbitrate({ ...base, action: 'reevaluate', reason: '' })).code, 'reason_required');
  const [first, second] = await Promise.all([
    ctx.replies.arbitrate({ ...base, action: 'accept_consensus' }),
    ctx.replies.arbitrate({ ...base, action: 'accept_consensus' }),
  ]);
  assert.deepEqual([first.ok, second.ok].sort(), [false, true]);
  assert.equal([first, second].find((r) => !r.ok).code, 'already');
  const resolved = await ctx.gateway.getThread(thread.thread_id, { tenantId: 'tenant-a' });
  assert.equal(resolved.status, 'resolved');
  const decision = resolved.messages.find((m) => m.kind === 'arbitration').decision;
  assert.equal(decision.action, 'accept_consensus');
  assert.equal(decision.by, 'comex@kayros.test');
  const run = ctx.swarm.getRun?.(resolved.current_run_id, { tenantId: 'tenant-a' }) || null;
  if (run) assert.equal(run.human_decision.by, 'comex@kayros.test');
  await ctx.replies.idle();
  const last = ctx.adapter.calls.at(-1);
  assert.equal(last.op, 'update');
  assert.deepEqual(last.view.actions, []);
  assert.match(last.view.title, /Approuvé|Refusé/);
  assert.equal((await ctx.replies.arbitrate({ ...base, action: 'override_veto', reason: 'trop tard' })).code, 'already');
});

test('a console decision on a chat-born mission updates the chat card with the outcome', async () => {
  const ctx = await setup();
  const { thread } = await startAndFinish(ctx);
  await ctx.gateway.arbitrateThread(thread.thread_id, { action: 'override_veto', decision: 'CONDITIONAL_GO', justification: 'Budget validé en CODIR' }, { tenantId: 'tenant-a', by: 'console@kayros.test' });
  await ctx.replies.idle();
  const last = ctx.adapter.calls.at(-1);
  assert.equal(last.op, 'update');
  assert.match(last.view.title, /sous conditions/);
  assert.match(last.view.text, /console@kayros\.test/);
  assert.match(last.view.text, /Budget validé en CODIR/);
});

test('Discord: the deferred interaction response is edited, then falls back to a bot message when the token expired', async () => {
  const ctx = await setup({ platform: 'discord' });
  const { thread } = await startAndFinish(ctx, { chatExtra: { discord: { application_id: 'app-1', token: 'interaction-token' } }, chat: { platform: 'discord', channel_id: 'CH-1' } });
  assert.equal(thread.status, 'awaiting_arbitration');
  assert.equal(ctx.adapter.calls.length, 1, 'no placeholder: the deferred response already shows "thinking"');
  assert.equal(ctx.adapter.calls[0].op, 'edit_interaction');
  assert.equal(ctx.adapter.calls[0].messageId, '@original');
  assert.ok(ctx.adapter.calls[0].payload.components.length);

  const other = await setup({ platform: 'discord' });
  await startAndFinish(other, { chatExtra: { discord: { application_id: 'app-1', token: 'expired' } }, chat: { platform: 'discord', channel_id: 'CH-1' } });
  assert.deepEqual(other.adapter.calls.map((c) => c.op), ['edit_interaction', 'channel_post']);
});

test('Teams: typing + proactive reply to the conversation, then the card is replaced in place', async () => {
  const ctx = await setup({ platform: 'teams' });
  const ref = { service_url: 'https://smba.trafficmanager.net/emea/', conversation_id: 'CH-1', reply_to_id: 'act-1' };
  await startAndFinish(ctx, { chat: { platform: 'teams', channel_id: 'CH-1', teams: ref } });
  assert.deepEqual(ctx.adapter.calls.map((c) => c.op), ['typing', 'send', 'update_activity']);
  assert.deepEqual(ctx.adapter.calls[1].ref, ref);
  assert.equal(ctx.adapter.calls[2].id, 'teams-msg-1');
  assert.equal(ctx.adapter.calls[2].view.inputs[0].id, 'reason');
});

test('verdict and outcome views stay within platform limits', () => {
  const thread = {
    thread_id: 'thread_x', status: 'awaiting_arbitration', question: 'q'.repeat(5000),
    messages: [{ kind: 'run', run: { run_id: 'run_1', swarm_name: 'S', consensus: { verdict: 'NO_GO', rationale: 'r'.repeat(5000) }, analyses: [] } }],
  };
  const view = verdictView(thread, { consoleUrl: 'https://c.test' });
  assert.match(view.actions[0].label, /Refuser/);
  const outcome = outcomeView({ ...thread, messages: [...thread.messages, { kind: 'arbitration', decision: { action: 'accept_consensus', verdict: 'NO_GO', by: 'a@b' } }] });
  assert.match(outcome.title, /Refusé/);
});

test('SlackAdapter renders valid Block Kit buttons (no "default" style) and threads replies', async () => {
  const sent = [];
  const adapter = new SlackAdapter({ botToken: 'xoxb-test', fetchImpl: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { json: async () => ({ ok: true, ts: '9.9' }) }; } });
  const view = verdictView({ thread_id: 'thread_y', status: 'awaiting_arbitration', question: 'q', messages: [{ kind: 'run', run: { run_id: 'r', consensus: { verdict: 'GO' }, analyses: [] } }] });
  const result = await adapter.postMessage('C1', view, { threadTs: '1.0' });
  assert.equal(result.messageId, '9.9');
  assert.equal(sent[0].body.thread_ts, '1.0');
  const buttons = sent[0].body.blocks.find((b) => b.type === 'actions').elements;
  for (const button of buttons) assert.ok(button.style === undefined || ['primary', 'danger'].includes(button.style));
});

test('TeamsAdapter only talks to Bot Framework service URLs', async () => {
  const urls = [];
  const adapter = new TeamsAdapter({ botId: 'bot', botPassword: 'pwd', fetchImpl: async (url) => { urls.push(url); return { ok: true, json: async () => ({ access_token: 't', expires_in: 3600, id: 'a-1' }) }; } });
  await assert.rejects(() => adapter.sendToConversation({ service_url: 'https://evil.example.com/', conversation_id: 'c' }, { type: 'message', text: 'x' }), /non autorisé/);
  const sent = await adapter.sendToConversation({ service_url: 'https://smba.trafficmanager.net/emea/', conversation_id: '19:abc@thread.tacv2', reply_to_id: 'act-1' }, { type: 'message', text: 'x' });
  assert.equal(sent.ok, true);
  assert.equal(urls.at(-1), 'https://smba.trafficmanager.net/emea/v3/conversations/19%3Aabc%40thread.tacv2/activities/act-1');
});
