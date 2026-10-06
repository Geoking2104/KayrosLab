#!/usr/bin/env node
/**
 * translate_corpus.mjs — traduit le corpus du Salon vers l'autre langue.
 *
 * « Traduire avant d'importer » : chaque phrase du corpus porte `tr:{fr|en}`
 * (la traduction d'affichage ; l'original reste dans `s`, base des scores).
 * S'appuie sur la route backend /v1/salon/translate (cache, garde anti-mock).
 * Reprenable : les phrases déjà traduites sont sautées.
 *
 * Usage : node salon/scripts/translate_corpus.mjs [--api https://api.kayroslab.com] [--batches 16]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : dflt; };
const API = arg('api', 'https://api.kayroslab.com');
const BATCH = Number(arg('batches', 16)) || 16;
const file = join(repo, 'backend/web/public/salon/corpus.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const classify = (s) => {
  const t = String(s || '');
  const fr = (t.match(/[àâçéèêëîïôùûüÿœ]/gi) || []).length * 3 + (t.match(/\b(le|la|les|des|une?|est|nous|vous|dans|pour|qui|que|pas|et|ne|se|au|du|ce|cette)\b/gi) || []).length;
  const en = (t.match(/\b(the|of|and|to|in|that|is|it|with|for|as|not|be|by|which|from|this|are|was|were|his|her|their)\b/gi) || []).length;
  return fr > en ? 'fr' : 'en';
};

const corpus = JSON.parse(readFileSync(file, 'utf8'));
const jobs = [];
for (const id of Object.keys(corpus)) {
  corpus[id].forEach((e, i) => {
    const to = classify(e.s) === 'fr' ? 'en' : 'fr';
    if (e.tr && typeof e.tr[to] === 'string' && e.tr[to]) return;
    jobs.push({ id, i, s: e.s, to });
  });
}
console.log('à traduire :', jobs.length);

async function callTranslate(texts, to) {
  const r = await fetch(API + '/v1/salon/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to, texts }),
    signal: AbortSignal.timeout(90000),
  });
  if (r.status === 429) { await sleep(12000); throw new Error('429'); }
  if (!r.ok) throw new Error('http ' + r.status);
  const j = await r.json();
  if (!j.ok || !Array.isArray(j.translations) || j.translations.length !== texts.length) throw new Error('réponse invalide');
  return j.translations;
}

let done = 0, failed = 0;
for (const to of ['fr', 'en']) {
  const list = jobs.filter((j) => j.to === to);
  for (let k = 0; k < list.length; k += BATCH) {
    const chunk = list.slice(k, k + BATCH);
    let trs = null;
    try { trs = await callTranslate(chunk.map((c) => c.s), to); }
    catch { await sleep(1500); try { trs = await callTranslate(chunk.map((c) => c.s), to); } catch { trs = null; } }
    if (trs) {
      chunk.forEach((item, ii) => {
        const t = trs[ii];
        if (t && String(t).trim() && t !== item.s && !/^\[mock\]/i.test(t)) {
          const e = corpus[item.id][item.i];
          e.tr = Object.assign({}, e.tr || {}, { [item.to]: String(t).trim() });
          done += 1;
        } else failed += 1;
      });
    } else failed += chunk.length;
    if (k % (BATCH * 10) === 0) writeFileSync(file, JSON.stringify(corpus));
    process.stderr.write(`avancement ${to} ${Math.min(k + BATCH, list.length)}/${list.length}\n`);
    await sleep(250);
  }
}
writeFileSync(file, JSON.stringify(corpus));
console.log('traduites :', done, '| échecs :', failed);
