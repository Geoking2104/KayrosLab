#!/usr/bin/env node
/**
 * kb_export.mjs — transforme les bases (ou le corpus existant) en « packs Salon »
 * statiques pour l'application : phrases entières avec provenance, formules
 * d'auteur, manifeste. Voir docs/SALON-OPENKB.md §6, §8.
 *
 * Deux sources :
 *   --from-corpus   : bootstrap — lit backend/web/public/salon/corpus.json
 *                     (provenance au niveau de l'œuvre ; en attendant les KB).
 *   (défaut)        : lit les bases OpenKB préparées (raw/<slug>.txt) et la
 *                     kb-map (provenance complète, version de base).
 *
 * Sorties (dans backend/web/public/salon/) :
 *   kb/<auteur>.json     pack canonique par auteur
 *   corpus.json          projection rétro-compatible ({w,s} + id + src)
 *   formulas.json        banque de formules agrégée
 *   kb-manifest.json     versions, compteurs, empreintes
 *
 * Usage :
 *   node salon/scripts/kb_export.mjs --from-corpus
 *   node salon/scripts/kb_export.mjs                      # mode bases OpenKB
 *   node salon/scripts/kb_export.mjs --check              # valide les sorties
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  CATALOG_FILE, MIRROR_DIR, NOISE, kbRawDir, kbRoot, loadCatalog, loadKbMap,
  nowIso, parseArgs, readJSON, saveKbMap, sentencesOf, sha256, stableChecksum,
  usableSentence, writeJSON,
} from "./openkb_common.mjs";

/* --------------------------------------------------------------- formules */

const CONNECTORS = /^(Mais|Et|Or|Car|Donc|Ainsi|Pourtant|Cependant|Encore|Aussi|Alors|Toutefois|Néanmoins|Nevertheless|However|But|And|Yet|For|So|Thus|Then|Besides|Moreover|Therefore)\b/;
const FR_HINT = /[àâçéèêëîïôùûüÿœ]|\b(le|la|les|des|une?|est|nous|vous|dans|pour|qui|que|pas|plus)\b/i;

export function classifyLang(text) {
  const fr = (String(text).match(/[àâçéèêëîïôùûüÿœ]/gi) || []).length * 3
    + (String(text).match(/\b(le|la|les|des|une?|est|nous|vous|dans|pour|qui|que|pas)\b/gi) || []).length;
  const en = (String(text).match(/\b(the|of|and|to|in|that|is|it|with|for|as|not)\b/gi) || []).length;
  return fr > en ? "fr" : "en";
}

/** Score de « fabricabilité » d'une phrase verbatim (heuristique stable). */
export function scoreVerbatim(s) {
  let score = 60;
  const len = s.length;
  score += Math.min(len, 220) / 4;
  if (len >= 70 && len <= 200) score += 8;
  if (CONNECTORS.test(s)) score -= 25;
  if ((s.match(/\?/g) || []).length >= 2) score -= 15;
  if (/[0-9]/.test(s) && (s.match(/[0-9]/g) || []).length >= 3) score -= 8;
  if (s.length > 300) score -= 12;
  return Math.round(score * 100) / 100;
}

const FAMILIES = [
  { label: "condition", re: /^(Si|If)\b/ },
  { label: "maxime", re: /^(Il faut|Il ne faut|Il est |C'est |One must|We must|Never |No one |Nothing )/ },
  { label: "restriction", re: /\bne\b[^.]{0,80}\b(que|point|jamais|rien)\b/i },
];

/**
 * Mine les formules d'un auteur à partir de phrases entières.
 * @param {{authorId:string, entries:{w:string,s:string}[], corpusSource?:string}} input
 */
export function mineFormulas({ authorId, entries }) {
  const seen = new Set();
  const unique = [];
  for (const e of entries) {
    const s = String(e.s || "").replace(/\s+/g, " ").trim();
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...e, s });
  }

  // Verbatim : top par score, ids stables (ordre d'origine).
  const ranked = unique
    .map((e, i) => ({ ...e, i, score: scoreVerbatim(e.s) }))
    .sort((a, b) => (b.score - a.score) || (a.i - b.i));
  const cap = Math.min(80, Math.max(12, Math.round(unique.length * 0.55)));
  const picked = ranked.slice(0, cap).sort((a, b) => a.i - b.i);
  const formulas = picked.map((e, n) => ({
    id: `${authorId}.f.v${String(n + 1).padStart(4, "0")}`,
    kind: "verbatim",
    text: e.s,
    work: e.w,
    lang: classifyLang(e.s),
    src: { work: e.w },
    quality: { chars: e.s.length },
  }));

  // Motifs : ouvertures fréquentes + familles de construction (attestées).
  const openings = new Map();
  for (const e of unique) {
    const words = e.s.split(" ").slice(0, 3).join(" ");
    if (words.length > 26) continue;
    const k = words;
    const cur = openings.get(k) || { count: 0, works: new Set(), examples: [] };
    cur.count += 1; cur.works.add(e.w);
    if (cur.examples.length < 2) cur.examples.push(e.s);
    openings.set(k, cur);
  }
  const patterns = [];
  [...openings.entries()]
    .filter(([, v]) => v.count >= 4)
    .sort((a, b) => (b[1].count - a[1].count) || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .forEach(([shape, v], i) => patterns.push({
      id: `${authorId}.f.p${String(i + 1).padStart(2, "0")}`,
      kind: "pattern",
      label: "ouverture",
      shape: `${shape}…`,
      attested: v.count,
      worksSpan: v.works.size,
      examples: v.examples,
    }));
  for (const fam of FAMILIES) {
    const hits = unique.filter((e) => fam.re.test(e.s));
    if (hits.length < 3) continue;
    patterns.push({
      id: `${authorId}.f.p${String(patterns.length + 1).padStart(2, "0")}`,
      kind: "pattern",
      label: fam.label,
      shape: fam.re.source.replace(/^\^|\$$/g, ""),
      attested: hits.length,
      worksSpan: new Set(hits.map((h) => h.w)).size,
      examples: hits.slice(0, 2).map((h) => h.s),
    });
  }

  return { formulas: [...formulas, ...patterns.slice(0, 12)], verbatim: formulas, patterns };
}

/* ----------------------------------------------------------------- packs */

export function buildPack({ authorId, entries, source, kbVersion, worksStats }) {
  const { formulas, verbatim, patterns } = mineFormulas({ authorId, entries });
  const passages = entries.map((e, i) => ({
    id: `${authorId}.p${String(i + 1).padStart(4, "0")}`,
    w: e.w,
    s: e.s,
    src: { work: e.w },
  }));
  const checksum = stableChecksum({
    passages: passages.map((p) => ({ id: p.id, w: p.w, s: p.s })),
    formulas: formulas.map((f) => ({ id: f.id, kind: f.kind, text: f.text || f.shape })),
  });
  return {
    authorId,
    kbVersion,
    builtAt: nowIso(),
    source,
    lang: entries.length ? classifyLang(entries.map((e) => e.s).join(" ").slice(0, 4000)) : "fr",
    works: worksStats,
    passages,
    formulas,
    concepts: [],
    entities: [],
    stats: { sentences: passages.length, formulas: formulas.length, verbatim: verbatim.length, patterns: patterns.length },
    checksum,
  };
}

export function loadCorpusEntries(corpus, authorId) {
  const list = Array.isArray(corpus[authorId]) ? corpus[authorId] : [];
  return list
    .map((e) => ({ w: e.w || e.work || "", s: String(e.s || e.text || "").replace(/\s+/g, " ").trim() }))
    .filter((e) => e.w && usableSentence(e.s));
}

export function loadKbEntries(authorId, { root = kbRoot(), map = loadKbMap() } = {}) {
  const rawDir = kbRawDir(authorId, root);
  if (!existsSync(rawDir)) return null;
  const workBySlug = new Map(((map.authors[authorId] || {}).works || []).map((w) => [w.slug, w.title]));
  const entries = [];
  for (const file of readdirSync(rawDir).filter((f) => f.endsWith(".txt")).sort()) {
    const slug = basename(file, ".txt");
    const text = readFileSync(join(rawDir, file), "utf8");
    const work = workBySlug.get(slug) || slug;
    for (const s of sentencesOf(text)) if (usableSentence(s)) entries.push({ w: work, s });
  }
  return entries.length ? entries : null;
}

/* ------------------------------------------------------------- validation */

export function validatePack(pack, { catalogAuthor } = {}) {
  const hard = [];
  const warn = [];
  if (!pack || !pack.authorId) hard.push("pack sans authorId");
  const passages = (pack && pack.passages) || [];
  if (!passages.length) hard.push(`${pack.authorId}: aucune phrase`);
  const seen = new Set();
  const titles = new Set(((catalogAuthor && catalogAuthor.works) || []).map((w) => w.title));
  let matchedWorks = 0;
  for (const p of passages) {
    if (!p.w || !p.s) { hard.push(`${pack.authorId}: passage incomplet (${p.id || "?"})`); continue; }
    if (p.s.length < 36 || p.s.length > 340) hard.push(`${pack.authorId}: longueur hors bornes (${p.id}: ${p.s.length})`);
    if (!/[.!?…»"]$/.test(p.s)) hard.push(`${pack.authorId}: phrase sans ponctuation finale (${p.id})`);
    if (!/^[A-ZÀ-ÖØ-Þ«"“„¿¡0-9(\[]/.test(p.s)) hard.push(`${pack.authorId}: début de phrase suspect (${p.id})`);
    if (NOISE.test(p.s)) hard.push(`${pack.authorId}: bruit éditorial (${p.id})`);
    if (/\uFFFD/.test(p.s)) hard.push(`${pack.authorId}: caractère de remplacement (${p.id})`);
    const k = p.s.toLowerCase();
    if (seen.has(k)) hard.push(`${pack.authorId}: doublon (${p.id})`);
    seen.add(k);
    if (titles.size && titles.has(p.w)) matchedWorks += 1;
  }
  if (titles.size && matchedWorks === 0 && passages.length) warn.push(`${pack.authorId}: aucune œuvre ne correspond au catalogue (titres inattendus)`);
  if (passages.length && passages.length < 18) warn.push(`${pack.authorId}: peu de phrases (${passages.length} < 18)`);
  if ((pack.formulas || []).length < 8) warn.push(`${pack.authorId}: peu de formules (${(pack.formulas || []).length})`);
  return { hard, warn };
}

export function checkOutputs({ mirror = MIRROR_DIR } = {}) {
  const manifest = readJSON(join(mirror, "kb-manifest.json"));
  const corpus = readJSON(join(mirror, "corpus.json"));
  const hard = []; const warn = []; const authors = [];
  if (!manifest) hard.push("kb-manifest.json manquant ou illisible");
  if (!corpus) hard.push("corpus.json manquant ou illisible");
  if (!manifest || !corpus) return { hard, warn, authors };
  for (const [authorId, info] of Object.entries(manifest.authors || {})) {
    const pack = readJSON(join(mirror, info.pack || `kb/${authorId}.json`));
    if (!pack) { hard.push(`${authorId}: pack illisible`); continue; }
    const v = validatePack(pack);
    hard.push(...v.hard); warn.push(...v.warn);
    const inCorpus = Array.isArray(corpus[authorId]) ? corpus[authorId].length : 0;
    if (inCorpus !== pack.passages.length) warn.push(`${authorId}: corpus (${inCorpus}) ≠ pack (${pack.passages.length})`);
    authors.push({ authorId, sentences: pack.passages.length, formulas: pack.formulas.length, ok: v.hard.length === 0 });
  }
  return { hard, warn, authors };
}

/* ------------------------------------------------------------------- main */

async function main() {
  const args = parseArgs();
  const mirror = MIRROR_DIR;

  if (args.check) {
    const { hard, warn, authors } = checkOutputs({ mirror });
    console.log(`→ Vérification des packs statiques (${authors.length} auteurs)`);
    for (const w of warn.slice(0, 30)) console.log(`  ⚠ ${w}`);
    for (const h of hard.slice(0, 40)) console.log(`  ✗ ${h}`);
    console.log(`\n${hard.length ? "✗" : "✓"} ${authors.length} packs — ${hard.length} erreur(s), ${warn.length} avertissement(s).`);
    if (hard.length) process.exit(1);
    return;
  }

  const catalog = loadCatalog();
  const map = loadKbMap();
  const fromCorpus = Boolean(args["from-corpus"]);
  const corpusPath = join(mirror, "corpus.json");
  const previousCorpus = readJSON(corpusPath, {});
  const authorIds = args.author ? [String(args.author)]
    : (fromCorpus ? Object.keys(previousCorpus) : Object.keys(map.authors));

  const built = {};
  const worksStats = {};
  for (const id of authorIds) {
    const author = catalog.authors.find((a) => a.id === id);
    let entries = null; let source = "openkb"; let kbVersion = (map.authors[id] || {}).kbVersion || `${id}@local`;
    if (fromCorpus) {
      entries = loadCorpusEntries(previousCorpus, id);
      source = "bootstrap-corpus";
      kbVersion = (map.authors[id] || {}).kbVersion || `${id}@bootstrap-${nowIso().slice(0, 10)}`;
    } else {
      entries = loadKbEntries(id, { root: args.root ? String(args.root) : kbRoot(), map });
    }
    if (!entries || !entries.length) { console.log(`  · ${id} : rien à exporter (ignoré)`); continue; }
    const titleByWork = new Map();
    for (const e of entries) titleByWork.set(e.w, (titleByWork.get(e.w) || 0) + 1);
    worksStats[id] = [...titleByWork.entries()].map(([title, sentences]) => ({ title, sentences }));
    const pack = buildPack({ authorId: id, entries, source, kbVersion, worksStats: worksStats[id] });
    const v = validatePack(pack, { catalogAuthor: author });
    if (v.hard.length) {
      console.error(`  ✗ ${id} : pack invalide —\n    ${v.hard.slice(0, 6).join("\n    ")}`);
      process.exitCode = 1;
      continue;
    }
    for (const w of v.warn.slice(0, 3)) console.log(`  ⚠ ${w}`);
    built[id] = pack;
    if (!args["dry-run"]) {
      writeJSON(join(mirror, "kb", `${id}.json`), pack);
      const m = map.authors[id] || (map.authors[id] = { kb: `salon-${id}`, works: [] });
      m.pack = { path: `kb/${id}.json`, builtAt: pack.builtAt, sentences: pack.stats.sentences, formulas: pack.stats.formulas, checksum: pack.checksum };
      m.kbVersion = kbVersion;
    }
    console.log(`  ✓ ${id} : ${pack.stats.sentences} phrases, ${pack.stats.formulas} formules (${source})`);
  }

  if (!Object.keys(built).length) { console.log("Rien à publier."); return; }

  const mergedCorpus = { ...previousCorpus };
  for (const [id, pack] of Object.entries(built)) {
    // Projection légère pour le chargement navigateur : {id, w, s}.
    // La provenance complète vit dans kb/<auteur>.json (packs).
    mergedCorpus[id] = pack.passages.map((p) => ({ id: p.id, w: p.w, s: p.s }));
  }
  const formulasAgg = {
    generatedAt: nowIso(),
    generator: "salon/scripts/kb_export.mjs",
    authors: Object.fromEntries(Object.entries(built).map(([id, p]) => [id, { kbVersion: p.kbVersion, formulas: p.formulas }])),
  };
  const manifest = readJSON(join(mirror, "kb-manifest.json"), { authors: {}, totals: {} });
  let mAuthors = { ...(manifest.authors || {}) };
  if (fromCorpus) mAuthors = {};
  for (const [id, pack] of Object.entries(built)) {
    mAuthors[id] = { kbVersion: pack.kbVersion, pack: `kb/${id}.json`, sentences: pack.stats.sentences, formulas: pack.stats.formulas, checksum: pack.checksum, builtAt: pack.builtAt };
  }
  const totals = Object.values(mAuthors).reduce((acc, a) => ({
    authors: acc.authors + 1, sentences: acc.sentences + a.sentences, formulas: acc.formulas + a.formulas,
  }), { authors: 0, sentences: 0, formulas: 0 });
  const nextManifest = {
    generatedAt: nowIso(),
    generator: "salon/scripts/kb_export.mjs",
    source: fromCorpus ? "bootstrap-corpus" : "openkb",
    totals,
    authors: mAuthors,
  };

  if (!args["dry-run"]) {
    writeJSON(corpusPath, mergedCorpus);
    writeJSON(join(mirror, "formulas.json"), formulasAgg);
    writeJSON(join(mirror, "kb-manifest.json"), nextManifest);
    saveKbMap(map);
  }
  console.log(`\n✓ ${Object.keys(built).length} pack(s) publié(s) — ${totals.sentences} phrases, ${totals.formulas} formules au total.`);
  console.log(`  → ${join(mirror, "kb")}/ · corpus.json · formulas.json · kb-manifest.json`);
}

if (process.argv[1] && process.argv[1].endsWith("kb_export.mjs")) {
  main().catch((e) => { console.error(`ERREUR: ${e.message}`); process.exit(1); });
}
