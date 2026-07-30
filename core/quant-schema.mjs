// KayrosLab — JSON Schema for quantization fields.
// Used by quant-guidance, agents, and orchestrator events.
// Draft-07 compatible. Zero dependencies.

/** Canonical quant keys recognized by the engine. */
export const QUANT_KEYS = [
  'q8_0', 'q6_K', 'q5_K_M', 'q5_K_S', 'q4_K_M', 'q4_K_S', 'iq4_xs', 'q3_K_M', 'q2_K',
];

export const TIER_KEYS = ['high', 'medium', 'low'];

/** @type {import('json-schema').JSONSchema7} */
export const QuantMetaSchema = {
  $id: 'https://kayroslab.local/schemas/quant-meta.json',
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'QuantMeta',
  type: 'object',
  additionalProperties: false,
  required: ['bits', 'quality', 'label'],
  properties: {
    bits: { type: ['number', 'null'], description: 'Effective bits per weight' },
    quality: { type: ['number', 'null'], minimum: 0, maximum: 1, description: 'Approx. quality retention vs FP16' },
    label: { type: 'string', description: 'Human-readable quality label' },
  },
};

/** @type {import('json-schema').JSONSchema7} */
export const QuantRecommendationSchema = {
  $id: 'https://kayroslab.local/schemas/quant-recommendation.json',
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'QuantRecommendation',
  type: 'object',
  additionalProperties: false,
  required: ['quant', 'tier', 'reason', 'meta'],
  properties: {
    quant: {
      type: 'string',
      description: 'Canonical quant key (e.g. q4_K_M)',
      // enum kept soft — unknown keys still allowed for future GGUF types
    },
    tier: { type: 'string', enum: TIER_KEYS },
    reason: { type: 'string' },
    meta: { $ref: 'https://kayroslab.local/schemas/quant-meta.json' },
  },
};

/** Per-agent quant info attached to trace / synthesis events. */
export const AgentQuantInfoSchema = {
  $id: 'https://kayroslab.local/schemas/agent-quant-info.json',
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'AgentQuantInfo',
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    preferredModel: { type: ['string', 'null'], description: 'Resolved Ollama-style model tag' },
    quant: { type: ['string', 'null'] },
    tier: { type: ['string', 'null'], enum: [...TIER_KEYS, null] },
    quality: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    label: { type: ['string', 'null'] },
  },
};

/** Full snapshot emitted on start / final / plan.quant.snapshot. */
export const QuantSnapshotSchema = {
  $id: 'https://kayroslab.local/schemas/quant-snapshot.json',
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'QuantSnapshot',
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    global: {
      oneOf: [
        { $ref: 'https://kayroslab.local/schemas/quant-recommendation.json' },
        { type: 'null' },
      ],
    },
    resolvedDefaultModel: { type: ['string', 'null'] },
    byAgent: {
      type: 'object',
      additionalProperties: { $ref: 'https://kayroslab.local/schemas/agent-quant-info.json' },
      description: 'Map agent name → AgentQuantInfo',
    },
  },
};

/** quant block on a single trace / synthesis event. */
export const EventQuantBlockSchema = {
  $id: 'https://kayroslab.local/schemas/event-quant-block.json',
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'EventQuantBlock',
  type: 'object',
  additionalProperties: false,
  properties: {
    modelUsed: { type: ['string', 'null'], description: 'Model tag actually sent to the provider' },
    agent: { $ref: 'https://kayroslab.local/schemas/agent-quant-info.json' },
  },
};

/** quant block on plan() result. */
export const PlanQuantBlockSchema = {
  $id: 'https://kayroslab.local/schemas/plan-quant-block.json',
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'PlanQuantBlock',
  type: 'object',
  additionalProperties: false,
  properties: {
    modelUsed: { type: ['string', 'null'] },
    agent: { $ref: 'https://kayroslab.local/schemas/agent-quant-info.json' },
    snapshot: { $ref: 'https://kayroslab.local/schemas/quant-snapshot.json' },
  },
};

/** Bundle of all schemas for registry / OpenAPI embedding. */
export const QuantSchemas = {
  QuantMeta: QuantMetaSchema,
  QuantRecommendation: QuantRecommendationSchema,
  AgentQuantInfo: AgentQuantInfoSchema,
  QuantSnapshot: QuantSnapshotSchema,
  EventQuantBlock: EventQuantBlockSchema,
  PlanQuantBlock: PlanQuantBlockSchema,
};

// ---------- Lightweight runtime validators (no AJV dependency) ----------

function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

/** Soft-validate a QuantRecommendation. Returns { ok, errors[] }. */
export function validateQuantRecommendation(x) {
  const errors = [];
  if (!isObj(x)) return { ok: false, errors: ['expected object'] };
  if (typeof x.quant !== 'string') errors.push('quant: string required');
  if (!TIER_KEYS.includes(x.tier)) errors.push(`tier: must be one of ${TIER_KEYS.join('|')}`);
  if (typeof x.reason !== 'string') errors.push('reason: string required');
  if (!isObj(x.meta)) errors.push('meta: object required');
  else {
    if (x.meta.bits != null && typeof x.meta.bits !== 'number') errors.push('meta.bits: number|null');
    if (x.meta.quality != null && (typeof x.meta.quality !== 'number' || x.meta.quality < 0 || x.meta.quality > 1)) {
      errors.push('meta.quality: number 0–1');
    }
    if (typeof x.meta.label !== 'string') errors.push('meta.label: string required');
  }
  return { ok: errors.length === 0, errors };
}

/** Soft-validate AgentQuantInfo (null allowed). */
export function validateAgentQuantInfo(x) {
  if (x == null) return { ok: true, errors: [] };
  const errors = [];
  if (!isObj(x)) return { ok: false, errors: ['expected object|null'] };
  for (const k of ['preferredModel', 'quant', 'label']) {
    if (x[k] != null && typeof x[k] !== 'string') errors.push(`${k}: string|null`);
  }
  if (x.tier != null && !TIER_KEYS.includes(x.tier)) errors.push(`tier: ${TIER_KEYS.join('|')}|null`);
  if (x.quality != null && (typeof x.quality !== 'number' || x.quality < 0 || x.quality > 1)) {
    errors.push('quality: number 0–1|null');
  }
  return { ok: errors.length === 0, errors };
}

/** Soft-validate QuantSnapshot (null allowed). */
export function validateQuantSnapshot(x) {
  if (x == null) return { ok: true, errors: [] };
  const errors = [];
  if (!isObj(x)) return { ok: false, errors: ['expected object|null'] };
  if (x.global != null) {
    const g = validateQuantRecommendation(x.global);
    if (!g.ok) errors.push(...g.errors.map((e) => `global.${e}`));
  }
  if (x.resolvedDefaultModel != null && typeof x.resolvedDefaultModel !== 'string') {
    errors.push('resolvedDefaultModel: string|null');
  }
  if (x.byAgent != null) {
    if (!isObj(x.byAgent)) errors.push('byAgent: object');
    else {
      for (const [name, info] of Object.entries(x.byAgent)) {
        const r = validateAgentQuantInfo(info);
        if (!r.ok) errors.push(...r.errors.map((e) => `byAgent.${name}.${e}`));
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Soft-validate EventQuantBlock. */
export function validateEventQuantBlock(x) {
  const errors = [];
  if (!isObj(x)) return { ok: false, errors: ['expected object'] };
  if (x.modelUsed != null && typeof x.modelUsed !== 'string') errors.push('modelUsed: string|null');
  const a = validateAgentQuantInfo(x.agent ?? null);
  if (!a.ok) errors.push(...a.errors.map((e) => `agent.${e}`));
  return { ok: errors.length === 0, errors };
}
