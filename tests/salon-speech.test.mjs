import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonical, checkTurn, composeTurn, deathYear, goldenQuestions, verifyQuote, voiceDistance, voiceVector,
} from '../salon/scripts/quality_lib.mjs';

const ROOT = process.cwd();
const CATALOG = join(ROOT, 'salon', 'src', 'lib', 'salon', 'catalog.json');
const DOCTRINE = join(ROOT, 'salon', 'src', 'lib', 'salon', 'doctrine.json');
const MIRROR = join(ROOT, 'backend', 'web', 'public', 'salon');
const MANIFEST = join(MIRROR, 'kb-manifest.json');

function json(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

const catalog = json(CATALOG);
const doctrine = json(DOCTRINE, {});
const manifest = json(MANIFEST);

test('catalogue : socle d’auteurs et d’œuvres', () => {
  assert.ok(catalog && Array.isArray(catalog.authors), 'catalog.json lisible');
  assert.ok(catalog.authors.length >= 66, `auteurs ≥ 66 (reçu ${catalog.authors.length})`);
  const works = catalog.authors.reduce((s, a) => s + (a.works || []).length, 0);
  assert.ok(works >= 300, `œuvres ≥ 300 (reçu ${works})`);
  const withFive = catalog.authors.filter((a) => (a.works || []).filter((w) => w.ok !== false).length >= 5).length;
  // 47/68 au dernier build : les auteurs à œuvre unique (Marc Aurèle, Sun Tzu,
  // Boèce, traditions) restent légitimes mais ne peuvent pas atteindre 5.
  assert.ok(withFive >= 45, `auteurs avec ≥ 5 œuvres : ${withFive}`);
});

test('mémoire : packs pubiés, phrases entières, sans doublon', { skip: !manifest && 'aucun pack publié' }, () => {
  const entries = Object.entries(manifest.authors || {});
  assert.ok(entries.length >= 60, `packs ≥ 60 (reçu ${entries.length})`);
  for (const [id, info] of entries) {
    const pack = json(join(MIRROR, info.pack || `kb/${id}.json`));
    assert.ok(pack, `${id}: pack lisible`);
    const passages = pack.passages || [];
    const uniqueWorks = new Set(passages.map((p) => p.w)).size;
    const minSentences = uniqueWorks <= 1 ? 70 : 120;
    assert.ok(passages.length >= minSentences, `${id}: ${passages.length} phrases ≥ ${minSentences}`);
    const seen = new Set();
    for (const p of passages) {
      assert.ok(p.s.length >= 40 && p.s.length <= 320, `${id}: bornes (${p.id})`);
      assert.ok(/[.!?…»"]$/.test(p.s), `${id}: phrase close (${p.id})`);
      const k = canonical(p.s);
      assert.ok(!seen.has(k), `${id}: doublon (${p.id})`);
      seen.add(k);
    }
    for (const f of pack.formulas || []) {
      if (f.kind === 'verbatim') assert.ok(seen.has(canonical(f.text)), `${id}: formule attestée (${f.id})`);
    }
  }
});

test('tours déterministes : contrat de parole respecté', { skip: !manifest && 'aucun pack publié' }, () => {
  const ids = Object.keys(manifest.authors || {}).slice(0, 12);
  assert.ok(ids.length >= 8, 'au moins 8 auteurs testés');
  for (const id of ids) {
    const author = catalog.authors.find((a) => a.id === id);
    const pack = json(join(MIRROR, `kb/${id}.json`));
    assert.ok(author && pack, `${id}: auteur + pack`);
    const questions = goldenQuestions(author, doctrine).slice(0, 2);
    for (const q of questions) {
      const turn = composeTurn({
        author,
        question: q.question,
        sentences: pack.passages.map((p) => ({ w: p.w, s: p.s })),
        act: 'reponse',
        toName: 'l’hôte',
        method: id === 'platon' || id === 'socrate' ? 'elenchus' : 'rhetorique',
      });
      const verdict = checkTurn({
        text: turn.text,
        author,
        toName: 'l’hôte',
        sources: pack.passages.map((p) => p.s),
        passages: [{ work: turn.work, text: turn.quote }],
      });
      assert.ok(verdict.ok, `${id} / ${q.question.slice(0, 30)} : ${verdict.errors.join(' ; ')}`);
      assert.ok(turn.quote && verifyQuote(turn.quote, pack.passages.map((p) => p.s)).ok, `${id}: citation vérifiée`);
    }
  }
});

test('voix : les auteurs ne se confondent pas', { skip: !manifest && 'aucun pack publié' }, () => {
  const rows = [];
  for (const [id, info] of Object.entries(manifest.authors || {})) {
    const pack = json(join(MIRROR, info.pack || `kb/${id}.json`));
    const author = catalog.authors.find((a) => a.id === id);
    if (!pack || !author) continue;
    rows.push({ id, lang: author.lang, v: voiceVector(pack.passages.map((p) => p.s)) });
  }
  const pairs = [];
  for (let i = 0; i < Math.min(rows.length, 14); i += 1) {
    for (let j = i + 1; j < Math.min(rows.length, 14); j += 1) {
      if (rows[i].lang !== rows[j].lang) continue;
      pairs.push(voiceDistance(rows[i].v, rows[j].v));
    }
  }
  assert.ok(pairs.length >= 4, 'paires comparables');
  const mean = pairs.reduce((s, x) => s + x, 0) / pairs.length;
  assert.ok(mean >= 0.12, `distance moyenne des voix ${mean.toFixed(3)} ≥ 0.12`);
});

test('doctrine : thèses et exemples de voix disponibles', () => {
  const ids = Object.keys(doctrine);
  assert.ok(ids.length >= 8, `auteurs avec doctrine ≥ 8 (reçu ${ids.length})`);
  let theses = 0;
  for (const id of ids) {
    const entry = doctrine[id];
    for (const demands of Object.values(entry.theses || {})) {
      theses += Object.values(demands || {}).filter((t) => t && (t.fr || t.en)).length;
    }
    const author = catalog.authors.find((a) => a.id === id);
    if (author) {
      assert.ok(author.sample || (author.samples && author.samples.length), `${id}: échantillon de voix`);
    }
  }
  assert.ok(theses >= 50, `thèses ≥ 50 (reçu ${theses})`);
});

test('contrôle négatif : une citation inventée est refusée', () => {
  const fake = 'La liberté consiste à obéir aux lois que l’on n’a pas écrites.';
  const sources = ['La liberté est l’obéissance à la loi qu’on s’est prescrite.'];
  assert.equal(verifyQuote(fake, sources).ok, false);
  assert.equal(verifyQuote(sources[0], sources).ok, true);
});

test('contrôle négatif : un anachronisme est refusé', () => {
  const author = catalog.authors.find((a) => a.id === 'voltaire');
  assert.equal(deathYear(author), 1778);
  const verdict = checkTurn({
    text: 'J’ai vu la Révolution de 1789 et je l’approuve, moi, Voltaire, depuis ma tombe.',
    author,
    toName: 'l’hôte',
    sources: [],
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((e) => e.includes('anachronisme')));
});
