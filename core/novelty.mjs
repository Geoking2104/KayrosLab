// KayrosLab — Embedding-based novelty scoring for Bisociator collisions.
// Zero-dep. Reuses cosine from memory.mjs and any Embeddings provider.

import { cosine } from './memory.mjs';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Canonical text used for embedding a collision.
 * Prefer structured fields over free-form agent output.
 */
export function buildCollisionEmbedText(collision = {}) {
  const parts = [];
  if (collision.framework?.name) {
    parts.push(`[Framework] ${collision.framework.name}`);
  }
  if (collision.framework?.mechanism) {
    parts.push(`[Mechanism] ${collision.framework.mechanism}`);
  }
  if (collision.proposal) {
    parts.push(`[Proposal] ${String(collision.proposal).trim()}`);
  }
  if (collision.mechanismTransferred) {
    parts.push(`[Bridge] ${String(collision.mechanismTransferred).trim()}`);
  }

  if (parts.length === 0 && collision.output) {
    return String(collision.output).slice(0, 600);
  }
  return parts.join('\n');
}

/**
 * Compute embedding-based novelty for a set of candidates.
 *
 * @param {Object[]} candidates - [{ id?, text?, embedding?, ... }]
 * @param {Object} refs
 * @param {number[]} [refs.inputEmbedding]
 * @param {Array<{embedding: number[]}>} [refs.memoryHits]
 * @param {Object} [weights] - { batch, memory, input }
 * @returns {Object[]} candidates enriched with novelty + noveltyBreakdown
 */
export function scoreNovelty(candidates = [], refs = {}, weights = {
  batch: 0.40,
  memory: 0.40,
  input: 0.20,
}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const { inputEmbedding = null, memoryHits = [] } = refs;
  const items = candidates.map((c) => ({ ...c, embedding: c.embedding || null }));

  return items.map((item, idx) => {
    // 1. Intra-batch diversity
    let maxBatchSim = 0;
    for (let j = 0; j < items.length; j++) {
      if (j === idx || !items[j].embedding || !item.embedding) continue;
      const sim = cosine(item.embedding, items[j].embedding);
      if (sim > maxBatchSim) maxBatchSim = sim;
    }
    const D_batch = 1 - maxBatchSim;

    // 2. Memory distance
    let maxMemorySim = 0;
    for (const hit of memoryHits) {
      if (!hit?.embedding || !item.embedding) continue;
      const sim = cosine(item.embedding, hit.embedding);
      if (sim > maxMemorySim) maxMemorySim = sim;
    }
    const D_memory = memoryHits.length ? (1 - maxMemorySim) : 0.5;

    // 3. Input distance
    let D_input = 0.5;
    if (inputEmbedding && item.embedding) {
      D_input = 1 - cosine(item.embedding, inputEmbedding);
    }

    const novelty = clamp(
      weights.batch * D_batch +
      weights.memory * D_memory +
      weights.input * D_input,
      0,
      1,
    );

    return {
      ...item,
      novelty,
      noveltyScore: Math.round(novelty * 100),
      noveltyBreakdown: {
        batch: +D_batch.toFixed(4),
        memory: +D_memory.toFixed(4),
        input: +D_input.toFixed(4),
      },
    };
  });
}

/**
 * High-level helper: embed + score a batch of collisions.
 *
 * @param {Object[]} collisions
 * @param {Object} opts
 * @param {Object} opts.embeddings - Embeddings instance (embed / embedBatch)
 * @param {string} [opts.inputText]
 * @param {Array} [opts.memoryHits]
 * @param {Object} [opts.weights]
 */
export async function scoreCollisions(collisions = [], opts = {}) {
  const { embeddings, inputText = null, memoryHits = [], weights } = opts;
  if (!embeddings) throw new Error('scoreCollisions: embeddings instance required');

  const texts = collisions.map((c) => buildCollisionEmbedText(c));
  const vectors = await embeddings.embedBatch(texts);

  const candidates = collisions.map((c, i) => ({
    ...c,
    text: texts[i],
    embedding: vectors[i],
  }));

  let inputEmbedding = null;
  if (inputText) {
    inputEmbedding = await embeddings.embed(inputText);
  }

  return scoreNovelty(candidates, { inputEmbedding, memoryHits }, weights);
}

/**
 * Soft diversity filter: drop candidates whose max cosine vs kept set exceeds threshold.
 */
export function filterDiverse(candidates = [], { threshold = 0.82 } = {}) {
  const kept = [];
  for (const c of candidates) {
    if (!c.embedding) {
      kept.push(c);
      continue;
    }
    let tooSimilar = false;
    for (const k of kept) {
      if (!k.embedding) continue;
      if (cosine(c.embedding, k.embedding) >= threshold) {
        tooSimilar = true;
        break;
      }
    }
    if (!tooSimilar) kept.push(c);
  }
  return kept;
}
