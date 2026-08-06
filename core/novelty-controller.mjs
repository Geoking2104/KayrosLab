// KayrosLab — Novelty as control loop (P1).
import {
  scoreCollisions,
  buildCollisionEmbedText,
} from './novelty.mjs';
import { tagEpistemic } from './epistemic.mjs';

export const DEFAULT_NOVELTY_AXES = Object.freeze([
  'technology', 'business_model', 'channel', 'risk', 'regulation',
]);

export function killNearDuplicates(candidates = [], opts = {}) {
  const threshold = opts.threshold ?? 0.82;
  const sorted = [...candidates].sort((a, b) => (b.novelty ?? 0) - (a.novelty ?? 0));
  const survivors = [];
  const killed = [];
  for (const c of sorted) {
    if (!c.embedding) { survivors.push({ ...c, killReason: null }); continue; }
    let dupOf = null, maxSim = 0;
    for (const s of survivors) {
      if (!s.embedding) continue;
      const sim = cosineSafe(c.embedding, s.embedding);
      if (sim >= threshold && sim > maxSim) { maxSim = sim; dupOf = s.id || s.text?.slice(0, 40) || 'kept'; }
    }
    if (dupOf != null) {
      killed.push({ ...c, killReason: { code: 'near_duplicate', similarity: +maxSim.toFixed(4), threshold, of: dupOf } });
    } else survivors.push({ ...c, killReason: null });
  }
  return { survivors, killed };
}

function cosineSafe(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

export function inferAxis(candidate = {}, axes = DEFAULT_NOVELTY_AXES) {
  if (candidate.axis && axes.includes(candidate.axis)) return candidate.axis;
  const t = `${candidate.text || ''} ${candidate.proposal || ''} ${buildCollisionEmbedText(candidate)}`.toLowerCase();
  if (/regulat|rgpd|gdpr|compliance|legal|norme/.test(t)) return 'regulation';
  if (/risk|fail|attack|security|threat|red team/.test(t)) return 'risk';
  if (/channel|go-to-market|distribution|sales|parten/.test(t)) return 'channel';
  if (/pricing|subscription|marketplace|revenue|business model|moneti/.test(t)) return 'business_model';
  if (/tech|model|infra|api|edge|llm|software|hardware|protocol/.test(t)) return 'technology';
  return axes[0] || 'technology';
}

export function enforceAxisQuotas(candidates = [], opts = {}) {
  const axes = opts.axes || DEFAULT_NOVELTY_AXES;
  const minPerAxis = opts.minPerAxis ?? 1;
  const maxPerAxis = opts.maxPerAxis ?? Infinity;
  const byAxis = Object.fromEntries(axes.map((a) => [a, []]));
  const unassigned = [];
  for (const c of candidates) {
    const axis = inferAxis(c, axes);
    const item = { ...c, axis };
    if (byAxis[axis]) byAxis[axis].push(item);
    else unassigned.push(item);
  }
  const survivors = [], killed = [], coverage = {};
  for (const axis of axes) {
    const list = (byAxis[axis] || []).sort((a, b) => (b.novelty ?? 0) - (a.novelty ?? 0));
    coverage[axis] = list.length;
    const keep = list.slice(0, maxPerAxis === Infinity ? list.length : maxPerAxis);
    survivors.push(...keep);
    for (const d of list.slice(keep.length)) {
      killed.push({ ...d, killReason: { code: 'axis_quota_exceeded', axis, maxPerAxis } });
    }
  }
  survivors.push(...unassigned);
  const missingAxes = axes.filter((a) => (coverage[a] || 0) < minPerAxis);
  return { survivors, killed, coverage, missingAxes };
}

export function shouldReBisociate(scored = [], opts = {}) {
  const minMedian = opts.minMedianNovelty ?? 0.35;
  const minKeep = opts.minSurvivors ?? 2;
  const maxRounds = opts.maxRounds ?? 2;
  const round = opts.round ?? 0;
  if (round >= maxRounds) return { reBisociate: false, reason: 'max_rounds', stats: null };
  const scores = scored.map((c) => c.novelty ?? 0).sort((a, b) => a - b);
  if (!scores.length) return { reBisociate: true, reason: 'empty_batch', stats: { median: 0, count: 0 } };
  const mid = Math.floor(scores.length / 2);
  const median = scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
  const stats = { median: +median.toFixed(4), min: scores[0], max: scores[scores.length - 1], count: scores.length };
  if (median < minMedian) return { reBisociate: true, reason: 'median_below_threshold', stats, threshold: minMedian };
  if (scores.length < minKeep) return { reBisociate: true, reason: 'too_few_candidates', stats };
  return { reBisociate: false, reason: 'ok', stats };
}

export async function runNoveltyControl(collisions = [], opts = {}) {
  const maxRounds = opts.maxRounds ?? 2;
  let batch = [...collisions];
  const allKilled = [], rounds = [];
  let scored = [];
  for (let round = 0; round < maxRounds; round++) {
    if (opts.embeddings && batch.length) {
      scored = await scoreCollisions(batch, {
        embeddings: opts.embeddings, inputText: opts.inputText,
        memoryHits: opts.memoryHits || [], weights: opts.weights,
      });
    } else {
      scored = batch.map((c, i) => ({
        ...c, text: buildCollisionEmbedText(c) || c.text || c.output || '',
        novelty: 0.5, noveltyScore: 50,
        noveltyBreakdown: { batch: 0.5, memory: 0.5, input: 0.5 },
        id: c.id || `c${i}`,
      }));
    }
    const dup = killNearDuplicates(scored, { threshold: opts.duplicateThreshold ?? 0.82 });
    const quota = enforceAxisQuotas(dup.survivors, {
      axes: opts.axes || DEFAULT_NOVELTY_AXES,
      minPerAxis: opts.minPerAxis ?? 0,
      maxPerAxis: opts.maxPerAxis ?? Infinity,
    });
    allKilled.push(...dup.killed, ...quota.killed);
    scored = quota.survivors;
    const decision = shouldReBisociate(scored, {
      minMedianNovelty: opts.minMedianNovelty ?? 0.35,
      minSurvivors: opts.minSurvivors ?? 2, maxRounds, round,
    });
    rounds.push({ round, scored: scored.length, killed: dup.killed.length + quota.killed.length, coverage: quota.coverage, missingAxes: quota.missingAxes, decision });
    if (!decision.reBisociate) break;
    if (typeof opts.generateMore !== 'function') break;
    try {
      const more = await opts.generateMore({ round: round + 1, reason: decision.reason, survivors: scored, killed: allKilled, missingAxes: quota.missingAxes });
      if (Array.isArray(more) && more.length) batch = [...scored, ...more];
      else break;
    } catch { break; }
  }
  const survivors = [...scored].sort((a, b) => (b.novelty ?? 0) - (a.novelty ?? 0));
  const medianNovelty = (() => {
    const arr = survivors.map((s) => s.novelty ?? 0).sort((a, b) => a - b);
    if (!arr.length) return 0;
    const m = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
  })();
  return {
    survivors, killed: allKilled, rounds,
    stats: { survivorCount: survivors.length, killedCount: allKilled.length, medianNovelty, topNovelty: survivors[0]?.novelty ?? null },
    epistemic: tagEpistemic(
      { survivors: survivors.length, killed: allKilled.length },
      { level: opts.embeddings ? 'inferred' : 'degraded', source: 'novelty-controller', kind: 'observation' },
    ),
  };
}

export function optionsFromNoveltyResult(result = {}) {
  const survivingOptions = (result.survivors || []).map((s, i) => ({
    id: s.id || `opt-${i}`,
    summary: s.proposal || s.text || buildCollisionEmbedText(s),
    novelty: s.novelty, noveltyScore: s.noveltyScore,
    axis: s.axis || inferAxis(s), framework: s.framework || null,
  }));
  const killedOptions = (result.killed || []).map((k, i) => ({
    id: k.id || `killed-${i}`,
    summary: k.proposal || k.text || buildCollisionEmbedText(k),
    killReason: k.killReason || { code: 'unknown' }, novelty: k.novelty,
  }));
  return { survivingOptions, killedOptions };
}
