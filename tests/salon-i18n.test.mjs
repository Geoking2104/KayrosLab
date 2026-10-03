import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const code = readFileSync(new URL('backend/web/public/salon/salon-engine.js', root), 'utf8');
const sandbox = { module: { exports: {} } };
sandbox.globalThis = sandbox;
new Function('module', 'exports', 'globalThis', code)(sandbox.module, sandbox.module.exports, sandbox);
const E = sandbox.module.exports;
const corpus = JSON.parse(readFileSync(new URL('backend/web/public/salon/corpus.json', root), 'utf8'));
const catalog = JSON.parse(readFileSync(new URL('salon/src/lib/salon/catalog.json', root), 'utf8'));
const vol = catalog.authors.find((a) => a.id === 'voltaire');

test('engine i18n : le cadrage suit la langue de la question', () => {
  const fr = E.scope("Qu'est-ce que la liberté ?");
  assert.equal(fr.lang, 'fr');
  assert.equal(fr.label, 'la liberté');
  assert.match(fr.suite, /^il reste à /);

  const en = E.scope('What is liberty?');
  assert.equal(en.lang, 'en');
  assert.equal(en.label, 'liberty');
  assert.match(en.suite, /^it remains to /);
});

test('engine i18n : en anglais, la réplique est anglaise (citation d’origine conservée)', () => {
  const out = E.answer({
    author: { id: 'voltaire', name: 'Voltaire', works: ["Candide, ou l'optimisme"], blurb: vol.blurb, blurbEn: vol.blurbEn },
    question: 'What remains of liberty once everything is explained?',
    corpus: corpus.voltaire,
    lang: 'en',
  });
  assert.ok(out.text && out.text.length > 60);
  assert.match(out.text, /The host asks|I take up your point/);
  assert.match(out.text, /I keep it as the thread/);
  assert.doesNotMatch(out.text, /L’hôte demande|Je le garde pour fil|Voilà ce que je signe|Ma prise, sur ce point/);
  assert.ok(out.prise && out.prise.length > 3);
});

test('engine i18n : le français ne bouge pas (gabarit identique)', () => {
  const out = E.answer({
    author: { id: 'voltaire', name: 'Voltaire', works: ["Candide, ou l'optimisme"], blurb: vol.blurb },
    question: "Que reste-t-il de la liberté ?",
    corpus: corpus.voltaire,
    lang: 'fr',
  });
  assert.match(out.text, /L’hôte demande : /);
  assert.match(out.text, /Je le garde pour fil/);
  assert.match(out.text, /Voilà ce que je signe|Ce qui reste à décider/);
  assert.doesNotMatch(out.text, /The host asks|I keep it as the thread/);
});

test('i18n : mémoire compilée et pupitre suivent la langue stockée, sans mélange', () => {
  const kb = readFileSync(new URL('backend/web/public/salon/salon-kb.js', root), 'utf8');
  assert.match(kb, /salon-locale/, 'la pastille mémoire lit salon-locale');
  assert.match(kb, /setTimeout\(paint, 80\)/, 'la pastille se repeint après la bascule de langue');
  const desk = readFileSync(new URL('backend/web/public/salon/gazette-desk.js', root), 'utf8');
  assert.match(desk, /applyCopy\(\)/, 'le pupitre applique sa copie à l’amorçage');
  assert.match(desk, /locale\(\)/, 'le pupitre suit la langue de la session');
  const fx = readFileSync(new URL('backend/web/public/salon/flux-x.js', root), 'utf8');
  assert.match(fx, /refreshCopy/, 'les libellés créés par flux-x se rafraîchissent à la bascule');
  assert.match(fx, /data-handle/, 'l’état lié est conservé pour la re-traduction');
});

test('i18n : le cercle parle une seule langue (fr/en)', () => {
  const run = readFileSync(new URL('backend/web/public/salon/circle-run.js', root), 'utf8');
  assert.match(run, /function roleLabel/, 'rôles localisés');
  assert.match(run, /The salon is thinking/, 'statuts localisés');
  const stage = readFileSync(new URL('backend/web/public/salon/circle-stage.js', root), 'utf8');
  assert.match(stage, /Back to the table/);
  assert.match(stage, /Continue the thread/);
  const ui = readFileSync(new URL('backend/web/public/salon/circle-ui.js', root), 'utf8');
  assert.match(ui, /Circle memory/);
  assert.match(ui, /End of discussion/);
  const speech = readFileSync(new URL('backend/web/public/salon/circle-speech.js', root), 'utf8');
  assert.match(speech, /L\("Hôte", "Host"\)/);
});
