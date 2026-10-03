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
const doctrine = JSON.parse(readFileSync(new URL('../salon/src/lib/salon/doctrine.json', import.meta.url), 'utf8'));
const kant = {
  id: 'kant', name: 'Emmanuel Kant', nameEn: 'Emmanuel Kant', kind: 'philosophe', blurb: '',
  works: [{ title: 'Fundamental Principles of the Metaphysic of Morals' }, { title: 'The Critique of Practical Reason' }],
  doctrine: doctrine.kant,
};
const epicure = {
  id: 'epicure', name: 'Épicure', nameEn: 'Epicurus', kind: 'philosophe', blurb: '',
  works: [{ title: 'Principal Doctrines (from Diogenes Laertius, Book X)' }],
  doctrine: doctrine.epicure,
};

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
  const top = E.retrieve(corpus.voltaire, E.scope(qLiberte), 2);
  assert.ok(top.length);
  assert.ok(fp.user.includes('« ' + top[0].work + ' »'), 'un passage/œuvre nommée est fourni au modèle');
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

test('planTurn : les rapports entre auteurs ont une logique', () => {
  const host = { name: 'Vous', text: qLiberte, host: true };
  const v = { name: 'Voltaire', prise: 'la liberté est une loi qu’on se donne', text: '…' };

  const t1 = E.planTurn({ role: 'lecteur', history: [] });
  assert.equal(t1.move, 'ouvre');
  assert.equal(t1.toName, 'l’hôte');

  const t2 = E.planTurn({ role: 'objecteur', history: [host, v] });
  assert.equal(t2.move, 'objecte');
  assert.equal(t2.act, 'objection');
  assert.equal(t2.toName, 'Voltaire');
  assert.match(t2.point, /liberté/);

  const t3 = E.planTurn({ role: 'defenseur', history: [host, v] });
  assert.equal(t3.move, 'precise');
  assert.equal(E.planTurn({ role: 'secretaire', history: [host, v] }).move, 'minute');
});

test('answer : une objection nomme l’auteur visé et son point', () => {
  const history = [{ name: 'Vous', text: qLiberte, host: true }, { name: 'Voltaire', prise: 'la liberté est une loi qu’on se donne', text: '…' }];
  const out = E.answer({ author: rousseau, question: qLiberte, corpus: corpus.rousseau || [], history, role: 'objecteur', lang: 'fr' });
  assert.match(out.text, /Voltaire/);
  assert.match(out.text, /loi qu’on se donne|loi qu'on se donne/);
});

test('mémoire par auteur : un convive reste cohérent avec ses tours précédents', () => {
  const self = [{ prise: 'la liberté est une loi qu’on se donne', text: '…' }];
  const out = E.answer({ author: rousseau, question: qLiberte, corpus: corpus.rousseau || [], self, lang: 'fr' });
  assert.match(out.text, /Comme je le tenais déjà/);

  const fp = E.floorPrompt({ author: rousseau, question: qLiberte, passages: [], self, lang: 'fr' });
  assert.match(fp.user, /Ta mémoire/);
  assert.match(fp.user, /loi qu’on se donne|loi qu'on se donne/);
});

test('parseSpeech : lit PRISE et REPLIQUE', () => {
  const r = E.parseSpeech('PRISE: la liberté est une loi qu’on se donne\nREPLIQUE:\nJe le soutiens.  Voilà.');
  assert.equal(r.prise, 'la liberté est une loi qu’on se donne');
  assert.equal(r.text, 'Je le soutiens. Voilà.');
});

/* ---- Plan de correction : doctrine par auteur, ancre de repli, elenchus, persona ---- */

test('doctrine : Kant change de thèse selon la question (O2)', () => {
  const a = E.answer({ author: kant, question: 'Faut-il obéir à une loi injuste ?', corpus: corpus.kant || [], lang: 'fr' });
  const b = E.answer({ author: kant, question: "Qu'est-ce que le bonheur ?", corpus: corpus.kant || [], lang: 'fr' });
  assert.notEqual(a.prise, b.prise);
});

test('doctrine : Kant ≠ Épicure sur le bonheur (O1)', () => {
  const k = E.answer({ author: kant, question: "Qu'est-ce que le bonheur ?", corpus: corpus.kant || [], lang: 'fr' });
  const e = E.answer({ author: epicure, question: "Qu'est-ce que le bonheur ?", corpus: corpus.epicure || [], lang: 'fr' });
  assert.ok(k.prise && e.prise);
  assert.notEqual(k.prise, e.prise);
});

test('doctrine : le bonheur de Kant est ancré dans une de ses œuvres (O3)', () => {
  const out = E.answer({ author: kant, question: "Qu'est-ce que le bonheur ?", corpus: corpus.kant || [], lang: 'fr' });
  assert.equal(out.grounded, true);
  assert.ok(['The Critique of Practical Reason', 'Fundamental Principles of the Metaphysic of Morals'].includes(out.passage.work));
});

test('doctrine : quand la recherche ne tranche pas, l’ancre de doctrine sert de lieu', () => {
  const out = E.answer({ author: kant, question: "Qu'est-ce que le bonheur ?", corpus: corpus.kant || [], passages: [], lang: 'fr' });
  assert.equal(out.grounded, true);
  assert.equal(out.passage.anchored, true);
  assert.equal(out.passage.work, 'Fundamental Principles of the Metaphysic of Morals');
});

test('retrieve : le bonheur trouve des passages chez Kant (lot 3a)', () => {
  assert.ok(E.retrieve(corpus.kant, E.scope("Qu'est-ce que le bonheur ?"), 3).some((p) => !p.weak));
});

test('elenchus adossé à la doctrine : Voltaire produit une thèse (lot 6B)', () => {
  const v = Object.assign({}, voltaire, { doctrine: doctrine.voltaire });
  const out = E.answer({ author: v, question: 'Faut-il obéir à une loi injuste ?', corpus: corpus.voltaire || [], lang: 'fr' });
  assert.doesNotMatch(out.prise, /Je ne tiens pas encore la définition/);
  assert.ok(out.prise.length > 10);
});

test('persona : élocution, concepts, résumés d’œuvres, règles — sans empreinte lexicale (lot 7)', () => {
  const p = E.persona(kant, 'fr', 'Agis de telle sorte que tu traites l’humanité toujours comme une fin.');
  assert.match(p, /Élocution : /);
  assert.match(p, /Concepts : /);
  assert.match(p, /Fundamental Principles of the Metaphysic of Morals/);
  assert.match(p, /n’invente ni citation/);
  assert.ok(!p.includes('Empreinte lexicale'));
});

/* ---- Plan de correction v2 : voix naturelle, typographie, repli d'œuvre ---------- */

test('v2 6a : plus de béquille « Je le garde pour fil » — voix naturelle', () => {
  const fr = E.answer({ author: voltaire, question: qLiberte, corpus: corpus.voltaire, lang: 'fr' });
  const en = E.answer({ author: voltaire, question: 'What remains of liberty once everything is explained?', corpus: corpus.voltaire, lang: 'en' });
  assert.doesNotMatch(fr.text, /garde pour fil/i);
  assert.doesNotMatch(en.text, /keep it as the thread/i);
  assert.doesNotMatch(fr.text, /\bde le\b/);
});

test('v2 6b/6c : typographie anglaise dans le prompt EN', () => {
  const q = 'What is happiness?';
  const fp = E.floorPrompt({ author: kant, question: q, scope: E.scope(q), passages: [], corpus: corpus.kant, lang: 'en' });
  assert.doesNotMatch(fp.system + fp.user, /«|»/);
  assert.match(fp.user, /Your position on happiness: /);
});

test('v2 6d : phraseFor supprimée', () => {
  assert.ok(!code.includes('function phraseFor'));
});

test('v2 6e : repli sur une œuvre présente dans le corpus, pas works[0]', () => {
  const smith = { id: 'smith', name: 'Adam Smith', blurb: '', works: [{ title: 'Livre absent' }, { title: 'The Wealth of Nations' }] };
  const out = E.answer({ author: smith, question: 'Qu’est-ce que le bonheur ?', corpus: corpus.smith, passages: [{ work: 'x', sentence: '', weak: true }], lang: 'fr' });
  assert.equal(out.grounded, false);
  assert.match(out.text, /« The Wealth of Nations »/);
  assert.doesNotMatch(out.text, /Livre absent/);
});

test('v2 6f : « esthétique » relève du domaine art', () => {
  assert.equal(E.scope('Qu’est-ce que l’esthétique ?').domain, 'art');
});

test('retrieve : la loi injuste trouve Locke via les gloses FR -> EN (v2 lot 3)', () => {
  assert.ok(E.retrieve(corpus.locke, E.scope('Faut-il obéir à une loi injuste ?'), 3).some((p) => !p.weak));
});
