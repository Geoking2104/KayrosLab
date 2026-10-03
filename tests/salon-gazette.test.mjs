import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');

/** Évalue un script classique dans un bac à sable (modèle des tests du moteur). */
function load(code, sandbox) {
  const fn = new Function('module', 'exports', 'window', 'document', 'location', 'globalThis', code);
  fn(sandbox.module, sandbox.module.exports, sandbox.window, undefined, undefined, sandbox.window);
  return sandbox.module.exports;
}

// Un même « window » pour le moteur et le pupitre.
const W = {};
W.window = W;
load(read('backend/web/public/salon/salon-engine.js'), { module: { exports: {} }, window: W });
assert.ok(W.SalonEngine && W.SalonEngine.retrieve, 'moteur chargé');

const G = load(read('backend/web/public/salon/gazette-desk.js'), { module: { exports: {} }, window: W });

test('gazette : parseStatus reconnaît les URL x.com / twitter.com et l’id nu', () => {
  const a = G.parseStatus('https://x.com/voltaire/status/1234567890');
  assert.equal(a.id, '1234567890');
  assert.equal(a.handle, 'voltaire');

  const b = G.parseStatus('https://twitter.com/i/web/status/987654321');
  assert.equal(b.id, '987654321');
  assert.equal(b.handle, '');

  const c = G.parseStatus('12345678');
  assert.equal(c.id, '12345678');

  assert.equal(G.parseStatus('https://example.com/statut/1234567890'), null);
  assert.equal(G.parseStatus(''), null);
});

test('gazette : decodeEntities / textFromOembed rendent un texte propre', () => {
  assert.equal(G.decodeEntities('La libert&eacute; &amp; la raison'), 'La liberté & la raison');
  assert.equal(G.decodeEntities('&#233;t&#x27;e'), 'ét\'e');
  const html = '<blockquote><p>La libert&eacute; &amp; la raison<br>tiennent ensemble.</p>&mdash; X</blockquote>';
  assert.equal(G.textFromOembed(html), 'La liberté & la raison tiennent ensemble.');
});

test('gazette : rankTexts classe les textes les plus proches et écarte le hors-sujet', () => {
  const corpus = {
    a: [
      { id: 'a1', w: 'Essai', s: 'La liberté ne se donne pas, elle se prend par la raison et se garde par la loi.' },
      { id: 'a2', w: 'Essai', s: 'Le jardin embaumait au matin et les abeilles sortaient déjà.' },
    ],
    b: [
      { id: 'b1', w: 'Traité', s: 'La raison sans liberté devient une simple mécanique de contrainte.' },
    ],
    c: [
      { id: 'c1', w: 'Nouvelle', s: 'Le jardin embaumait au matin et les abeilles sortaient déjà.' },
    ],
  };
  const q = 'Que reste-t-il de la liberté et de la raison ?';
  const one = G.rankTexts(corpus, q);
  const two = G.rankTexts(corpus, q);
  assert.deepEqual(one, two, 'déterministe');
  assert.deepEqual(one.map((r) => r.authorId).sort(), ['a', 'b'], 'les textes proches sont proposés');
  assert.ok(one[0].best >= one[1].best, 'trié par proximité décroissante');
  assert.ok(!one.some((r) => r.authorId === 'c'), 'le hors-sujet est écarté');

  for (const cand of one) {
    assert.ok(cand.rows.length >= 1 && cand.rows.length <= 2, 'borné à 2 extraits');
    for (const row of cand.rows) {
      const known = (corpus[cand.authorId] || []).some((p) => p.s === row.text);
      assert.ok(known, 'l’extrait est un texte du corpus');
      assert.ok(row.work, 'l’œuvre est nommée');
    }
  }
  // chaque extrait est une phrase entière du corpus, pas un fragment recollé
  assert.match(one[0].rows[0].text, /[.!?…»"]$/);
  assert.equal(G.rankTexts({}, q).length, 0);
});

test('réponse : l’auteur répond depuis son texte le plus proche (ou avoue le manque)', () => {
  const corpus = {
    a: [{ id: 'a1', w: 'Essai', s: 'La liberté ne se donne pas, elle se prend par la raison et se garde par la loi.' }],
  };
  const out = G.respond('a', 'Que reste-t-il de la liberté et de la raison ?', corpus.a);
  assert.ok(out && out.text && out.text.length > 40, 'une réponse est produite');
  assert.match(out.text, /Essai/, 'la réponse nomme l’œuvre d’appui');
  assert.ok(out.prise && out.prise.length > 4, 'la prise accompagne la réponse');

  const bare = G.respond('a', 'Que reste-t-il de la liberté ?', []);
  assert.ok(bare && bare.text && bare.text.length > 30, 'sans passage, l’auteur parle sans citer à faux');
});

test('pupitre : bouton d’import et sélection d’une réponse', () => {
  const html = read('backend/web/public/salon/flux/index.html');
  const js = read('backend/web/public/salon/gazette-desk.js');
  assert.match(html, /id="gz-import"/);
  assert.match(html, /Importer le contenu/);
  assert.match(html, /Demander aux auteurs/);
  assert.match(js, /gz-import/);
  assert.match(js, /data-act="pick"/);
  assert.match(js, /Sélectionner/);
  assert.match(js, /Choisie/);
  assert.match(js, /is-picked/);
});
