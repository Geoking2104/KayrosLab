import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  signPayload, verifySignature, computeSignature, validateCallbackUrl, nextRetryDelayMs, MAX_DELIVERY_ATTEMPTS,
  WebhookDispatcher, InMemoryWebhookOutbox, IntegrationSettingsService,
} from './webhooks.mjs';

test('signature HMAC-SHA256 t=…,v1=… vérifiable avec node:crypto seul (snippet n8n/Zapier)', () => {
  const body = JSON.stringify({ event: 'mission.completed', verdict: 'GO' });
  const header = signPayload('whsec_test', body, { timestamp: 1760000000 });
  const [t, v1] = header.split(',').map((part) => part.split('=')[1]);
  assert.equal(t, '1760000000');
  assert.equal(v1, createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex'));
  assert.equal(computeSignature('whsec_test', t, body), v1);
  assert.deepEqual(verifySignature('whsec_test', body, header, { nowSeconds: 1760000100 }), { ok: true, timestamp: 1760000000 });
});

test('vérification : corps modifié, mauvais secret, rejeu hors tolérance, rotation', () => {
  const body = '{"a":1}';
  const header = signPayload('s1', body, { timestamp: 1000 });
  assert.equal(verifySignature('s1', '{"a":2}', header, { nowSeconds: 1000 }).ok, false);
  assert.equal(verifySignature('s2', body, header, { nowSeconds: 1000 }).ok, false);
  assert.equal(verifySignature('s1', body, header, { nowSeconds: 1000 + 301 }).reason, 'horodatage hors tolérance');
  assert.equal(verifySignature('s1', body, 'garbage', { nowSeconds: 1000 }).ok, false);
  const rotated = `${header},v1=${computeSignature('s2', 1000, body)}`;
  assert.equal(verifySignature('s2', body, rotated, { nowSeconds: 1000 }).ok, true);
});

test('callback_url : https obligatoire, pas d’identifiants ni d’hôte privé (SSRF)', () => {
  assert.equal(validateCallbackUrl('https://n8n.kayroslab.com/webhook-waiting/1'), 'https://n8n.kayroslab.com/webhook-waiting/1');
  for (const bad of ['http://n8n.example.com', 'https://u:p@n8n.example.com', 'https://localhost/x', 'https://10.0.0.4/x', 'https://192.168.1.2/x', 'https://[::1]/x', 'ftp://x', 'pas une url']) {
    assert.throws(() => validateCallbackUrl(bad), /callback_url/, bad);
  }
  assert.equal(validateCallbackUrl('http://127.0.0.1:5678/x', { allowHttp: true, allowPrivate: true }), 'http://127.0.0.1:5678/x');
});

test('backoff : 1 min, 5 min, 30 min, 2 h, 6 h puis abandon', () => {
  assert.equal(MAX_DELIVERY_ATTEMPTS, 6);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(nextRetryDelayMs), [60e3, 300e3, 1800e3, 7200e3, 21600e3, null]);
});

test('dispatcher : succès, échec retenté, 410 définitif, dédoublonnage par event_id', async () => {
  const settings = new IntegrationSettingsService();
  const outbox = new InMemoryWebhookOutbox();
  const statuses = { 'https://ok.example.com/': 204, 'https://ko.example.com/': 503, 'https://gone.example.com/': 410 };
  const calls = [];
  const dispatcher = new WebhookDispatcher({ outbox, settings, fetchImpl: async (url, init) => { calls.push({ url, init }); return { status: statuses[url] }; } });
  const event = { event: 'mission.completed', event_id: 'evt_1' };
  await dispatcher.enqueue({ tenantId: 't', event, targets: Object.keys(statuses) });
  await dispatcher.enqueue({ tenantId: 't', event, targets: ['https://ok.example.com/'] });
  assert.equal((await outbox.list('t')).length, 3, 'même event_id + même cible = une seule livraison');
  assert.equal(await dispatcher.deliverDue(), 3);
  const byUrl = Object.fromEntries((await outbox.list('t')).map((d) => [d.target_url, d]));
  assert.equal(byUrl['https://ok.example.com/'].status, 'delivered');
  assert.equal(byUrl['https://ko.example.com/'].status, 'pending');
  assert.equal(byUrl['https://ko.example.com/'].attempts, 1);
  assert.equal(byUrl['https://gone.example.com/'].status, 'failed');
  const secret = await settings.ensureSecret('t');
  const sent = calls[0].init;
  assert.equal(verifySignature(secret, sent.body, sent.headers['x-kayros-signature']).ok, true);
  assert.equal(sent.headers['x-kayros-event-id'], 'evt_1');
  assert.equal(await dispatcher.deliverDue(), 0, 'la tentative suivante attend son délai');
});

test('secret de webhook chiffré au repos quand un chiffrement est fourni', async () => {
  const store = new (await import('./webhooks.mjs')).InMemoryIntegrationSettingsStore();
  const settings = new IntegrationSettingsService({ store, encrypt: (s) => Buffer.from(s).toString('base64'), decrypt: (v) => Buffer.from(v, 'base64').toString() });
  const { secret } = await settings.update('t', { webhook_url: 'https://h.example.com' });
  assert.match((await store.get('t')).webhook_secret, /^enc:/);
  assert.equal((await settings.get('t')).webhook_secret, secret);
  assert.equal((await settings.view('t')).has_secret, true);
  assert.equal(JSON.stringify(await settings.view('t')).includes(secret), false);
});
