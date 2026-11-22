/* Cas réel : la réplique de Voltaire citait Candide avec « ; » au lieu de
 * « ; » (espace insécable avant la ponctuation en français). La citation
 * existait, mais la vérification la rejetait → repli déterministe.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { canonical, quoteMatches, verifyQuotes } from '../backend/fastify/lib/salon-quotes.mjs';

const CANDIDE = "Oui, dit l’abbé, mais c’est en enrageant ; car on s’y plaint de tout avec de grands éclats de rire.";
const AUTHOR = { works: [{ title: "Candide, ou l'optimisme" }] };

test('canonical : l\'espace avant la ponctuation est neutralisée', () => {
  assert.equal(canonical('en enrageant ; car'), canonical('en enrageant; car'));
  assert.equal(canonical('la liberté : une idée'), canonical('la liberté: une idée'));
});

test('citation : la ponctuation française ne fait plus échouer la vérification', () => {
  const model = "Oui, dit l’abbé, mais c’est en enrageant; car on s’y plaint ...";
  assert.equal(quoteMatches(model, CANDIDE), true);
  const v = verifyQuotes(`Dans « Candide, ou l'optimisme » : « ${model} »`, AUTHOR, [CANDIDE], []);
  assert.equal(v.errors.length, 0);
  assert.equal(v.citations.length, 1);
});

test('citation : une phrase absente reste refusée', () => {
  const fake = 'Les hommes naissent libres et égaux en droits selon la nature même.';
  const v = verifyQuotes(`« ${fake} »`, AUTHOR, [CANDIDE], []);
  assert.equal(v.citations.length, 0);
  assert.equal(v.errors.length, 1);
});

test('citation : l\'ellipse interne exige les fragments dans l\'ordre', () => {
  const ok = "Oui, dit l’abbé ... car on s’y plaint de tout";
  assert.equal(quoteMatches(ok, CANDIDE), true);
  const reversed = "car on s’y plaint de tout ... Oui, dit l’abbé";
  assert.equal(quoteMatches(reversed, CANDIDE), false);
});

test('citation : une œuvre d\'un autre auteur est refusée', () => {
  const v = verifyQuotes('Comme dans Les Essais, tout dépend de l’usage.', AUTHOR, [CANDIDE], ['les essais']);
  assert.ok(v.errors.some((e) => e.includes('autre auteur')));
});

test('citation : le titre de l\'auteur n\'est pas pris pour une citation', () => {
  const v = verifyQuotes("Dans « Candide, ou l'optimisme » je soutiens cela.", AUTHOR, [CANDIDE], []);
  assert.equal(v.errors.length, 0);
});
