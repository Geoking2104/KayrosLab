// KayrosLab — Embeddings + MemoryService.
// Ref. specs techniques §6 (Vector Memory). Souverain via Ollama (nomic-embed-text), mock offline, ou proxy HTTP.

/** Adaptateur embeddings Ollama (POST /api/embed). Souverain. */
export class OllamaEmbeddings {
  constructor({ endpoint = 'http://localhost:11434', model = 'nomic-embed-text', fetchImpl } = {}) {
    this.id = 'ollama'; this.endpoint = String(endpoint).replace(/\/$/, ''); this.model = model; this._fetch = fetchImpl;
  }
  _f() {
    const f = this._fetch ?? (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) { const e = new Error('OllamaEmbeddings: fetch indisponible'); e.code = 'NO_FETCH'; throw e; }
    return f;
  }
  async embed(text) { const [v] = await this.embedBatch([text]); return v; }
  async embedBatch(texts) {
    const res = await this._f()(`${this.endpoint}/api/embed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) { const e = new Error(`Ollama embed HTTP ${res.status}`); e.code = 'OLLAMA_EMBED_HTTP'; throw e; }
    const d = await res.json();
    // /api/embed -> { embeddings: [[...],...] } ; /api/embeddings (ancien) -> { embedding: [...] }
    return d.embeddings ?? (d.embedding ? [d.embedding] : []);
  }
}

/** Embeddings déterministes offline (tests / fallback). Aucun réseau. */
export class MockEmbeddings {
  constructor({ dim = 16 } = {}) { this.id = 'mock'; this.dim = dim; }
  async embed(text) {
    const v = new Array(this.dim).fill(0);
    const s = String(text ?? '');
    for (let i = 0; i < s.length; i++) v[i % this.dim] += s.charCodeAt(i);
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
  async embedBatch(texts) { return Promise.all(texts.map((t) => this.embed(t))); }
}

/** Embeddings via le proxy backend (POST { input } -> { embeddings }). Pour le navigateur. */
export class HttpEmbeddings {
  constructor({ url, model, secret, fetchImpl } = {}) {
    if (!url) throw new Error('HttpEmbeddings: url requis');
    this.id = 'backend'; this.url = url; this.model = model; this.secret = secret; this._fetch = fetchImpl;
  }
  _f() {
    const f = this._fetch ?? (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) { const e = new Error('HttpEmbeddings: fetch indisponible'); e.code = 'NO_FETCH'; throw e; }
    return f;
  }
  async embed(text) { const [v] = await this.embedBatch([text]); return v; }
  async embedBatch(texts) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.secret) headers['X-Kayros-Secret'] = this.secret;
    const res = await this._f()(this.url, { method: 'POST', headers, body: JSON.stringify({ input: texts, model: this.model }) });
    if (!res.ok) { const e = new Error(`Backend embed HTTP ${res.status}`); e.code = 'BACKEND_EMBED_HTTP'; throw e; }
    const d = await res.json();
    if (d?.error) { const e = new Error(`Backend embed: ${d.error}`); e.code = 'BACKEND_EMBED_ERROR'; throw e; }
    return d.embeddings ?? (d.embedding ? [d.embedding] : []);
  }
}

/**
 * MemoryService : lie embeddings + vector store (InMemory ou Qdrant).
 * remember() encode et stocke ; recall() encode la requête et cherche les plus proches.
 */
export class MemoryService {
  constructor({ embeddings, store }) {
    if (!embeddings || !store) throw new Error('MemoryService: embeddings + store requis');
    this.embeddings = embeddings; this.store = store;
  }
  async remember({ id, ideaId, text }) {
    const embedding = await this.embeddings.embed(text);
    await this.store.upsert({ id, ideaId, text, embedding });
    return embedding;
  }
  async rememberMany(items) {
    const texts = items.map((i) => i.text);
    const vecs = await this.embeddings.embedBatch(texts);
    await Promise.all(items.map((it, k) => this.store.upsert({ id: it.id, ideaId: it.ideaId, text: it.text, embedding: vecs[k] })));
    return vecs.length;
  }
  async recall(ideaId, query, k = 5) {
    const q = await this.embeddings.embed(query);
    return this.store.search(q, k, { ideaId });
  }
}
