// KayrosLab — L3 relevance scoring inside an allowed scope set.

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Tokenize for lightweight lexical overlap (FR/EN tolerant). */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 2);
}

/**
 * Lexical score in [0, 1]: fraction of query tokens found in title+content.
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
 */
export function rankCores(cores, query, { queryEmbedding = null, k = Infinity } = {}) {
  if (!Array.isArray(cores) || !cores.length) return [];
  const scored = cores.map((c, i) => {
    let score = lexicalScore(query, c);
    if (queryEmbedding && Array.isArray(c.embedding) && c.embedding.length) {
      const cos = cosine(queryEmbedding, c.embedding);
      score = 0.35 * score + 0.65 * Math.max(0, cos);
    }
    return { core: c, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, k).map((s) => ({ ...s.core, score: s.score }));
}

export function l3BelongsToTenant(core, tenantId) {
  if (!tenantId || !core) return true;
  if (core.scope === 'tenant') return core.scopeId === tenantId;
  if (core.tenantId) return core.tenantId === tenantId;
  return false;
}

export function l1BelongsToTenant(fact, tenantId) {
  if (!tenantId) return true;
  const t = fact.tenantId ?? 'default';
  return t === tenantId;
}

export { cosine };
