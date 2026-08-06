import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  killNearDuplicates, enforceAxisQuotas, shouldReBisociate,
  runNoveltyControl, optionsFromNoveltyResult, inferAxis,
} from './novelty-controller.mjs';

describe('killNearDuplicates', () => {
  it('keeps diverse vectors, kills near copies', () => {
    const { survivors, killed } = killNearDuplicates([
      { id: 'a', embedding: [1, 0, 0], novelty: 0.9 },
      { id: 'b', embedding: [0.99, 0.01, 0], novelty: 0.8 },
      { id: 'c', embedding: [0, 1, 0], novelty: 0.7 },
    ], { threshold: 0.9 });
    assert.ok(survivors.length >= 2);
    assert.ok(killed.length >= 1);
    assert.equal(killed[0].killReason.code, 'near_duplicate');
  });
});

describe('enforceAxisQuotas + inferAxis', () => {
  it('detects regulation axis', () => {
    assert.equal(inferAxis({ text: 'GDPR residency compliance vault' }), 'regulation');
  });
  it('reports missing axes', () => {
    const { missingAxes, coverage } = enforceAxisQuotas([
      { text: 'edge LLM inference stack', novelty: 0.6 },
    ], { minPerAxis: 1, axes: ['technology', 'regulation'] });
    assert.ok(coverage.technology >= 1);
    assert.ok(missingAxes.includes('regulation'));
  });
});

describe('shouldReBisociate', () => {
  it('requests more when median low', () => {
    const d = shouldReBisociate([{ novelty: 0.1 }, { novelty: 0.2 }], { minMedianNovelty: 0.35 });
    assert.equal(d.reBisociate, true);
  });
  it('stops at max rounds', () => {
    assert.equal(shouldReBisociate([{ novelty: 0.1 }], { round: 2, maxRounds: 2 }).reBisociate, false);
  });
});

describe('runNoveltyControl', () => {
  it('works without embeddings + can reBisociate via generateMore', async () => {
    let calls = 0;
    const result = await runNoveltyControl(
      [{ proposal: 'A tech platform for X', id: '1' }],
      {
        minMedianNovelty: 0.9, maxRounds: 2,
        generateMore: async () => { calls += 1; return [{ proposal: 'Regulatory-first compliance channel', id: '2' }]; },
      },
    );
    assert.ok(result.survivors.length >= 1);
    assert.ok(calls >= 1);
    assert.ok(optionsFromNoveltyResult(result).survivingOptions.length >= 1);
  });
});
