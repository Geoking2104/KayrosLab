import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Langues v2 : toute citation affichée passe par la langue choisie.
// Le corpus doit porter les traductions `tr:{fr,en}`, et le moteur doit les
// préférer à l'original pour la langue demandée (sinon l'original reste).
const root = new URL('..', import.meta.url);
const engine = readFileSync(new URL('backend/web/public/salon/salon-engine.js', root), 'utf8');
const sandbox = { module: { exports: {} } };
sandbox.globalThis = sandbox;
new Function('module', 'exports', 'globalThis', engine)(sandbox.module, sandbox.module.exports, sandbox);
const E = sandbox.module.exports;
const corpus = JSON.parse(readFileSync(new URL('backend/web/public/salon/corpus.json', root), 'utf8'));
const doctrine = JSON.parse(readFileSync(new URL('salon/src/lib/salon/doctrine.json', root), 'utf8'));

const count = (s, re) => (String(s).match(re) || []).length;
const classify = (s) => {
  const t = String(s || '');
  const fr = (t.match(/[àâçéèêëîïôùûüÿœ]/gi) || []).length * 3
    + count(t, /\b(le|la|les|des|une?|est|nous|vous|dans|pour|qui|que|pas|et|ne|se|au|du|ce|cette|dit|faut|moi|tout|comme|mais|elle|avec|sans|être|fait|ses|son|plus|bien|était)\b/gi);
  const en = count(t, /\b(the|of|and|to|in|that|is|it|with|for|as|not|be|by|which|from|this|are|was|were|his|her|their)\b/gi);
  return fr > en ? 'fr' : 'en';
};

test('langues : le moteur affiche la traduction quand elle existe (fr et en)', () => {
  const entry = [
    { w: 'W', s: 'The original English sentence about virtue.', tr: { fr: 'La phrase française sur la vertu.' } },
  ];
  const author = { id: 'x', name: 'X', blurb: '', works: [{ title: 'W' }] };
  const q = 'La vertu s’apprend-elle ?';
  const fr = E.answer({ author, question: q, corpus: entry, lang: 'fr' });
  assert.match(fr.text, /La phrase française sur la vertu\./);
  assert.doesNotMatch(fr.text, /The original English sentence/);
  const en = E.answer({ author, question: 'Is virtue learned?', corpus: entry, lang: 'en' });
  assert.match(en.text, /The original English sentence about virtue\./);
  // floorPrompt : la traduction entre dans le prompt de la bonne langue
  const pass = E.retrieve(entry, E.scope(q), 1)[0];
  assert.ok(pass && !pass.weak, 'passage retenu');
  assert.match(pass.sentence, /La phrase française sur la vertu\./);
  const fp = E.floorPrompt({ author, question: q, scope: E.scope(q), passages: [pass], corpus: entry, history: [], self: [], role: 'invite', lang: 'fr' });
  assert.match(fp.user, /La phrase française sur la vertu\./);
  assert.doesNotMatch(fp.user, /The original English sentence/);
});

test('langues : les ancres de doctrine s’affichent traduites', () => {
  const corpusKant = corpus.kant || [];
  const anchor = doctrine.kant.theses.bonheur['*'].anchors[0];
  const fr = E.floorPrompt({ author: { id: 'kant', name: 'Kant', blurb: '', works: [], doctrine: doctrine.kant }, question: 'Qu’est-ce que le bonheur ?', scope: E.scope('Qu’est-ce que le bonheur ?'), passages: [], corpus: corpusKant, history: [], self: [], role: 'invite', lang: 'fr' });
  const hit = E.resolveAnchor([anchor], corpusKant, 'fr');
  assert.ok(hit, 'ancre résolue');
  assert.ok(fr.user.includes(hit.sentence), 'la phrase affichée est celle de resolveAnchor(fr)');
});

test('langues : le corpus est traduit pour l’autre langue (couverture)', () => {
  let total = 0, withTr = 0, anchorsMissing = 0;
  for (const id of Object.keys(corpus)) {
    for (const e of corpus[id]) {
      total += 1;
      const to = classify(e.s) === 'fr' ? 'en' : 'fr';
      if (e.tr && typeof e.tr[to] === 'string' && e.tr[to].trim()) withTr += 1;
    }
  }
  // chaque ancre de doctrine doit avoir sa traduction disponible
  for (const id of Object.keys(doctrine)) {
    for (const dom of Object.keys(doctrine[id].theses || {})) {
      for (const dem of Object.keys(doctrine[id].theses[dom])) {
        for (const a of doctrine[id].theses[dom][dem].anchors) {
          const p = (corpus[id] || []).find((e) => e.w === a.work && String(e.s).indexOf(a.startsWith) === 0);
          const to = p ? (classify(p.s) === 'fr' ? 'en' : 'fr') : null;
          if (!p || !to || !(p.tr && p.tr[to])) anchorsMissing += 1;
        }
      }
    }
  }
  assert.ok(total > 2400, 'corpus complet');
  assert.equal(anchorsMissing, 0, 'toutes les ancres de doctrine sont traduites');
  assert.ok(withTr / total >= 0.9, 'couverture des traductions ≥ 90 % (' + withTr + '/' + total + ')');
  assert.ok(withTr / total >= 0.99, 'couverture cible ≥ 99 % (' + withTr + '/' + total + ')');
});
