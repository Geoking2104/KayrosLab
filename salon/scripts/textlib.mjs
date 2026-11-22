#!/usr/bin/env node
/**
 * textlib.mjs — primitives texte partagées du Salon (zéro dépendance).
 *
 * Remplace la dépendance au moteur publié `backend/web/public/salon/salon-engine.js`
 * (absent de la branche) tout en gardant la même sémantique : phrases entières,
 * bruit éditorial écarté, scoring lexical déterministe, cadrage de question.
 *
 * Utilisé par : corpus_lib.mjs, harvest_corpus.mjs, align_corpus.mjs,
 * doctrine_candidates.mjs, enrich_catalog.mjs, speech_eval.mjs, publish_gate.mjs.
 */

/* --------------------------------------------------------------- bruit */

export const NOISE = /project gutenberg|gutenberg\.org|ebook|produced by|transcriber|pg[a-z]*\.txt|copyright|table of contents|advertisement|isbn|printers?|publishers?|\bpress\b|london:|edinburgh|oxford:|mdccc|mdcc|chapter\s+[ivxl]+|^book\b|^volume\b|^contents\b|preface|introduction|translator|editor\b|the author of the following|bibliograph|dictionary of|assistant in the|catalogue|appendix|\bsays that\b|\bwas born\b|\bflourished\b|\bdied in\b|\bthe life of\b|biograph|\bhis life\b|\bher life\b/i;

export function isNoise(s) {
  const text = String(s || '');
  const letters = text.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length) {
    const caps = (letters.match(/[A-ZÀ-Þ]/g) || []).length;
    if (caps / letters.length > 0.55) return true;
  }
  if (!/[a-zà-ÿ]{3}/.test(text)) return true;
  return NOISE.test(text);
}

/* ------------------------------------------------------------ phrases */

/**
 * Phrase publiable : bornes propres, longueur 24–340, ponctuation finale,
 * pas de résidu OCR, pas de bruit éditorial.
 */
export function cleanSentence(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length < 24 || t.length > 340) return false;
  if (!/[.!?…»"]$/.test(t)) return false;
  if (!/^[A-ZÀ-ÖØ-Þ«"“„¿¡0-9(\[]/.test(t)) return false;
  if (/\uFFFD/.test(t)) return false;
  if (/_/.test(t) && (t.match(/_/g) || []).length >= 2) return false;
  if (isNoise(t)) return false;
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 16) return false;
  const caps = (letters.match(/[A-ZÀ-Þ]/g) || []).length;
  if (caps / letters.length > 0.62) return false;
  return true;
}

/** Phrase citable au sens du contrat : 40–320 caractères, phrase entière. */
export function usableSentence(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length >= 40 && t.length <= 320 && cleanSentence(t);
}

export function sentencesOf(text) {
  const clean = String(text || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.split(/(?<=[.!?…])\s+(?=["«“„]?[A-ZÀ-ÖØ-Þ0-9])/u);
  return parts
    .map((s) => s.replace(/^["«“„\][\s]+/, '').replace(/\s*["»”]\s*$/, '').trim())
    .filter((s) => cleanSentence(s));
}

/** Échantillonnage régulier et déterministe. */
export function sample(arr, max) {
  if (!Array.isArray(arr) || arr.length <= max) return (arr || []).slice();
  const out = [];
  const step = arr.length / max;
  for (let i = 0; i < max; i += 1) out.push(arr[Math.floor(i * step)]);
  return out;
}

/* ------------------------------------------------------------- langue */

export function classifyLang(text) {
  const s = String(text || '');
  const fr = (s.match(/[àâçéèêëîïôùûüÿœ]/gi) || []).length * 3
    + (s.match(/\b(le|la|les|des|une?|est|nous|vous|dans|pour|qui|que|pas|plus)\b/gi) || []).length;
  const en = (s.match(/\b(the|of|and|to|in|that|is|it|with|for|as|not)\b/gi) || []).length;
  return fr > en ? 'fr' : 'en';
}

/** Normalisation pour vérification de sous-chaîne (citation). */
export function canonical(text) {
  return String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
    .replace(/[\u2013\u2014\u2010\u2011]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* ----------------------------------------------------- scoring lexical */

const STOP = new Set([
  'dans', 'cette', 'avec', 'pour', 'plus', 'tout', 'tous', 'leur', 'leurs',
  'comme', 'mais', 'donc', 'alors', 'ainsi', 'sans', 'sous', 'entre',
  'apres', 'avant', 'encore', 'aussi', 'bien', 'tres', 'fait', 'faire',
  'etre', 'avoir', 'cela', 'ceux', 'celles', 'nous', 'vous', 'elle', 'elles',
  'that', 'this', 'with', 'from', 'have', 'been', 'were', 'which',
  'their', 'there', 'about', 'would', 'could', 'should', 'the', 'and',
]);

export function contentWords(text) {
  return (String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z][a-z'-]+/g) || [])
    .map((w) => w.replace(/['-]/g, ''))
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

export function relevance(query, text) {
  const q = new Set(contentWords(query));
  if (!q.size) return 0;
  const words = contentWords(text);
  if (!words.length) return 0;
  let hit = 0;
  for (const w of words) if (q.has(w)) hit += 1;
  return hit / Math.sqrt(q.size * Math.max(words.length, 8));
}

/** Meilleure phrase d'un passage : pertinence d'abord, sinon la plus longue. */
export function bestSentence(text, query = '') {
  const list = sentencesOf(text);
  if (!list.length) return '';
  if (query) {
    let best = list[0];
    let bestScore = -1;
    for (const s of list) {
      const score = relevance(query, s);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (bestScore > 0) return best;
  }
  return list.slice().sort((a, b) => b.length - a.length)[0];
}

/* -------------------------------------------------------------- cadrage */

const DOMAINS = [
  ['liberte', /libert[eé]|libre|freedom|free will|autonom/],
  ['justice', /justice|juste|droit|right|law|loi/],
  ['pouvoir', /pouvoir|power|gouvern|state|souverain|autorit/],
  ['verite', /v[eé]rit[eé]|truth|science|connaissance|knowledge/],
  ['bonheur', /bonheur|happiness|plaisir|pleasure|joie/],
  ['vertu', /vertu|virtue|morale|moral|bien/],
  ['dieu', /dieu|god|providence|religion|foi|faith/],
  ['nature', /nature|natural|monde|world|cosmos/],
  ['amour', /amour|love|passion|d[eé]sir/],
  ['mort', /mort|death|mourir|destin|fate/],
  ['guerre', /guerre|war|combat|arm[eé]e|strat[eé]g/],
  ['economie', /riche|wealth|march[eé]|market|travail|labour|capital/],
  ['art', /art|beaut[eé]|beauty|po[eé]sie|poetry|style/],
  ['education', /education|[eé]ducation|instruction|apprendre|learn/],
  ['societe', /soci[eé]t[eé]|society|citoyen|citizen|peuple|people/],
  ['temps', /temps|time|histoire|history|m[eé]moire/],
];

const DEMANDS = [
  ['definition', /qu['’]est-ce|what is|d[eé]finis|define|qu'appelle/],
  ['cause', /pourquoi|why|cause|parce que|because/],
  ['maniere', /comment|how|de quelle mani[eè]re/],
  ['norme', /faut-il|should|doit|must|il faut|ought/],
  ['verite', /est-ce vrai|is it true|vrai|true|croire|believe/],
  ['quantite', /combien|how much|how many|plus que|moins que/],
  ['valeur', /vaut|worth|mieux|better|pr[eé]f[eé]rable/],
  ['these', /.*/],
];

export function scope(question) {
  const q = String(question || '').toLowerCase();
  const domain = (DOMAINS.find(([, re]) => re.test(q)) || ['generique'])[0];
  const demand = (DEMANDS.find(([, re]) => re.test(q)) || ['these'])[0];
  const keys = (q.match(/[a-zà-ÿ]{4,}/g) || []).filter((w) => !STOP.has(w)).slice(0, 12);
  return { terms: keys, demand, domain, keys, label: domain, concepts: [] };
}

/* -------------------------------------------------------- Gutenberg */

/** Chemin miroir pglaf : /4/6/5/4650/4650-0.txt (dernier segment = ID complet). */
export function gutenbergPath(id, variant = '-0.txt') {
  const s = String(id);
  return `${s.slice(0, -1).split('').join('/')}/${s}/${s}${variant}`;
}

const MIRRORS = [
  (id, v) => `https://mirror.csclub.uwaterloo.ca/gutenberg/${gutenbergPath(id, v)}`,
  (id, v) => `https://gutenberg.pglaf.org/cache/epub/${id}/pg${id}${v === '-0.txt' ? '.txt' : v}`,
  (id, v) => `https://gutenberg.pglaf.org/${gutenbergPath(id, v)}`,
];

/**
 * Télécharge un texte Gutenberg (préfixe borné via Range).
 * Les miroirs limitent le débit sur les gros livres : on ne lit que
 * `maxBytes` (2 Mo par défaut), largement suffisant pour des centaines de
 * phrases, et on abandonne proprement au-delà.
 * @returns {Promise<{text:string,url:string,bytes:number,total:number|null}|null>}
 */
export async function fetchWorkText(id, { timeoutMs = 15000, retries = 0, maxBytes = 900_000 } = {}) {
  const variants = ['-0.txt', '-8.txt'];
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    for (const variant of variants) {
      for (const build of MIRRORS) {
        const url = build(id, variant);
        try {
          const res = await fetch(url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
              'user-agent': 'KayrosLab-Salon/1.0 (corpus domaine public)',
              range: `bytes=0-${maxBytes - 1}`,
              'accept-encoding': 'identity',
            },
          });
          if (!res.ok && res.status !== 206) continue;
          const total = res.headers.get('content-range')
            ? Number((res.headers.get('content-range').match(/\/(\d+)/) || [])[1]) || null
            : Number(res.headers.get('content-length')) || null;
          let text;
          if (res.body && typeof res.body.getReader === 'function') {
            const reader = res.body.getReader();
            const chunks = [];
            let received = 0;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              received += value.length;
              if (received >= maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } break; }
            }
            const buf = Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, maxBytes);
            text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
          } else {
            text = await res.text();
            if (text.length > maxBytes) text = text.slice(0, maxBytes);
          }
          if (!text || text.length < 5000 || /^\s*<!DOCTYPE html/i.test(text)) continue;
          return { text, url, bytes: text.length, total };
        } catch { /* miroir suivant */ }
      }
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}

/* ------------------------------------------------------------- divers */

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'sans-titre';
}

/** Retire l'en-tête/pied Project Gutenberg (fenêtre 10–97 % par défaut). */
export function cutGutenberg(text, work = null, { window = true } = {}) {
  let s = String(text || '').replace(/\r/g, '');
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
    if (sliced) s = s.slice(0, Math.floor(s.length * 0.99));
    else s = s.slice(Math.floor(s.length * 0.10), Math.floor(s.length * 0.97));
  }
  return s;
}

/** Rejette les phrases qui nomment l'auteur à la troisième personne. */
export function authorNameRe(author) {
  const tokens = [];
  for (const n of [author?.name, author?.nameEn]) {
    if (!n) continue;
    const parts = String(n).split(/[\s’'-]+/).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.length >= 4) tokens.push(last);
  }
  const uniq = Array.from(new Set(tokens));
  if (!uniq.length) return null;
  return new RegExp('\\b(?:' + uniq.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b');
}

/** Sous-ensemble « moteur » pour les scripts qui consommaient salon-engine.js. */
export const engineFallback = {
  cleanSentence,
  bestSentence,
  sentencesOf,
  relevance,
  scope,
  sample,
  classifyLang,
};
