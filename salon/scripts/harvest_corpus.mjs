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
 * Déterministe : œuvres triées, échantillonnage à pas fixe. En cas d'échec
 * réseau pour un auteur, on conserve ses entrées existantes (jamais de trou).
 *
 * Usage : node salon/scripts/harvest_corpus.mjs [--limit N] [--works N] [--max N] [--workmax N]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

const argN = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const LIMIT = argN('limit', 0);      // 0 = tous les auteurs
const WORKS = argN('works', 3);      // œuvres lues par auteur
const MAX = argN('max', 48);         // phrases gardées par auteur
const WORKMAX = argN('workmax', 24); // phrases gardées par œuvre

// moteur (pour la découpe propre des phrases)
const eng = readFileSync(join(repo, 'backend/web/public/salon/salon-engine.js'), 'utf8');
const sb = { module: { exports: {} } }; sb.globalThis = sb;
new Function('module', 'exports', 'globalThis', eng)(sb.module, sb.module.exports, sb);
const E = sb.module.exports;

const catalog = JSON.parse(readFileSync(join(repo, 'salon/src/lib/salon/catalog.json'), 'utf8'));
const dest = join(repo, 'backend/web/public/salon/corpus.json');
const prev = existsSync(dest) ? JSON.parse(readFileSync(dest, 'utf8')) : {};

const NOISE = /project gutenberg|gutenberg\.org|ebook|produced by|transcriber|pg[a-z]*\.txt|copyright|table of contents|advertisement|isbn|printers?|publishers?|\bpress\b|london:|edinburgh|oxford:|mdccc|mdcc|chapter\s+[ivxl]+|^book\b|^volume\b|^contents\b|preface|introduction|translator|editor\b|the author of the following|bibliograph|dictionary of|assistant in the|catalogue|appendix|\bsays that\b|\bwas born\b|\bflourished\b|\bdied in\b|\bthe life of\b|biograph|\bhis life\b|\bher life\b/i;

function isNoise(s) {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length) {
    const caps = (letters.match(/[A-Z]/g) || []).length;
    if (caps / letters.length > 0.5) return true;
  }
  if (!/[a-z]{3}/.test(s)) return true; // pas de mot courant → entête/titre
  return NOISE.test(s);
}

function cutGutenberg(t) {
  let s = t.replace(/\r/g, '');
  const start = s.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG/i);
  if (start >= 0) s = s.slice(start + 200);
  const end = s.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (end >= 0) s = s.slice(0, end);
  // Retire les liminaires (préface, introduction, notices) et la fin (index).
  s = s.slice(Math.floor(s.length * 0.10), Math.floor(s.length * 0.97));
  return s;
}

function sample(arr, max) {
  if (arr.length <= max) return arr.slice();
  const out = [];
  const step = arr.length / max;
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function sentences(text) {
  const parts = String(text).replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
  const out = [];
  const seen = new Set();
  for (const raw of parts) {
    const s = raw.replace(/^["«“„[\]\s]+/, '').trim();
    if (!E.cleanSentence(s)) continue;
    if (isNoise(s)) continue;
    const key = s.slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': 'KayrosLab-Salon/1.0 (corpus domaine public)' } });
    if (!r.ok) return null;
    const t = await r.text();
    return t.length > 3_000_000 ? t.slice(0, 3_000_000) : t;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const authors = LIMIT > 0 ? catalog.authors.slice(0, LIMIT) : catalog.authors;
const out = {};
let fetched = 0, failed = 0, total = 0;

for (const a of authors) {
  const works = (a.works || [])
    .filter((w) => w && w.url && /gutenberg\.org/.test(w.url))
    .sort((x, y) => String(x.title).localeCompare(String(y.title)))
    .slice(0, WORKS);
  const entries = [];
  const seen = new Set();
  for (const w of works) {
    const raw = await fetchText(w.url);
    if (!raw) { failed++; continue; }
    fetched++;
    const ss = sample(sentences(cutGutenberg(raw)), WORKMAX);
    for (const s of ss) {
      const key = s.slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ w: w.title, s: s });
    }
  }
  if (!entries.length) {
    // pas de réseau/texte exploitable : on garde la mémoire précédente
    if (prev[a.id]) { out[a.id] = prev[a.id]; total += prev[a.id].length; }
    continue;
  }
  const kept = sample(entries, MAX);
  out[a.id] = kept;
  total += kept.length;
  process.stderr.write(`${a.id}: ${kept.length}\n`);
}

writeFileSync(dest, JSON.stringify(out));
console.log(`authors ${Object.keys(out).length} · phrases ${total} · fetches ${fetched} · echecs ${failed} · bytes ${readFileSync(dest).length}`);
