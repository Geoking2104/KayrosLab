/**
 * Salon × OpenKB — pont mémoire contextuelle (serveur).
 *
 * Référence : docs/SALON-OPENKB.md (§7 contexte & cohérence, §9 interfaces).
 *
 * Le pont lit les packs statiques (`backend/web/public/salon/kb/<auteur>.json`,
 * projections des bases OpenKB) et, en mode `answer`, interroge le service
 * OpenKB local (REST, loopback) pour une synthèse ancrée. Il ne contacte jamais
 * un auteur hors de son pack, ne dépasse jamais son budget de temps, met en
 * cache les réponses et ouvre un disjoncteur après N échecs.
 *
 * Le repli (packs → moteur déterministe) reste entièrement côté Salon : le pont
 * est une amélioration, jamais une dépendance.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PACK_DIR = fileURLToPath(new URL('../../web/public/salon/', import.meta.url));

const STOP = new Set([
  'dans', 'cette', 'avec', 'pour', 'plus', 'tout', 'tous', 'leur', 'leurs',
  'comme', 'mais', 'donc', 'alors', 'ainsi', 'sans', 'sous', 'entre',
  'apres', 'avant', 'encore', 'aussi', 'bien', 'tres', 'fait', 'faire',
  'etre', 'avoir', 'cela', 'ceux', 'celles', 'nous', 'vous', 'elle', 'elles',
  'that', 'this', 'with', 'from', 'have', 'been', 'were', 'which',
  'their', 'there', 'about', 'would', 'could', 'should', 'the', 'and',
]);

export function normWords(text) {
  return (String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z][a-z'-]+/g) || [])
    .map((w) => w.replace(/['-]/g, ''))
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

export function relevance(query, text) {
  const q = new Set(normWords(query));
  if (!q.size) return 0;
  const words = normWords(text);
  if (!words.length) return 0;
  let hit = 0;
  for (const w of words) if (q.has(w)) hit += 1;
  return hit / Math.sqrt(q.size * Math.max(words.length, 8));
}

/** Requête conditionnée par le contexte (question de table, dernier tour, acte, tweet). */
export function buildKbQuery({ question, context = {} } = {}) {
  const lines = [];
  lines.push(`[Question de table] « ${String(question || '').trim()} »`);
  const turns = Array.isArray(context.turns) ? context.turns : [];
  const last = turns.length ? turns[turns.length - 1] : null;
  if (last && (last.prise || last.text)) {
    lines.push(`[Point à traiter] ${last.name || 'un convive'} soutient : « ${String(last.prise || last.text).slice(0, 240)} »`);
  }
  if (context.act) lines.push(`[Acte] ${context.act}${context.toName ? ` vers ${context.toName}` : ''}`);
  if (context.tweet) lines.push(`[Gazette] « ${String(context.tweet).slice(0, 280)} »`);
  lines.push("Objectif : (1) les passages qui répondent à ce point, dans l'union des œuvres de l'auteur ; (2) les formules verbatim candidates ; (3) sinon, l'aveu du manque.");
  return lines.join('\n');
}

export function createSalonKb(options = {}) {
  const state = {
    packCache: new Map(),
    corpus: null,
    corpusMtime: 0,
    cache: new Map(),
    failures: 0,
    openUntil: 0,
  };

  const cfg = () => ({
    packDir: options.packDir || process.env.SALON_KB_PACK_DIR || DEFAULT_PACK_DIR,
    baseUrl: options.baseUrl || process.env.OPENKB_URL || 'http://127.0.0.1:7566',
    token: options.token !== undefined ? options.token : (process.env.OPENKB_API_TOKEN || ''),
    timeoutMs: options.timeoutMs !== undefined ? options.timeoutMs : Number(process.env.SALON_KB_TIMEOUT_MS || 6000),
    cacheTtlMs: options.cacheTtlMs !== undefined ? options.cacheTtlMs : Number(process.env.SALON_KB_CACHE_MS || 10 * 60 * 1000),
    breakerThreshold: options.breakerThreshold !== undefined ? options.breakerThreshold : 3,
    breakerCooldownMs: options.breakerCooldownMs !== undefined ? options.breakerCooldownMs : 60 * 1000,
  });
  const fetchImpl = () => options.fetchImpl || globalThis.fetch;
  const clock = () => (options.now ? options.now() : Date.now());

  function loadPack(authorId) {
    const { packDir } = cfg();
    const file = join(packDir, 'kb', `${authorId}.json`);
    try {
      const st = statSync(file);
      const hit = state.packCache.get(authorId);
      if (hit && hit.mtimeMs === st.mtimeMs) return hit.pack;
      const pack = JSON.parse(readFileSync(file, 'utf8'));
      state.packCache.set(authorId, { mtimeMs: st.mtimeMs, pack });
      return pack;
    } catch { /* projection corpus ci-dessous */ }
    try {
      const cfile = join(packDir, 'corpus.json');
      const st = statSync(cfile);
      if (state.corpusMtime !== st.mtimeMs) {
        state.corpus = JSON.parse(readFileSync(cfile, 'utf8'));
        state.corpusMtime = st.mtimeMs;
      }
      const list = state.corpus && state.corpus[authorId];
      if (Array.isArray(list) && list.length) {
        return {
          authorId,
          kbVersion: `${authorId}@corpus`,
          source: 'corpus-projection',
          passages: list.map((e, i) => ({ id: e.id || `${authorId}.p${String(i + 1).padStart(4, '0')}`, w: e.w, s: e.s, src: e.src || { work: e.w } })),
          formulas: [],
          stats: { sentences: list.length, formulas: 0 },
        };
      }
    } catch { /* ignoré */ }
    return null;
  }

  function rankPassages(pack, queryText, k) {
    const ranked = (pack.passages || [])
      .map((p, i) => ({
        id: p.id,
        work: p.w,
        sentence: p.s,
        src: p.src || { work: p.w },
        score: Math.round(relevance(queryText, `${p.w || ''} ${p.s || ''}`) * 1000) / 1000,
        i,
      }))
      .sort((a, b) => (b.score - a.score) || (a.i - b.i))
      .slice(0, Math.max(1, k));
    for (const p of ranked) { p.weak = p.score < 0.08; delete p.i; }
    return ranked;
  }

  function rankFormulas(pack, queryText, max = 2) {
    return (pack.formulas || [])
      .filter((f) => f.kind === 'verbatim')
      .map((f, i) => ({ f, i, score: relevance(queryText, `${f.work || ''} ${f.text || ''}`) }))
      .sort((a, b) => (b.score - a.score) || (a.i - b.i))
      .slice(0, max)
      .map((x) => ({ id: x.f.id, text: x.f.text, work: x.f.work, score: Math.round(x.score * 1000) / 1000 }));
  }

  function cacheKey(authorId, kbVersion, mode, question, context) {
    return createHash('sha1')
      .update([authorId, kbVersion, mode, String(question || '').trim(), JSON.stringify(context || {})].join('|'))
      .digest('hex');
  }

  function bumpFailure() {
    const c = cfg();
    state.failures += 1;
    if (state.failures >= c.breakerThreshold) {
      state.openUntil = clock() + c.breakerCooldownMs;
      state.failures = 0;
    }
  }

  async function answerMode(pack, authorId, queryText, k) {
    const c = cfg();
    if (clock() < state.openUntil) return { ok: false, degraded: 'circuit_open', message: 'pont en veille' };
    try {
      const res = await fetchImpl()(`${c.baseUrl.replace(/\/$/, '')}/api/v1/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(c.token ? { authorization: `Bearer ${c.token}` } : {}) },
        body: JSON.stringify({ kb: `salon-${authorId}`, question: queryText, stream: false, save: false }),
        signal: AbortSignal.timeout(c.timeoutMs),
      });
      if (!res.ok) { bumpFailure(); return { ok: false, degraded: `openkb_${res.status}`, message: `OpenKB ${res.status}` }; }
      const body = await res.json();
      state.failures = 0;
      return {
        ok: true,
        mode: 'answer',
        engine: 'openkb',
        kbVersion: pack.kbVersion || 'local',
        synthesis: String((body && body.answer) || '').trim() || null,
        passages: rankPassages(pack, queryText, k),
        formulas: rankFormulas(pack, queryText),
        degraded: null,
      };
    } catch (e) {
      bumpFailure();
      return { ok: false, degraded: 'unreachable', message: String((e && e.message) || e) };
    }
  }

  function retrievalMode(pack, queryText, k) {
    return {
      ok: true,
      mode: 'retrieval',
      engine: 'pack',
      kbVersion: pack.kbVersion || 'local',
      passages: rankPassages(pack, queryText, k),
      formulas: rankFormulas(pack, queryText),
      synthesis: null,
      degraded: null,
    };
  }

  async function query({ authorId, question, context = {}, mode = 'retrieval', k = 3 } = {}) {
    const started = clock();
    const traceId = 'tr_' + createHash('sha1').update(`${started}|${authorId}|${question}`).digest('hex').slice(0, 12);
    const { packDir } = cfg();
    const pack = loadPack(String(authorId || ''));
    if (!pack) return { ok: false, degraded: 'unknown_author', message: `pas de pack pour ${authorId} (${packDir})` };
    const queryText = buildKbQuery({ question, context });
    const kbVersion = pack.kbVersion || 'local';
    const key = cacheKey(authorId, kbVersion, mode, question, context);
    const hit = state.cache.get(key);
    if (hit && hit.until > clock()) {
      return { ...hit.value, cached: true, trace: { id: traceId, ms: clock() - started, engine: hit.value.engine, steps: ['cache'] } };
    }
    const result = mode === 'answer'
      ? await answerMode(pack, authorId, queryText, Number(k) || 3)
      : retrievalMode(pack, queryText, Number(k) || 3);
    result.trace = { id: traceId, ms: clock() - started, engine: result.engine || null, steps: mode === 'answer' ? ['build', 'openkb.query', 'rank'] : ['build', 'pack.rank'] };
    if (result.ok) state.cache.set(key, { value: result, until: clock() + cfg().cacheTtlMs });
    return result;
  }

  function manifest() {
    const { packDir } = cfg();
    try { return JSON.parse(readFileSync(join(packDir, 'kb-manifest.json'), 'utf8')); } catch { return null; }
  }

  function status(authorId) {
    const pack = loadPack(String(authorId || ''));
    if (!pack) return null;
    return {
      authorId: pack.authorId,
      kbVersion: pack.kbVersion || null,
      source: pack.source || null,
      builtAt: pack.builtAt || null,
      sentences: (pack.stats && pack.stats.sentences) || (pack.passages || []).length,
      formulas: (pack.stats && pack.stats.formulas) || (pack.formulas || []).length,
    };
  }

  return { query, manifest, status, buildKbQuery, relevance, _state: state };
}
