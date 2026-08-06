import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  tagEpistemic, aggregateEpistemic, explainUncertainty,
  inferLevelFromContext, normalizeLevel,
} from './epistemic.mjs';

describe('tagEpistemic', () => {
  it('tags observed claim with default confidence', () => {
    const t = tagEpistemic('competitor X raises prices', {
      level: 'observed', source: 'scanner', evidence: ['search:1'],
    });
    assert.equal(t.level, 'observed');
    assert.ok(t.confidence >= 0.8);
  });
  it('forces degraded when meta.degraded', () => {
    const t = tagEpistemic('maybe', { level: 'inferred', degraded: true });
    assert.equal(t.level, 'degraded');
    assert.ok(t.confidence <= 0.35);
  });
});

describe('inferLevelFromContext', () => {
  it('marks heuristic positioning degraded', () => {
    assert.equal(inferLevelFromContext({ mode: 'heuristic' }), 'degraded');
  });
  it('marks scanners observed', () => {
    assert.equal(inferLevelFromContext({ mode: 'scanners' }), 'observed');
  });
  it('marks bisociator hypothesized', () => {
    assert.equal(inferLevelFromContext({ source: 'agent', agent: 'Bisociateur' }), 'hypothesized');
  });
});

describe('aggregateEpistemic + explainUncertainty', () => {
  it('worst-link on critical claims', () => {
    const items = [
      tagEpistemic('fact', { level: 'observed', kind: 'observation' }),
      tagEpistemic('go', { level: 'degraded', kind: 'recommendation' }),
    ];
    const agg = aggregateEpistemic(items);
    assert.equal(agg.level, 'degraded');
    const expl = explainUncertainty(agg, { recommendation: 'go' });
    assert.ok(expl.summary.includes('degraded'));
  });
  it('empty → unknown hole', () => {
    const agg = aggregateEpistemic([]);
    assert.equal(agg.level, 'unknown');
    assert.ok(agg.criticalHoles.includes('no_epistemic_items'));
  });
});

describe('normalizeLevel', () => {
  it('defaults unknown', () => {
    assert.equal(normalizeLevel('nope'), 'unknown');
  });
});
