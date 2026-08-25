import test from 'node:test';
import assert from 'node:assert/strict';

import { ToolRegistry } from '../../../core/tool-registry.mjs';
import { forecastIdeaFromHistory, seriesFromIdea } from '../routes/forecasts.mjs';

test('seriesFromIdea sorts and scopes observed values by KPI', () => {
  const idea = { impact: { releves: [
    { kpiId: 'adoption', value: 3, ts: '2026-01-03T00:00:00Z' },
    { kpiId: 'other', value: 99, ts: '2026-01-01T00:00:00Z' },
    { kpiId: 'adoption', value: 1, ts: '2026-01-01T00:00:00Z' },
    { kpiId: 'adoption', value: 2, ts: '2026-01-02T00:00:00Z' },
  ] } };
  assert.deepEqual(seriesFromIdea(idea, 'adoption'), [1, 2, 3]);
});

test('forecastIdeaFromHistory keeps the forecast simulated and tenant-scoped', async () => {
  const tools = new ToolRegistry();
  let callContext = null;
  tools.register({
    name: 'projection.forecast', inputKeys: ['inputs'], sideEffect: 'read',
    handler: async (payload, context) => {
      callContext = context;
      return {
        point_forecast: [[21, 22]],
        quantile_forecast: [Array.from({ length: 2 }, () => [10, 12, 14, 16, 20, 24, 26, 28, 30])],
        quantiles: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
        meta: [{ uncertainty: { ratio: 1 }, requiresHumanReview: true }],
        model_id: 'timesfm-test', governance_label: 'SIMULATION', simulated: true,
        cached: false, created_at: '2026-01-01T00:00:00Z',
      };
    },
  });
  const idea = {
    id: 'idea-1',
    impact: { releves: Array.from({ length: 20 }, (_, index) => ({ kpiId: 'adoption', value: index + 1 })) },
  };
  const result = await forecastIdeaFromHistory({ tools, pgPool: null }, {
    idea, tenantId: 'tenant-a', kpi: 'adoption', horizon: 2,
  });
  assert.equal(result.simulated, true);
  assert.equal(result.requires_human_review, true);
  assert.equal(result.history_points, 20);
  assert.equal(callContext.tenantId, 'tenant-a');
});

test('forecastIdeaFromHistory rejects short histories before model invocation', async () => {
  const tools = new ToolRegistry();
  tools.register({ name: 'projection.forecast', inputKeys: ['inputs'], handler: async () => ({}) });
  await assert.rejects(
    forecastIdeaFromHistory({ tools, pgPool: null }, {
      idea: { id: 'idea-1', impact: { releves: [{ kpiId: 'k', value: 1 }] } },
      tenantId: 'tenant-a', kpi: 'k', horizon: 2,
    }),
    (error) => error.code === 'INSUFFICIENT_HISTORY' && error.observed === 1,
  );
});
