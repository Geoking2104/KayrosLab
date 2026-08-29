import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  ConnectorConfigurationService,
  InMemoryConnectorConfigStore,
  decryptConnectorSecrets,
  connectorEncryptionKey,
} from './connector-config.mjs';

test('connector credentials are encrypted and never returned by public views', async () => {
  const keyValue = randomBytes(32).toString('base64');
  const store = new InMemoryConnectorConfigStore();
  const service = new ConnectorConfigurationService({ store, encryptionKey: keyValue, publicApiUrl: 'https://api.example.test' });
  const view = await service.configure('tenant-a', 'slack', {
    secrets: { bot_token: 'xoxb-secret', signing_secret: 'signing-secret' }, enabled: true,
  });
  assert.equal(JSON.stringify(view).includes('xoxb-secret'), false);
  const stored = await store.get('tenant-a', 'slack');
  assert.equal(stored.encrypted_secrets.includes('xoxb-secret'), false);
  assert.equal(decryptConnectorSecrets(stored.encrypted_secrets, connectorEncryptionKey(keyValue)).bot_token, 'xoxb-secret');
  assert.match(view.webhook_url, /configured/);
});

test('connectivity test updates state without exposing the token', async () => {
  const service = new ConnectorConfigurationService({
    encryptionKey: randomBytes(32).toString('base64'),
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, team: 'Kayros' }) }),
  });
  await service.configure('tenant-a', 'slack', { secrets: { bot_token: 'xoxb-secret', signing_secret: 'signing' } });
  const result = await service.test('tenant-a', 'slack');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'connected');
  assert.equal(JSON.stringify(result).includes('xoxb-secret'), false);
});

test('saving secrets fails closed without an encryption key', async () => {
  const service = new ConnectorConfigurationService();
  await assert.rejects(() => service.configure('tenant-a', 'discord', {
    secrets: { application_id: 'app', bot_token: 'token', public_key: 'key' },
  }), /stockage sécurisé indisponible/);
});
