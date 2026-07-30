// KayrosLab — Mémoire : Shared Memory + Vector Memory + Layered L0–L3.
// Ref. specs techniques §6 (EF-17/18) + schéma mémoire stratifiée.
// InMemory (P0/P1) ; Qdrant (P1/P2) même interface.
// Backward compatible avec SharedMemory + MemoryService existants.

import {
  createL0, createL1, createL2, createL3,
  uid, nowIso,
} from './memory-types.mjs';

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Mémoire partagée par idée (faits, hypothèses, contributions). Évoluée vers L1. */
export class SharedMemory {
  constructor(ideaId) {
    this.ideaId = ideaId;
    this.facts = [];          // désormais des L1AtomicFact-like
    this.hypotheses = [];
    this.contributions = [];
    this.activeL0Refs = [];   // ids L0 encore en contexte
    this.lastDistilledAt = null;
  }

  /** @deprecated Préférer LayeredMemory.addAtomicFact — conservé pour compat. */
  addFact(actor, content, source) {
    const fact = createL1({
      ideaId: this.ideaId,
      content,
      type: 'observation',
      actors: [actor],
      sourceRefs: source ? [{ type: 'external', id: String(source) }] : [],
    });
    this.facts.push(fact);
    return this;
  }

  addHypothesis(actor, content) {
    this.hypotheses.push({ id: uid(), actor, content, ts: nowIso() });
    return this;
  }

  addContribution(c) {
    this.contributions.push({ id: uid(), ...c, ts: nowIso() });
    return this;
  }

  snapshot() {
    return {
      ideaId: this.ideaId,
      facts: this.facts,
      hypotheses: this.hypotheses,
      contributions: this.contributions,
      activeL0Refs: this.activeL0Refs,
      lastDistilledAt: this.lastDistilledAt,
    };
  }
}

/**
 * Vector store en mémoire — même interface que Qdrant (upsert/search).
 * Filtrage optionnel par ideaId (EF-30 : isolation multi-idées).
 */
export class InMemoryVectorStore {
  constructor() { this._recs = new Map(); }
  async upsert({ id, ideaId, text, embedding, layer = 'l1', meta = {} }) {
    if (!id || !Array.isArray(embedding)) throw new Error('VectorRecord invalide (id + embedding requis)');
    this._recs.set(id, { id, ideaId, text, embedding, layer, meta });
  }
  async search(embedding, k = 5, { ideaId, layer } = {}) {
    const out = [];
    for (const r of this._recs.values()) {
      if (ideaId && r.ideaId !== ideaId) continue;
      if (layer && r.layer !== layer) continue;
      out.push({ id: r.id, ideaId: r.ideaId, text: r.text, score: cosine(embedding, r.embedding), layer: r.layer, meta: r.meta });
    }
    out.sort((x, y) => y.score - x.score);
    return out.slice(0, k);
  }
  size() { return this._recs.size; }
  clear() { this._recs.clear(); }
}

/**
 * Vector store Qdrant (REST). Même interface upsert/search que InMemoryVectorStore.
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

  async ensureCollection() {
    const res = await this._f()(`${this.url}/collections/${this.collection}`, {
      method: 'PUT', headers: this._headers(),
      body: JSON.stringify({ vectors: { size: this.dim, distance: 'Cosine' } }),
    });
    return res.ok;
  }

  async upsert({ id, ideaId, text, embedding, layer = 'l1', meta = {} }) {
    if (id === undefined || id === null || !Array.isArray(embedding)) throw new Error('VectorRecord invalide (id + embedding requis)');
    const res = await this._f()(`${this.url}/collections/${this.collection}/points`, {
      method: 'PUT', headers: this._headers(),
      body: JSON.stringify({
        points: [{
          id,
          vector: embedding,
          payload: { ideaId, text, layer, ...meta },
        }],
      }),
    });
    if (!res.ok) { const e = new Error(`Qdrant upsert HTTP ${res.status}`); e.code = 'QDRANT_HTTP'; throw e; }
  }

  async search(embedding, k = 5, { ideaId, layer } = {}) {
    const must = [];
    if (ideaId) must.push({ key: 'ideaId', match: { value: ideaId } });
    if (layer) must.push({ key: 'layer', match: { value: layer } });
    const body = { vector: embedding, limit: k, with_payload: true };
    if (must.length) body.filter = { must };
    const res = await this._f()(`${this.url}/collections/${this.collection}/points/search`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body),
    });
    if (!res.ok) { const e = new Error(`Qdrant search HTTP ${res.status}`); e.code = 'QDRANT_HTTP'; throw e; }
    const data = await res.json();
    return (data.result ?? []).map((r) => ({
      id: r.id,
      score: r.score,
      ideaId: r.payload?.ideaId,
      text: r.payload?.text,
      layer: r.payload?.layer,
      meta: r.payload,
    }));
  }
}

// ========== Layered Memory (L0–L3) ==========

/**
 * Orchestrateur de mémoire stratifiée.
 * - L0 : working context (offloadable)
 * - L1 : atomic facts
 * - L2 : scenarios / insights
 * - L3 : core / persona / skills
 *
 * Peut s'appuyer sur un vector store existant pour le recall hybride.
 * Compatible avec le MemoryService classique (via remember/recall).
 */
export class LayeredMemory {
  /**
   * @param {Object} [opts]
   * @param {import('./embeddings.mjs').MemoryService} [opts.memoryService]  // optionnel, pour embeddings
   * @param {Object} [opts.store]  // InMemoryVectorStore | QdrantVectorStore
   */
  constructor({ memoryService = null, store = null } = {}) {
    this.memoryService = memoryService;
    this.store = store ?? new InMemoryVectorStore();

    /** @type {Map<string, import('./memory-types.mjs').L0WorkingItem>} */
    this._l0 = new Map();
    /** @type {Map<string, import('./memory-types.mjs').L1AtomicFact>} */
    this._l1 = new Map();
    /** @type {Map<string, import('./memory-types.mjs').L2Scenario>} */
    this._l2 = new Map();
    /** @type {Map<string, import('./memory-types.mjs').L3CoreMemory>} */
    this._l3 = new Map();

    // index rapide ideaId → set of ids
    this._byIdea = { l0: new Map(), l1: new Map(), l2: new Map() };
  }

  // ---------- L0 ----------

  /**
   * Enregistre un item de contexte de travail (outil, scrape, pensée…).
   * @param {Parameters<typeof createL0>[0]} p
   */
  rememberL0(p) {
    const item = createL0(p);
    this._l0.set(item.id, item);
    this._indexIdea('l0', item.ideaId, item.id);
    return item;
  }

  /**
   * Offload : marque les L0 d'une idée/étape comme expirés et retourne les refs.
   * En production on écrirait les contenus lourds sur disque (filePath).
   */
  offload(ideaId, step = null) {
    const refs = [];
    for (const [id, item] of this._l0) {
      if (item.ideaId !== ideaId) continue;
      if (step && item.step !== step) continue;
      item.expiresAt = nowIso();
      // Simulation d'offload : on garde un résumé, le contenu complet peut être externalisé
      if (typeof item.content === 'string' && item.content.length > 800 && !item.summary) {
        item.summary = item.content.slice(0, 400) + '…';
      }
      refs.push({ id, mermaidNodeId: item.mermaidNodeId, kind: item.kind, summary: item.summary });
    }
    return refs;
  }

  getWorkingCanvas(ideaId) {
    const nodes = [];
    for (const item of this._l0.values()) {
      if (item.ideaId === ideaId && !item.expiresAt) nodes.push(item);
    }
    // Simple Mermaid skeleton (peut être enrichi plus tard)
    const lines = ['flowchart TD'];
    nodes.forEach((n, i) => {
      const label = (n.summary || n.kind).replace(/["\n]/g, ' ').slice(0, 40);
      lines.push(`  N${i}["${label}"]`);
      if (n.mermaidNodeId) lines.push(`  N${i} --- ${n.mermaidNodeId}`);
    });
    return { mermaid: lines.join('\n'), nodes };
  }

  // ---------- L1 ----------

  /**
   * @param {Parameters<typeof createL1>[0]} p
   */
  async addAtomicFact(p) {
    const fact = createL1(p);
    this._l1.set(fact.id, fact);
    if (fact.ideaId) this._indexIdea('l1', fact.ideaId, fact.id);

    // Index vectoriel si possible
    if (this.memoryService && fact.content) {
      try {
        const emb = await this.memoryService.embeddings.embed(fact.content);
        fact.embedding = emb;
        await this.store.upsert({
          id: fact.id,
          ideaId: fact.ideaId,
          text: fact.content,
          embedding: emb,
          layer: 'l1',
          meta: { type: fact.type, confidence: fact.confidence },
        });
      } catch (_) { /* soft-fail embeddings */ }
    }
    return fact;
  }

  getAtomicFacts({ ideaId = null, status = 'active', type = null } = {}) {
    const out = [];
    for (const f of this._l1.values()) {
      if (status && f.status !== status) continue;
      if (ideaId && f.ideaId !== ideaId) continue;
      if (type && f.type !== type) continue;
      out.push(f);
    }
    return out;
  }

  // ---------- L2 ----------

  /**
   * @param {Parameters<typeof createL2>[0]} p
   */
  async distillScenario(p) {
    const scenario = createL2(p);
    this._l2.set(scenario.id, scenario);
    for (const iid of scenario.ideaIds) this._indexIdea('l2', iid, scenario.id);

    if (this.memoryService && scenario.summary) {
      try {
        const emb = await this.memoryService.embeddings.embed(scenario.summary + '\n' + scenario.title);
        scenario.embedding = emb;
        await this.store.upsert({
          id: scenario.id,
          ideaId: scenario.ideaIds[0] || null,
          text: scenario.summary,
          embedding: emb,
          layer: 'l2',
          meta: { patternType: scenario.patternType, reviewStatus: scenario.reviewStatus },
        });
      } catch (_) {}
    }
    return scenario;
  }

  getScenarios({ ideaId = null, reviewStatus = null, patternType = null } = {}) {
    const out = [];
    for (const s of this._l2.values()) {
      if (ideaId && !s.ideaIds.includes(ideaId)) continue;
      if (reviewStatus && s.reviewStatus !== reviewStatus) continue;
      if (patternType && s.patternType !== patternType) continue;
      out.push(s);
    }
    return out;
  }

  // ---------- L3 ----------

  /**
   * @param {Parameters<typeof createL3>[0]} p
   */
  updateCore(p) {
    const core = createL3(p);
    // Si même scope+kind+title existe déjà → version++
    for (const existing of this._l3.values()) {
      if (existing.scope === core.scope && existing.scopeId === core.scopeId &&
          existing.kind === core.kind && existing.title === core.title) {
        core.version = (existing.version || 1) + 1;
        core.id = existing.id; // on écrase
        break;
      }
    }
    this._l3.set(core.id, core);
    return core;
  }

  getCore({ scope = null, scopeId = null, kind = null } = {}) {
    const out = [];
    for (const c of this._l3.values()) {
      if (scope && c.scope !== scope) continue;
      if (scopeId && c.scopeId !== scopeId) continue;
      if (kind && c.kind !== kind) continue;
      out.push(c);
    }
    return out;
  }

  // ---------- Unified Recall ----------

  /**
   * Recall multi-couches.
   * @param {string} query
   * @param {Object} [opts]
   * @param {string} [opts.ideaId]
   * @param {('L1'|'L2'|'L3')[]} [opts.layers]
   * @param {number} [opts.k]
   */
  async recall(query, { ideaId = null, layers = ['L1', 'L2', 'L3'], k = 5 } = {}) {
    const result = { l1: [], l2: [], l3: [] };

    // L3 : simple filtre (pas encore vectorisé)
    if (layers.includes('L3')) {
      result.l3 = this.getCore().slice(0, k);
    }

    // L1 + L2 via vector store si disponible
    if (this.memoryService && (layers.includes('L1') || layers.includes('L2'))) {
      try {
        const emb = await this.memoryService.embeddings.embed(query);
        const hits = await this.store.search(emb, k * 2, { ideaId });

        for (const h of hits) {
          if (h.layer === 'l1' && layers.includes('L1')) {
            const fact = this._l1.get(h.id);
            if (fact) result.l1.push({ ...fact, score: h.score });
          } else if (h.layer === 'l2' && layers.includes('L2')) {
            const sc = this._l2.get(h.id);
            if (sc) result.l2.push({ ...sc, score: h.score });
          }
        }
        result.l1 = result.l1.slice(0, k);
        result.l2 = result.l2.slice(0, k);
      } catch (_) {
        // fallback non-vectoriel
        if (layers.includes('L1')) result.l1 = this.getAtomicFacts({ ideaId }).slice(0, k);
        if (layers.includes('L2')) result.l2 = this.getScenarios({ ideaId }).slice(0, k);
      }
    } else {
      if (layers.includes('L1')) result.l1 = this.getAtomicFacts({ ideaId }).slice(0, k);
      if (layers.includes('L2')) result.l2 = this.getScenarios({ ideaId }).slice(0, k);
    }

    return result;
  }

  // ---------- Snapshot / Debug ----------

  snapshot(ideaId = null) {
    const filter = (map) => {
      if (!ideaId) return [...map.values()];
      return [...map.values()].filter((x) =>
        x.ideaId === ideaId || (x.ideaIds && x.ideaIds.includes(ideaId))
      );
    };
    return {
      l0: filter(this._l0),
      l1: filter(this._l1),
      l2: filter(this._l2),
      l3: [...this._l3.values()],
      stats: {
        l0: this._l0.size,
        l1: this._l1.size,
        l2: this._l2.size,
        l3: this._l3.size,
      },
    };
  }

  // ---------- Internal ----------

  _indexIdea(layer, ideaId, id) {
    if (!ideaId) return;
    if (!this._byIdea[layer].has(ideaId)) this._byIdea[layer].set(ideaId, new Set());
    this._byIdea[layer].get(ideaId).add(id);
  }
}

// Ré-export des factories pour commodité
export { createL0, createL1, createL2, createL3 } from './memory-types.mjs';
