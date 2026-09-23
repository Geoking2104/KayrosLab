#!/usr/bin/env node
/**
 * align_corpus.mjs — prépare la mémoire livrée au salon statique.
 *
 * Source : salon/src/lib/salon/corpus.json (tranches brutes, souvent coupées au
 * milieu d'une phrase). Sortie : backend/web/public/salon/corpus.json, où chaque
 * passage porte en plus `s` = une phrase ENTIÈRE et propre (sans résidu d'OCR ni
 * note d'éditeur), extraite par le moteur. C'est cette phrase que l'agent pourra
 * citer ; à défaut, il renonce à citer plutôt que de coller un fragment.
 *
 * Usage : node salon/scripts/align_corpus.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

const engineCode = readFileSync(join(repo, 'backend/web/public/salon/salon-engine.js'), 'utf8');
const sandbox = { module: { exports: {} } };
sandbox.globalThis = sandbox;
new Function('module', 'exports', 'globalThis', engineCode)(sandbox.module, sandbox.module.exports, sandbox);
const E = sandbox.module.exports;

const src = JSON.parse(readFileSync(join(repo, 'salon/src/lib/salon/corpus.json'), 'utf8'));

const out = {};
let passages = 0, quotable = 0;
for (const [id, entry] of Object.entries(src)) {
  const list = [];
  for (const p of entry.passages || []) {
    const w = String(p.work || '').trim();
    const t = String(p.text || '').replace(/\s+/g, ' ').trim();
    if (!w || t.length < 120) continue;
    const s = E.bestSentence(t);
    list.push(s ? { w: w, t: t, s: s } : { w: w, t: t });
    passages++;
    if (s) quotable++;
  }
  if (list.length) out[id] = list;
}

const dest = join(repo, 'backend/web/public/salon/corpus.json');
writeFileSync(dest, JSON.stringify(out));
console.log('authors', Object.keys(out).length, '· passages', passages, '· citables', quotable,
  '· bytes', readFileSync(dest).length);
