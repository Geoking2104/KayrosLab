// KayrosLab — Soft-fallback embedding model selection (V16 optimized).
// Priority: small/fast embedding models first, then larger, then Mock.

import { OllamaEmbeddings, MockEmbeddings, HttpEmbeddings, EmbedCache } from './embeddings.mjs';

/** Shared process-level cache across fallback attempts & engine lifetime. */
const sharedCache = new EmbedCache({ max: 512 });

export const DEFAULT_EMBED_PRIORITY = [
  'qwen3-embedding:0.6b',  // small, fast, strong multilingual
  'bge-m3',                // strong retrieval
  'mxbai-embed-large',     // quality
  'nomic-embed-text',      // solid default
];

/**
 * Create embeddings with soft fallback across models.
 * @param {object} [opts]
 * @param {string[]} [opts.priority]
 * @param {string} [opts.model] - force single model (skip fallback)
 * @param {string} [opts.endpoint]
 * @param {string} [opts.embeddingsUrl] - if set, use HttpEmbeddings instead of Ollama
 * @param {boolean} [opts.forceMock]
 * @param {Function} [opts.fetchImpl]
 * @param {boolean} [opts.quiet]
 * @param {string} [opts.secret]
 * @param {number} [opts.timeoutMs=12000]
 * @param {string|number} [opts.keepAlive='15m']
 * @param {number} [opts.batchSize=16]
 * @param {number} [opts.maxChars=1800]
 */
export async function createEmbeddingsWithFallback(opts = {}) {
  const {
    priority = DEFAULT_EMBED_PRIORITY,
    model: forcedModel = null,
    endpoint = 'http://localhost:11434',
    embeddingsUrl = null,
    forceMock = false,
    fetchImpl,
    quiet = false,
    secret,
    timeoutMs = 12000,
    keepAlive = '15m',
    batchSize = 16,
    maxChars = 1800,
  } = opts;

  if (forceMock) {
    return new MockEmbeddings({ dim: 16 });
  }

  if (embeddingsUrl) {
    return new HttpEmbeddings({
      url: embeddingsUrl,
      model: forcedModel || process.env.KAYROS_EMBED_MODEL || 'nomic-embed-text',
      secret,
      fetchImpl,
      timeoutMs,
    });
  }

  const envModel = typeof process !== 'undefined' ? process.env?.KAYROS_EMBED_MODEL : null;
  const candidates = forcedModel
    ? [forcedModel]
    : (envModel ? [envModel, ...priority.filter((m) => m !== envModel)] : [...priority]);

  const common = {
    endpoint,
    fetchImpl,
    timeoutMs,
    keepAlive,
    batchSize,
    maxChars,
    normalize: true,
    cache: sharedCache,
    useCache: true,
  };

  for (const model of candidates) {
    try {
      const emb = new OllamaEmbeddings({ ...common, model });
      // Health check – tiny payload (also warms the model via keep_alive)
      await emb.embed('kayros');
      if (!quiet) console.log(`[embeddings] using model: ${model} (cache=${sharedCache.map.size})`);
      return emb;
    } catch (err) {
      if (!quiet) console.warn(`[embeddings] ${model} unavailable: ${err?.message || err}`);
    }
  }

  if (!quiet) console.warn('[embeddings] all models failed – falling back to MockEmbeddings');
  return new MockEmbeddings({ dim: 16 });
}

export { sharedCache };
