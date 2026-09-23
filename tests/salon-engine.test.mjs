import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Le dossier backend/web est en ESM ; on évalue le fichier (script classique)
// dans un bac à sable qui lui fournit `module`, comme dans le navigateur.
const code = readFileSync(new URL('../backend/web/public/salon/salon-engine.js', import.meta.url), 'utf8');
const sandbox = { module: { exports: {} } };
sandbox.globalThis = sandbox;
new Function('module', 'exports', 'globalThis', code)(sandbox.module, sandbox.module.exports, sandbox);
const E = sandbox.module.exports;
const corpus = JSON.parse(readFileSync(new URL('../backend/web/public/salon/corpus.json', import.meta.url), 'utf8'));

const voltaire = {
  id: 'voltaire', name: 'Voltaire', nameEn: 'Voltaire', kind: 'philosophe', method: 'elenchus',
  era: '1694–1778 · Lumières',
  blurb: "L'ironie contre les dogmes : optimisme naïf mis à l'épreuve du réel, tolérance, lucidité.",
  works: [{ title: "Candide, ou l'optimisme" }, { title: 'Micromégas' }],
};
const rousseau = {
  id: 'rousseau', name: 'Jean-Jacques Rousseau', kind: 'philosophe', method: 'auto',
  blurb: "L'éducation par l'expérience, le contrat social et le prix de la civilisation.",
  works: [{ title: 'Émile' }, { title: 'Du contrat social' }],
};

const qLiberte = "Que reste-t-il de la liberté une fois qu'on a tout expliqué ?";
const qJustice = "Qu'est-ce qu'une chose juste, si le plus fort l'appelle ainsi ?";
const qGouverner = "Faut-il paraître vertueux pour gouverner, ou seulement l'être ?";

test('scope : circonscrit sujet, demande et domaine', () => {
  const s = E.scope(qLiberte);
  assert.equal(s.domain, 'liberte');
  assert.equal(s.label, 'la liberté');
  assert.ok(s.terms.includes('liberte'));

  assert.equal(E.scope(qJustice).domain, 'justice');
  assert.equal(E.scope(qJustice).demand, 'definition');

  const g = E.scope(qGouverner);
  assert.equal(g.demand, 'norme');
  assert.ok(['pouvoir', 'vertu'].includes(g.domain), 'domaine pouvoir/vertu');

  assert.equal(E.scope('Pourquoi l’optimisme trompe-t-il ?').demand, 'cause');
  assert.equal(E.scope('La paix vaut-elle mieux que la victoire ?').domain, 'guerre');
});

test('retrieve : les passages dépendent de la question, pas du décor', () => {
  const vs = corpus.voltaire;
  const a = E.retrieve(vs, E.scope(qLiberte), 3);
  const b = E.retrieve(vs, E.scope(qJustice), 3);
  assert.ok(a.length && b.length);
  assert.notEqual(a[0].text, b[0].text, 'deux questions différentes ne ramènent pas le même passage');
  // le meilleur passage doit toucher un terme de la question
  const hit = E.relevance(qLiberte, a[0].work + ' ' + a[0].text) > 0.02;
  assert.ok(hit, 'le passage retenu a un lien lexical avec la question');
});

test('answer : déterministe, ancré, et lié à la question', () => {
  const opts = { author: voltaire, question: qLiberte, corpus: corpus.voltaire, lang: 'fr' };
  const one = E.answer(opts);
  const two = E.answer(opts);
  assert.equal(one.text, two.text, 'deux exécutions identiques');
  assert.equal(one.prise, two.prise);

  const s = E.scope(qLiberte);
  assert.ok(one.text.includes(s.label), 'la réplique nomme le sujet de la question');
  assert.ok(/libert/i.test(one.text), 'la réplique reste sur la liberté');
  assert.ok(one.prise && one.prise.length > 10, 'une prise est produite');
  // la réplique n’est pas le texte IA/conscience codé en dur d’avant
  assert.doesNotMatch(one.text, /grain|irreductible|conscience-acces/);
});

test('answer : ne confond pas deux questions (pas de réponse hors sujet)', () => {
  const lib = E.answer({ author: voltaire, question: qLiberte, corpus: corpus.voltaire, lang: 'fr' });
  const jus = E.answer({ author: voltaire, question: qJustice, corpus: corpus.voltaire, lang: 'fr' });
  assert.notEqual(lib.text, jus.text);
  assert.ok(/just/i.test(jus.text), 'la question sur la justice produit une réplique sur le juste');
});

test('thread : la réplique s’accroche à la prise précédente', () => {
  const history = [{ name: 'Vous', text: qLiberte }, { name: 'Voltaire', prise: "l'optimisme n'est qu'une politesse faite au malheur", text: '…' }];
  const out = E.answer({ author: rousseau, question: qLiberte, corpus: corpus.rousseau || [], history, act: 'objection', lang: 'fr' });
  assert.ok(out.text.includes('politesse faite au malheur'), 'ressaisit la prise du tour précédent');
});

test('persona + floorPrompt : la mémoire de l’auteur entre dans le prompt', () => {
  const p = E.persona(voltaire, 'fr');
  assert.ok(p.includes(voltaire.blurb));
  assert.ok(p.includes("Candide"));
  const fp = E.floorPrompt({ author: voltaire, question: qLiberte, passages: E.retrieve(corpus.voltaire, E.scope(qLiberte), 2), lang: 'fr' });
  assert.ok(fp.system.includes('PRISE'));
  assert.ok(fp.system.includes(voltaire.blurb));
  assert.ok(fp.user.includes(qLiberte), 'la question est le fil directeur');
  assert.ok(fp.user.includes('Candide'), 'un passage/œuvre nommée est fourni au modèle');
});

test('ancrage : cite une phrase entière quand la mémoire répond, sinon s’abstient', () => {
  const cat = { id: 'rousseau', name: 'Jean-Jacques Rousseau', blurb: '', works: [{ title: 'Du contrat social' }] };
  const q = 'Le contrat social repose-t-il sur la liberté ou sur la contrainte ?';
  const out = E.answer({ author: cat, question: q, corpus: corpus.rousseau || [], lang: 'fr' });
  if (out.grounded) {
    assert.ok(out.passage.sentence.length >= 40, 'une phrase entière est citée');
    assert.match(out.passage.sentence, /^[A-ZÀ-ÖØ-Þ].*[.!?]$/s, 'phrase bien formée');
  } else {
    assert.match(out.text, /sans citer à faux|ne tranche pas/, 's’abstient de citer');
  }
});

test('parseSpeech : lit PRISE et REPLIQUE', () => {
  const r = E.parseSpeech('PRISE: la liberté est une loi qu’on se donne\nREPLIQUE:\nJe le soutiens.  Voilà.');
  assert.equal(r.prise, 'la liberté est une loi qu’on se donne');
  assert.equal(r.text, 'Je le soutiens. Voilà.');
});
