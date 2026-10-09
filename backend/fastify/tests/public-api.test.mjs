// API publique /v1/public/* + console Intégrations : clés d'API (création
// unique, scopes, révocation), missions avec Idempotency-Key et référence
// externe, profil demo, webhooks signés (callback + abonnement), arbitrage.
// Aucun appel LLM réel (profil demo ou LLM simulé), aucun réseau (fetch injecté).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { bearer, buildTestApp, registerComex } from './test-helpers.mjs';
import { verifySignature } from '../../../core/integrations/webhooks.mjs';

const auth = (token) => ({ authorization: `Bearer ${token}` });

describe('API publique et intégrations', () => {
  let app; let ctx; let comex; let sent;

  beforeEach(async () => {
    ({ app, ctx } = await buildTestApp({}, { console: true }));
    await registerComex(ctx);
    comex = await bearer(ctx, 'comex@test.local', 'secret1234');
    sent = [];
    ctx.webhookDispatcher.fetch = async (url, init) => { sent.push({ url, ...init }); return { status: 200 }; };
  });
  afterEach(async () => { await ctx.hybridGateway.idle(); if (app) await app.close(); });

  async function createKey(body = { name: 'n8n PoC' }) {
    const res = await app.inject({ method: 'POST', url: '/v1/console/integrations/keys', headers: auth(comex), payload: body });
    assert.equal(res.statusCode, 201, res.body);
    return res.json();
  }
  async function createCollective(name = 'Comité deal review') {
    const res = await app.inject({ method: 'POST', url: '/v1/console/sessions', headers: auth(comex), payload: { name, active_agents: ['cfo', 'cto', 'legal_counsel'] } });
    assert.equal(res.statusCode, 201, res.body);
    return res.json().session.session_id;
  }
  function launch(token, payload, key = 'sf-006A-Proposal') {
    return app.inject({ method: 'POST', url: '/v1/public/missions', headers: { ...auth(token), 'idempotency-key': key }, payload });
  }

  it('crée une clé affichée une seule fois, liste sans secret, /me par Bearer ou X-Api-Key', async () => {
    const { token, key } = await createKey({ name: 'n8n PoC', service_account: 'n8n' });
    assert.match(token, /^kl_live_[a-z0-9]{10}_[A-Za-z0-9]{32}$/);
    assert.deepEqual(key.scopes, ['missions:write', 'missions:read', 'collectives:read']);
    const list = await app.inject({ method: 'GET', url: '/v1/console/integrations', headers: auth(comex) });
    assert.equal(list.statusCode, 200);
    assert.ok(!list.body.includes(token), 'la clé complète ne réapparaît jamais');
    assert.ok(!list.body.includes('token_sha256'));
    assert.equal(list.json().profiles.default, 'fast');

    const me = await app.inject({ method: 'GET', url: '/v1/public/me', headers: auth(token) });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().tenant_id, 't1');
    assert.equal(me.json().service_account, 'n8n');
    const viaHeader = await app.inject({ method: 'GET', url: '/v1/public/me', headers: { 'x-api-key': token } });
    assert.equal(viaHeader.statusCode, 200);
  });

  it('callback_events : seuls les événements demandés partent vers callback_url', async () => {
    const { token } = await createKey();
    const collective = await createCollective();
    const bad = await launch(token, { collective_id: collective, question: 'Signer ?', profile: 'demo', callback_url: 'https://n8n.example.com/webhook-waiting/1', callback_events: ['mission.unknown'] }, 'ce-bad');
    assert.equal(bad.statusCode, 400, bad.body);
    const res = await launch(token, { collective_id: collective, question: 'Signer ?', profile: 'demo', callback_url: 'https://n8n.example.com/webhook-waiting/2', callback_events: ['mission.completed', 'mission.failed'] }, 'ce-ok');
    assert.equal(res.statusCode, 202, res.body);
    const threadId = new URL(res.json().dossier_url).hash.split('thread=')[1];
    await ctx.hybridGateway.waitForThread(decodeURIComponent(threadId));
    await ctx.webhookDispatcher.deliverDue();
    assert.deepEqual(sent.map((item) => item.headers['x-kayros-event']), ['mission.completed']);
    const arbitrated = await app.inject({ method: 'POST', url: `/v1/console/threads/${threadId}/arbitrate`, headers: auth(comex), payload: { action: 'accept_consensus' } });
    assert.equal(arbitrated.statusCode, 200, arbitrated.body);
    await ctx.webhookDispatcher.deliverDue();
    assert.deepEqual(sent.map((item) => item.headers['x-kayros-event']), ['mission.completed'], 'arbitrage non envoyé à l’URL de reprise');
  });

  it('refuse clé absente, invalide ou révoquée, et un scope manquant', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/v1/public/me' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/v1/public/me', headers: auth('kl_live_abcdefghij_' + 'x'.repeat(32)) })).statusCode, 401);
    const readOnly = await createKey({ name: 'lecture', scopes: ['missions:read'] });
    const denied = await launch(readOnly.token, { collective_id: 'x', question: 'Signer ?' });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().code, 'insufficient_scope');
    const revoke = await app.inject({ method: 'DELETE', url: `/v1/console/integrations/keys/${readOnly.key.key_id}`, headers: auth(comex) });
    assert.equal(revoke.json().key.status, 'revoked');
    const after = await app.inject({ method: 'GET', url: '/v1/public/me', headers: auth(readOnly.token) });
    assert.equal(after.statusCode, 401);
  });

  it('réserve la gestion des clés aux rôles comex/admin', async () => {
    await ctx.auth.register({ email: 'contrib@test.local', password: 'secret1234', name: 'C', role: 'contributeur', tenantId: 't1' });
    const contrib = await bearer(ctx, 'contrib@test.local', 'secret1234');
    const res = await app.inject({ method: 'POST', url: '/v1/console/integrations/keys', headers: auth(contrib), payload: { name: 'x' } });
    assert.equal(res.statusCode, 403);
  });

  it('lance une mission demo idempotente, la retrouve par référence externe et livre un callback signé', async () => {
    const { token } = await createKey();
    const collective = await createCollective();
    const listed = await app.inject({ method: 'GET', url: '/v1/public/collectives', headers: auth(token) });
    assert.equal(listed.json().collectives[0].id, collective);
    assert.equal(listed.json().collectives[0].agents.length, 3);

    const payload = {
      collective_id: collective, question: 'Faut-il accorder 18 % de remise à ACME ?', profile: 'demo',
      external_ref: { system: 'salesforce', object: 'Opportunity', id: '006A' },
      callback_url: 'https://n8n.example.com/webhook-waiting/42', metadata: { amount: 240000 },
    };
    const missing = await app.inject({ method: 'POST', url: '/v1/public/missions', headers: auth(token), payload });
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.json().code, 'idempotency_key_required');

    const started = await launch(token, payload);
    assert.equal(started.statusCode, 202, started.body);
    const body = started.json();
    assert.match(body.mission_id, /^msn_/);
    assert.equal(body.status, 'running');
    assert.equal(body.profile, 'demo');
    assert.equal(body.poll_url, `/v1/public/missions/${body.mission_id}`);

    const replay = await launch(token, payload);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.headers['idempotent-replayed'], 'true');
    assert.equal(replay.json().mission_id, body.mission_id);
    const conflict = await launch(token, { ...payload, question: 'Autre question ?' });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().code, 'idempotency_key_reused');

    await ctx.hybridGateway.idle();
    const done = (await app.inject({ method: 'GET', url: `/v1/public/missions/${body.mission_id}`, headers: auth(token) })).json();
    assert.equal(done.state, 'completed');
    assert.ok(['GO', 'CONDITIONAL_GO', 'NO_GO'].includes(done.verdict));
    assert.equal(done.agents.length, 3);
    assert.ok(done.agents.every((agent) => agent.reason.startsWith('[Démo]')));
    assert.equal(done.llm.simulated, true);
    assert.equal(done.llm.provider, 'demo');
    assert.ok(done.risks.length > 0);
    assert.match(done.dossier_url, /#activity\?thread=thread_/);

    const search = await app.inject({ method: 'GET', url: '/v1/public/missions?external_ref=salesforce:Opportunity:006A', headers: auth(token) });
    assert.deepEqual(search.json().missions.map((m) => m.mission_id), [body.mission_id]);

    await ctx.webhookDispatcher.deliverDue();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://n8n.example.com/webhook-waiting/42');
    assert.equal(sent[0].headers['x-kayros-event'], 'mission.completed');
    const event = JSON.parse(sent[0].body);
    assert.equal(event.event, 'mission.completed');
    assert.equal(event.mission_id, body.mission_id);
    assert.equal(event.external_ref.id, '006A');
    const { secret } = (await app.inject({ method: 'POST', url: '/v1/console/integrations/webhook/secret', headers: auth(comex) })).json();
    assert.match(secret, /^whsec_/);
    assert.equal(verifySignature(secret, sent[0].body, sent[0].headers['x-kayros-signature']).ok, true);
    assert.equal(verifySignature(secret, sent[0].body.replace('006A', '006B'), sent[0].headers['x-kayros-signature']).ok, false);

    // Arbitrage humain dans la console → mission.arbitrated vers la même URL.
    const arbitrate = await app.inject({ method: 'POST', url: `/v1/console/threads/${event.dossier_url.split('thread=')[1]}/arbitrate`, headers: auth(comex), payload: { action: 'accept_consensus' } });
    assert.equal(arbitrate.statusCode, 200, arbitrate.body);
    await ctx.webhookDispatcher.deliverDue();
    assert.equal(sent.length, 2);
    const arbitrated = JSON.parse(sent[1].body);
    assert.equal(arbitrated.event, 'mission.arbitrated');
    assert.equal(arbitrated.state, 'arbitrated');
    assert.equal(arbitrated.human_decision.action, 'accept_consensus');
  });

  it('refuse un callback http ou vers un hôte privé, et un collectif inconnu', async () => {
    const { token } = await createKey();
    const collective = await createCollective();
    const http = await launch(token, { collective_id: collective, question: 'Signer ?', callback_url: 'http://n8n.example.com/x' }, 'k1');
    assert.equal(http.json().code, 'invalid_callback_url');
    const local = await launch(token, { collective_id: collective, question: 'Signer ?', callback_url: 'https://127.0.0.1/x' }, 'k2');
    assert.equal(local.json().code, 'invalid_callback_url');
    const unknown = await launch(token, { collective_id: 'room_inconnue', question: 'Signer ?' }, 'k3');
    assert.equal(unknown.statusCode, 404);
  });

  it('limite une clé à ses collectifs autorisés', async () => {
    const allowed = await createCollective('A');
    const other = await createCollective('B');
    const { token } = await createKey({ name: 'restreinte', collective_ids: [allowed] });
    const listed = (await app.inject({ method: 'GET', url: '/v1/public/collectives', headers: auth(token) })).json();
    assert.deepEqual(listed.collectives.map((c) => c.id), [allowed]);
    assert.equal((await launch(token, { collective_id: other, question: 'Signer ?', profile: 'demo' }, 'k4')).statusCode, 404);
  });

  it('webhook d’abonnement du tenant, webhook de test et nouvelle tentative en cas d’échec', async () => {
    const update = await app.inject({ method: 'PUT', url: '/v1/console/integrations/webhook', headers: auth(comex), payload: { webhook_url: 'https://hooks.example.com/kayros' } });
    assert.equal(update.statusCode, 200, update.body);
    assert.match(update.json().secret, /^whsec_/);
    assert.equal(update.json().webhook.has_secret, true);
    assert.ok(!JSON.stringify(update.json().webhook).includes(update.json().secret));

    ctx.webhookDispatcher.fetch = async (url, init) => { sent.push({ url, ...init }); return { status: 500 }; };
    const test = await app.inject({ method: 'POST', url: '/v1/console/integrations/webhook/test', headers: auth(comex), payload: {} });
    assert.equal(test.statusCode, 200, test.body);
    const delivery = test.json().delivery;
    assert.equal(delivery.event, 'ping');
    assert.equal(delivery.status, 'pending', 'un 500 est retenté plus tard');
    assert.equal(delivery.attempts, 1);
    assert.ok(Date.parse(delivery.next_attempt_at) > Date.now() + 50_000);
    assert.equal(JSON.parse(sent[0].body).event, 'ping');
  });

  it('profils : fast par défaut, retombe sur la configuration serveur sans clé NVIDIA', async () => {
    assert.equal(ctx.llmConfig.fast.available, false);
    assert.equal(ctx.providers['nvidia-fast'], undefined);
    assert.ok(ctx.providers.demo, 'provider demo toujours disponible');
    const { token } = await createKey();
    const collective = await createCollective();
    const res = await launch(token, { collective_id: collective, question: 'Signer ?' }, 'k5');
    assert.equal(res.statusCode, 202);
    assert.equal(res.json().profile, 'fast');
    assert.match(res.json().note, /fast indisponible/);
  });
});

describe('profil fast avec une clé NVIDIA (factice, sans réseau)', () => {
  it('enregistre le provider nvidia-fast avec le modèle rapide par défaut', async () => {
    const { app, ctx } = await buildTestApp({ NVIDIA_API_KEY: 'nvapi-test-not-a-real-key' });
    try {
      assert.equal(ctx.llmConfig.fast.available, true);
      assert.equal(ctx.llmConfig.fast.model, 'nvidia/nemotron-3.5-lightning-30b-a3b');
      assert.deepEqual(ctx.llmConfig.fast.extraBody, { chat_template_kwargs: { enable_thinking: false } });
      const provider = ctx.providers['nvidia-fast'];
      assert.equal(provider.defaultModel, 'nvidia/nemotron-3.5-lightning-30b-a3b');
      assert.equal(provider.maxTokens, 1500);
      assert.equal(provider.buildBody({ messages: [] }).chat_template_kwargs.enable_thinking, false);
    } finally { await app.close(); }
  });
});
