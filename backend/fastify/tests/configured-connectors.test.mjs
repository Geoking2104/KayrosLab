import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import connectorsRoute from '../routes/connectors.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { ConnectorConfigurationService } from '../../../core/connector-config.mjs';

function signedSlack(body, secret) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const raw = JSON.stringify(body);
  return {
    raw,
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${raw}`).digest('hex')}`,
    },
  };
}

async function buildApp() {
  const swarm = new SwarmService();
  const hybridGateway = new HybridAgentGateway({ swarm });
  const connectorConfig = new ConnectorConfigurationService({
    encryptionKey: randomBytes(32).toString('base64'),
    publicApiUrl: 'https://api.example.test',
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, ts: '171.1', team: 'Kayros' }) }),
  });
  const connector = await connectorConfig.configure('tenant-a', 'slack', {
    secrets: { bot_token: 'xoxb-fixture', signing_secret: 'fixture-signing-secret' },
  });
  await hybridGateway.createRoom({
    platform: 'slack', external_room_id: 'C-PROD', name: 'Production', mode: 'always',
  }, { tenantId: 'tenant-a', by: 'owner@kayros.test' });

  const app = Fastify();
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body;
    try { done(null, JSON.parse(body)); } catch (error) { done(error); }
  });
  app.decorate('kayrosContext', {
    connectorConfig, hybridGateway, slackAdapter: null, discordAdapter: null, teamsAdapter: null,
    connectorService: { handleInteraction: async () => ({ type: 'ack' }) }, linkService: null,
  });
  await app.register(connectorsRoute);
  return { app, connector };
}

test('configured Slack webhook verifies its tenant secret and opens a durable thread', async (t) => {
  const { app, connector } = await buildApp();
  t.after(() => app.close());
  const body = { type: 'event_callback', event: { type: 'app_mention', channel: 'C-PROD', user: 'U1', text: '<@BOT> faut-il lancer ?', ts: '171.0' } };
  const signed = signedSlack(body, 'fixture-signing-secret');
  const response = await app.inject({
    method: 'POST', url: `/v1/connectors/slack/configured/${connector.connection_id}`,
    headers: signed.headers, payload: signed.raw,
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.ok(response.json().thread_id);
});

test('configured Slack webhook rejects an invalid signature', async (t) => {
  const { app, connector } = await buildApp();
  t.after(() => app.close());
  const response = await app.inject({
    method: 'POST', url: `/v1/connectors/slack/configured/${connector.connection_id}`,
    headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)), 'x-slack-signature': 'v0=bad' },
    payload: JSON.stringify({ type: 'url_verification', challenge: 'nope' }),
  });
  assert.equal(response.statusCode, 401);
});
