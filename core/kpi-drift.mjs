// KayrosLab — KPI drift detection (V16).
// Detects trend deviations over a series of readings (not just single-threshold breach).
// Zero-dep, pure functions, deterministic.

/**
 * Linear regression slope for a series of {value, ts?} points ordered by time.
 * @param {{value:number, ts?:string}[]} series
 * @returns {{slope:number, intercept:number, n:number}}
 */
export function linearSlope(series = []) {
  const n = series.length;
  if (n < 2) return { slope: 0, intercept: series[0]?.value ?? 0, n };
  // Use index as x if no timestamps, or epoch ms
  const pts = series.map((r, i) => {
    const x = r.ts ? Date.parse(r.ts) : i;
    return { x: Number.isFinite(x) ? x : i, y: Number(r.value) };
  }).filter((p) => Number.isFinite(p.y));
  if (pts.length < 2) return { slope: 0, intercept: series[0]?.value ?? 0, n: pts.length };

  // Normalize x to 0..n-1 scale for stable slope when using timestamps
  const x0 = pts[0].x;
  const span = pts[pts.length - 1].x - x0 || 1;
  const norm = pts.map((p) => ({ x: (p.x - x0) / span, y: p.y }));

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of norm) {
    sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumXX += p.x * p.x;
  }
  const m = norm.length;
  const denom = m * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (m * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / m;
  return { slope, intercept, n: m };
}

/**
 * Detect drift for one KPI against its history.
 *
 * @param {Object} kpi - { id, name?, threshold?, comparator?, drift?: { minPoints?, maxAbsSlope?, maxRelativeChange? } }
 * @param {{value:number, ts?:string, kpiId?:string}[]} readings - chronological readings for this KPI
 * @returns {null|{ type:'drift', kpiId, name, slope, relativeChange, latest, baseline, reason }}
 */
export function detectKpiDrift(kpi, readings = []) {
  const cfg = kpi.drift || {};
  const minPoints = cfg.minPoints ?? 3;
  const maxAbsSlope = cfg.maxAbsSlope ?? null;
  const maxRelativeChange = cfg.maxRelativeChange ?? 0.25;

  const series = readings
    .filter((r) => (r.kpiId ?? r.id) === kpi.id || !r.kpiId)
    .map((r) => ({ value: Number(r.value), ts: r.ts }))
    .filter((r) => Number.isFinite(r.value));

  if (series.length < minPoints) return null;

  const { slope } = linearSlope(series);
  const baseline = series[0].value;
  const latest = series[series.length - 1].value;
  const relativeChange = baseline === 0
    ? (latest === 0 ? 0 : Infinity)
    : (latest - baseline) / Math.abs(baseline);

  const reasons = [];
  if (maxAbsSlope != null && Math.abs(slope) > maxAbsSlope) {
    reasons.push(`slope ${slope.toFixed(4)} exceeds ±${maxAbsSlope}`);
  }
  if (Math.abs(relativeChange) >= maxRelativeChange) {
    reasons.push(`relative change ${(relativeChange * 100).toFixed(1)}% exceeds ±${(maxRelativeChange * 100).toFixed(0)}%`);
  }

  if (!reasons.length) return null;

  return {
    type: 'drift',
    kpiId: kpi.id,
    name: kpi.name ?? kpi.id,
    slope,
    relativeChange,
    latest,
    baseline,
    n: series.length,
    reason: reasons.join('; '),
  };
}

/**
 * Evaluate drift across multiple KPIs.
 * @param {Object[]} kpis
 * @param {{value:number, ts?:string, kpiId?:string}[]} allReadings
 * @returns {{ drifts: Object[], stable: string[] }}
 */
export function evaluateKpiDrifts(kpis = [], allReadings = []) {
  const drifts = [];
  const stable = [];
  for (const k of kpis) {
    const forK = allReadings.filter((r) => (r.kpiId ?? r.id) === k.id);
    const d = detectKpiDrift(k, forK.length ? forK : allReadings);
    if (d) drifts.push(d);
    else stable.push(k.id);
  }
  return { drifts, stable };
}

/** Convert drift alerts into Listen-loop signals (same shape as alertsToSignals). */
export function driftsToSignals(drifts = [], { ideaId = 'idea', now } = {}) {
  const ts = typeof now === 'function' ? now : () => new Date().toISOString();
  return drifts.map((d, i) => ({
    id: `${ideaId}:drift:${d.kpiId}:${i}`,
    source: 'kpi-drift',
    date: ts(),
    contenu: `Dérive KPI "${d.name}" : ${d.reason} (latest=${d.latest}, baseline=${d.baseline}).`,
    kpiId: d.kpiId,
    type: 'drift',
  }));
}
