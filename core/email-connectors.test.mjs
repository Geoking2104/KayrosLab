import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGmailMessages, fetchOutlookMessages } from './email-connectors.mjs';

const enc = (s) => Buffer.from(s).toString('base64url');
const res = (status, body) => ({ status, ok: status < 300, json: async () => body });

test('gmail : liste puis lit les messages envoyés, sans exposer le jeton', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization });
    if (url.includes('/messages?')) return res(200, { messages: [{ id: 'a' }, { id: 'b' }] });
    if (url.includes('/messages/a')) return res(200, { payload: { headers: [{ name: 'From', value: 'geo@x.fr' }, { name: 'Subject', value: 'Go' }], parts: [{ mimeType: 'text/plain', body: { data: enc('On tranche demain.') } }] } });
    return res(200, { payload: { headers: [], parts: [{ mimeType: 'text/html', body: { data: enc('<p>Chiffre ?</p>') } }] } });
  };
  const out = await fetchGmailMessages({ accessToken: 'tok', fetchImpl, max: 5 });
  assert.deepEqual(out.map((m) => m.body), ['On tranche demain.', 'Chiffre ?']);
  assert.equal(out[0].from, 'geo@x.fr');
  assert.match(calls[0].url, /q=in%3Asent/);
  assert.equal(calls[0].auth, 'Bearer tok');
});

test('gmail / outlook : erreurs claires', async () => {
  await assert.rejects(fetchGmailMessages({}), /jeton OAuth requis/);
  await assert.rejects(fetchGmailMessages({ accessToken: 't', fetchImpl: async () => res(401, {}) }), /refusé ou expiré/);
  await assert.rejects(fetchOutlookMessages({}), /Mail.Read/);
});

test('outlook : éléments envoyés via Graph, HTML nettoyé', async () => {
  const fetchImpl = async (url) => {
    assert.match(url, /sentitems/);
    return res(200, { value: [{ from: { emailAddress: { address: 'geo@x.fr' } }, subject: 's', body: { contentType: 'html', content: '<div>Décision&nbsp;: go.</div>' } }] });
  };
  const out = await fetchOutlookMessages({ accessToken: 't', fetchImpl });
  assert.deepEqual(out, [{ from: 'geo@x.fr', subject: 's', body: 'Décision : go.' }]);
});
