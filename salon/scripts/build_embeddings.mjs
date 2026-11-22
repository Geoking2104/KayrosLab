#!/usr/bin/env node
/**
 * build_embeddings.mjs — index vectoriel persistant des packs Salon.
 *
 * Pour chaque auteur, prend un échantillon régulier de phrases (160 par défaut),
 * les embedde avec bge-m3 via Ollama (loopback), normalise les vecteurs et écrit :
 *   backend/fastify/data/salon-emb/<auteur>.f32   vecteurs float32
 *   backend/fastify/data/salon-emb/<auteur>.json  métadonnées + phrases
 *   backend/fastify/data/salon-emb/manifest.json  modèle, dimensions, compteurs
 *
 * L'API /v1/salon/speak charge cet index en priorité ; s'il manque, elle
 * retombe sur le rerank dense à la requête (8 candidats) puis le lexical.
 *
 * Usage :
 *   node salon/scripts/build_embeddings.mjs --max-per-author 160
 *   node salon/scripts/build_embeddings.mjs --author voltaire --force
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, parseArgs } from './openkb_common.mjs';

const args = parseArgs();
const OUT = args.out ? resolve(String(args.out)) : join(REPO, 'backend/fastify/data/salon-emb');
const PACKS = join(REPO, 'backend/web/public/salon/kb');
const MAX = args['max-per-author'] ? Number(args['max-per-author']) : 160;
const BATCH = args.batch ? Number(args.batch) : 16;
const MODEL = String(args.model || process.env.EMBED_MODEL || 'bge-m3');
const OLLAMA = String(args.ollama || process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434').replace(/\/$/, '');
const FORCE = Boolean(args.force);
const VERSION = 2;

const CONCEPTS = {
  rire: ['rire', 'ris', 'rires', 'ridicule', 'ridicules', 'comedie', 'comique', 'moquerie', 'railler', 'sourire', 'laughter', 'comedy'],
  vice: ['vice', 'vices', 'defaut', 'defauts', 'corruption', 'moeurs', 'hypocrisie', 'hypocrite', 'passion', 'passions'],
  corriger: ['corriger', 'correction', 'corrige', 'guerir', 'guerison', 'reformer', 'reforme', 'amender', 'amendement'],
  liberte: ['liberte', 'libertes', 'libre', 'autonomie', 'independance', 'freedom', 'liberty'],
  justice: ['justice', 'juste', 'injustice', 'droit', 'droits', 'law', 'right'],
  pouvoir: ['pouvoir', 'pouvoirs', 'gouvernement', 'gouverner', 'souverain', 'autorite', 'power', 'state'],
  verite: ['verite', 'vrai', 'faux', 'erreur', 'science', 'connaissance', 'truth', 'knowledge'],
  bonheur: ['bonheur', 'heureux', 'plaisir', 'joie', 'happiness', 'pleasure'],
  vertu: ['vertu', 'vertus', 'morale', 'bien', 'virtue', 'moral'],
  dieu: ['dieu', 'dieux', 'providence', 'religion', 'foi', 'god', 'faith'],
  nature: ['nature', 'naturel', 'monde', 'cosmos', 'world'],
  amour: ['amour', 'aimer', 'passion', 'desir', 'love', 'desire'],
  mort: ['mort', 'mourir', 'destin', 'fate', 'death'],
  guerre: ['guerre', 'combat', 'armee', 'strategie', 'war', 'strategy'],
  richesse: ['richesse', 'riche', 'argent', 'wealth', 'money', 'capital'],
  travail: ['travail', 'travailler', 'labour', 'work', 'industry'],
  education: ['education', 'instruire', 'instruction', 'apprendre', 'learn'],
  societe: ['societe', 'citoyen', 'peuple', 'society', 'people', 'citizen'],
  temps: ['temps', 'histoire', 'memoire', 'time', 'history'],
  art: ['art', 'beaute', 'poesie', 'style', 'beauty', 'poetry'],
};

function words(text) {
  return (String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z][a-z'-]+/g) || [])
    .map((w) => w.replace(/['-]/g, ''))
    .filter((w) => w.length >= 4);
}

/** Sélection : un passage par concept, puis échantillonnage régulier. */
function selectForIndex(all, max) {
  const picked = [];
  const seen = new Set();
  const add = (p) => {
    const key = String(p.s).slice(0, 80).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    picked.push({ work: p.w, text: p.s });
  };
  for (const [key, list] of Object.entries(CONCEPTS)) {
    const hits = all.find((p) => {
      const ws = new Set(words(p.s));
      return ws.has(key) || list.some((x) => ws.has(x));
    });
    if (hits) add(hits);
  }
  const step = Math.max(1, Math.floor(all.length / max));
  for (let i = 0; i < all.length && picked.length < max; i += step) add(all[i]);
  for (const p of all) {
    if (picked.length >= max) break;
    add(p);
  }
  return picked.slice(0, max);
}

mkdirSync(OUT, { recursive: true });

function l2(vector) {
  let sum = 0;
  for (const x of vector) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  return vector.map((x) => x / n);
}

async function embed(texts) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`${OLLAMA}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, input: texts, keep_alive: '10m' }),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}`);
      const body = await res.json();
      const vectors = body.embeddings || (body.embedding ? [body.embedding] : []);
      if (!Array.isArray(vectors) || vectors.length !== texts.length) {
        throw new Error(`shape ${vectors.length} ≠ ${texts.length}`);
      }
      return vectors.map(l2);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw last || new Error('embedding impossible');
}

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

const files = existsSync(PACKS)
  ? readdirSync(PACKS).filter((f) => f.endsWith('.json')).sort()
  : [];
if (!files.length) {
  console.error(`✗ packs introuvables : ${PACKS}`);
  process.exit(1);
}

const only = args.author ? String(args.author) : null;
const manifestPath = join(OUT, 'manifest.json');
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { authors: {} };
const manifest = { version: VERSION, model: MODEL, dims: 0, builtAt: new Date().toISOString(), total: 0, authors: {} };
let dims = 0;
let total = 0;
let built = 0;

for (const file of files) {
  const authorId = file.replace(/\.json$/, '');
  if (only && authorId !== only) {
    if (previous.authors && previous.authors[authorId]) {
      manifest.authors[authorId] = previous.authors[authorId];
      total += previous.authors[authorId].count || 0;
      dims = dims || previous.authors[authorId].dims || 0;
    }
    continue;
  }
  if (!FORCE && previous.version === VERSION && previous.authors && previous.authors[authorId]) {
    manifest.authors[authorId] = previous.authors[authorId];
    total += previous.authors[authorId].count || 0;
    dims = dims || previous.authors[authorId].dims || 0;
    continue;
  }
  // Reprise : un auteur déjà calculé (json + f32) est réutilisé même sans manifeste.
  if (!FORCE && previous.version === VERSION && existsSync(join(OUT, `${authorId}.json`)) && existsSync(join(OUT, `${authorId}.f32`))) {
    try {
      const meta = JSON.parse(readFileSync(join(OUT, `${authorId}.json`), 'utf8'));
      if (meta && meta.version === VERSION && meta.dims && meta.count) {
        manifest.authors[authorId] = { count: meta.count, dims: meta.dims };
        total += meta.count;
        dims = dims || meta.dims;
        built += 1;
        continue;
      }
    } catch { /* reconstruit */ }
  }

  const pack = JSON.parse(readFileSync(join(PACKS, file), 'utf8'));
  const all = (pack.passages || []).filter((p) => p && p.s);
  const picked = selectForIndex(all, MAX);
  if (!picked.length) continue;

  const vectors = [];
  for (let off = 0; off < picked.length; off += BATCH) {
    const chunk = picked.slice(off, off + BATCH);
    const vecs = await embed(chunk.map((p) => p.text));
    vectors.push(...vecs);
    process.stderr.write(`  ${authorId}: ${Math.min(off + BATCH, picked.length)}/${picked.length}\r`);
  }
  const d = vectors[0] ? vectors[0].length : 0;
  if (!d) continue;
  const buf = Buffer.alloc(vectors.length * d * 4);
  vectors.forEach((v, i) => v.forEach((x, j) => buf.writeFloatLE(x, (i * d + j) * 4)));
  writeAtomic(join(OUT, `${authorId}.f32`), buf);
  writeAtomic(join(OUT, `${authorId}.json`), JSON.stringify({
    version: VERSION, authorId, model: MODEL, dims: d, count: picked.length, sentences: picked,
  }));
  manifest.authors[authorId] = { count: picked.length, dims: d };
  total += picked.length;
  dims = dims || d;
  built += 1;
}

manifest.dims = dims;
manifest.total = total;
writeAtomic(manifestPath, JSON.stringify(manifest));
console.log(`✓ index bge-m3 : ${built} auteur(s) construits · ${Object.keys(manifest.authors).length} auteurs · ${total} phrases · ${dims} dimensions`);
console.log(`  → ${OUT}`);
