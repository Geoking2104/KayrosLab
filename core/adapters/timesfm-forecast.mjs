// KayrosLab — zero-dependency contract for optional TimesFM forecasting.
// The model runtime lives outside core/; this module only validates and
// interprets the adapter response.

export const TIMESFM_TOOL_NAME = 'projection.forecast';
export const TIMESFM_QUANTILES = Object.freeze([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);

export const timesfmToolContract = Object.freeze({
  name: TIMESFM_TOOL_NAME,
  description: 'Forecast KPI trajectories with TimesFM 2.5. Outputs are simulations, never observed facts.',
  inputKeys: ['inputs'],
  sideEffect: 'read',
  gate: false,
  governance: Object.freeze({
    label: 'SIMULATION',
    requiresHumanArbitrationWhenUncertain: true,
  }),
});

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validate the portable payload before it crosses the process boundary.
 * Limits are deliberately lower than TimesFM's theoretical limits to keep a
 * single API call from monopolising the warm inference service.
 */
export function validateForecastInput(payload = {}, {
  maxBatch = 32,
  maxContext = 16_384,
  maxHorizon = 1_000,
  minHistory = 3,
} = {}) {
  const { inputs, horizon = 12, ideaIds = null } = payload;
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > maxBatch) {
    throw new Error(`projection.forecast: inputs must contain 1..${maxBatch} series`);
  }
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > maxHorizon) {
    throw new Error(`projection.forecast: horizon must be an integer in 1..${maxHorizon}`);
  }
  for (const series of inputs) {
    if (!Array.isArray(series) || series.length < minHistory || series.length > maxContext) {
      throw new Error(`projection.forecast: every series must contain ${minHistory}..${maxContext} values`);
    }
    if (!series.every(finiteNumber)) {
      throw new Error('projection.forecast: series values must be finite numbers');
    }
  }
  if (ideaIds != null && (!Array.isArray(ideaIds) || ideaIds.length !== inputs.length)) {
    throw new Error('projection.forecast: ideaIds must match the input batch length');
  }
  return { ...payload, inputs, horizon };
}

/**
 * TimesFM service returns nine quantiles per horizon: P10..P90. Uncertainty is
 * the mean P90-P10 interval relative to the mean absolute P50. Using absolute
 * scale avoids negative KPI forecasts flipping the decision.
 */
export function computeForecastUncertainty(point = [], quantileRows = [], {
  threshold = 0.8,
  epsilon = 1e-9,
} = {}) {
  if (!Array.isArray(point) || !point.length || !Array.isArray(quantileRows) || !quantileRows.length) {
    return { high: false, ratio: 0, meanWidth: 0, reference: 0 };
  }

  const widths = [];
  const medians = [];
  for (const row of quantileRows) {
    if (!Array.isArray(row) || row.length < TIMESFM_QUANTILES.length) continue;
    const p10 = Number(row[0]);
    const p50 = Number(row[4]);
    const p90 = Number(row[8]);
    if (![p10, p50, p90].every(Number.isFinite)) continue;
    widths.push(Math.max(0, p90 - p10));
    medians.push(Math.abs(p50));
  }
  if (!widths.length) return { high: false, ratio: 0, meanWidth: 0, reference: 0 };

  const meanWidth = widths.reduce((sum, value) => sum + value, 0) / widths.length;
  const medianReference = medians.reduce((sum, value) => sum + value, 0) / medians.length;
  const pointReference = point
    .filter(finiteNumber)
    .reduce((sum, value, _index, values) => sum + Math.abs(value) / values.length, 0);
  const reference = Math.max(medianReference, pointReference, epsilon);
  const ratio = meanWidth / reference;
  return { high: ratio > threshold, ratio, meanWidth, reference };
}

export function summarizeForecastForMemory({ ideaId, kpi, horizon, point, uncertainty, modelId }) {
  const last = Array.isArray(point) && point.length ? point[point.length - 1] : null;
  return {
    title: `TimesFM forecast — ${kpi || 'impact_score'}`,
    summary: `SIMULATION for ${ideaId || 'idea'} over ${horizon} periods; final point=${Number.isFinite(last) ? last : 'n/a'}; uncertainty ratio=${Number(uncertainty?.ratio || 0).toFixed(3)}.`,
    content: JSON.stringify({ label: 'SIMULATION', modelId, kpi, horizon, point, uncertainty }),
    ideaIds: ideaId ? [ideaId] : [],
    patternType: 'insight',
    applicableStages: ['projeter'],
    tags: ['forecast', 'timesfm', 'simulation'],
    confidence: uncertainty?.high ? 0.35 : 0.6,
    reviewStatus: 'draft',
  };
}
