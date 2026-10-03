import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Lot 2 (v2) : couverture et cohérence de la doctrine étendue (vagues 0 et 1).
const code = readFileSync(new URL('../backend/web/public/salon/salon-engine.js', import.meta.url), 'utf8');
const sandbox = { module: { exports: {} } };
sandbox.globalThis = sandbox;
new Function('module', 'exports', 'globalThis', code)(sandbox.module, sandbox.module.exports, sandbox);
const E = sandbox.module.exports;
const corpus = JSON.parse(readFileSync(new URL('../backend/web/public/salon/corpus.json', import.meta.url), 'utf8'));
const doctrine = JSON.parse(readFileSync(new URL('../salon/src/lib/salon/doctrine.json', import.meta.url), 'utf8'));

const Q = {
  liberte: 'Que reste-t-il de la liberté une fois qu’on a tout expliqué ?',
  pouvoir: 'Le pouvoir peut-il être légitime ?',
  justice: 'Faut-il obéir à une loi injuste ?',
  verite: 'La vérité se décrète-t-elle ?',
  conscience: 'Une machine peut-elle avoir une conscience ?',
  vertu: 'La vertu s’apprend-elle ?',
  bonheur: 'Qu’est-ce que le bonheur ?',
  education: 'Que doit-on apprendre à un enfant ?',
  travail: 'Le travail rend-il libre ?',
  nature: 'La nature a-t-elle des droits ?',
  religion: 'Faut-il croire en Dieu ?',
  amour: 'L’amour est-il un choix ?',
  art: 'À quoi sert l’art ?',
  guerre: 'La guerre peut-elle être juste ?',
  temps: 'Faut-il avoir peur de la mort ?',
};

test('doctrine : les questions de référence tombent dans le bon domaine', () => {
  for (const d of Object.keys(Q)) assert.equal(E.scope(Q[d]).domain, d, Q[d]);
});

test('doctrine : chaque ancre se résout en une phrase réelle du corpus', () => {
  for (const id of Object.keys(doctrine)) for (const dom of Object.keys(doctrine[id].theses || {})) for (const dem of Object.keys(doctrine[id].theses[dom])) {
    for (const a of doctrine[id].theses[dom][dem].anchors) {
      assert.ok(E.resolveAnchor([a], corpus[id] || []), id + '/' + dom + '.' + dem + ' : ' + a.work + ' :: ' + a.startsWith);
    }
  }
});

test('doctrine : une ancre sans lien lexical avec son domaine doit être relue (reviewed)', () => {
  const bad = [];
  for (const id of Object.keys(doctrine)) for (const dom of Object.keys(doctrine[id].theses || {})) for (const dem of Object.keys(doctrine[id].theses[dom])) {
    const t = doctrine[id].theses[dom][dem];
    const bag = new Set(E.terms((E.scope(Q[dom] || dom).keysRaw || '') + ' ' + t.fr + ' ' + t.en));
    for (const a of t.anchors) {
      const hit = E.resolveAnchor([a], corpus[id] || []);
      if (!hit || a.reviewed) continue;
      if (!E.terms(hit.sentence).some((x) => bag.has(x))) bad.push(id + '/' + dom + ' : ' + hit.sentence.slice(0, 70));
    }
  }
  assert.deepEqual(bad, [], 'ancres à relire, ou à marquer "reviewed": true après validation du propriétaire');
});

test('doctrine : deux domaines donnent deux thèses différentes (données et moteur)', () => {
  for (const id of Object.keys(doctrine)) {
    const doms = Object.keys(doctrine[id].theses || {}).filter((d) => Q[d]);
    const author = { id, name: id, blurb: '', works: [], doctrine: doctrine[id] };
    const prises = doms.map((d) => E.answer({ author, question: Q[d], corpus: corpus[id] || [], lang: 'fr' }).prise);
    for (let i = 0; i < doms.length; i++) for (let j = i + 1; j < doms.length; j++) {
      assert.notEqual(doctrine[id].theses[doms[i]]['*']?.fr, doctrine[id].theses[doms[j]]['*']?.fr, id + ' : ' + doms[i] + ' vs ' + doms[j] + ' (données)');
      assert.notEqual(prises[i], prises[j], id + ' : ' + doms[i] + ' vs ' + doms[j] + ' (moteur)');
    }
  }
});

// Couverture livrée : vagues 0 et 1 (étendre au fil des validations du propriétaire).
const VAGUES = [
  ['voltaire', 'rousseau', 'montaigne', 'kant', 'epicure'],
  ['platon', 'aristote', 'machiavel', 'marcaurele', 'suntzu'],
];
test('doctrine : chaque auteur des vagues livrées a au moins 6 domaines', () => {
  for (const id of VAGUES.flat()) {
    assert.ok(doctrine[id], 'doctrine présente pour ' + id);
    assert.ok(Object.keys(doctrine[id].theses || {}).length >= 6, id + ' : au moins 6 domaines');
  }
});
