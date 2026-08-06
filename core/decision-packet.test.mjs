import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compilePacket, assertGateable, applyEpistemicPolicy,
  renderPacketForGate, normalizeRecommendation, policyForPacket,
} from './decision-packet.mjs';

describe('normalizeRecommendation', () => {
  it('parses variants', () => {
    assert.equal(normalizeRecommendation('No-Go'), 'no-go');
    assert.equal(normalizeRecommendation('GO'), 'go');
    assert.equal(normalizeRecommendation('please revise'), 'revise');
  });
});

describe('compilePacket', () => {
  it('builds packet from agent outputs + degraded synthesis softens Go', () => {
    const packet = compilePacket({
      ideaId: 'idea-1',
      goal: 'Launch EU sovereign AI',
      agentOutputs: [
        { agent: 'Critic', output: '- Regulatory risk on data residency is high and unresolved' },
        { agent: 'Bisociateur', output: 'Collision: edge inference + local compliance vault' },
      ],
      synthesis: {
        output: 'Recommended decision: Go. Confidence high.',
        structured: { decision: 'Go', confidence: 0.9 },
        degraded: { reason: 'mock_provider' },
      },
      positionning: { mode: 'heuristic', competitorCount: 0 },
    });
    assert.equal(packet.ideaId, 'idea-1');
    assert.equal(packet.recommendation, 'revise');
    assert.ok(packet.falsifiers.length >= 1);
  });

  it('keeps go when grounded and not degraded', () => {
    const packet = compilePacket({
      ideaId: 'i2',
      goal: 'Pilot',
      agentOutputs: [
        { agent: 'Positioner', output: 'Observed: 2 weak competitors, gap on on-prem tooling' },
      ],
      synthesis: {
        output: 'Decision: Go with pilot',
        structured: {
          decision: 'go', confidence: 0.7,
          falsifiers: ['Pilot CAC exceeds plan by 40%'],
          evidence: ['scan:web:1'],
        },
      },
      positionning: { mode: 'scanners', competitorCount: 2, gapCount: 1 },
      falsifiers: ['Pilot CAC exceeds plan by 40%'],
    });
    assert.equal(packet.recommendation, 'go');
    assert.equal(packet.world.level, 'observed');
  });
});

describe('assertGateable + applyEpistemicPolicy', () => {
  it('downgrades go → revise on epistemic blockers', () => {
    const packet = {
      recommendation: 'go',
      falsifiers: [],
      claims: [],
      epistemicStatus: { level: 'degraded', confidence: 0.2, criticalHoles: ['majority_degraded', 'no_grounded_evidence'] },
      recommendationTag: { level: 'degraded', degraded: true, kind: 'recommendation' },
    };
    const { packet: next, changed, assertion } = applyEpistemicPolicy(packet, { level: 'supervise' });
    assert.equal(changed, true);
    assert.equal(next.recommendation, 'revise');
    assert.ok(assertion.blockers.length >= 1);
  });
});

describe('renderPacketForGate + policyForPacket', () => {
  it('renders comex view', () => {
    const packet = compilePacket({
      ideaId: 'i3',
      goal: 'Y',
      synthesis: { output: 'Revise', structured: { decision: 'revise' } },
      agentOutputs: [{ agent: 'RedTeam', output: '- Failure mode: supply chain lock-in' }],
    });
    const view = renderPacketForGate(packet);
    assert.equal(view.ideaId, 'i3');
    assert.ok(view.epistemic.summary);
  });
  it('policy opens comex on blockers', () => {
    const packet = {
      recommendation: 'go',
      falsifiers: [],
      epistemicStatus: { level: 'degraded', confidence: 0.1, criticalHoles: ['majority_degraded'] },
      recommendationTag: { degraded: true, level: 'degraded' },
      claims: [],
    };
    assert.equal(policyForPacket(packet, { level: 'supervise', sensitive: false }), 'comex_arbitrage');
  });
});
