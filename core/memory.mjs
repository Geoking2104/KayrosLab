// KayrosLab — Mémoire : Shared Memory + Vector Memory (similarité cosinus).
// Réf. specs techniques §6 (EF-17/18). Vector store en mémoire (P0/P1) ; Qdrant en P2 (même interface).

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Mémoire partagée par idée (faits, hypothèses, contributions). */
export class SharedMemory {
  constructor(ideaId) { this.ideaId = ideaId; this.facts = []; this.hypotheses = []; this.contributions = []; }
  addFact(actor, content, source) { this.facts.push({ id: globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random()), actor, content, source, ts: new Date().toISOString() }); return this; }
  addHypothesis(actor, content) { this.hypotheses.push({ actor, content, ts: new Date().toISOString() }); return this; }
  addContribution(c) { this.contributions.push({ ...c, ts: new Date().toISOString() }); return this; }
  snapshot() { return { ideaId: this.ideaId, facts: this.facts, hypotheses: this.hypotheses, contributions: this.contributions }; }
}

/**
 * Vector store en mémoire — même interface que l'implémentation Qdrant cible (upsert/search).
 * Filtrage optionnel par `ideaId` (EF-30 : isolation multi-idées).
 */
export class InMemoryVectorStore {
  constructor() { this._recs = new Map(); }
  async upsert({ id, ideaId, text, embedding }) {
    if (!id || !Array.isArray(embedding)) throw new Error('VectorRecord invalide (id + embedding requis)');
    this._recs.set(id, { id, ideaId, text, embedding });
  }
  /** @returns {Promise<{id:string, score:number, ideaId?:string, text?:string}[]>} */
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
