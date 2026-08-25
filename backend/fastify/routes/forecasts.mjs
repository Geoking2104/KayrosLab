import { z } from 'zod';

import { loadKpiHistory } from '../../adapters/timesfm/index.mjs';

export const MIN_FORECAST_HISTORY = 20;

export function seriesFromIdea(idea, kpi, limit = 1_024) {
  return (idea?.impact?.releves || [])
    .filter((reading) => reading.kpiId === kpi && Number.isFinite(Number(reading.value)))
    .sort((left, right) => {
      const a = Date.parse(left.ts || '') || 0;
      const b = Date.parse(right.ts || '') || 0;
      return a - b;
    })
    .slice(-Math.max(1, limit))
    .map((reading) => Number(reading.value));
}

export async function forecastIdeaFromHistory(ctx, {
  idea,
  tenantId,
  kpi,
  horizon = 12,
  minHistory = MIN_FORECAST_HISTORY,
} = {}) {
  const tool = ctx?.tools?.get?.('projection.forecast');
  if (!tool) {
    const error = new Error('TimesFM forecasting is not enabled');
    error.code = 'TIMESFM_DISABLED';
    throw error;
  }

  const maxContext = Number(process.env.TIMESFM_MAX_CONTEXT) || 1_024;
  const localSeries = seriesFromIdea(idea, kpi, maxContext);
  let databaseSeries = [];
  try {
    databaseSeries = await loadKpiHistory(ctx.pgPool, {
      tenantId, ideaId: idea.id, kpi, limit: maxContext,
    });
  } catch (error) {
    ctx.logger?.warn?.(`[TimesFM] KPI history lookup failed: ${error.message}`);
  }
  const inputs = databaseSeries.length > localSeries.length ? databaseSeries : localSeries;
  if (inputs.length < minHistory) {
    const error = new Error(`At least ${minHistory} observed values are required for ${kpi}`);
    error.code = 'INSUFFICIENT_HISTORY';
    error.observed = inputs.length;
    throw error;
  }

  const batch = await ctx.tools.call('projection.forecast', {
    inputs: [inputs],
    ideaIds: [idea.id],
    kpi,
    horizon,
  }, { tenantId, ideaId: idea.id });

  return {
    ideaId: idea.id,
    kpi,
    horizon,
    history_points: inputs.length,
    point_forecast: batch.point_forecast[0],
    quantile_forecast: batch.quantile_forecast[0],
    quantiles: batch.quantiles,
    uncertainty: batch.meta[0]?.uncertainty || null,
    requires_human_review: batch.meta[0]?.requiresHumanReview === true,
    model_id: batch.model_id,
    provenance: batch.provenance,
    simulated: true,
    governance_label: batch.governance_label,
    cached: batch.cached,
    created_at: batch.created_at,
  };
}

function forecastError(reply, error) {
  if (error.code === 'TIMESFM_DISABLED') {
    return reply.code(503).send({ error: error.message, code: error.code });
  }
  if (error.code === 'INSUFFICIENT_HISTORY') {
    return reply.code(422).send({
      error: error.message, code: error.code, observed: error.observed,
      required: MIN_FORECAST_HISTORY,
    });
  }
  const status = /service error|timed out|fetch failed/i.test(error.message) ? 503 : 400;
  return reply.code(status).send({ error: error.message, code: 'FORECAST_FAILED' });
}

export default async function forecastsRoute(app) {
  app.get('/v1/forecast/status', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const timesfm = app.kayrosContext?.timesfm;
    if (!timesfm?.health) return { enabled: false, available: false, reason: timesfm?.reason || 'disabled' };
    return timesfm.health();
  });

  app.post('/v1/ideas/:id/forecast', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) {
      return reply.code(404).send({ error: 'introuvable' });
    }
    const defaultKpi = idea.roadmap?.kpis?.[0]?.id || 'impact_score';
    const parsed = z.object({
      kpi: z.string().trim().min(1).max(128).optional().default(defaultKpi),
      horizon: z.number().int().min(1).max(1_000).optional().default(12),
    }).safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation failed', issues: parsed.error.issues });

    try {
      const forecast = await forecastIdeaFromHistory(ctx, {
        idea, tenantId: me.tenantId, kpi: parsed.data.kpi, horizon: parsed.data.horizon,
      });
      const out = {
        ...idea,
        forecasts: { ...(idea.forecasts || {}), [parsed.data.kpi]: forecast },
        updatedAt: new Date().toISOString(),
      };
      await ctx.ideas.save(out);
      ctx.journal?.({
        type: 'project.forecast', by: me.email, ideaId: idea.id, kpi: parsed.data.kpi,
        horizon: parsed.data.horizon, uncertaintyHigh: forecast.requires_human_review,
      });
      return forecast;
    } catch (error) {
      return forecastError(reply, error);
    }
  });

  app.get('/v1/ideas/:id/forecasts', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ctx = app.kayrosContext;
    const idea = await ctx.ideas.get(req.params.id);
    if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) {
      return reply.code(404).send({ error: 'introuvable' });
    }
    if (!ctx.pgPool) return { forecasts: Object.values(idea.forecasts || {}) };
    try {
      const { rows } = await ctx.pgPool.query(
        `select idea_id, kpi, horizon, point_forecast, quantile_forecast, model_id, meta,
                created_at, updated_at
         from kayros_forecasts where tenant_id = $1 and idea_id = $2
         order by updated_at desc`,
        [me.tenantId, idea.id],
      );
      return { forecasts: rows.map((row) => ({ ...row, simulated: true })) };
    } catch (error) {
      return reply.code(503).send({ error: 'forecast storage unavailable' });
    }
  });
}
