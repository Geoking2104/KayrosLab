#!/usr/bin/env node
/**
 * corpus_lib.mjs — fonctions pures partagées par la récolte (harvest_corpus.mjs)
 * et l'outil de relecture doctrinale (doctrine_candidates.mjs).
 *
 * Extraction de harvest_corpus.mjs (v2, lot 2) : mêmes comportements, à
 * l'identique — un module importable sans effet de bord de récolte.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repo = join(here, '..', '..');

/* --------------------------------------------------------------- moteur */

export function loadEngine() {
  const eng = readFileSync(join(repo, 'backend/web/public/salon/salon-engine.js'), 'utf8');
  const sb = { module: { exports: {} } };
  sb.globalThis = sb;
  new Function('module', 'exports', 'globalThis', eng)(sb.module, sb.module.exports, sb);
  return sb.module.exports;
}
export const E = loadEngine();

/* ------------------------------------------------------------- nettoyage */

export const NOISE = /project gutenberg|gutenberg\.org|ebook|produced by|transcriber|pg[a-z]*\.txt|copyright|table of contents|advertisement|isbn|printers?|publishers?|\bpress\b|london:|edinburgh|oxford:|mdccc|mdcc|chapter\s+[ivxl]+|^book\b|^volume\b|^contents\b|preface|introduction|translator|editor\b|the author of the following|bibliograph|dictionary of|assistant in the|catalogue|appendix|\bsays that\b|\bwas born\b|\bflourished\b|\bdied in\b|\bthe life of\b|biograph|\bhis life\b|\bher life\b/i;

export function isNoise(s) {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length) {
    const caps = (letters.match(/[A-Z]/g) || []).length;
    if (caps / letters.length > 0.5) return true;
  }
  if (!/[a-z]{3}/.test(s)) return true; // pas de mot courant → entête/titre
  return NOISE.test(s);
}

/**
 * Retire l'en-tête/pied Project Gutenberg.
 * window = true (défaut) : fenêtre 10–97 % (récolte) ; false : texte entier
 * (recherche d'épingles de doctrine, hors coupe).
 * startAt (catalog.json) : saute l'introduction d'éditeur quand elle est connue.
 */
export function cutGutenberg(t, work, { window = true } = {}) {
  let s = t.replace(/\r/g, '');
  const start = s.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG/i);
  if (start >= 0) s = s.slice(start + 200);
  const end = s.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (end >= 0) s = s.slice(0, end);
  let sliced = false;
  if (work && work.startAt) {
    const m = s.search(new RegExp(work.startAt, 'i'));
    if (m > 0) { s = s.slice(m); sliced = true; }
  }
  if (window) {
    // Retire les liminaires (préface, introduction, notices) et la fin (index).
    if (sliced) s = s.slice(0, Math.floor(s.length * 0.99));
    else s = s.slice(Math.floor(s.length * 0.10), Math.floor(s.length * 0.97));
  }
  return s;
}

/* Rejette les phrases qui nomment l'auteur à la troisième personne
 * (commentaire d'éditeur, notice). */
export function authorNameRe(a) {
  const toks = [];
  for (const n of [a.name, a.nameEn]) {
    if (!n) continue;
    const parts = String(n).split(/[\s’'-]+/).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.length >= 4) toks.push(last);
  }
  const uniq = Array.from(new Set(toks));
  if (!uniq.length) return null;
  return new RegExp('\\b(?:' + uniq.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b');
}

/* --------------------------------------------------------- phrases */

export function sample(arr, max) {
  if (arr.length <= max) return arr.slice();
  const out = [];
  const step = arr.length / max;
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

export function sentences(text) {
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

/* ------------------------------------------------------------------ réseau */

export async function fetchText(url) {
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
