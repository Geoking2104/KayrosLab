import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp } from './test-helpers.mjs';

// Relais texte Gutenberg (import d'auteur) : lecture serveur des .txt
// (pas de CORS côté gutenberg.org), avec cache mémoire.

function withFakeFetch(map) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    for (const [part, make] of Object.entries(map)) {
      if (u.includes(part)) return make(u);
    }
    throw new Error('fetch inattendu: ' + u);
  };
  return () => { globalThis.fetch = orig; };
}

const body = (s, status = 200) => new Response(s, { status });

test('relais gutenberg : renvoie le texte borné et le met en cache', async () => {
  const { app } = await buildTestApp();
  let calls = 0;
  const restore = withFakeFetch({
    'gutenberg.org': () => { calls += 1; return body('*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\n\n' + 'Phrase de test. '.repeat(900)); },
  });
  try {
    const r1 = await app.inject({ method: 'GET', url: '/v1/salon/gutenberg/text?id=135&max=5000' });
    assert.equal(r1.statusCode, 200);
    const j1 = r1.json();
    assert.equal(j1.ok, true);
    assert.equal(j1.id, '135');
    assert.ok(j1.text.length > 1000 && j1.text.length <= 5000, 'borné à max');
    const r2 = await app.inject({ method: 'GET', url: '/v1/salon/gutenberg/text?id=135' });
    assert.equal(r2.statusCode, 200);
    assert.equal(r2.json().cached, true);
    assert.equal(calls, 1, 'une seule lecture amont (cache)');
  } finally { restore(); await app.close(); }
});

test('relais gutenberg : id invalide refusé', async () => {
  const { app } = await buildTestApp();
  try {
    const r = await app.inject({ method: 'GET', url: '/v1/salon/gutenberg/text?id=abc' });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().ok, false);
  } finally { await app.close(); }
});

test('relais gutenberg : source indisponible → 502', async () => {
  const { app } = await buildTestApp();
  const restore = withFakeFetch({ 'gutenberg.org': () => body('not found', 404) });
  try {
    const r = await app.inject({ method: 'GET', url: '/v1/salon/gutenberg/text?id=999999' });
    assert.equal(r.statusCode, 502);
    assert.equal(r.json().ok, false);
  } finally { restore(); await app.close(); }
});
