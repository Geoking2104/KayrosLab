import { emptySalonState } from '../lib/salon-state.mjs';

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
}
