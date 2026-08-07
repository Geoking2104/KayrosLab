// Node test for P3 world-model + gate resolution
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sketchWorldModel,
  resolveGateLevel,
  packetFieldsFromWorld,
  runWorldModelControl,
} from './world-model.mjs';

describe('sketchWorldModel', () => {
  it('extracts actors and constraints from a concrete goal', () => {
    const w = sketchWorldModel(
      'Launch a B2B SaaS pilot for SME customers in 90 days under GDPR with limited sales team capacity',
    );
    assert.ok(w.actors.length >= 2);
    assert.ok(w.constraints.length >= 2);
    assert.ok(w.assumptions.some((a) => a.critical));
    assert.ok(w.stats.coverage > 0.2);
    assert.ok(['low', 'medium', 'high'].includes(w.stakes));
  });

  it('produces default assumptions on a vague goal', () => {
    const w = sketchWorldModel('Improve things');
    assert.ok(w.assumptions.length >= 2);
    assert.ok(w.uncertainties.length >= 1);
  });
});

describe('resolveGateLevel', () => {
  it('returns heavy for high stakes + many critical assumptions', () => {
    const r = resolveGateLevel({
      frameQuality: 0.6,
      world: { stakes: 'high', stats: { criticalAssumptions: 3, coverage: 0.5 } },
      epistemicRank: 2,
      recommendation: 'go',
    });
    assert.equal(r.level, 'heavy');
    assert.equal(r.requiredRole, 'comex');
  });

  it('returns light for weak frame and low coverage', () => {
    const r = resolveGateLevel({
      frameQuality: 0.25,
      world: { stakes: 'low', stats: { criticalAssumptions: 0, coverage: 0.15 } },
      epistemicRank: 3,
    });
    assert.equal(r.level, 'light');
  });
});

describe('runWorldModelControl', () => {
  it('emits world_model and gate_resolution events', async () => {
    const res = await runWorldModelControl({
      goal: 'Build a privacy-first P2P file transfer for regulated enterprises in 6 months',
      opts: { ideaId: 't1' },
    });
    assert.ok(res.world);
    assert.ok(res.gateResolution?.level);
    assert.ok(res.events.some((e) => e.type === 'world_model'));
    assert.ok(res.events.some((e) => e.type === 'gate_resolution'));
    const fields = packetFieldsFromWorld(res.world);
    assert.ok(Array.isArray(fields.criticalAssumptions));
  });
});
