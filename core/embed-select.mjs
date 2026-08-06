// KayrosLab — Soft-fallback embedding model selection (Ollama).
// Tries preferred models in order, falls back to MockEmbeddings.

import { OllamaEmbeddings, MockEmbeddings, HttpEmbeddings } from './embeddings.mjs';

export const DEFAULT_EMBED_PRIORITY = [
  'qwen3-embedding:0.6b',
  'bge-m3',
  'mxbai-embed-large',
  'nomic-embed-text',
];

/**
 * Create an embeddings instance with soft fallback.
 * Priority: opts.model / KAYROS_EMBED_MODEL → priority list → Mock.
 *
 * @param {Object} [opts]
 * @param {string[]} [opts.priority]
 * @param {string} [opts.model] - force a single model
 * @param {string} [opts.endpoint]
 * @param {string} [opts.embeddingsUrl] - use HttpEmbeddings instead
 * @param {boolean} [opts.forceMock]
 * @param {Function} [opts.fetchImpl]
 * @param {boolean} [opts.quiet] - suppress console warnings
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
    });
  }

  const envModel = process.env.KAYROS_EMBED_MODEL;
  const candidates = forcedModel
    ? [forcedModel]
    : envModel
      ? [envModel, ...priority.filter((m) => m !== envModel)]
      : [...priority];

  for (const model of candidates) {
    try {
      const emb = new OllamaEmbeddings({ model, endpoint, fetchImpl });
      // Health check – tiny payload
      await emb.embed('kayros');
      if (!quiet) console.log(`[embeddings] using model: ${model}`);
      return emb;
    } catch (err) {
      if (!quiet) console.warn(`[embeddings] ${model} unavailable: ${err?.message || err}`);
    }
  }

  if (!quiet) console.warn('[embeddings] all models failed – falling back to MockEmbeddings');
  return new MockEmbeddings({ dim: 16 });
}
