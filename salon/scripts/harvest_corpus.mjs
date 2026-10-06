#!/usr/bin/env node
/**
 * harvest_corpus.mjs — construit la mémoire livrée au salon depuis le catalogue.
 *
 * Source : salon/src/lib/salon/catalog.json — chaque œuvre porte son URL
 * Gutenberg. On y lit le texte, on en extrait des PHRASES ENTIÈRES et propres
 * (sans en-tête/pied Gutenberg, ni résidu d'OCR), et on en garde un échantillon
 * régulier par œuvre et par auteur. Sortie : backend/web/public/salon/corpus.json
 * = { "<auteur>": [ { "w": "<œuvre>", "s": "<phrase>" }, … ] }.
 *
 * Déterministe : ordre du catalogue, échantillonnage à pas fixe. En cas d'échec
 * réseau pour un auteur, on conserve ses entrées existantes (jamais de trou).
 *
 * Usage : node salon/scripts/harvest_corpus.mjs [--limit N] [--works N] [--max N] [--workmax N]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { repo, cutGutenberg, authorNameRe, sample, sentences, fetchText } from './corpus_lib.mjs';

const argN = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const LIMIT = argN('limit', 0);      // 0 = tous les auteurs
const WORKS = argN('works', 5);      // œuvres lues par auteur (production : 5)
const MAX = argN('max', 60);         // phrases gardées par auteur (hors épingles)
const WORKMAX = argN('workmax', 12); // phrases gardées par œuvre

const catalog = JSON.parse(readFileSync(join(repo, 'salon/src/lib/salon/catalog.json'), 'utf8'));
const dest = join(repo, 'backend/web/public/salon/corpus.json');
const prev = existsSync(dest) ? JSON.parse(readFileSync(dest, 'utf8')) : {};

/* V2 (plan, lot 2) — Épingles de doctrine : les phrases d'ancre des thèses
 * sont toujours présentes dans la mémoire livrée, hors échantillonnage et
 * hors plafond. Une ancre introuvable = avertissement + sortie non nulle. */
const doctrinePath = join(repo, 'salon', 'src', 'lib', 'salon', 'doctrine.json');
const doctrine = existsSync(doctrinePath) ? JSON.parse(readFileSync(doctrinePath, 'utf8')) : {};
const anchorSets = {};
for (const [id, d] of Object.entries(doctrine)) {
  const list = [];
  const seen = new Set();
  for (const dom of Object.keys((d && d.theses) || {})) {
    for (const dem of Object.keys(d.theses[dom])) {
      for (const an of (d.theses[dom][dem].anchors || [])) {
        if (!an || !an.work || !an.startsWith) continue;
        const k = an.work + '::' + an.startsWith;
        if (seen.has(k)) continue;
        seen.add(k);
        list.push({ work: an.work, startsWith: an.startsWith });
      }
    }
  }
  if (list.length) anchorSets[id] = list;
}
let missingPins = 0;

const authors = LIMIT > 0 ? catalog.authors.slice(0, LIMIT) : catalog.authors;
const out = {};
let fetched = 0, failed = 0, total = 0;

for (const a of authors) {
  const works = (a.works || [])
    .filter((w) => w && w.url && /gutenberg\.org/.test(w.url))
    // Ordre du catalogue (celui affiché) : works[0] couvert en premier.
    .slice(0, WORKS);
  const _nameRe = authorNameRe(a);
  // Toutes les phrases candidates par œuvre, puis échantillonnage adaptatif :
  // le pas par œuvre n'est élargi que si l'auteur reste sous 18 phrases
  // (source unique ou œuvres partageant un même livre).
  const sources = [];
  const fullSources = [];
  for (const w of works) {
    const raw = await fetchText(w.url);
    if (!raw) { failed++; continue; }
    fetched++;
    sources.push({ title: w.title, list: sentences(cutGutenberg(raw, w)).filter((s) => !_nameRe || !_nameRe.test(s)) });
    // Texte entier (sans la coupe 10–97 %) : sert aux épingles de doctrine.
    fullSources.push({ title: w.title, list: sentences(cutGutenberg(raw, w, { window: false })) });
  }
  const collect = (limitPerWork) => {
    const out2 = [];
    const seen2 = new Set();
    for (const src of sources) {
      for (const s of sample(src.list, limitPerWork)) {
        const key = s.slice(0, 60);
        if (seen2.has(key)) continue;
        seen2.add(key);
        out2.push({ w: src.title, s: s });
      }
    }
    return out2;
  };
  let wm = WORKMAX;
  let entries = collect(wm);
  while (entries.length < 18 && wm < MAX) {
    wm = Math.min(MAX, wm * 2);
    entries = collect(wm);
  }
  // Épingles de doctrine : hors échantillonnage, hors plafond MAX.
  const pins = anchorSets[a.id] || [];
  const pinned = [];
  for (const pin of pins) {
    const src = fullSources.find((x) => x.title === pin.work);
    const s = src && src.list.find((x) => x.indexOf(pin.startsWith) === 0);
    if (s) {
      if (!pinned.some((e) => e.s.slice(0, 60) === s.slice(0, 60))) pinned.push({ w: pin.work, s });
    } else {
      process.stderr.write(`ancre introuvable ${a.id} :: ${pin.work} :: ${pin.startsWith}\n`);
      missingPins++;
    }
  }
  if (!entries.length && !pinned.length) {
    // pas de réseau/texte exploitable : on garde la mémoire précédente
    if (prev[a.id]) { out[a.id] = prev[a.id]; total += prev[a.id].length; }
    continue;
  }
  const pinKeys = new Set(pinned.map((e) => e.s.slice(0, 60)));
  const kept = sample(entries.filter((e) => !pinKeys.has(e.s.slice(0, 60))), MAX);
  // Conserve les traductions d'affichage (tr) quand la même phrase revient.
  const prevByKey = new Map((prev[a.id] || []).map((e) => [e.w + '::' + String(e.s || '').slice(0, 60), e]));
  out[a.id] = pinned.concat(kept).map((e) => {
    const p0 = prevByKey.get(e.w + '::' + e.s.slice(0, 60));
    return p0 && p0.tr ? Object.assign({}, e, { tr: p0.tr }) : e;
  });
  total += pinned.length + kept.length;
  process.stderr.write(`${a.id}: ${pinned.length} épinglée(s) + ${kept.length}\n`);
}

writeFileSync(dest, JSON.stringify(out));
console.log(`authors ${Object.keys(out).length} · phrases ${total} · fetches ${fetched} · echecs ${failed} · bytes ${readFileSync(dest).length}`);
if (missingPins) {
  process.stderr.write(`\n${missingPins} ancre(s) de doctrine introuvable(s) — corpus écrit mais incohérent.\n`);
  process.exit(2);
}
