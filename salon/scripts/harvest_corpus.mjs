#!/usr/bin/env node
/**
 * harvest_corpus.mjs — construit la mémoire livrée au Salon depuis le catalogue.
 *
 * Source : salon/src/lib/salon/catalog.json — chaque œuvre porte son URL
 * Gutenberg. On lit le texte, on en extrait des PHRASES ENTIÈRES et propres
 * (sans en-tête/pied Gutenberg, ni résidu d'OCR), puis on en garde un
 * échantillon régulier par œuvre et par auteur.
 *
 * Sorties :
 *   backend/web/public/salon/corpus.json      { "<auteur>": [ {w,s,id?}, … ] }
 *   salon/.cache/sources/<auteur>/<œuvre>.txt texte normalisé (audit de citations)
 *   catalog.json                              échantillon/termes/stats mis à jour
 *   salon/scripts/reports/harvest-<date>.json rapport
 *
 * Déterministe : ordre du catalogue, échantillonnage à pas fixe. En cas d'échec
 * réseau pour un auteur, on conserve ses entrées existantes (jamais de trou).
 *
 * Usage :
 *   node salon/scripts/harvest_corpus.mjs [--limit N] [--works N] [--max N] [--workmax N]
 *                                        [--author id] [--no-catalog] [--sleep ms]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { repo, cutGutenberg, authorNameRe, sample, sentences, fetchText } from './corpus_lib.mjs';
import { contentWords, slugify, classifyLang } from './textlib.mjs';
import { nowIso, readJSON } from './openkb_common.mjs';

const argN = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const argS = (name) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
};
const has = (name) => process.argv.includes('--' + name);

const LIMIT = argN('limit', 0);        // 0 = tous les auteurs
const WORKS = argN('works', 6);        // œuvres lues par auteur
const MAX = argN('max', 360);          // phrases gardées par auteur (hors épingles)
const WORKMAX = argN('workmax', 80);   // phrases gardées par œuvre
const SLEEP = argN('sleep', 120);      // politesse entre deux téléchargements
const ONLY = argS('author');
const OUT_DIR = argS('out') ? resolve(argS('out')) : join(repo, 'backend/web/public/salon');
const UPDATE_CATALOG = !has('no-catalog');

const catalogPath = join(repo, 'salon/src/lib/salon/catalog.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const dest = join(OUT_DIR, 'corpus.json');
const cacheRoot = join(repo, 'salon/.cache/sources');
const reportPath = join(repo, 'salon/scripts/reports', `harvest-${nowIso().slice(0, 10)}.json`);
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(cacheRoot, { recursive: true });
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

const authors = ONLY
  ? catalog.authors.filter((a) => a.id === ONLY)
  : (LIMIT > 0 ? catalog.authors.slice(0, LIMIT) : catalog.authors);

const out = {};
const report = { at: nowIso(), params: { WORKS, MAX, WORKMAX }, authors: {}, failures: [] };
let fetched = 0, failed = 0, total = 0;

function topTerms(list, n) {
  const freq = new Map();
  for (const s of list) for (const w of contentWords(s)) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).slice(0, n).map(([w]) => w);
}

function voiceSample(list, lang) {
  const preferred = lang ? list.filter((s) => classifyLang(s) === lang) : [];
  const pool = preferred.length ? preferred : list;
  const candidates = pool.filter((s) => s.length >= 90 && s.length <= 260 && !/[0-9]{3}/.test(s));
  if (!candidates.length) return pool.slice().sort((a, b) => b.length - a.length)[0] || '';
  // La phrase la plus proche de 180 caractères : dense, citable, non extrême.
  return candidates.slice().sort((a, b) => Math.abs(a.length - 180) - Math.abs(b.length - 180))[0];
}

for (const a of authors) {
  const authorStart = Date.now();
  const works = (a.works || [])
    .filter((w) => w && w.url && /gutenberg\.org/.test(w.url) && w.ok !== false)
    .slice(0, WORKS);
  // Les œuvres qui portent une ancre de doctrine sont toujours lues, même
  // au-delà du plafond --works (deux au plus) : sans elles, la doctrine
  // perd ses phrases d'appui.
  const anchorWorks = (anchorSets[a.id] || []).map((p) => p.work);
  for (const title of anchorWorks) {
    if (works.length >= WORKS + 2) break;
    if (works.some((w) => w.title === title)) continue;
    const extra = (a.works || []).find((w) => w.title === title && w.url && /gutenberg\.org/.test(w.url));
    if (extra) works.push(extra);
  }
  const nameRe = authorNameRe(a);
  const sources = [];
  const fullSources = [];
  const workMeta = [];

  for (const w of works) {
    const raw = await fetchText(w.url);
    if (!raw) {
      failed += 1;
      report.failures.push({ authorId: a.id, work: w.title, url: w.url });
      continue;
    }
    fetched += 1;
    const body = cutGutenberg(raw, w, { window: false });
    const list = sentences(cutGutenberg(raw, w)).filter((s) => !nameRe || !nameRe.test(s));
    sources.push({ title: w.title, list });
    fullSources.push({ title: w.title, list: sentences(body) });
    workMeta.push({ work: w, chars: body.length, sample: body.slice(0, 280), terms: topTerms(list.slice(0, 200), 12) });
    if (SLEEP > 0) await new Promise((r) => setTimeout(r, SLEEP));
  }

  const collect = (limitPerWork) => {
    const acc = [];
    const seen = new Set();
    for (const src of sources) {
      for (const s of sample(src.list, limitPerWork)) {
        const key = s.slice(0, 60).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        acc.push({ w: src.title, s });
      }
    }
    return acc;
  };

  let wm = works.length <= 1 ? Math.max(WORKMAX, 240) : WORKMAX;
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
      if (!pinned.some((e) => e.s.slice(0, 60).toLowerCase() === s.slice(0, 60).toLowerCase())) {
        pinned.push({ w: pin.work, s });
      }
    } else {
      process.stderr.write(`ancre introuvable ${a.id} :: ${pin.work} :: ${pin.startsWith}\n`);
      missingPins += 1;
    }
  }

  if (!entries.length && !pinned.length) {
    if (prev[a.id]) {
      out[a.id] = prev[a.id];
      total += prev[a.id].length;
    }
    report.authors[a.id] = { status: 'aucune source', kept: prev[a.id] ? prev[a.id].length : 0 };
    continue;
  }

  const pinKeys = new Set(pinned.map((e) => e.s.slice(0, 60).toLowerCase()));
  const kept = sample(entries.filter((e) => !pinKeys.has(e.s.slice(0, 60).toLowerCase())), MAX);
  const prevByKey = new Map((prev[a.id] || []).map((e) => [e.w + '::' + String(e.s || '').slice(0, 60), e]));
  const merged = pinned.concat(kept).map((e) => {
    const p0 = prevByKey.get(e.w + '::' + e.s.slice(0, 60));
    return p0 && p0.tr ? Object.assign({}, e, { id: p0.id, tr: p0.tr }) : e;
  });
  out[a.id] = merged;
  total += merged.length;

  // Cache d'audit : uniquement les phrases conservées, par œuvre (léger, exact).
  const dir = join(cacheRoot, a.id);
  mkdirSync(dir, { recursive: true });
  const keptByWork = new Map();
  for (const e of merged) {
    if (!keptByWork.has(e.w)) keptByWork.set(e.w, []);
    keptByWork.get(e.w).push(e.s);
  }
  for (const [work, list] of keptByWork) {
    writeFileSync(join(dir, `${slugify(work)}.txt`), list.join('\n'), 'utf8');
  }

  // Profil de voix : échantillon, termes, statistiques (alimente buildPersona).
  const sentencesKept = merged.map((e) => e.s);
  if (UPDATE_CATALOG && sentencesKept.length) {
    const distinct = new Set(contentWords(sentencesKept.join(' ')));
    a.sample = voiceSample(sentencesKept, a.lang);
    a.terms = topTerms(sentencesKept, 16);
    a.stats = { words: sentencesKept.join(' ').split(/\s+/).filter(Boolean).length, distinct: distinct.size };
    // Trois exemples de voix, si possible issus d'œuvres différentes.
    const byWork = new Map();
    for (const e of merged) {
      if (!byWork.has(e.w)) byWork.set(e.w, []);
      byWork.get(e.w).push(e.s);
    }
    const picks = [];
    for (const list of byWork.values()) {
      const s = voiceSample(list, a.lang);
      if (s && !picks.includes(s)) picks.push(s);
      if (picks.length >= 3) break;
    }
    a.samples = picks;
    a.works = (a.works || []).map((w) => {
      const meta = workMeta.find((m) => m.work.title === w.title);
      if (!meta) return w;
      return {
        ...w,
        chars: meta.chars,
        sample: meta.sample,
        terms: meta.terms,
        ok: true,
      };
    });
  }

  report.authors[a.id] = {
    status: 'ok',
    worksRead: sources.length,
    worksFailed: works.length - sources.length,
    pinned: pinned.length,
    kept: merged.length,
    perWork: sources.map((s) => ({ title: s.title, sentences: s.list.length })),
  };
  process.stderr.write(`${a.id}: ${pinned.length} épinglée(s) + ${kept.length} (${sources.length}/${works.length} œuvres, ${((Date.now() - authorStart) / 1000).toFixed(1)}s)\n`);
}

writeFileSync(dest, JSON.stringify(out));
if (UPDATE_CATALOG) {
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
}
mkdirSync(join(repo, 'salon/scripts/reports'), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

console.log(`authors ${Object.keys(out).length} · phrases ${total} · fetches ${fetched} · echecs ${failed} · bytes ${readFileSync(dest).length}`);
console.log(`rapport : ${reportPath}`);
if (missingPins) {
  process.stderr.write(`\n${missingPins} ancre(s) de doctrine introuvable(s) — corpus écrit.\n`);
  if (has('strict-pins')) process.exit(2);
}
