import { emptySalonState } from '../lib/salon-state.mjs';
import { z } from 'zod';

export default async function salonRoutes(app) {
  app.get('/v1/salon/state', async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    const store = app.kayrosContext.salonState;
    if (!store) return reply.code(503).send({ error: 'salon indisponible' });
    const state = (await store.get(me.sub)) || emptySalonState();
    return { state };
  });

  app.put('/v1/salon/state', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    const store = app.kayrosContext.salonState;
    if (!store) return reply.code(503).send({ error: 'salon indisponible' });
    const incoming = req.body?.state ?? req.body;
    try {
      const state = await store.put(me.sub, incoming);
      return { ok: true, state };
    } catch (error) {
      if (error.code === 'SALON_TOO_LARGE') return reply.code(413).send({ error: error.message });
      if (error.code === 'SALON_USER') return reply.code(400).send({ error: error.message });
      return reply.code(400).send({ error: error.message });
    }
  });

  /* Relais texte Gutenberg (import d'auteur du domaine public).
   * Les .txt de gutenberg.org n'envoient pas d'en-tête CORS : le navigateur
   * ne peut pas les lire en direct. Ce relais lit le texte côté serveur et
   * le renvoie borné (défaut 200 Ko, max 1 Mo), avec cache mémoire 6 h. */
  const gutenbergCache = new Map();
  const GUTENBERG_CACHE_MS = 6 * 60 * 60 * 1000;
  const GUTENBERG_CACHE_MAX = 120;

  app.get('/v1/salon/gutenberg/text', {
    config: { rateLimit: { max: 90, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const id = String(req.query?.id || '').trim();
    if (!/^\d{1,7}$/.test(id)) return reply.code(400).send({ ok: false, error: 'id invalide' });
    const max = Math.min(Math.max(Number(req.query?.max) || 200000, 2000), 1000000);
    const now = Date.now();
    const hit = gutenbergCache.get(id);
    if (hit && now - hit.at < GUTENBERG_CACHE_MS) {
      return { ok: true, id, cached: true, text: hit.text.slice(0, max) };
    }
    const urls = [
      `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
      `https://www.gutenberg.org/cache/epub/${id}/pg${id}-0.txt`,
      `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
    ];
    let text = null; let from = null;
    for (const url of urls) {
      try {
        const r = await fetch(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(20000),
          headers: { 'user-agent': 'KayrosLab-Salon/1.0 (import auteur, domaine public)' },
        });
        if (!r.ok) continue;
        const t = await r.text();
        if (t && t.length > 500 && !/^\s*<!DOCTYPE html/i.test(t)) { text = t; from = url; break; }
      } catch { /* essaie l'URL suivante */ }
    }
    if (!text) return reply.code(502).send({ ok: false, error: 'texte introuvable' });
    if (gutenbergCache.size >= GUTENBERG_CACHE_MAX) {
      const oldest = [...gutenbergCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) gutenbergCache.delete(oldest[0]);
    }
    gutenbergCache.set(id, { at: now, text });
    return { ok: true, id, from, text: text.slice(0, max) };
  });

  /* Traduction fr<->en (Salon) : les citations du domaine public doivent
   * s'afficher dans la langue choisie. Traductions côté serveur (LLM),
   * cache mémoire borné ; une chaîne déjà dans la langue cible passe telle
   * quelle. POST { to: 'fr'|'en', texts: string[] } -> { translations: [] }. */
  const translateCache = new Map();
  const TRANSLATE_CACHE_MAX = 4000;
  const translateBody = z.object({
    to: z.enum(['fr', 'en']),
    texts: z.array(z.string().min(1).max(4000)).min(1).max(24),
  });

  function classifyLikelyLang(t) {
    const s = String(t || '');
    const fr = (s.match(/[àâçéèêëîïôùûüÿœ]/gi) || []).length * 3
      + (s.match(/\b(le|la|les|des|une?|est|nous|vous|dans|pour|qui|que|pas)\b/gi) || []).length;
    const en = (s.match(/\b(the|of|and|to|in|that|is|it|with|for|as|not)\b/gi) || []).length;
    return fr > en ? 'fr' : 'en';
  }

  function normalizeTranslation(s) {
    let t = String(s || '').trim();
    if (!t) return null;
    t = t.charAt(0).toUpperCase() + t.slice(1);
    if (!/[.!?…»"”)]$/.test(t)) t += '.';
    return t;
  }

  async function translateBatchWithLlm(llm, texts, to) {
    const label = to === 'fr' ? 'French' : 'English';
    const system = `You are a careful literary translator. Translate each item of the JSON array into ${label}. Keep the meaning, the tone and the punctuation faithful; keep proper nouns. Reply with ONLY a JSON array of strings, same length and same order, no commentary, no code fence.`;
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(texts) },
    ];
    const parse = (raw) => {
      const t = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/,'').trim();
      try {
        const arr = JSON.parse(t);
        if (Array.isArray(arr) && arr.length === texts.length) {
          return arr.map((x) => (typeof x === 'string' ? normalizeTranslation(x) : null));
        }
      } catch { /* essai suivant */ }
      return null;
    };
    try {
      const r = await llm.complete({ messages, temperature: 0.2, role: 'salon-translate' });
      const arr = parse(r && r.text);
      if (arr) return arr;
    } catch { /* repli un-par-un */ }
    // Repli : un appel par item (borné) — le lot entier est rarement cassé.
    const out = texts.map(() => null);
    const cap = Math.min(texts.length, 6);
    for (let i = 0; i < cap; i++) {
      try {
        const r = await llm.complete({
          messages: [
            { role: 'system', content: `Translate into ${label}. Reply with ONLY the translation, no commentary.` },
            { role: 'user', content: texts[i] },
          ],
          temperature: 0.2,
          role: 'salon-translate',
        });
        out[i] = normalizeTranslation(r && r.text);
      } catch { /* laisse null */ }
    }
    return out;
  }

  app.post('/v1/salon/translate', {
    config: { rateLimit: { max: 90, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = translateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'texts et to requis', issues: parsed.error.issues });
    const { to, texts } = parsed.data;
    const out = new Array(texts.length).fill(null);
    const needIdx = [];
    const needTexts = [];
    texts.forEach((raw, i) => {
      const t = String(raw || '').trim();
      const key = to + '::' + t;
      const hit = translateCache.get(key);
      if (hit) { out[i] = hit; return; }
      if (classifyLikelyLang(t) === to) { translateCache.set(key, t); out[i] = t; return; }
      needIdx.push(i);
      needTexts.push(t);
    });
    let failed = 0;
    if (needTexts.length) {
      const llm = app.kayrosContext.llm;
      if (!llm || !llm.complete) { needIdx.forEach((idx, k) => { out[idx] = needTexts[k]; }); failed = needTexts.length; }
      else {
        const translated = await translateBatchWithLlm(llm, needTexts, to);
        needIdx.forEach((idx, k) => {
          const tr = translated[k];
          if (tr) { out[idx] = tr; translateCache.set(to + '::' + needTexts[k], tr); }
          else { out[idx] = needTexts[k]; failed += 1; }
        });
      }
    }
    while (translateCache.size > TRANSLATE_CACHE_MAX) {
      const first = translateCache.keys().next().value;
      translateCache.delete(first);
    }
    return { ok: true, to, translations: out, failed };
  });
}
