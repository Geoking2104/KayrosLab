import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { checkOutputs, mineFormulas, scoreVerbatim, classifyLang } from '../salon/scripts/kb_export.mjs';
import { canonical } from '../salon/scripts/kb_quote_audit.mjs';

const root = new URL('..', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');

test('les packs publiés sont valides (54 auteurs, phrases bornées, provenance)', () => {
  const { hard, warn, authors } = checkOutputs({});
  assert.equal(hard.length, 0, hard.slice(0, 6).join('\n'));
  assert.equal(warn.length, 0, warn.slice(0, 6).join('\n'));
  assert.ok(authors.length >= 54, `auteurs=${authors.length}`);
  const total = authors.reduce((n, a) => n + a.sentences, 0);
  assert.ok(total >= 1500, `phrases=${total}`);
  const kbFiles = readdirSync(new URL('backend/web/public/salon/kb/', root)).filter((f) => f.endsWith('.json'));
  assert.ok(kbFiles.length >= 54, `fichiers de packs=${kbFiles.length}`);
});

test('le corpus et les packs racontent la même histoire (voltaire)', () => {
  const corpus = JSON.parse(read('backend/web/public/salon/corpus.json'));
  const pack = JSON.parse(read('backend/web/public/salon/kb/voltaire.json'));
  assert.equal(corpus.voltaire.length, pack.passages.length);
  const ids = new Set(pack.passages.map((p) => p.id));
  for (const e of corpus.voltaire.slice(0, 20)) {
    assert.ok(e.id && ids.has(e.id), `entrée corpus sans pack : ${JSON.stringify(e).slice(0, 80)}`);
    assert.match(e.s, /[.!?…»"]$/, 'phrase entière attendue');
    assert.ok(e.s.length >= 40 && e.s.length <= 320, `longueur ${e.s.length}`);
  }
});

test('mineFormulas : verbatim exacts, motifs attestés, déterministe', () => {
  const T = [
    'Il faut penser la liberté comme une pratique et non comme un slogan.',
    'Il faut penser la justice comme une pratique et non comme un slogan.',
    'Il faut penser la vertu comme une pratique et non comme un mot vide.',
    'Il faut penser la guerre comme un dernier recours et non comme un jeu.',
    'La raison est une lumière qui ne promet rien mais qui éclaire.',
    'La raison est lente, la coutume est rapide, et l\'usage les confond.',
    'Si la coutume gouverne, alors la liberté se tait sans disparaître.',
    'Si la force gouverne, alors la loi se tait sans disparaître.',
    'Si la peur gouverne, alors la raison se tait sans disparaître.',
    'Une maxime sans coût n\'est qu\'une politesse faite au malheur.',
  ];
  const entries = T.map((s, i) => ({ w: i < 5 ? 'Œuvre A' : 'Œuvre B', s }));
  const a = mineFormulas({ authorId: 't', entries });
  const b = mineFormulas({ authorId: 't', entries });
  assert.deepEqual(a, b, 'déterministe');
  for (const f of a.formulas) {
    if (f.kind === 'verbatim') assert.ok(entries.some((e) => e.s === f.text), f.id);
    else assert.ok(f.attested >= 3, `${f.id} attesté ${f.attested}`);
  }
  assert.ok(a.patterns.some((p) => p.label === 'condition'));
  assert.ok(a.patterns.some((p) => p.label === 'ouverture'));
});

test('scoreVerbatim pénalise les connecteurs et rewarde les phrases autonomes', () => {
  const s = "La liberté n'est pas de faire ce qu'on veut, mais de vouloir ce que l'on fait vraiment.";
  assert.ok(scoreVerbatim(`Mais ${s}`) < scoreVerbatim(s));
  assert.equal(classifyLang('La liberté est une idée de la raison pratique.'), 'fr');
  assert.equal(classifyLang('The liberty of one ends where the liberty of another begins.'), 'en');
});

test('canonical : normalise guillemets, tirets et espaces insécables', () => {
  assert.equal(canonical('«\u00a0La liberté\u00a0» \u2014 oui\u2026'), '" La liberté " - oui...');
  assert.equal(canonical("l\u2019esprit"), "l'esprit");
});
