// KayrosLab — Memoire : Shared Memory + Vector Memory (similarite cosinus).
// Ref. specs techniques §6 (EF-17/18). InMemory (P0/P1) ; Qdrant (P1/P2) meme interface.

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Memoire partagee par idee (faits, hypotheses, contributions). */
export class SharedMemory {
  constructor(ideaId) { this.ideaId = ideaId; this.facts = []; this.hypotheses = []; this.contributions = []; }
  addFact(actor, content, source) { this.facts.push({ id: globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random()), actor, content, source, ts: new Date().toISOString() }); return this; }
  addHypothesis(actor, content) { this.hypotheses.push({ actor, content, ts: new Date().toISOString() }); return this; }
  addContribution(c) { this.contributions.push({ ...c, ts: new Date().toISOString() }); return this; }
  snapshot() { return { ideaId: this.ideaId, facts: this.facts, hypotheses: this.hypotheses, contributions: this.contributions }; }
}

/**
 * Vector store en memoire — meme interface que Qdrant (upsert/search).
 * Filtrage optionnel par ideaId (EF-30 : isolation multi-idees).
 */
export class InMemoryVectorStore {
  constructor() { this._recs = new Map(); }
  async upsert({ id, ideaId, text, embedding }) {
    if (!id || !Array.isArray(embedding)) throw new Error('VectorRecord invalide (id + embedding requis)');
    this._recs.set(id, { id, ideaId, text, embedding });
  }
  async search(embedding, k = 5, { ideaId } = {}) {
    const out = [];
    for (const r of this._recs.values()) {
      if (ideaId && r.ideaId !== ideaId) continue;
      out.push({ id: r.id, ideaId: r.ideaId, text: r.text, score: cosine(embedding, r.embedding) });
    }
    out.sort((x, y) => y.score - x.score);
    return out.slice(0, k);
  }
  size() { return this._recs.size; }
}

/**
 * Vector store Qdrant (REST). Meme interface upsert/search que InMemoryVectorStore.
 * Note : Qdrant exige des ids entiers ou UUID pour les points.
 */
export class QdrantVectorStore {
  constructor({ url = 'http://localhost:6333', collection = 'kayroslab', dim = 768, apiKey, fetchImpl } = {}) {
    this.url = String(url).replace(/\/$/, ''); this.collection = collection; this.dim = dim; this.apiKey = apiKey; this._fetch = fetchImpl;
  }
  _f() {
    const f = this._fetch ?? (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) { const e = new Error('QdrantVectorStore: fetch indisponible'); e.code = 'NO_FETCH'; throw e; }
    return f;
  }
  _headers() { const h = { 'Content-Type': 'application/json' }; if (this.apiKey) h['api-key'] = this.apiKey; return h; }

  /** Cree la collection si besoin (distance cosinus). Idempotent cote Qdrant. */
  async ensureCollection() {
    const res = await this._f()(`${this.url}/collections/${this.collection}`, {
      method: 'PUT', headers: this._headers(),
      body: JSON.stringify({ vectors: { size: this.dim, distance: 'Cosine' } }),
    });
    return res.ok;
  }

  async upsert({ id, ideaId, text, embedding }) {
    if (id === undefined || id === null || !Array.isArray(embedding)) throw new Error('VectorRecord invalide (id + embedding requis)');
    const res = await this._f()(`${this.url}/collections/${this.collection}/points`, {
      method: 'PUT', headers: this._headers(),
      body: JSON.stringify({ points: [{ id, vector: embedding, payload: { ideaId, text } }] }),
    });
    if (!res.ok) { const e = new Error(`Qdrant upsert HTTP ${res.status}`); e.code = 'QDRANT_HTTP'; throw e; }
  }

  async search(embedding, k = 5, { ideaId } = {}) {
    const body = { vector: embedding, limit: k, with_payload: true };
    if (ideaId) body.filter = { must: [{ key: 'ideaId', match: { value: ideaId } }] };
    const res = await this._f()(`${this.url}/collections/${this.collection}/points/search`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body),
    });
    if (!res.ok) { const e = new Error(`Qdrant search HTTP ${res.status}`); e.code = 'QDRANT_HTTP'; throw e; }
    const data = await res.json();
    return (data.result ?? []).map((r) => ({ id: r.id, score: r.score, ideaId: r.payload?.ideaId, text: r.payload?.text }));
  }
}
