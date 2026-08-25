import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeForecastUncertainty,
  summarizeForecastForMemory,
  validateForecastInput,
} from './timesfm-forecast.mjs';

test('validateForecastInput accepts a bounded batch and rejects non-finite values', () => {
  const valid = validateForecastInput({ inputs: [[1, 2, 3]], horizon: 6, ideaIds: ['idea-1'] });
  assert.equal(valid.horizon, 6);
  assert.throws(
    () => validateForecastInput({ inputs: [[1, Number.NaN, 3]] }),
    /finite numbers/,
  );
  assert.throws(
    () => validateForecastInput({ inputs: [[1, 2, 3]], ideaIds: [] }),
    /batch length/,
  );
});

test('computeForecastUncertainty reads P10/P50/P90 from the nine-quantile response', () => {
  const narrow = computeForecastUncertainty(
    [100, 110],
    [
      [90, 92, 94, 96, 100, 104, 106, 108, 110],
      [100, 102, 104, 106, 110, 114, 116, 118, 120],
    ],
  );
  assert.equal(narrow.high, false);
  assert.equal(narrow.meanWidth, 20);

  const wide = computeForecastUncertainty(
    [10],
    [[-10, -5, 0, 2, 10, 15, 18, 20, 30]],
  );
  assert.equal(wide.high, true);
  assert.equal(wide.ratio, 4);
});

test('forecast memory records remain explicitly simulated and draft', () => {
  const record = summarizeForecastForMemory({
    ideaId: 'idea-1', kpi: 'adoption', horizon: 2,
    point: [10, 12], uncertainty: { ratio: 0.2, high: false }, modelId: 'timesfm-test',
  });
  assert.equal(record.reviewStatus, 'draft');
  assert.ok(record.tags.includes('simulation'));
  assert.match(record.content, /SIMULATION/);
});
