import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Banc de mesure (plan de correction) : sur 5 questions de référence,
// combien d'auteurs ont au moins un passage non faible ; et les thèses des
// 4 convives par défaut sont deux à deux différentes (doctrine).
const code = readFileSync(new URL('../backend/web/public/salon/salon-engine.js', import.meta.url), 'utf8');
const sandbox = { module: { exports: {} } };
sandbox.globalThis = sandbox;
new Function('module', 'exports', 'globalThis', code)(sandbox.module, sandbox.module.exports, sandbox);
const E = sandbox.module.exports;
const corpus = JSON.parse(readFileSync(new URL('../backend/web/public/salon/corpus.json', import.meta.url), 'utf8'));
const doctrine = JSON.parse(readFileSync(new URL('../salon/src/lib/salon/doctrine.json', import.meta.url), 'utf8'));

const QUESTIONS = [
  "Faut-il obéir à une loi injuste ?",
  "Qu'est-ce que le bonheur ?",
  "Que reste-t-il de la liberté une fois qu'on a tout expliqué ?",
  "La vérité se décrète-t-elle ?",
  "Le pouvoir peut-il être légitime ?",
];
const MIN = [14, 15, 19, 29, 28]; // v2 lot 3a-bis (gloses FR -> EN, filtre max) mesuré après épingles de doctrine (corpus 2565 ph.) ; avant : 6/13/8/24/27 sur 90f366f.

test('grounding : auteurs avec passage non faible (non-régression lot 3a)', () => {
  QUESTIONS.forEach((q, i) => {
    const sc = E.scope(q);
    let clean = 0;
    for (const id of Object.keys(corpus)) {
      if (E.retrieve(corpus[id] || [], sc, 3).some((p) => !p.weak)) clean++;
    }
    assert.ok(clean >= MIN[i], q + ' → ' + clean + ' auteurs (min ' + MIN[i] + ')');
  });
});

const GUESTS = ['voltaire', 'rousseau', 'montaigne', 'kant'];
test('grounding : les 4 convives par défaut ont des thèses deux à deux distinctes (doctrine)', () => {
  const fix = {
    voltaire: { id: 'voltaire', name: 'Voltaire', blurb: '', works: [] },
    rousseau: { id: 'rousseau', name: 'Jean-Jacques Rousseau', blurb: '', works: [] },
    montaigne: { id: 'montaigne', name: 'Michel de Montaigne', blurb: '', works: [] },
    kant: { id: 'kant', name: 'Emmanuel Kant', blurb: '', works: [] },
  };
  for (const q of QUESTIONS) {
    const prises = GUESTS.map((id) =>
      E.answer({ author: Object.assign({}, fix[id], { doctrine: doctrine[id] }), question: q, corpus: corpus[id] || [], lang: 'fr' }).prise
    );
    for (let i = 0; i < prises.length; i++) {
      for (let j = i + 1; j < prises.length; j++) {
        assert.notEqual(prises[i], prises[j], q + ' : ' + GUESTS[i] + ' vs ' + GUESTS[j]);
      }
    }
  }
});
