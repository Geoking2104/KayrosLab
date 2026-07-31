// KayrosLab — L3 relevance scoring inside an allowed scope set.

import { cosine } from './memory.mjs';

/** Tokenize for lightweight lexical overlap (FR/EN tolerant). */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z0-9àâäéèêëïîôùûüç]+/i)
    .filter((t) => t.length > 2);
}

/**
 * Lexical score in [0, 1]: fraction of query tokens found in title+content.
 * @param {string} query
 * @param {{ title?: string, content?: string, kind?: string }} core
 */
export function lexicalScore(query, core) {
  const q = tokenize(query);
  if (!q.length) return 0;
  const hay = tokenize(`${core.title || ''} ${core.content || ''} ${core.kind || ''}`);
  if (!hay.length) return 0;
  const set = new Set(hay);
  let hit = 0;
  for (const t of q) if (set.has(t)) hit++;
  return hit / q.length;
}

/**
 * Rank cores by relevance to query.
 * Prefer embedding cosine when both sides have vectors; else lexical.
 * Stable: higher score first, then original order.
 *
 * @param {Array} cores
 * @param {string} query
 * @param {{ queryEmbedding?: number[]|null, k?: number }} [opts]
 */
export function rankCores(cores, query, { queryEmbedding = null, k = Infinity } = {}) {
  if (!Array.isArray(cores) || !cores.length) return [];
  const scored = cores.map((c, i) => {
    let score = lexicalScore(query, c);
    if (queryEmbedding && Array.isArray(c.embedding) && c.embedding.length) {
      const cos = cosine(queryEmbedding, c.embedding);
      // Blend: embedding dominant when present
      score = 0.35 * score + 0.65 * Math.max(0, cos);
    }
    return { core: c, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, k).map((s) => ({ ...s.core, score: s.score }));
}

/** Does an L3 entry belong to tenant (direct tenant scope or nested under tenant id match). */
export function l3BelongsToTenant(core, tenantId) {
  if (!tenantId || !core) return true;
  if (core.scope === 'tenant') return core.scopeId === tenantId;
  // Nested scopes may carry tenantId field if present
  if (core.tenantId) return core.tenantId === tenantId;
  // Without tenant annotation on user/team cores, include only when explicitly filtered by scopes
  return false;
}

/** L1 belongs to tenant when tenantId matches (default tenant allowed). */
export function l1BelongsToTenant(fact, tenantId) {
  if (!tenantId) return true;
  const t = fact.tenantId ?? 'default';
  return t === tenantId;
}
