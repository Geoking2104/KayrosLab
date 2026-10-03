import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Lot 1 (v2) : une ancre de doctrine résolue ne cohabite jamais avec « Aucun passage pertinent ».
const code = readFileSync(new URL('../backend/web/public/salon/salon-engine.js', import.meta.url), 'utf8');
const sandbox = { module: { exports: {} } };
sandbox.globalThis = sandbox;
new Function('module', 'exports', 'globalThis', code)(sandbox.module, sandbox.module.exports, sandbox);
const E = sandbox.module.exports;
const corpus = JSON.parse(readFileSync(new URL('../backend/web/public/salon/corpus.json', import.meta.url), 'utf8'));
const doctrine = JSON.parse(readFileSync(new URL('../salon/src/lib/salon/doctrine.json', import.meta.url), 'utf8'));
const kant = {
  id: 'kant', name: 'Emmanuel Kant', nameEn: 'Emmanuel Kant', kind: 'philosophe', blurb: '',
  works: [{ title: 'Fundamental Principles of the Metaphysic of Morals' }], doctrine: doctrine.kant,
};

for (const [lang, q, none, head] of [
  ['fr', 'Faut-il obéir à une loi injuste ?', /Aucun passage pertinent/, /Passages \(au plus un/],
  ['en', 'Should one obey an unjust law?', /No relevant passage/, /Passages \(use at most one/],
]) {
  test('prompt (' + lang + ') : ancre de doctrine sans passage => pas de consigne contradictoire', () => {
    const fp = E.floorPrompt({ author: kant, question: q, scope: E.scope(q), passages: [], corpus: corpus.kant, history: [], self: [], role: 'invite', lang });
    assert.match(fp.user, /Fundamental Principles of the Metaphysic of Morals/);
    assert.doesNotMatch(fp.user, none);
    assert.match(fp.user, head);
  });
}

test('prompt : sans doctrine ni passage, la consigne « Aucun passage pertinent » demeure', () => {
  const q = 'Faut-il obéir à une loi injuste ?';
  const fp = E.floorPrompt({ author: Object.assign({}, kant, { doctrine: undefined }), question: q, scope: E.scope(q), passages: [], corpus: corpus.kant, history: [], self: [], role: 'invite', lang: 'fr' });
  assert.match(fp.user, /Aucun passage pertinent/);
});
