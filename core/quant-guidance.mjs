// KayrosLab — Quantization-aware guidance for local / sovereign models.
// Helps choose GGUF quant levels by role sensitivity and available headroom.
// Zero dependencies. Safe defaults oriented toward Ollama + llama.cpp.

export {
  QUANT_KEYS, TIER_KEYS,
  QuantMetaSchema, QuantRecommendationSchema, AgentQuantInfoSchema,
  QuantSnapshotSchema, EventQuantBlockSchema, PlanQuantBlockSchema,
  QuantSchemas,
  validateQuantRecommendation, validateAgentQuantInfo,
  validateQuantSnapshot, validateEventQuantBlock,
} from './quant-schema.mjs';

/** Role sensitivity to quantization quality (higher = prefer higher quant). */
export const ROLE_QUANT_TIER = {
  // High-stakes reasoning / structured output
  Planner: 'high',
  Synthesizer: 'high',
  Critic: 'high',
  "Devil's Advocate": 'high',
  RedTeam: 'high',
  // Creative / exploratory — more tolerant
  Bisociator: 'medium',
  // Generic / tool / distillation
  agent: 'medium',
  SynthesizerDistill: 'high',
  default: 'medium',
};

/** Ordered preference lists (best → acceptable). */
const QUANT_PREFERENCE = {
  high: ['q5_K_M', 'q6_K', 'q5_K_S', 'q4_K_M', 'q8_0'],
  medium: ['q4_K_M', 'q5_K_M', 'q4_K_S', 'q5_K_S', 'q6_K'],
  low: ['q4_K_M', 'q4_K_S', 'q3_K_M', 'iq4_xs', 'q5_K_M'],
};

/** Human-readable notes + rough quality retention vs FP16. */
export const QUANT_META = {
  q8_0: { bits: 8.5, quality: 0.995, label: 'Near-lossless' },
  q6_K: { bits: 6.6, quality: 0.99, label: 'Excellent' },
  q5_K_M: { bits: 5.7, quality: 0.98, label: 'Very good' },
  q5_K_S: { bits: 5.5, quality: 0.975, label: 'Good+' },
  q4_K_M: { bits: 4.9, quality: 0.97, label: 'Recommended default' },
  q4_K_S: { bits: 4.5, quality: 0.95, label: 'Compact 4-bit' },
  iq4_xs: { bits: 4.25, quality: 0.96, label: 'I-matrix 4-bit' },
  q3_K_M: { bits: 3.9, quality: 0.92, label: 'Aggressive — quality drop' },
  q2_K: { bits: 2.5, quality: 0.85, label: 'Last resort' },
};

/** Normalize quant string to canonical key (q4_K_M, …). */
export function normalizeQuant(q) {
  if (!q) return null;
  const s = String(q).trim().toLowerCase().replace(/-/g, '_');
  if (s === 'q4' || s === 'q4_k') return 'q4_K_M';
  if (s === 'q5' || s === 'q5_k') return 'q5_K_M';
  if (s === 'q6' || s === 'q6_k') return 'q6_K';
  if (s === 'q8' || s === 'q8_0') return 'q8_0';
  const known = Object.keys(QUANT_META);
  const hit = known.find((k) => k.toLowerCase() === s);
  return hit || s;
}

/**
 * Recommend a quant for a given role and optional constraints.
 * @returns {{ quant: string, tier: string, reason: string, meta: object }}
 */
export function recommendQuant({
  role = 'default',
  tier = null,
  prefer = null,
  preferHigher = false,
  available = null,
} = {}) {
  const t = tier || ROLE_QUANT_TIER[role] || ROLE_QUANT_TIER.default;
  let list = [...(QUANT_PREFERENCE[t] || QUANT_PREFERENCE.medium)];

  if (preferHigher && t !== 'high') {
    list = ['q5_K_M', ...list.filter((q) => q !== 'q5_K_M')];
  }

  const forced = normalizeQuant(prefer);
  if (forced && QUANT_META[forced]) {
    return {
      quant: forced,
      tier: t,
      reason: `Explicit preference (${forced})`,
      meta: QUANT_META[forced],
    };
  }

  let chosen = list[0];
  if (Array.isArray(available) && available.length) {
    const normAvail = available.map(normalizeQuant);
    const hit = list.find((q) => normAvail.includes(q));
    if (hit) chosen = hit;
  }

  return {
    quant: chosen,
    tier: t,
    reason: `Role « ${role} » → tier ${t}`,
    meta: QUANT_META[chosen] || { bits: null, quality: null, label: chosen },
  };
}

/** Build an Ollama-style model tag with quant suffix. */
export function resolveModelTag(baseModel, quant) {
  if (!baseModel) return baseModel;
  const q = normalizeQuant(quant);
  if (!q) return baseModel;

  const quantKeys = Object.keys(QUANT_META).join('|').replace(/_/g, '[_-]?');
  const re = new RegExp(`[-_]?((?:${quantKeys}))$`, 'i');
  const cleaned = String(baseModel).replace(re, '');

  const suffix = q;
  if (cleaned.includes(':')) return `${cleaned}-${suffix}`;
  return `${cleaned}:${suffix}`;
}

/** Extract quant from a model tag if present. */
export function parseQuantFromTag(modelTag) {
  if (!modelTag) return null;
  const quantKeys = Object.keys(QUANT_META);
  const lower = String(modelTag).toLowerCase();
  for (const k of quantKeys) {
    if (lower.endsWith(k.toLowerCase()) || lower.endsWith(k.toLowerCase().replace(/_/g, '-'))) {
      return k;
    }
  }
  const m = lower.match(/[-_](q[2-8](?:_k(?:_[sml])?)?|iq\d+_\w+|q8_0)(?:$|[-_])/i);
  return m ? normalizeQuant(m[1]) : null;
}

/** Rough quality estimate 0–1 for a quant key. */
export function estimateQuality(quant) {
  const q = normalizeQuant(quant);
  return QUANT_META[q]?.quality ?? 0.9;
}

/**
 * High-level helper used by createEngine.
 * Returns guidance object + resolved default model tag.
 */
export function recommendForEngine({
  model = 'llama3.2',
  roleQuant = {},
  quant = null,
  preferHigherQuant = false,
  sovereignty = null,
} = {}) {
  const global = recommendQuant({
    role: 'default',
    prefer: quant,
    preferHigher: preferHigherQuant,
  });

  const byRole = {};
  for (const role of Object.keys(ROLE_QUANT_TIER)) {
    const override = roleQuant[role];
    byRole[role] = recommendQuant({
      role,
      prefer: override || quant,
      preferHigher: preferHigherQuant,
    });
  }

  const resolvedDefault = sovereignty === 'local'
    ? resolveModelTag(model, global.quant)
    : model;

  return {
    global,
    byRole,
    resolvedDefaultModel: resolvedDefault,
    resolveForRole(role, baseModel = model) {
      const rec = byRole[role] || global;
      return resolveModelTag(baseModel, rec.quant);
    },
  };
}
