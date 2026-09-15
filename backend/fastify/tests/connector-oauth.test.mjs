import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import connectorsRoute from '../routes/connectors.mjs';
import { ConnectorOAuthService, connectorConnectionMode, buildAuthorizeUrl, oauthConfigFromEnv } from '../../../core/index.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';

const KEY = Buffer.alloc(32, 7).toString('base64');

function configuredService() {
  return new ConnectorOAuthService({
    config: {
      slack: { clientId: 'cid', clientSecret: 'sec', signingSecret: 'sig', scopes: 'app_mentions:read,chat:write' },
      discord: { clientId: 'app', clientSecret: 'dsec', botToken: 'bot', publicKey: 'pub', permissions: '534723950656', scopes: 'bot applications.commands' },
      teams: { appId: '', botPassword: '', tenant: 'organizations' },
    },
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, access_token: 'xoxb-token', team: { id: 'T1', name: 'Comité' } }) }),
    now: () => 1_000_000,
  });
}

test('connector connection modes reflect available server credentials', () => {
  const config = {
    slack: { clientId: 'a', clientSecret: 'b', signingSecret: 'c', scopes: 'x' },
    discord: { clientId: 'a', clientSecret: '', botToken: 'b', publicKey: 'c', permissions: '0', scopes: 'bot' },
    teams: { appId: '', botPassword: '', tenant: 'organizations' },
  };
  assert.equal(connectorConnectionMode('slack', config), 'oauth');
  assert.equal(connectorConnectionMode('discord', config), 'invite');
  assert.equal(connectorConnectionMode('teams', config), null);
  assert.equal(oauthConfigFromEnv({}).slack.clientId, '');
});

test('authorize URLs are built per platform without leaking secrets', () => {
  const config = {
    slack: { clientId: 'cid', clientSecret: 'sec', signingSecret: 'sig', scopes: 'chat:write' },
    discord: { clientId: 'app', clientSecret: 'dsec', botToken: 'bot', publicKey: 'pub', permissions: '42', scopes: 'bot' },
    teams: { appId: 'az', botPassword: 'pwd', tenant: 'organizations' },
  };
  const slack = buildAuthorizeUrl('slack', { config, redirectUri: 'https://api.test/cb', state: 'st1' });
  assert.match(slack, /^https:\/\/slack\.com\/oauth\/v2\/authorize\?/);
  assert.ok(slack.includes('client_id=cid'));
  assert.ok(!slack.includes('sec'));
  const discord = buildAuthorizeUrl('discord', { config, redirectUri: 'https://api.test/cb', state: 'st2' });
  assert.ok(discord.startsWith('https://discord.com/oauth2/authorize?'));
  assert.ok(discord.includes('permissions=42'));
  const teams = buildAuthorizeUrl('teams', { config, redirectUri: 'https://api.test/cb', state: 'st3' });
  assert.ok(teams.includes('/organizations/adminconsent'));
});

test('OAuth state is single-use and expires', () => {
  let clock = 5_000;
  const service = new ConnectorOAuthService({
    config: { slack: { clientId: 'a', clientSecret: 'b', signingSecret: 'c', scopes: 'x' }, discord: {}, teams: {} },
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    stateTtlMs: 1000, now: () => clock,
  });
  const started = service.start('slack', { tenantId: 't1', redirectUri: 'https://api.test/cb' });
  assert.ok(started.url.includes('state='));
  const consumed = service.consume(started.state);
  assert.equal(consumed.tenantId, 't1');
  assert.throws(() => service.consume(started.state), /invalide ou expiré/);
  const expired = service.start('slack', { tenantId: 't1', redirectUri: 'https://api.test/cb' });
  clock += 5000;
  assert.throws(() => service.consume(expired.state), /invalide ou expiré/);
});

test('slack exchange returns a storable bot token without exposing the client secret', async () => {
  const service = configuredService();
  const started = service.start('slack', { tenantId: 'tenant-a', redirectUri: 'https://api.test/v1/connectors/slack/oauth/callback' });
  const result = await service.complete('slack', { state: started.state, query: { code: 'abc' } });
  assert.equal(result.tenantId, 'tenant-a');
  assert.equal(result.secrets.bot_token, 'xoxb-token');
  assert.equal(result.settings.team_id, 'T1');
});

test('public OAuth callback stores the tenant connection and redirects to the console', async (t) => {
  const swarm = new SwarmService();
  const hybridGateway = new HybridAgentGateway({ swarm });
  const connectorConfig = new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore(), encryptionKey: KEY });
  const connectorOAuth = configuredService();
  const app = Fastify();
  app.decorate('kayrosContext', { hybridGateway, connectorConfig, connectorOAuth, consoleUrl: 'https://www.kayroslab.com/console/' });
  app.decorate('requireAuth', async () => ({ sub: 'u1', tenantId: 'tenant-a', role: 'comex' }));
  await app.register(connectorsRoute);
  t.after(() => app.close());

  const started = connectorOAuth.start('slack', { tenantId: 'tenant-a', redirectUri: 'https://api.test/v1/connectors/slack/oauth/callback' });
  const response = await app.inject({ method: 'GET', url: `/v1/connectors/slack/oauth/callback?code=abc&state=${encodeURIComponent(started.state)}` });
  assert.equal(response.statusCode, 302);
  assert.match(response.headers.location, /#settings\?connected=slack$/);

  const rows = await connectorConfig.list('tenant-a');
  const slack = rows.find((row) => row.platform === 'slack');
  assert.equal(slack.status, 'configured');
  assert.ok(slack.connection_id);
  assert.deepEqual(slack.configured_secret_fields.includes('bot_token'), true);
});

test('public OAuth callback reports a friendly error on a bad state', async (t) => {
  const swarm = new SwarmService();
  const connectorConfig = new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore(), encryptionKey: KEY });
  const app = Fastify();
  app.decorate('kayrosContext', { hybridGateway: new HybridAgentGateway({ swarm }), connectorConfig, connectorOAuth: configuredService(), consoleUrl: 'https://www.kayroslab.com/console' });
  app.decorate('requireAuth', async () => ({ sub: 'u1', tenantId: 'tenant-a', role: 'comex' }));
  await app.register(connectorsRoute);
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/v1/connectors/slack/oauth/callback?code=abc&state=bogus' });
  assert.equal(response.statusCode, 302);
  assert.match(response.headers.location, /connect_error=/);
});
