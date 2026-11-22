#!/usr/bin/env node
/**
 * speech_eval.mjs — tests de qualité de parole AVANT publication.
 *
 * Deux niveaux :
 *   A. Actifs (toujours) : mémoire, bornes de phrases, provenance, doublons,
 *      formules verbatim, couverture doctrinale, langue, diversité des voix,
 *      et composition déterministe d'un tour par question du jeu d'or.
 *   B. Modèle réel (option --llm, si SALON_LLM_URL ou XAI_API_KEY) : génère
 *      des tours et applique le même contrat (citation vérifiée, longueur,
 *      destinataire, anachronismes).
 *
 * Sortie : salon/scripts/reports/speech-eval-<date>.{json,md}
 * Code de sortie 1 si un seuil dur n'est pas atteint — le portail refuse alors
 * de publier.
 *
 * Usage :
 *   node salon/scripts/speech_eval.mjs --mirror backend/web/public/salon
 *   node salon/scripts/speech_eval.mjs --golden-per-author 3 --llm
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CATALOG_FILE, MIRROR_DIR, REPORTS_DIR, REPO, nowIso, parseArgs, readJSON, writeJSON,
} from './openkb_common.mjs';
import { splitSentences, canonical, checkTurn, composeTurn, goldenQuestions, voiceVector, voiceDistance, contentWords, wordCount } from './quality_lib.mjs';
import { sample } from './textlib.mjs';

const args = parseArgs();
const MIRROR = args.mirror ? resolve(String(args.mirror)) : MIRROR_DIR;
const REPORT_JSON = join(REPORTS_DIR, `speech-eval-${nowIso().slice(0, 10)}.json`);
const REPORT_MD = join(REPORTS_DIR, `speech-eval-${nowIso().slice(0, 10)}.md`);

const TH = {
  minSentences: args['min-sentences'] ? Number(args['min-sentences']) : 120,
  minCoverage: args['min-coverage'] ? Number(args['min-coverage']) : 0.95,
  minTurnPass: args['min-turn-pass'] ? Number(args['min-turn-pass']) : 0.98,
  minDoctrine: args['min-doctrine'] ? Number(args['min-doctrine']) : 0.8,
  minLang: args['min-lang'] ? Number(args['min-lang']) : 0.8,
  minVoice: args['min-voice-distance'] ? Number(args['min-voice-distance']) : 0.12,
  golden: args['golden-per-author'] ? Number(args['golden-per-author']) : 2,
  llm: Boolean(args.llm),
};

const catalog = readJSON(CATALOG_FILE);
const doctrine = readJSON(join(REPO, 'salon', 'src', 'lib', 'salon', 'doctrine.json'), {});
const manifest = readJSON(join(MIRROR, 'kb-manifest.json'));
const corpus = readJSON(join(MIRROR, 'corpus.json'), {});

if (!catalog || !Array.isArray(catalog.authors)) {
  console.error('catalog.json illisible'); process.exit(1);
}
if (!manifest) {
  console.error(`kb-manifest.json absent dans ${MIRROR} — rien à évaluer.`);
  process.exit(1);
}

const fails = [];
const warns = [];
const perAuthor = [];
const packs = new Map();

for (const [id, info] of Object.entries(manifest.authors || {})) {
  const pack = readJSON(join(MIRROR, (info.pack || `kb/${id}.json`)));
  if (!pack) { fails.push(`${id}: pack illisible`); continue; }
  packs.set(id, pack);
}

// A1. Couverture
const catalogAuthors = catalog.authors.filter((a) => (a.works || []).length >= 1);
const covered = catalogAuthors.filter((a) => packs.has(a.id));
const coverage = catalogAuthors.length ? covered.length / catalogAuthors.length : 0;
if (coverage < TH.minCoverage) fails.push(`couverture ${(coverage * 100).toFixed(1)}% < ${(TH.minCoverage * 100)}% (${covered.length}/${catalogAuthors.length})`);

const checksums = new Map();
let totalSentences = 0;

for (const author of catalogAuthors) {
  const pack = packs.get(author.id);
  if (!pack) continue;
  const passages = pack.passages || [];
  totalSentences += passages.length;
  const uniqueWorks = new Set(passages.map((p) => p.w)).size;
  const minForAuthor = uniqueWorks <= 1 ? Math.min(TH.minSentences, 70) : TH.minSentences;
  const row = {
    id: author.id,
    name: author.name,
    lang: author.lang,
    sentences: passages.length,
    formulas: (pack.formulas || []).length,
    works: new Set(passages.map((p) => p.w)).size,
    errors: [],
    warnings: [],
  };
  if (passages.length < minForAuthor) row.errors.push(`${passages.length} phrases < ${minForAuthor}`);
  if (!row.works) row.errors.push('aucune œuvre');

  // A2. Bornes, ponctuation, bruit, doublons
  const seen = new Set();
  let langOk = 0;
  for (const p of passages) {
    const s = String(p.s || '');
    if (s.length < 40 || s.length > 320) row.errors.push(`longueur hors bornes (${p.id}: ${s.length})`);
    if (!/[.!?…»"]$/.test(s)) row.errors.push(`phrase non close (${p.id})`);
    if (!/^[A-ZÀ-ÖØ-Þ«"“„0-9(\[]/.test(s)) row.errors.push(`début suspect (${p.id})`);
    if (/project gutenberg|gutenberg\.org|isbn|table of contents/i.test(s)) row.errors.push(`bruit (${p.id})`);
    const k = canonical(s);
    if (seen.has(k)) row.errors.push(`doublon (${p.id})`);
    seen.add(k);
    const fr = (s.match(/[àâçéèêëîïôùûüÿœ]/gi) || []).length * 3
      + (s.match(/\b(le|la|les|des|une?|est|et|que|qui|dans|pour|pas|plus|sur|avec|nous|vous|ils|elles|du|au|aux|ce|cette|son|sa|ses)\b/gi) || []).length;
    const en = (s.match(/\b(the|of|and|to|in|that|is|it|with|for|as|not|this|his|her|their)\b/gi) || []).length;
    // Seuls fr/en sont contrôlés : les auteurs latins/grecs/allemands sont lus
    // dans des traductions anglaises sur Gutenberg.
    const enforced = author.lang === 'fr' || author.lang === 'en';
    const lang = en === 0 && fr === 0 ? (author.lang || 'fr') : (fr >= en ? 'fr' : 'en');
    if (!enforced || lang === author.lang) langOk += 1;
  }
  if (passages.length && langOk / passages.length < TH.minLang) {
    row.warnings.push(`langue conforme ${(langOk / passages.length * 100).toFixed(0)}% < ${TH.minLang * 100}%`);
  }

  // A3. Formules verbatim : sous-chaîne d'une phrase du pack
  for (const f of (pack.formulas || [])) {
    if (f.kind !== 'verbatim') continue;
    if (!seen.has(canonical(f.text))) row.errors.push(`formule non attestée (${f.id})`);
  }

  // A4. Doctrine : ancres présentes
  const d = doctrine[author.id];
  if (d && d.theses) {
    const anchors = [];
    for (const demands of Object.values(d.theses)) {
      for (const t of Object.values(demands || {})) {
        for (const a of (t && t.anchors) || []) if (a && a.startsWith) anchors.push(a);
      }
    }
    if (anchors.length) {
      let found = 0;
      for (const a of anchors) {
        const stem = canonical(a.startsWith);
        if (passages.some((p) => canonical(p.s).includes(stem.slice(0, Math.min(60, stem.length))))) found += 1;
      }
      const ratio = found / anchors.length;
      row.doctrine = { anchors: anchors.length, found, ratio };
      if (ratio < TH.minDoctrine) row.warnings.push(`ancres doctrinales ${(ratio * 100).toFixed(0)}% < ${TH.minDoctrine * 100}%`);
    }
  }

  // A5. Voix : vecteur de style + détection de packs identiques
  row.voice = voiceVector(passages.map((p) => p.s));
  const ck = pack.checksum;
  if (ck) {
    if (checksums.has(ck)) row.errors.push(`pack identique à ${checksums.get(ck)} (checksum)`);
    else checksums.set(ck, author.id);
  }

  // A6. Tours déterministes sur le jeu d'or
  const questions = goldenQuestions(author, doctrine).slice(0, Math.max(2, TH.golden));
  const turns = [];
  for (const q of questions) {
    const composed = composeTurn({
      author,
      question: q.question,
      sentences: passages.map((p) => ({ w: p.w, s: p.s })),
      act: 'reponse',
      toName: "l’hôte",
      method: author.id === 'platon' || author.id === 'socrate' ? 'elenchus' : 'rhetorique',
    });
    const verdict = checkTurn({
      text: composed.text,
      author,
      toName: "l’hôte",
      sources: passages.map((p) => p.s),
      passages: [{ work: composed.work, text: composed.quote }],
      minWords: 40,
    });
    turns.push({ question: q.question, ok: verdict.ok, errors: verdict.errors, words: verdict.words, citations: verdict.citations.length });
    if (!verdict.ok) row.errors.push(`tour hors contrat (${q.question.slice(0, 40)}…): ${verdict.errors.slice(0, 2).join(' ; ')}`);
  }
  row.turnPass = turns.filter((t) => t.ok).length / Math.max(turns.length, 1);
  row.turns = turns;

  for (const w of row.warnings) warns.push(`${author.id}: ${w}`);
  if (row.errors.length) fails.push(`${author.id}: ${row.errors.length} erreur(s) — ${row.errors.slice(0, 3).join(' ; ')}`);
  perAuthor.push(row);
}

// A7. Diversité des voix (paires de même langue)
const byLang = new Map();
for (const row of perAuthor) {
  if (!row.voice || row.sentences < 40) continue;
  const l = row.lang || 'fr';
  if (!byLang.has(l)) byLang.set(l, []);
  byLang.get(l).push(row);
}
const distances = [];
for (const [lang, rows] of byLang) {
  const subset = rows.length > 12 ? sample(rows, 12) : rows;
  for (let i = 0; i < subset.length; i += 1) {
    for (let j = i + 1; j < subset.length; j += 1) {
      distances.push({ a: subset[i].id, b: subset[j].id, lang, d: voiceDistance(subset[i].voice, subset[j].voice) });
    }
  }
}
const meanDistance = distances.length ? distances.reduce((s, x) => s + x.d, 0) / distances.length : 1;
if (distances.length && meanDistance < TH.minVoice) {
  fails.push(`voix trop proches : distance moyenne ${meanDistance.toFixed(3)} < ${TH.minVoice}`);
}

// B. Mode modèle réel (optionnel)
const llmResults = [];
if (TH.llm) {
  const proxy = process.env.SALON_LLM_URL || process.env.KAYROS_LLM_URL;
  const key = process.env.XAI_API_KEY;
  if (!proxy && !key) {
    warns.push('--llm demandé mais aucun fournisseur configuré (SALON_LLM_URL / XAI_API_KEY)');
  } else {
    for (const row of perAuthor.slice(0, Number(args['llm-authors'] || 4))) {
      const author = catalog.authors.find((a) => a.id === row.id);
      const pack = packs.get(row.id);
      const passages = sample(pack.passages, 5);
      const persona = [
        `Tu incarnes ${author.name} (${author.era}), ${author.kind}. ${author.blurb}`,
        `Œuvres : ${author.works.map((w) => `« ${w.title} »`).join(' ; ')}.`,
        author.samples && author.samples.length ? `Voix : ${author.samples.map((s) => `« ${s} »`).join(' ')}` : '',
        "N'invente ni citation ni œuvre. Cite une phrase entière des passages, entre guillemets.",
      ].filter(Boolean).join('\n');
      const q = goldenQuestions(author, doctrine)[0].question;
      const messages = [
        { role: 'system', content: persona },
        { role: 'user', content: `Question de table : ${q}\n\nPassages :\n${passages.map((p) => `« ${p.w} »\n${p.s}`).join('\n\n')}\n\nRéponds au format PRISE/REPLIQUE, 90–170 mots.` },
      ];
      try {
        const res = proxy
          ? await fetch(proxy, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, temperature: 0.4, role: 'salon-eval' }), signal: AbortSignal.timeout(60000) })
          : await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model: process.env.SALON_MODEL || 'grok-4.5', max_tokens: 900, temperature: 0.4, messages }), signal: AbortSignal.timeout(60000) });
        const body = await res.json();
        const raw = (proxy ? body.text : body.choices?.[0]?.message?.content) || '';
        const text = String(raw).replace(/^[\s\S]*?REPLIQUE\s*:\s*/i, '').trim();
        const verdict = checkTurn({ text, author, toName: "l’hôte", sources: passages.map((p) => p.s), passages, minWords: 80 });
        llmResults.push({ author: author.id, ok: verdict.ok, errors: verdict.errors, words: verdict.words, citations: verdict.citations.length });
        if (!verdict.ok) warns.push(`LLM ${author.id}: ${verdict.errors.slice(0, 2).join(' ; ')}`);
      } catch (e) {
        warns.push(`LLM ${author.id}: échec ${e.message}`);
      }
    }
  }
}

// Rapport
const totalAuthors = perAuthor.length;
const totalWorks = perAuthor.reduce((s, r) => s + r.works, 0);
const median = (arr) => {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};
const summary = {
  at: nowIso(),
  mirror: MIRROR,
  thresholds: TH,
  totals: {
    authors: totalAuthors,
    works: totalWorks,
    sentences: totalSentences,
    medianSentences: median(perAuthor.map((r) => r.sentences)),
    minSentences: Math.min(...perAuthor.map((r) => r.sentences)),
    maxSentences: Math.max(...perAuthor.map((r) => r.sentences)),
    coverage: Number(coverage.toFixed(3)),
    meanVoiceDistance: Number(meanDistance.toFixed(3)),
  },
  turnPass: totalAuthors ? perAuthor.reduce((s, r) => s + r.turnPass, 0) / totalAuthors : 0,
  llm: llmResults,
  failures: fails,
  warnings: warns,
  authors: perAuthor.map((r) => ({
    id: r.id, name: r.name, lang: r.lang, sentences: r.sentences, works: r.works, formulas: r.formulas,
    doctrine: r.doctrine, turnPass: r.turnPass, errors: r.errors,
  })),
};

writeJSON(REPORT_JSON, summary);

const md = [
  '# Tests de qualité de parole — Salon',
  '',
  `- Date : ${summary.at}`,
  `- Source : \`${MIRROR}\``,
  `- Auteurs : **${totalAuthors}** · œuvres : **${totalWorks}** · phrases : **${totalSentences}**`,
  `- Phrases/auteur : médiane **${summary.totals.medianSentences}**, min **${summary.totals.minSentences}**, max **${summary.totals.maxSentences}**`,
  `- Couverture : **${(coverage * 100).toFixed(1)} %** · tours conformes : **${(summary.turnPass * 100).toFixed(1)} %** · distance des voix : **${meanDistance.toFixed(3)}**`,
  '',
  fails.length ? `## ✗ ${fails.length} échec(s)` : '## ✓ Aucun échec dur',
  ...fails.slice(0, 40).map((f) => `- ${f}`),
  '',
  warns.length ? `## ⚠ ${warns.length} avertissement(s)` : '',
  ...warns.slice(0, 20).map((w) => `- ${w}`),
  '',
  '## Détail par auteur',
  '',
  '| auteur | phrases | œuvres | formules | ancres | tours | erreurs |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...perAuthor.map((r) => `| ${r.name} | ${r.sentences} | ${r.works} | ${r.formulas} | ${r.doctrine ? (r.doctrine.ratio * 100).toFixed(0) + '%' : '—'} | ${(r.turnPass * 100).toFixed(0)}% | ${r.errors.length} |`),
].join('\n');
writeFileSync(REPORT_MD, md, 'utf8');

console.log(`Auteurs ${totalAuthors} · phrases ${totalSentences} · couverture ${(coverage * 100).toFixed(1)}% · tours ${(summary.turnPass * 100).toFixed(1)}% · voix ${meanDistance.toFixed(3)}`);
if (fails.length) {
  console.error(`✗ ${fails.length} échec(s) :`);
  for (const f of fails.slice(0, 12)) console.error('  - ' + f);
  console.error(`rapport : ${REPORT_MD}`);
  process.exit(1);
}
console.log(`✓ tests de qualité de parole verts — rapport : ${REPORT_MD}`);
