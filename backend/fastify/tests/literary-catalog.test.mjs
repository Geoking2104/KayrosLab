import test from 'node:test';
import assert from 'node:assert/strict';
import { LITERARY_AUTHORS, findAuthor, searchAuthors, stripGutenbergBoilerplate, literaryFingerprint, LITERARY_KINDS } from '../lib/literary-catalog.mjs';

test('le catalogue d’auteurs est cohérent et complet', () => {
  assert.ok(LITERARY_AUTHORS.length >= 20, 'au moins 20 auteurs attendus');
  const ids = new Set();
  for (const author of LITERARY_AUTHORS) {
    assert.ok(/^[a-z][a-z0-9_]{1,63}$/.test(author.id), `id invalide: ${author.id}`);
    assert.ok(!ids.has(author.id), `id dupliqué: ${author.id}`); ids.add(author.id);
    assert.ok(author.name && author.kind && author.era && author.blurb && author.wikipedia, `champs manquants: ${author.id}`);
    assert.ok(LITERARY_KINDS.includes(author.kind), `kind inconnu: ${author.kind}`);
    assert.ok(['fr', 'en'].includes(author.lang), `lang inconnue: ${author.id}`);
    assert.ok(Array.isArray(author.works) && author.works.length >= 1, `œuvres manquantes: ${author.id}`);
    for (const work of author.works) {
      assert.ok(work.title && work.title.length >= 3, `titre d’œuvre manquant: ${author.id}`);
      assert.match(work.url, /^https:\/\/www\.gutenberg\.org\/cache\/epub\/\d+\/pg\d+\.txt$/, `URL Gutenberg invalide: ${author.id}`);
    }
  }
});

test('la recherche filtre par texte et par type', () => {
  const hugo = searchAuthors({ search: 'hugo' });
  assert.equal(hugo.length, 1);
  assert.equal(hugo[0].id, 'hugo');
  const philosophes = searchAuthors({ kind: 'philosophe' });
  assert.ok(philosophes.length >= 5, 'au moins 5 philosophes attendus');
  assert.ok(searchAuthors({ search: 'inexistantxyz' }).length === 0);
  assert.equal(findAuthor('hugo').name, 'Victor Hugo');
  assert.equal(findAuthor('inconnu'), null);
});

test('le boilerplate Gutenberg est retiré proprement', () => {
  const raw = '*** START OF THE PROJECT GUTENBERG EBOOK LES MISÉRABLES ***\n\nJean Valjean marchait.\n\n*** END OF THE PROJECT GUTENBERG EBOOK LES MISÉRABLES ***\nSignature: personne';
  const clean = stripGutenbergBoilerplate(raw);
  assert.match(clean, /Jean Valjean marchait/);
  assert.doesNotMatch(clean, /Signature: personne/);
  assert.doesNotMatch(clean, /START OF THE PROJECT/);
});

test('l’empreinte lexicale est déterministe et filtre les mots vides', () => {
  const a = literaryFingerprint(['Le rouge et le noir — Julien Sorel, Julien Sorel encore, Verrières, Verrières, Verrières.']);
  const b = literaryFingerprint(['Le rouge et le noir — Julien Sorel, Julien Sorel encore, Verrières, Verrières, Verrières.']);
  assert.deepEqual(a, b);
  assert.ok(a.words >= 9);
  assert.ok(a.distinct >= 5);
  assert.ok(a.terms[0].startsWith('verrières'));
  const onlyStop = literaryFingerprint(['the and that with this from they have for not with you']);
  assert.ok(onlyStop.terms.length <= 1);
});
