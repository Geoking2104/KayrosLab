import test from 'node:test';
import assert from 'node:assert/strict';

import { ToolRegistry } from '../../../core/tool-registry.mjs';
import { registerTimesFM } from '../../adapters/timesfm/index.mjs';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('TimesFM adapter registers the real ToolDef, labels simulation and caches exact inputs', async () => {
  const calls = [];
  const queries = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      point_forecast: [[4, 5]],
      quantile_forecast: [[
        [1, 2, 2.5, 3, 4, 4.2, 4.4, 4.8, 6],
        [2, 3, 3.5, 4, 5, 5.2, 5.4, 5.8, 7],
      ]],
      model_id: 'google/timesfm-2.5-200m-pytorch',
      provenance: 'test',
    });
  };
  const pgPool = { query: async (...args) => { queries.push(args); return { rows: [] }; } };
  const tools = new ToolRegistry();
  registerTimesFM(tools, {
    fetchImpl, pgPool, token: 'secret', maxHorizon: 10, logger: { info() {}, warn() {} },
  });

  const payload = { inputs: [[1, 2, 3]], ideaIds: ['idea-1'], kpi: 'adoption', horizon: 2 };
  const first = await tools.call('projection.forecast', payload, { tenantId: 'tenant-a' });
  const second = await tools.call('projection.forecast', payload, { tenantId: 'tenant-a' });

  assert.equal(first.simulated, true);
  assert.match(first.governance_label, /^SIMULATION/);
  assert.equal(second.cached, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.authorization, 'Bearer secret');
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0][1].slice(0, 4), ['tenant-a', 'idea-1', 'adoption', 2]);
});

test('TimesFM adapter rejects malformed service quantiles', async () => {
  const tools = new ToolRegistry();
  registerTimesFM(tools, {
    fetchImpl: async () => jsonResponse({
      point_forecast: [[4]],
      quantile_forecast: [[[[1, 2]]]],
    }),
    maxHorizon: 10,
    logger: { info() {}, warn() {} },
  });
  await assert.rejects(
    tools.call('projection.forecast', { inputs: [[1, 2, 3]], horizon: 1 }),
    /invalid quantile/,
  );
});
