// KayrosLab — Epistemic status layer (P0).
// Tag claims/artifacts with how much we know — refuse confident wrongness at gates.

export const EPISTEMIC_LEVELS = Object.freeze([
  'observed', 'inferred', 'hypothesized', 'degraded', 'unknown',
]);

export const EPISTEMIC_RANK = Object.freeze({
  observed: 4, inferred: 3, hypothesized: 2, degraded: 1, unknown: 0,
});

export function normalizeLevel(level) {
  const l = String(level || '').toLowerCase().trim();
  if (EPISTEMIC_RANK[l] != null) return l;
  return 'unknown';
}

export function tagEpistemic(value, meta = {}) {
  const degraded = !!(meta.degraded || meta.level === 'degraded');
  let level = normalizeLevel(meta.level);
  if (degraded && EPISTEMIC_RANK[level] > EPISTEMIC_RANK.degraded) level = 'degraded';
  if (value == null && level !== 'degraded') level = 'unknown';

  let confidence = meta.confidence;
  if (confidence == null) confidence = defaultConfidence(level);
  confidence = clamp01(confidence);
  if (degraded) confidence = Math.min(confidence, 0.35);

  return {
    value,
    level,
    rank: EPISTEMIC_RANK[level],
    source: meta.source || 'system',
    sourceId: meta.sourceId || null,
    confidence,
    evidence: asStringArray(meta.evidence),
    falsifiers: asStringArray(meta.falsifiers),
    degraded,
    degradedReason: meta.degradedReason || (degraded ? 'degraded_source' : null),
    kind: meta.kind || inferKind(value, meta),
    taggedAt: meta.taggedAt || new Date().toISOString(),
    extra: meta.extra && typeof meta.extra === 'object' ? { ...meta.extra } : undefined,
  };
}

function inferKind(value, meta) {
  if (meta.kind) return meta.kind;
  if (meta.source === 'agent' && /red|critic/i.test(meta.sourceId || '')) return 'risk';
  if (typeof value === 'string' && /\b(go|no-go|revise)\b/i.test(value)) return 'recommendation';
  return 'claim';
}

function defaultConfidence(level) {
  switch (level) {
    case 'observed': return 0.85;
    case 'inferred': return 0.65;
    case 'hypothesized': return 0.45;
    case 'degraded': return 0.25;
    default: return 0.1;
  }
}

function clamp01(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function asStringArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return [String(v)];
}

export function inferLevelFromContext(ctx = {}) {
  if (ctx.degraded || ctx.degradedReason || ctx.fallback === true) return 'degraded';
  if (ctx.mode === 'heuristic' || ctx.mode === 'heuristic-fallback') return 'degraded';
  if (ctx.mode === 'scanners' || ctx.source === 'scanner' || ctx.source === 'search') return 'observed';
  if (ctx.source === 'memory' || ctx.source === 'l1' || ctx.source === 'layered') return 'observed';
  if (ctx.source === 'agent' && /bisoci|scenario|builder/i.test(ctx.agent || ctx.sourceId || '')) return 'hypothesized';
  if (ctx.source === 'agent' && /critic|redteam|red_team|position/i.test(ctx.agent || ctx.sourceId || '')) return 'inferred';
  if (ctx.source === 'llm' || ctx.source === 'agent') return 'inferred';
  if (ctx.source === 'human' || ctx.source === 'gate') return 'observed';
  return 'unknown';
}

export function tagAgentOutput(agent, output, extra = {}) {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
  const level = inferLevelFromContext({
    source: 'agent', agent, sourceId: agent, degraded: extra.degraded, ...extra,
  });
  return tagEpistemic(text, {
    level,
    source: 'agent',
    sourceId: agent,
    kind: /red|critic/i.test(agent || '') ? 'risk' : /bisoci/i.test(agent || '') ? 'option' : 'claim',
    confidence: extra.confidence,
    evidence: extra.evidence,
    falsifiers: extra.falsifiers,
    degraded: !!extra.degraded,
    degradedReason: extra.degraded?.reason || extra.degradedReason,
    extra: { agent, ...(extra.extra || {}) },
  });
}

export function aggregateEpistemic(items = []) {
  const list = (items || []).filter(Boolean);
  if (!list.length) {
    return {
      level: 'unknown', rank: 0, confidence: 0, counts: {},
      degradedCount: 0, observedCount: 0, criticalHoles: ['no_epistemic_items'],
    };
  }
  const counts = {};
  for (const l of EPISTEMIC_LEVELS) counts[l] = 0;
  let confSum = 0;
  let degradedCount = 0;
  for (const it of list) {
    const level = normalizeLevel(it.level);
    counts[level] = (counts[level] || 0) + 1;
    confSum += Number(it.confidence) || 0;
    if (it.degraded || level === 'degraded') degradedCount += 1;
  }
  const critical = list.filter((it) => it.kind === 'recommendation' || it.kind === 'risk');
  const pool = critical.length ? critical : list;
  const minRank = Math.min(...pool.map((it) => EPISTEMIC_RANK[normalizeLevel(it.level)] ?? 0));
  const level = EPISTEMIC_LEVELS.find((l) => EPISTEMIC_RANK[l] === minRank) || 'unknown';
  const criticalHoles = [];
  if (counts.unknown > 0) criticalHoles.push('unknown_claims');
  if (degradedCount > 0 && degradedCount >= list.length / 2) criticalHoles.push('majority_degraded');
  if (counts.observed === 0 && counts.inferred === 0) criticalHoles.push('no_grounded_evidence');
  return {
    level, rank: minRank, confidence: clamp01(confSum / list.length),
    counts, degradedCount, observedCount: counts.observed || 0,
    itemCount: list.length, criticalHoles,
  };
}

export function explainUncertainty(aggregate = {}, opts = {}) {
  const level = normalizeLevel(aggregate.level);
  const holes = aggregate.criticalHoles || aggregate.blockers || [];
  const lines = [];
  lines.push(`Overall epistemic level: ${level} (confidence ${pct(aggregate.confidence)}).`);
  if (aggregate.counts) {
    const parts = EPISTEMIC_LEVELS.filter((l) => aggregate.counts[l]).map((l) => `${l}=${aggregate.counts[l]}`);
    if (parts.length) lines.push(`Claim mix: ${parts.join(', ')}.`);
  }
  if (aggregate.degradedCount) lines.push(`${aggregate.degradedCount} item(s) marked degraded (fallback / heuristic / error path).`);
  if (aggregate.observedCount === 0) lines.push('No directly observed evidence in the packet — recommendations rest on inference or generation.');
  for (const h of holes) lines.push(`Hole: ${describeHole(h)}.`);
  if (opts.recommendation) lines.push(`Stated recommendation: ${opts.recommendation}.`);
  if (opts.maxFalsifiers) lines.push(`Sample falsifiers: ${opts.maxFalsifiers.slice(0, 3).join(' | ')}`);
  return { level, confidence: aggregate.confidence ?? 0, summary: lines.join(' '), lines, holes };
}

function describeHole(h) {
  const map = {
    no_epistemic_items: 'no tagged claims available',
    unknown_claims: 'some claims have unknown grounding',
    majority_degraded: 'majority of claims come from degraded paths',
    no_grounded_evidence: 'no observed or inferred evidence',
    missing_falsifiers: 'recommendation lacks falsifiers',
    empty_recommendation: 'no clear Go / No-Go / Revise',
    degraded_recommendation: 'recommendation itself is degraded',
    insufficient_evidence_for_go: 'Go requires stronger grounding',
    packet_incomplete: 'decision packet missing required fields',
  };
  return map[h] || String(h);
}

function pct(c) {
  const n = Number(c);
  if (Number.isNaN(n)) return 'n/a';
  return `${Math.round(n * 100)}%`;
}

export function strengthenClaim(tagged, { evidence, falsifiers, level, confidence } = {}) {
  if (!tagged) return tagEpistemic(null, { level: 'unknown' });
  const nextLevel = level
    ? (EPISTEMIC_RANK[normalizeLevel(level)] < tagged.rank ? normalizeLevel(level) : tagged.level)
    : tagged.level;
  return tagEpistemic(tagged.value, {
    ...tagged,
    level: nextLevel,
    confidence: confidence != null ? confidence : tagged.confidence,
    evidence: [...(tagged.evidence || []), ...asStringArray(evidence)],
    falsifiers: [...(tagged.falsifiers || []), ...asStringArray(falsifiers)],
  });
}
