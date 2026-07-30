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
    this.facts = [];
    this.hypotheses = [];
    this.contributions = [];
    this.activeL0Refs = [];
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

/** Vector store en mémoire — même interface que Qdrant. */
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

/** Vector store Qdrant (REST). */
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
        points: [{ id, vector: embedding, payload: { ideaId, text, layer, ...meta } }],
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
      id: r.id, score: r.score, ideaId: r.payload?.ideaId, text: r.payload?.text,
      layer: r.payload?.layer, meta: r.payload,
    }));
  }
}

// ========== File Offload Backend (L0) ==========

export class FileOffloadBackend {
  constructor({ rootDir = './.kayros-l0', fs = null, path = null } = {}) {
    this.rootDir = rootDir;
    this.fs = fs;
    this.path = path;
    this.enabled = !!(fs && path && typeof fs.writeFile === 'function');
  }

  async write(ideaId, item) {
    if (!this.enabled) return null;
    try {
      const dir = this.path.join(this.rootDir, ideaId);
      await this.fs.mkdir(dir, { recursive: true });
      const filePath = this.path.join(dir, `${item.id}.json`);
      const payload = JSON.stringify({
        id: item.id, kind: item.kind, step: item.step, agentRole: item.agentRole,
        content: item.content, createdAt: item.createdAt,
      }, null, 2);
      await this.fs.writeFile(filePath, payload, 'utf8');
      return filePath;
    } catch { return null; }
  }

  async read(filePath) {
    if (!this.enabled || !filePath) return null;
    try {
      const raw = await this.fs.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch { return null; }
  }
}

// ========== File Layered Store (L1 / L2 / L3 persistence) ==========

/**
 * Persistance atomique des couches L1–L3 (et snapshot L0 léger).
 * Même pattern que FileUserStore / FileGateStore : write tmp → rename.
 */
export class FileLayeredStore {
  /**
   * @param {Object} opts
   * @param {string} [opts.path='./.kayros-memory.json']
   * @param {Object} [opts.fs]
   * @param {Object} [opts.pathModule]  // { dirname, join } si besoin
   */
  constructor({ path = './.kayros-memory.json', fs = null } = {}) {
    this.path = path;
    this.fs = fs;
    this.enabled = !!(fs && typeof fs.writeFile === 'function');
  }

  async load() {
    if (!this.enabled) return null;
    try {
      const raw = await this.fs.readFile(this.path, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      return null;
    }
  }

  async save(snapshot) {
    if (!this.enabled) return false;
    try {
      const tmp = `${this.path}.tmp`;
      const payload = JSON.stringify({
        version: 1,
        savedAt: nowIso(),
        l1: snapshot.l1 || [],
        l2: snapshot.l2 || [],
        l3: snapshot.l3 || [],
        // L0 n'est volontairement pas persisté en masse (trop volatile)
      }, null, 2);
      await this.fs.writeFile(tmp, payload, 'utf8');
      if (typeof this.fs.rename === 'function') {
        await this.fs.rename(tmp, this.path);
      } else {
        await this.fs.writeFile(this.path, payload, 'utf8');
      }
      return true;
    } catch {
      return false;
    }
  }
}

// ========== Layered Memory (L0–L3) ==========

export class LayeredMemory {
  /**
   * @param {Object} [opts]
   * @param {import('./embeddings.mjs').MemoryService} [opts.memoryService]
   * @param {Object} [opts.store]
   * @param {FileOffloadBackend} [opts.offloadBackend]
   * @param {FileLayeredStore} [opts.persistentStore]
   */
  constructor({ memoryService = null, store = null, offloadBackend = null, persistentStore = null } = {}) {
    this.memoryService = memoryService;
    this.store = store ?? new InMemoryVectorStore();
    this.offloadBackend = offloadBackend;
    this.persistentStore = persistentStore;

    this._l0 = new Map();
    this._l1 = new Map();
    this._l2 = new Map();
    this._l3 = new Map();

    this._byIdea = { l0: new Map(), l1: new Map(), l2: new Map() };
    this._dirty = false;
  }

  // ---------- L0 ----------

  rememberL0(p) {
    const item = createL0(p);
    this._l0.set(item.id, item);
    this._indexIdea('l0', item.ideaId, item.id);
    return item;
  }

  async offload(ideaId, step = null) {
    const refs = [];
    for (const [id, item] of this._l0) {
      if (item.ideaId !== ideaId) continue;
      if (step && item.step !== step) continue;
      if (item.expiresAt) continue;

      item.expiresAt = nowIso();

      if (typeof item.content === 'string' && item.content.length > 600 && !item.summary) {
        item.summary = item.content.slice(0, 350) + '…';
      } else if (typeof item.content === 'object' && !item.summary) {
        item.summary = `[${item.kind}] ${JSON.stringify(item.content).slice(0, 200)}…`;
      }

      if (this.offloadBackend) {
        const filePath = await this.offloadBackend.write(ideaId, item);
        if (filePath) item.filePath = filePath;
      }

      if (item.filePath && typeof item.content === 'string' && item.content.length > 2000) {
        item.content = item.summary || '[offloaded]';
      }

      refs.push({
        id, mermaidNodeId: item.mermaidNodeId, kind: item.kind,
        summary: item.summary, filePath: item.filePath || null,
      });
    }
    return refs;
  }

  /**
   * Canvas Mermaid enrichi.
   * - Subgraphs par étape
   * - Nœuds colorés (actif vs offloadé)
   * - Label agent + kind
   * - Liens séquentiels approximatifs
   * - IDs stables pour drill-down
   */
  getWorkingCanvas(ideaId, { includeOffloaded = true } = {}) {
    const items = [];
    for (const item of this._l0.values()) {
      if (item.ideaId !== ideaId) continue;
      if (!includeOffloaded && item.expiresAt) continue;
      items.push(item);
    }

    // Group by step
    const byStep = new Map();
    for (const it of items) {
      const key = it.step || 'unknown';
      if (!byStep.has(key)) byStep.set(key, []);
      byStep.get(key).push(it);
    }

    const lines = [
      'flowchart TD',
      '  classDef active fill:#dbeafe,stroke:#2563eb,color:#1e3a8a',
      '  classDef offloaded fill:#f1f5f9,stroke:#94a3b8,color:#64748b,stroke-dasharray: 4 2',
    ];

    const nodeIds = [];
    let prevStepLast = null;

    for (const [step, group] of byStep) {
      const safeStep = step.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`  subgraph ${safeStep}["${step}"]`);
      lines.push('    direction TB');

      group.forEach((n, i) => {
        const nid = `N_${safeStep}_${i}`;
        nodeIds.push({ id: nid, itemId: n.id, step });
        const label = [
          n.agentRole ? `${n.agentRole}` : null,
          n.kind,
          (n.summary || '').slice(0, 28),
        ].filter(Boolean).join(' · ').replace(/["\n]/g, ' ');

        const cls = n.expiresAt ? 'offloaded' : 'active';
        lines.push(`    ${nid}["${label}"]:::${cls}`);
      });

      // Liens internes au step
      for (let i = 1; i < group.length; i++) {
        lines.push(`    N_${safeStep}_${i - 1} --> N_${safeStep}_${i}`);
      }

      lines.push('  end');

      // Lien inter-step
      if (prevStepLast && group.length) {
        lines.push(`  ${prevStepLast} --> N_${safeStep}_0`);
      }
      if (group.length) prevStepLast = `N_${safeStep}_${group.length - 1}`;
    }

    return {
      mermaid: lines.join('\n'),
      nodes: items,
      nodeIds,
      stats: {
        total: items.length,
        active: items.filter((x) => !x.expiresAt).length,
        offloaded: items.filter((x) => !!x.expiresAt).length,
        steps: byStep.size,
      },
    };
  }

  // ---------- L1 ----------

  async addAtomicFact(p) {
    const fact = createL1(p);
    this._l1.set(fact.id, fact);
    if (fact.ideaId) this._indexIdea('l1', fact.ideaId, fact.id);
    this._dirty = true;

    if (this.memoryService && fact.content) {
      try {
        const emb = await this.memoryService.embeddings.embed(fact.content);
        fact.embedding = emb;
        await this.store.upsert({
          id: fact.id, ideaId: fact.ideaId, text: fact.content, embedding: emb,
          layer: 'l1', meta: { type: fact.type, confidence: fact.confidence },
        });
      } catch (_) {}
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

  async distillScenario(p) {
    const scenario = createL2(p);
    this._l2.set(scenario.id, scenario);
    for (const iid of scenario.ideaIds) this._indexIdea('l2', iid, scenario.id);
    this._dirty = true;

    if (this.memoryService && scenario.summary) {
      try {
        const emb = await this.memoryService.embeddings.embed(scenario.summary + '\n' + scenario.title);
        scenario.embedding = emb;
        await this.store.upsert({
          id: scenario.id, ideaId: scenario.ideaIds[0] || null, text: scenario.summary, embedding: emb,
          layer: 'l2', meta: { patternType: scenario.patternType, reviewStatus: scenario.reviewStatus },
        });
      } catch (_) {}
    }
    return scenario;
  }

  /**
   * Job de distillation automatique L1 → L2.
   * Heuristique légère (pas de LLM obligatoire) :
   * - regroupe les faits actifs par `type`
   * - si ≥ minFacts dans un groupe → crée un scénario draft
   * - évite les doublons de titre
   *
   * @param {string} ideaId
   * @param {Object} [opts]
   * @param {number} [opts.minFacts=3]
   * @param {boolean} [opts.force=false]  // ignore les titres déjà existants
   * @returns {Promise<import('./memory-types.mjs').L2Scenario[]>}
   */
  async autoDistillL2(ideaId, { minFacts = 3, force = false } = {}) {
    if (!ideaId) throw new Error('autoDistillL2: ideaId requis');
    const facts = this.getAtomicFacts({ ideaId, status: 'active' });
    if (facts.length < minFacts) return [];

    // Group by type
    const groups = new Map();
    for (const f of facts) {
      const key = f.type || 'observation';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }

    const existingTitles = new Set(
      this.getScenarios({ ideaId }).map((s) => s.title.toLowerCase())
    );
    const created = [];

    for (const [type, group] of groups) {
      if (group.length < minFacts) continue;

      const title = `Synthèse ${type} (${ideaId})`;
      if (!force && existingTitles.has(title.toLowerCase())) continue;

      // Contenu Markdown simple
      const lines = group.slice(0, 12).map((f) =>
        `- (${f.confidence.toFixed(2)}) ${f.content}`
      );
      const content = `## Faits ${type}\n\n${lines.join('\n')}\n\n_Généré automatiquement le ${nowIso()}_`;
      const summary = `${group.length} faits de type « ${type} » consolidés.`;

      const scenario = await this.distillScenario({
        title,
        content,
        summary,
        ideaIds: [ideaId],
        relatedL1Ids: group.map((f) => f.id),
        patternType: type === 'competitor' || type === 'risk' ? 'competitive_gap' : 'insight',
        confidence: Math.min(0.85, group.reduce((s, f) => s + f.confidence, 0) / group.length),
        reviewStatus: 'draft',
        tags: [type, 'auto-distill'],
      });
      created.push(scenario);
    }

    return created;
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

  updateCore(p) {
    const core = createL3(p);
    for (const existing of this._l3.values()) {
      if (existing.scope === core.scope && existing.scopeId === core.scopeId &&
          existing.kind === core.kind && existing.title === core.title) {
        core.version = (existing.version || 1) + 1;
        core.id = existing.id;
        break;
      }
    }
    this._l3.set(core.id, core);
    this._dirty = true;
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

  // ---------- Persistence ----------

  /** Sauvegarde L1/L2/L3 sur disque (si persistentStore configuré). */
  async save() {
    if (!this.persistentStore) return false;
    const snap = this.snapshot();
    const ok = await this.persistentStore.save(snap);
    if (ok) this._dirty = false;
    return ok;
  }

  /** Charge L1/L2/L3 depuis le disque et reconstruit les index + vecteurs. */
  async load() {
    if (!this.persistentStore) return false;
    const data = await this.persistentStore.load();
    if (!data) return false;

    this._l1.clear();
    this._l2.clear();
    this._l3.clear();
    this._byIdea.l1.clear();
    this._byIdea.l2.clear();

    for (const f of data.l1 || []) {
      this._l1.set(f.id, f);
      if (f.ideaId) this._indexIdea('l1', f.ideaId, f.id);
      if (f.embedding && this.store) {
        try {
          await this.store.upsert({
            id: f.id, ideaId: f.ideaId, text: f.content, embedding: f.embedding,
            layer: 'l1', meta: { type: f.type, confidence: f.confidence },
          });
        } catch (_) {}
      }
    }
    for (const s of data.l2 || []) {
      this._l2.set(s.id, s);
      for (const iid of s.ideaIds || []) this._indexIdea('l2', iid, s.id);
      if (s.embedding && this.store) {
        try {
          await this.store.upsert({
            id: s.id, ideaId: s.ideaIds?.[0] || null, text: s.summary || s.title,
            embedding: s.embedding, layer: 'l2',
            meta: { patternType: s.patternType, reviewStatus: s.reviewStatus },
          });
        } catch (_) {}
      }
    }
    for (const c of data.l3 || []) {
      this._l3.set(c.id, c);
    }

    this._dirty = false;
    return true;
  }

  // ---------- Unified Recall ----------

  async recall(query, { ideaId = null, layers = ['L1', 'L2', 'L3'], k = 5 } = {}) {
    const result = { l1: [], l2: [], l3: [] };

    if (layers.includes('L3')) {
      result.l3 = this.getCore().slice(0, k);
    }

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
        if (layers.includes('L1')) result.l1 = this.getAtomicFacts({ ideaId }).slice(0, k);
        if (layers.includes('L2')) result.l2 = this.getScenarios({ ideaId }).slice(0, k);
      }
    } else {
      if (layers.includes('L1')) result.l1 = this.getAtomicFacts({ ideaId }).slice(0, k);
      if (layers.includes('L2')) result.l2 = this.getScenarios({ ideaId }).slice(0, k);
    }

    return result;
  }

  async buildContextBlock(query, { ideaId = null, k = 4 } = {}) {
    const { l1, l2, l3 } = await this.recall(query, { ideaId, k });
    const parts = [];
    if (l3.length) {
      parts.push('### Connaissances stables (L3)');
      for (const c of l3) parts.push(`- [${c.kind}] ${c.title}: ${c.content.slice(0, 180)}`);
    }
    if (l2.length) {
      parts.push('### Scénarios / insights (L2)');
      for (const s of l2) parts.push(`- ${s.title}: ${s.summary || s.content.slice(0, 160)}`);
    }
    if (l1.length) {
      parts.push('### Faits atomiques (L1)');
      for (const f of l1) parts.push(`- (${f.type}, conf=${f.confidence.toFixed(2)}) ${f.content}`);
    }
    return parts.length ? parts.join('\n') : '';
  }

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
      stats: { l0: this._l0.size, l1: this._l1.size, l2: this._l2.size, l3: this._l3.size },
      dirty: this._dirty,
    };
  }

  _indexIdea(layer, ideaId, id) {
    if (!ideaId) return;
    if (!this._byIdea[layer].has(ideaId)) this._byIdea[layer].set(ideaId, new Set());
    this._byIdea[layer].get(ideaId).add(id);
  }
}

export { createL0, createL1, createL2, createL3 } from './memory-types.mjs';
