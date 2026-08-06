import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  heuristicAttack, heuristicRebut, scoreSurvival, contestOption,
  runTournament, packetFieldsFromContest, asOption,
} from './dialectic.mjs';

describe('heuristic attack/rebut/survival', () => {
  it('produces attacks and residual risk', () => {
    const opt = asOption('Launch EU sovereign LLM with on-prem data residency');
    const atk = heuristicAttack(opt, { competitorCount: 3 });
    assert.ok(atk.attacks.length >= 3);
    const reb = heuristicRebut(opt, atk);
    assert.equal(reb.rebuttals.length, atk.attacks.length);
    const surv = scoreSurvival(opt, atk, reb);
    assert.ok(surv.survival >= 0 && surv.survival <= 1);
    assert.ok(surv.reasons.length >= 1);
  });
});

describe('contestOption + tournament', () => {
  it('contests a weak option', async () => {
    const r = await contestOption('Copy the market leader with a thin wrapper', {
      world: { degraded: true, competitorCount: 5 },
    });
    assert.ok(r.attack.attacks.length);
    assert.ok(r.survival);
  });
  it('tournament returns survivors and kill reasons', async () => {
    const t = await runTournament([
      { id: 'o1', claim: 'Narrow pilot on non-sensitive logs with clear KPI falsifier' },
      { id: 'o2', claim: 'Replace incumbent suite in 3 months without partners' },
      { id: 'o3', claim: 'Marketplace for regulated AI with residency by design' },
    ], { maxSurvivors: 2 });
    assert.ok(t.survivors.length <= 2);
    assert.ok(t.killed.length >= 1);
    assert.ok(t.killed[0].killReason);
    const fields = packetFieldsFromContest({ tournamentResult: t });
    assert.ok(fields.survivingOptions.length >= 1);
  });
});
