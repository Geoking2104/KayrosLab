// KayrosLab — Quantization-aware guidance for local / sovereign models.
// Zero dependencies. Safe defaults oriented toward Ollama + llama.cpp.

export {
  QUANT_KEYS, TIER_KEYS,
  QuantMetaSchema, QuantRecommendationSchema, AgentQuantInfoSchema,
  QuantSnapshotSchema, EventQuantBlockSchema, PlanQuantBlockSchema,
  QuantSchemas,
  validateQuantRecommendation, validateAgentQuantInfo,
  validateQuantSnapshot, validateEventQuantBlock,
} from './quant-schema.mjs';

/** Map agent constructor names → quant role keys. */
export const ROLE_ALIAS = {
  DevilsAdvocate: "Devil's Advocate",
  Bisociateur: 'Bisociator',
  "Devil's Advocate": "Devil's Advocate",
  Bisociator: 'Bisociator',
};

export function normalizeRole(role) {
  if (!role) return 'default';
  return ROLE_ALIAS[role] || role;
}

export const ROLE_QUANT_TIER = {
  Planner: 'high',
  Synthesizer: 'high',
  Critic: 'high',
  "Devil's Advocate": 'high',
  RedTeam: 'high',
  Bisociator: 'medium',
  agent: 'medium',
  SynthesizerDistill: 'high',
  default: 'medium',
};

const QUANT_PREFERENCE = {
  high: ['q5_K_M', 'q6_K', 'q5_K_S', 'q4_K_M', 'q8_0'],
  medium: ['q4_K_M', 'q5_K_M', 'q4_K_S', 'q5_K_S', 'q6_K'],
  low: ['q4_K_M', 'q4_K_S', 'q3_K_M', 'iq4_xs', 'q5_K_M'],
};

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

export function recommendQuant({
  role = 'default',
  tier = null,
  prefer = null,
  preferHigher = false,
  available = null,
} = {}) {
  const roleKey = normalizeRole(role);
  const t = tier || ROLE_QUANT_TIER[roleKey] || ROLE_QUANT_TIER.default;
  let list = [...(QUANT_PREFERENCE[t] || QUANT_PREFERENCE.medium)];

  if (preferHigher && t !== 'high') {
    list = ['q5_K_M', ...list.filter((q) => q !== 'q5_K_M')];
  }

  const forced = normalizeQuant(prefer);
  if (forced && QUANT_META[forced]) {
    if (Array.isArray(available) && available.length) {
      const normAvail = available.map(normalizeQuant);
      if (normAvail.includes(forced)) {
        return { quant: forced, tier: t, reason: `Explicit preference (${forced})`, meta: QUANT_META[forced] };
      }
    } else {
      return { quant: forced, tier: t, reason: `Explicit preference (${forced})`, meta: QUANT_META[forced] };
    }
  }

  let chosen = list[0];
  if (Array.isArray(available) && available.length) {
    const normAvail = available.map(normalizeQuant).filter(Boolean);
    const hit = list.find((q) => normAvail.includes(q));
    if (hit) chosen = hit;
    else if (normAvail.length) chosen = normAvail[0];
  }

  return {
    quant: chosen,
    tier: t,
    reason: `Role « ${roleKey} » → tier ${t}`,
    meta: QUANT_META[chosen] || { bits: null, quality: null, label: chosen },
  };
}

export function extractAvailableQuants(modelTags = []) {
  const set = new Set();
  for (const tag of modelTags) {
    const q = parseQuantFromTag(tag);
    if (q) set.add(q);
  }
  return [...set];
}

export function filterGuidanceByAvailable(guidance, modelTags = []) {
  if (!guidance || !modelTags.length) return guidance;
  const available = extractAvailableQuants(modelTags);
  if (!available.length) {
    // Still attach availableModels for exact tag matching even without quant suffixes
    return {
      ...guidance,
      availableModels: [...modelTags],
      resolveForRole(role, model) {
        const rec = guidance.byRole?.[normalizeRole(role)] || guidance.byRole?.[role] || guidance.global;
        return resolveModelTag(model || stripQuantFromTag(guidance.resolvedDefaultModel) || 'llama3.2', rec?.quant, modelTags);
      },
    };
  }

  const recompute = (role, prefer) => recommendQuant({ role, prefer, available });

  const global = recompute('default', guidance.global?.quant);
  const byRole = {};
  for (const role of Object.keys(ROLE_QUANT_TIER)) {
    byRole[role] = recompute(role, guidance.byRole?.[role]?.quant);
  }

  const baseModel = guidance.resolvedDefaultModel
    ? stripQuantFromTag(guidance.resolvedDefaultModel)
    : 'llama3.2';

  return {
    ...guidance,
    global,
    byRole,
    availableQuants: available,
    availableModels: [...modelTags],
    resolvedDefaultModel: resolveModelTag(baseModel, global.quant, modelTags),
    resolveForRole(role, model = baseModel) {
      const rec = byRole[normalizeRole(role)] || byRole[role] || global;
      return resolveModelTag(model, rec.quant, modelTags);
    },
  };
}

/**
 * Build an Ollama-style model tag.
 * - Never invent `name:tag-q4_K_M` (invalid for most registries).
 * - If availableModels is provided, prefer an exact installed match.
 * - If base already has a `:` tag and no installed match, keep base (no invented quant).
 * - If base has no `:`, use `base:quant`.
 */
export function resolveModelTag(baseModel, quant, availableModels = null) {
  if (!baseModel) return baseModel;
  const q = normalizeQuant(quant);
  if (!q) return baseModel;

  const quantKeys = Object.keys(QUANT_META).join('|').replace(/_/g, '[_-]?');
  const re = new RegExp(`[-_]?((?:${quantKeys}))$`, 'i');
  const cleaned = String(baseModel).replace(re, '');
  const family = cleaned.split(':')[0];

  const candidates = [];
  if (!cleaned.includes(':')) {
    candidates.push(`${cleaned}:${q}`);
  } else {
    // Prefer replacing after colon only when inventing is necessary and list allows
    candidates.push(`${family}:${q}`);
    candidates.push(`${cleaned}-${q}`); // legacy form, only if installed
  }

  if (Array.isArray(availableModels) && availableModels.length) {
    const tags = availableModels.map(String);
    for (const c of candidates) {
      if (tags.includes(c)) return c;
    }
    const byFamilyQuant = tags.find(
      (t) => t.startsWith(`${family}:`) && parseQuantFromTag(t) === q,
    );
    if (byFamilyQuant) return byFamilyQuant;
    const byFamily = tags.find((t) => t === cleaned || t.startsWith(`${family}:`));
    if (byFamily) return byFamily; // installed base, no invented quant
    // no match → keep cleaned base rather than inventing
    return cleaned;
  }

  // No inventory: only invent quant suffix when base has no tag part
  if (!cleaned.includes(':')) return `${cleaned}:${q}`;
  return cleaned;
}

export function stripQuantFromTag(modelTag) {
  if (!modelTag) return modelTag;
  const quantKeys = Object.keys(QUANT_META).join('|').replace(/_/g, '[_-]?');
  const re = new RegExp(`[-_]?((?:${quantKeys}))$`, 'i');
  const cleaned = String(modelTag).replace(re, '');
  return cleaned || modelTag;
}

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

export function estimateQuality(quant) {
  const q = normalizeQuant(quant);
  return QUANT_META[q]?.quality ?? 0.9;
}

export function recommendForEngine({
  model = 'llama3.2',
  roleQuant = {},
  quant = null,
  preferHigherQuant = false,
  sovereignty = null,
  availableModels = null,
} = {}) {
  const available = Array.isArray(availableModels)
    ? extractAvailableQuants(availableModels)
    : null;

  const global = recommendQuant({
    role: 'default',
    prefer: quant,
    preferHigher: preferHigherQuant,
    available,
  });

  const byRole = {};
  for (const role of Object.keys(ROLE_QUANT_TIER)) {
    const override = roleQuant[role] || roleQuant[normalizeRole(role)];
    byRole[role] = recommendQuant({
      role,
      prefer: override || quant,
      preferHigher: preferHigherQuant,
      available,
    });
  }

  const resolvedDefault = sovereignty === 'local'
    ? resolveModelTag(model, global.quant, availableModels)
    : model;

  return {
    global,
    byRole,
    resolvedDefaultModel: resolvedDefault,
    availableQuants: available,
    availableModels: availableModels || null,
    resolveForRole(role, baseModel = model) {
      const key = normalizeRole(role);
      const rec = byRole[key] || byRole[role] || global;
      return resolveModelTag(baseModel, rec.quant, availableModels);
    },
  };
}
