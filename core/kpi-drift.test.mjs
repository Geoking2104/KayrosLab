import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { linearSlope, detectKpiDrift, evaluateKpiDrifts, driftsToSignals } from './kpi-drift.mjs';
import { evaluateKpisWithDrift } from './loop.mjs';

describe('kpi-drift', () => {
  it('linearSlope detects upward trend', () => {
    const series = [{ value: 10 }, { value: 12 }, { value: 15 }, { value: 20 }];
    const { slope, n } = linearSlope(series);
    assert.equal(n, 4);
    assert.ok(slope > 0);
  });

  it('detectKpiDrift fires on large relative change', () => {
    const kpi = { id: 'conv', name: 'Conversion', drift: { minPoints: 3, maxRelativeChange: 0.2 } };
    const readings = [
      { kpiId: 'conv', value: 100, ts: '2026-01-01T00:00:00Z' },
      { kpiId: 'conv', value: 95, ts: '2026-02-01T00:00:00Z' },
      { kpiId: 'conv', value: 60, ts: '2026-03-01T00:00:00Z' },
    ];
    const d = detectKpiDrift(kpi, readings);
    assert.ok(d);
    assert.equal(d.type, 'drift');
    assert.equal(d.kpiId, 'conv');
  });

  it('detectKpiDrift stays quiet when stable', () => {
    const kpi = { id: 'nps', drift: { minPoints: 3, maxRelativeChange: 0.25 } };
    const readings = [
      { kpiId: 'nps', value: 50 },
      { kpiId: 'nps', value: 51 },
      { kpiId: 'nps', value: 52 },
    ];
    assert.equal(detectKpiDrift(kpi, readings), null);
  });

  it('evaluateKpisWithDrift merges threshold + drift signals', () => {
    const kpis = [
      { id: 'x', name: 'X', threshold: 10, comparator: 'lte', drift: { minPoints: 3, maxRelativeChange: 0.3 } },
    ];
    const readings = [
      { kpiId: 'x', value: 100 },
      { kpiId: 'x', value: 80 },
      { kpiId: 'x', value: 5 },
    ];
    const result = evaluateKpisWithDrift(kpis, readings, { ideaId: 'idea-1' });
    assert.ok(result.alerts.length >= 1);
    assert.ok(result.drifts.length >= 1);
    assert.ok(result.signals.length >= 2);
  });

  it('driftsToSignals shape', () => {
    const signals = driftsToSignals([{ kpiId: 'a', name: 'A', reason: 'test', latest: 1, baseline: 2 }], { ideaId: 'i' });
    assert.equal(signals.length, 1);
    assert.equal(signals[0].source, 'kpi-drift');
    assert.match(signals[0].id, /^i:drift:a:/);
  });
});
