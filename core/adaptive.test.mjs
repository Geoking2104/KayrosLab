// Node test for P4 adaptive + residual portfolio
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePressure,
  allocateCompute,
  buildResidualPortfolio,
  suggestRevisitTriggers,
  runAdaptiveControl,
} from './adaptive.mjs';

describe('computePressure + allocateCompute', () => {
  it('raises pressure on weak frame and high stakes', () => {
    const low = computePressure({ frameQuality: 0.8, epistemicRank: 4, stakes: 'low', criticalAssumptions: 0 });
    const high = computePressure({ frameQuality: 0.3, epistemicRank: 1, stakes: 'high', criticalAssumptions: 3 });
    assert.ok(high.pressure > low.pressure);
    const budget = allocateCompute(high);
    assert.ok(budget.maxSteps >= 10);
    assert.equal(budget.requireFalsifiers, true);
  });
});

describe('residual portfolio', () => {
  it('aggregates survivors and critical assumptions', () => {
    const world = {
      assumptions: [
        { id: 'a1', text: 'Users will pay', critical: true, confidence: 0.3, falsifier: 'No WTP' },
        { id: 'a2', text: 'Nice to have', critical: false, confidence: 0.5 },
      ],
    };
    const p = buildResidualPortfolio({
      survivingOptions: [{ id: 'o1', claim: 'Option A', residualSeverity: 0.6 }],
      residualRisks: ['Execution risk'],
      world,
      recommendation: 'go',
    });
    assert.ok(p.stats.portfolioRisk > 0.3);
    assert.ok(p.stats.decisionDebt > 0);
    assert.ok(p.items.length >= 2);
  });
});

describe('runAdaptiveControl', () => {
  it('emits pressure and portfolio events with triggers', () => {
    const res = runAdaptiveControl({
      frameQuality: 0.4,
      epistemicRank: 2,
      stakes: 'high',
      criticalAssumptions: 2,
      survivingOptions: [{ claim: 'Pilot narrow segment' }],
      residualRisks: ['Compliance lag'],
      recommendation: 'go',
    });
    assert.ok(res.pressure.pressure > 0);
    assert.ok(res.portfolio.stats.openCount >= 1);
    assert.ok(Array.isArray(res.triggers));
    assert.ok(res.events.some((e) => e.type === 'adaptive_pressure'));
    assert.ok(res.events.some((e) => e.type === 'residual_portfolio'));
  });
});
