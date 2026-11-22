#!/usr/bin/env node
/**
 * refresh_voice_profiles.mjs — met à jour le profil de voix du catalogue
 * à partir des packs publiés, sans refaire la récolte réseau.
 *
 * Préfère les phrases dans la langue de l'auteur (un auteur français ne doit
 * pas recevoir un exemple de voix anglais), remplit `sample`, `samples`,
 * `terms`, `stats`.
 *
 * Usage : node salon/scripts/refresh_voice_profiles.mjs [--mirror <dir>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CATALOG_FILE, MIRROR_DIR, parseArgs, readJSON } from './openkb_common.mjs';
import { classifyLang, contentWords } from './textlib.mjs';

const args = parseArgs();
const MIRROR = args.mirror ? resolve(String(args.mirror)) : MIRROR_DIR;
const catalog = readJSON(CATALOG_FILE);
const manifest = readJSON(join(MIRROR, 'kb-manifest.json'));
if (!catalog || !manifest) throw new Error('catalogue ou manifeste illisible');

function topTerms(list, n) {
  const freq = new Map();
  for (const s of list) for (const w of contentWords(s)) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).slice(0, n).map(([w]) => w);
}

function pick(list, lang) {
  const preferred = lang ? list.filter((s) => classifyLang(s) === lang) : [];
  const pool = preferred.length ? preferred : list;
  const candidates = pool.filter((s) => s.length >= 90 && s.length <= 260 && !/[0-9]{3}/.test(s));
  const ranked = (candidates.length ? candidates : pool).slice()
    .sort((a, b) => Math.abs(a.length - 180) - Math.abs(b.length - 180));
  return ranked[0] || '';
}

let updated = 0;
for (const author of catalog.authors) {
  const info = (manifest.authors || {})[author.id];
  if (!info) continue;
  const pack = readJSON(join(MIRROR, info.pack || `kb/${author.id}.json`));
  if (!pack || !(pack.passages || []).length) continue;
  const sentences = pack.passages.map((p) => p.s);
  author.sample = pick(sentences, author.lang);
  const byWork = new Map();
  for (const p of pack.passages) {
    if (!byWork.has(p.w)) byWork.set(p.w, []);
    byWork.get(p.w).push(p.s);
  }
  const samples = [];
  for (const list of byWork.values()) {
    const s = pick(list, author.lang);
    if (s && !samples.includes(s)) samples.push(s);
    if (samples.length >= 3) break;
  }
  author.samples = samples;
  author.terms = topTerms(sentences, 16);
  const distinct = new Set(contentWords(sentences.join(' ')));
  author.stats = { words: sentences.join(' ').split(/\s+/).filter(Boolean).length, distinct: distinct.size };
  updated += 1;
}

writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
console.log(`✓ profils de voix : ${updated} auteurs mis à jour`);
for (const id of ['voltaire', 'moliere', 'dickens']) {
  const a = catalog.authors.find((x) => x.id === id);
  if (a) console.log(`  ${id}: ${JSON.stringify((a.sample || '').slice(0, 90))}`);
}
