import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp } from './test-helpers.mjs';

// Traduction fr<->en du Salon : LLM côté serveur, cache, langue cible intacte.

test('traduction : traduit via le LLM, met en cache, laisse la langue cible telle quelle', async () => {
  const { app } = await buildTestApp();
  let calls = 0;
  app.kayrosContext.llm.complete = async ({ messages }) => {
    calls += 1;
    const arr = JSON.parse(messages[1].content);
    return { text: JSON.stringify(arr.map((s) => 'Traduit: ' + s)) };
  };
  try {
    const r1 = await app.inject({ method: 'POST', url: '/v1/salon/translate', payload: { to: 'fr', texts: ['The world is a stage.', 'Une phrase déjà française.'] } });
    assert.equal(r1.statusCode, 200);
    const j1 = r1.json();
    assert.equal(j1.ok, true);
    assert.equal(j1.translations[0], 'Traduit: The world is a stage.');
    assert.equal(j1.translations[1], 'Une phrase déjà française.');
    assert.equal(calls, 1);
    const r2 = await app.inject({ method: 'POST', url: '/v1/salon/translate', payload: { to: 'fr', texts: ['The world is a stage.'] } });
    assert.equal(r2.json().translations[0], 'Traduit: The world is a stage.');
    assert.equal(calls, 1, 'cache : pas de second appel LLM');
  } finally { await app.close(); }
});

test('traduction : entrée invalide refusée', async () => {
  const { app } = await buildTestApp();
  try {
    const r = await app.inject({ method: 'POST', url: '/v1/salon/translate', payload: { to: 'de', texts: ['x'] } });
    assert.equal(r.statusCode, 400);
    const r2 = await app.inject({ method: 'POST', url: '/v1/salon/translate', payload: { to: 'fr', texts: [] } });
    assert.equal(r2.statusCode, 400);
  } finally { await app.close(); }
});

test('traduction : un fournisseur dégradé (mock) est refusé, l’original est rendu', async () => {
  const { app } = await buildTestApp();
  app.kayrosContext.llm.complete = async () => ({ text: '[mock] (salon-translate) reponse simulee a: x' });
  try {
    const r = await app.inject({ method: 'POST', url: '/v1/salon/translate', payload: { to: 'fr', texts: ['The world is a stage.'] } });
    const j = r.json();
    assert.equal(j.translations[0], 'The world is a stage.');
    assert.equal(j.failed, 1);
  } finally { await app.close(); }
});

test('traduction : repli un-par-un quand le lot casse', async () => {
  const { app } = await buildTestApp();
  let calls = 0;
  app.kayrosContext.llm.complete = async ({ messages }) => {
    calls += 1;
    if (messages[0].content.includes('JSON array')) return { text: 'not json' };
    return { text: 'Traduction unique.' };
  };
  try {
    const r = await app.inject({ method: 'POST', url: '/v1/salon/translate', payload: { to: 'en', texts: ['Le monde est une scène.'] } });
    assert.equal(r.json().translations[0], 'Traduction unique.');
    assert.ok(calls >= 2, 'repli item par item');
  } finally { await app.close(); }
});
