// KayrosLab — Embeddings + MemoryService.
// Ref. specs techniques §6 (Vector Memory). Souverain via Ollama (nomic-embed-text), mock offline, ou proxy HTTP.
// V16 optim: keep_alive, timeout, truncate, batch chunking, L2 normalize, in-memory cache.

/** Simple LRU string→vector cache (process-local). */
export class EmbedCache {
  constructor({ max = 256 } = {}) {
    this.max = max;
    this.map = new Map();
  }
  _key(model, text) {
    return model + '::' + text;
  }
  get(model, text) {
    const k = this._key(model, text);
    if (!this.map.has(k)) return null;
    const v = this.map.get(k);
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }
  set(model, text, vec) {
    const k = this._key(model, text);
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, vec);
    while (this.map.size > this.max) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
  }
  clear() { this.map.clear(); }
}

function l2normalize(vec) {
  if (!Array.isArray(vec) || !vec.length) return vec;
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  const n = Math.sqrt(s) || 1;
  if (Math.abs(n - 1) < 1e-6) return vec;
  return vec.map((x) => x / n);
}

function truncateText(text, maxChars) {
  const s = String(text ?? '');
  if (!maxChars || s.length <= maxChars) return s;
  return s.slice(0, maxChars);
}

/** Adaptateur embeddings Ollama (POST /api/embed). Souverain. Optimisé V16. */
export class OllamaEmbeddings {
  constructor({
    endpoint = 'http://localhost:11434',
    model = 'nomic-embed-text',
    fetchImpl,
    timeoutMs = 15000,
    keepAlive = '10m',
    maxChars = 2000,
    batchSize = 16,
    normalize = true,
    cache = null,
    useCache = true,
  } = {}) {
    this.id = 'ollama';
    this.endpoint = String(endpoint).replace(/\/$/, '');
    this.model = model;
    this._fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.keepAlive = keepAlive;
    this.maxChars = maxChars;
    this.batchSize = Math.max(1, batchSize);
    this.normalize = normalize;
    this.useCache = useCache;
    this.cache = cache || (useCache ? new EmbedCache({ max: 256 }) : null);
  }

  _f() {
    const f = this._fetch ?? (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) { const e = new Error('OllamaEmbeddings: fetch indisponible'); e.code = 'NO_FETCH'; throw e; }
    return f;
  }

  async embed(text) {
    const [v] = await this.embedBatch([text]);
    return v;
  }

  async embedBatch(texts) {
    const list = (texts || []).map((t) => truncateText(t, this.maxChars));
    const out = new Array(list.length);
    const missingIdx = [];
    const missingTexts = [];

    for (let i = 0; i < list.length; i++) {
      if (this.cache && this.useCache) {
        const hit = this.cache.get(this.model, list[i]);
        if (hit) {
          out[i] = hit;
          continue;
        }
      }
      missingIdx.push(i);
      missingTexts.push(list[i]);
    }

    if (!missingTexts.length) return out;

    for (let off = 0; off < missingTexts.length; off += this.batchSize) {
      const chunk = missingTexts.slice(off, off + this.batchSize);
      const vectors = await this._embedChunk(chunk);
      for (let j = 0; j < chunk.length; j++) {
        let v = vectors[j];
        if (!v) throw new Error(`Ollama embed: missing vector at chunk offset ${off + j}`);
        if (this.normalize) v = l2normalize(v);
        const globalIdx = missingIdx[off + j];
        out[globalIdx] = v;
        if (this.cache && this.useCache) {
          this.cache.set(this.model, chunk[j], v);
        }
      }
    }
    return out;
  }

  async _embedChunk(texts) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl && this.timeoutMs
      ? setTimeout(() => ctrl.abort(), this.timeoutMs)
      : null;

    try {
      const body = {
        model: this.model,
        input: texts,
      };
      if (this.keepAlive != null) body.keep_alive = this.keepAlive;
      body.options = { ...(body.options || {}), num_ctx: Math.min(2048, Math.ceil(this.maxChars / 2)) };

      const res = await this._f()(`${this.endpoint}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl?.signal,
      });
      if (!res.ok) {
        const e = new Error(`Ollama embed HTTP ${res.status}`);
        e.code = 'OLLAMA_EMBED_HTTP';
        e.status = res.status;
        throw e;
      }
      const d = await res.json();
      const vectors = d.embeddings ?? (d.embedding ? [d.embedding] : []);
      if (vectors.length !== texts.length) {
        if (texts.length === 1 && vectors.length === 1) return vectors;
        throw Object.assign(new Error(`Ollama embed: expected ${texts.length} vectors, got ${vectors.length}`), { code: 'OLLAMA_EMBED_SHAPE' });
      }
      return vectors;
    } catch (err) {
      if (err?.name === 'AbortError') {
        const e = new Error(`Ollama embed timeout after ${this.timeoutMs}ms`);
        e.code = 'OLLAMA_EMBED_TIMEOUT';
        throw e;
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** Embeddings déterministes offline (tests / fallback). Aucun réseau. */
export class MockEmbeddings {
  constructor({ dim = 16 } = {}) { this.id = 'mock'; this.dim = dim; this.model = 'mock'; }
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
  constructor({ url, model, secret, fetchImpl, timeoutMs = 20000 } = {}) {
    if (!url) throw new Error('HttpEmbeddings: url requis');
    this.id = 'backend'; this.url = url; this.model = model; this.secret = secret;
    this._fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }
  _f() {
    const f = this._fetch ?? (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) { const e = new Error('HttpEmbeddings: fetch indisponible'); e.code = 'NO_FETCH'; throw e; }
    return f;
  }
  async embed(text) { const [v] = await this.embedBatch([text]); return v; }
  async embedBatch(texts) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl && this.timeoutMs ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.secret) headers['x-kayros-secret'] = this.secret;
      const res = await this._f()(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input: texts, model: this.model }),
        signal: ctrl?.signal,
      });
      if (!res.ok) {
        const e = new Error(`HttpEmbeddings HTTP ${res.status}`);
        e.code = 'HTTP_EMBED_HTTP';
        throw e;
      }
      const d = await res.json();
      return d.embeddings ?? d.vectors ?? [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * MemoryService — embed + upsert + semantic recall.
 * Layered memory lives in memory.mjs; this is the low-level vector API.
 */
export class MemoryService {
  constructor({ embeddings, store }) {
    if (!embeddings || !store) throw new Error('MemoryService: embeddings + store requis');
    this.embeddings = embeddings;
    this.store = store;
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
