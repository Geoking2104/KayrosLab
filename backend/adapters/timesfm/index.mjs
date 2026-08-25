import { createHash } from 'node:crypto';

import {
  TIMESFM_QUANTILES,
  TIMESFM_TOOL_NAME,
  computeForecastUncertainty,
  timesfmToolContract,
  validateForecastInput,
} from '../../../core/adapters/timesfm-forecast.mjs';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8001';

function booleanEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normaliseEndpoint(value) {
  const url = new URL(value || DEFAULT_ENDPOINT);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('KAYROS_TIMESFM_ENDPOINT must use http or https');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  return url.toString().replace(/\/$/, '');
}

function cacheKey(payload) {
  return createHash('sha256').update(JSON.stringify({
    inputs: payload.inputs,
    horizon: payload.horizon,
    ideaIds: payload.ideaIds || [],
    kpi: payload.kpi || 'impact_score',
  })).digest('base64url');
}

function validateServiceResult(data, batchSize, horizon) {
  if (!data || !Array.isArray(data.point_forecast) || data.point_forecast.length !== batchSize) {
    throw new Error('TimesFM returned an invalid point forecast batch');
  }
  if (!Array.isArray(data.quantile_forecast) || data.quantile_forecast.length !== batchSize) {
    throw new Error('TimesFM returned an invalid quantile forecast batch');
  }
  for (let index = 0; index < batchSize; index += 1) {
    const point = data.point_forecast[index];
    const rows = data.quantile_forecast[index];
    if (!Array.isArray(point) || point.length !== horizon || !point.every(Number.isFinite)) {
      throw new Error('TimesFM returned invalid point forecast values');
    }
    if (!Array.isArray(rows) || rows.length !== horizon || rows.some((row) => (
      !Array.isArray(row)
      || row.length !== TIMESFM_QUANTILES.length
      || !row.every(Number.isFinite)
    ))) {
      throw new Error('TimesFM returned invalid quantile forecast values');
    }
  }
  return data;
}

async function persistForecasts(pgPool, result, payload, tenantId, logger) {
  if (!pgPool || !Array.isArray(payload.ideaIds)) return;
  for (let index = 0; index < payload.ideaIds.length; index += 1) {
    const ideaId = payload.ideaIds[index];
    if (!ideaId) continue;
    try {
      await pgPool.query(
        `insert into kayros_forecasts
           (tenant_id, idea_id, kpi, horizon, point_forecast, quantile_forecast, model_id, meta)
         values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb)
         on conflict (tenant_id, idea_id, kpi, horizon) do update set
           point_forecast = excluded.point_forecast,
           quantile_forecast = excluded.quantile_forecast,
           model_id = excluded.model_id,
           meta = excluded.meta,
           updated_at = now()`,
        [
          tenantId || 'default', ideaId, payload.kpi || 'impact_score', payload.horizon,
          JSON.stringify(result.point_forecast[index]),
          JSON.stringify(result.quantile_forecast[index]),
          result.model_id,
          JSON.stringify(result.meta[index]),
        ],
      );
    } catch (error) {
      logger?.warn?.(`[TimesFM] forecast persistence failed for ${ideaId}: ${error.message}`);
    }
  }
}

export function createTimesFMClient({
  endpoint = DEFAULT_ENDPOINT,
  token = '',
  fetchImpl = globalThis.fetch,
  pgPool = null,
  logger = console,
  timeoutMs = 30_000,
  cacheTtlMs = 15 * 60_000,
  maxCacheEntries = 100,
  maxBatch = 32,
  maxContext = 16_384,
  maxHorizon = 256,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('TimesFM requires fetch');
  const baseUrl = normaliseEndpoint(endpoint);
  const cache = new Map();

  function headers() {
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }

  function remember(key, value) {
    cache.delete(key);
    cache.set(key, { at: Date.now(), value });
    while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
  }

  async function forecast(rawPayload, callContext = {}) {
    const payload = validateForecastInput(rawPayload, { maxBatch, maxContext, maxHorizon });
    const key = cacheKey(payload);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < cacheTtlMs) {
      cache.delete(key);
      cache.set(key, cached);
      return { ...cached.value, cached: true };
    }
    if (cached) cache.delete(key);

    const response = await fetchImpl(`${baseUrl}/forecast`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ inputs: payload.inputs, horizon: payload.horizon }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const detail = String(await response.text()).slice(0, 300);
      throw new Error(`TimesFM service error ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    const data = validateServiceResult(await response.json(), payload.inputs.length, payload.horizon);
    const meta = data.point_forecast.map((point, index) => {
      const uncertainty = computeForecastUncertainty(point, data.quantile_forecast[index]);
      return {
        ideaId: payload.ideaIds?.[index] || null,
        uncertainty,
        requiresHumanReview: uncertainty.high,
      };
    });
    const result = {
      point_forecast: data.point_forecast,
      quantile_forecast: data.quantile_forecast,
      quantiles: [...TIMESFM_QUANTILES],
      meta,
      model_id: data.model_id || 'google/timesfm-2.5-200m-pytorch',
      provenance: data.provenance || null,
      simulated: true,
      governance_label: 'SIMULATION: TimesFM forecast — human arbitration required when uncertainty is high',
      cached: false,
      created_at: new Date().toISOString(),
    };
    await persistForecasts(pgPool, result, payload, callContext.tenantId, logger);
    remember(key, result);
    return result;
  }

  async function health() {
    try {
      const response = await fetchImpl(`${baseUrl}/health`, {
        method: 'GET',
        headers: headers(),
        signal: AbortSignal.timeout(Math.min(timeoutMs, 5_000)),
      });
      const body = await response.json().catch(() => null);
      return { enabled: true, available: response.ok, endpoint: baseUrl, service: body };
    } catch (error) {
      return { enabled: true, available: false, endpoint: baseUrl, error: error.message };
    }
  }

  return { endpoint: baseUrl, forecast, health, clearCache: () => cache.clear() };
}

export function registerTimesFM(tools, options = {}) {
  if (!tools || typeof tools.register !== 'function') throw new Error('TimesFM requires a ToolRegistry');
  const client = createTimesFMClient(options);
  tools.register({
    ...timesfmToolContract,
    handler: (payload, context) => client.forecast(payload, context),
  });
  options.logger?.info?.(`[TimesFM] registered ${TIMESFM_TOOL_NAME} -> ${client.endpoint}`);
  return client;
}

export function registerTimesFMFromEnv(tools, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  pgPool = null,
  logger = console,
} = {}) {
  if (!booleanEnv(env.KAYROS_TIMESFM_ENABLED)) {
    return { enabled: false, available: false, reason: 'disabled' };
  }
  return registerTimesFM(tools, {
    endpoint: env.KAYROS_TIMESFM_ENDPOINT || DEFAULT_ENDPOINT,
    token: env.KAYROS_TIMESFM_TOKEN || '',
    fetchImpl,
    pgPool,
    logger,
    timeoutMs: Number(env.KAYROS_TIMESFM_TIMEOUT_MS) || 30_000,
    cacheTtlMs: Number(env.KAYROS_TIMESFM_CACHE_TTL_MS) || 15 * 60_000,
    maxCacheEntries: Number(env.KAYROS_TIMESFM_CACHE_MAX) || 100,
    maxBatch: Number(env.KAYROS_TIMESFM_MAX_BATCH) || 32,
    maxContext: Number(env.TIMESFM_MAX_CONTEXT) || 1_024,
    maxHorizon: Number(env.TIMESFM_MAX_HORIZON) || 256,
  });
}

export async function persistKpiReadings(pgPool, { tenantId = 'default', ideaId, readings = [], source = 'monitor' }) {
  if (!pgPool || !ideaId || !readings.length) return 0;
  let count = 0;
  for (const reading of readings) {
    await pgPool.query(
      `insert into kayros_kpi_history (tenant_id, idea_id, kpi, ts, value, source)
       values ($1, $2, $3, coalesce($4::timestamptz, now()), $5, $6)`,
      [tenantId, ideaId, reading.kpiId, reading.ts || null, reading.value, source],
    );
    count += 1;
  }
  return count;
}

export async function loadKpiHistory(pgPool, {
  tenantId = 'default', ideaId, kpi, limit = 1_024,
} = {}) {
  if (!pgPool || !ideaId || !kpi) return [];
  const { rows } = await pgPool.query(
    `select value from (
       select value, ts, id from kayros_kpi_history
       where tenant_id = $1 and idea_id = $2 and kpi = $3
       order by ts desc, id desc limit $4
     ) recent order by ts asc, id asc`,
    [tenantId, ideaId, kpi, Math.max(1, Math.min(Number(limit) || 1_024, 16_384))],
  );
  return rows.map((row) => Number(row.value)).filter(Number.isFinite);
}
