import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiKeyService, generateApiKey, parseApiKey, hashApiKey, apiKeyFromHeaders, InMemoryApiKeyStore } from './api-keys.mjs';

test('format kl_live_<prefix>_<secret>, hash SHA-256, extraction des en-têtes', () => {
  const { token, prefix, sha256 } = generateApiKey();
  assert.match(token, /^kl_live_[a-z0-9]{10}_[A-Za-z0-9]{32}$/);
  assert.equal(parseApiKey(token).prefix, prefix);
  assert.equal(sha256, hashApiKey(token));
  assert.equal(parseApiKey('kl_live_court'), null);
  assert.equal(apiKeyFromHeaders({ authorization: `Bearer ${token}` }), token);
  assert.equal(apiKeyFromHeaders({ 'x-api-key': token }), token);
});

test('création, authentification, scopes, expiration et révocation', async () => {
  const store = new InMemoryApiKeyStore();
  const service = new ApiKeyService({ store });
  const { key, token } = await service.create({ tenantId: 't1', name: 'n8n', serviceAccount: 'N8N Bot', createdBy: 'boss' });
  assert.equal(key.service_account, 'n8n-bot');
  assert.equal(key.status, 'active');
  assert.equal(JSON.stringify(key).includes(token), false);
  assert.ok(!('token_sha256' in key));
  const principal = await service.authenticate(token);
  assert.equal(principal.tenantId, 't1');
  assert.equal(principal.sub, 'svc:t1:n8n-bot');
  assert.equal(principal.role, 'service');
  await assert.rejects(service.authenticate(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')), /invalide/);
  await assert.rejects(service.create({ tenantId: 't1', name: 'x', scopes: ['admin:all'] }), /scopes inconnus/);

  const expiring = await service.create({ tenantId: 't1', name: 'court', expiresInDays: 1 });
  store.keys.get(expiring.key.key_id).expires_at = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(service.authenticate(expiring.token), /expirée/);

  assert.equal((await service.revoke('autre-tenant', key.key_id)), null, 'un autre tenant ne peut pas révoquer');
  assert.equal((await service.revoke('t1', key.key_id)).status, 'revoked');
  await assert.rejects(service.authenticate(token), /révoquée/);
});
