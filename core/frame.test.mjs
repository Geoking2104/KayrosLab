// Node test for P2 frame control
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreFrameDimensions,
  detectFrameIssues,
  assessFrame,
  generateHeuristicReframes,
  shouldOpenFrameGate,
  runFrameControl,
} from './frame.mjs';

describe('frame dimensions', () => {
  it('scores a vague goal low', () => {
    const d = scoreFrameDimensions('Améliorer l’expérience client');
    assert.ok(d.quality < 0.45, `expected low quality, got ${d.quality}`);
    assert.ok(d.specificity < 0.5);
  });

  it('scores a concrete constrained goal higher', () => {
    const d = scoreFrameDimensions(
      'Augmenter le taux de conversion onboarding B2B de 12% à 20% en 6 mois pour les PME françaises, budget < 80k€, conformité RGPD',
    );
    assert.ok(d.quality > 0.55, `expected higher quality, got ${d.quality}`);
    assert.ok(d.constraints > 0.5);
    assert.ok(d.measurability > 0.5);
  });
});

describe('assessFrame + issues', () => {
  it('flags generic improve', () => {
    const a = assessFrame('Améliorer le produit');
    assert.equal(a.needsReframe, true);
    assert.ok(a.issues.some((i) => i.code === 'generic_improve' || i.code === 'vague'));
  });

  it('accepts a solid frame', () => {
    const a = assessFrame(
      'Piloter un MVP de diagnostic DPE assisté IA pour agences immobilières IDF, KPI = 30 diagnostics/semaine à M+3, budget 40k€',
    );
    assert.ok(a.quality >= 0.5);
    assert.equal(a.needsReframe, false);
  });
});

describe('reframes + gate', () => {
  it('generates heuristic reframes', () => {
    const r = generateHeuristicReframes('Lancer une offre data');
    assert.ok(r.length >= 3);
    assert.ok(r.every((x) => x.frame && x.label));
  });

  it('opens gate on weak frame', () => {
    const a = assessFrame('Innover');
    const g = shouldOpenFrameGate(a);
    assert.ok(g.open || g.auto, 'should open or auto-reframe');
  });

  it('runFrameControl auto-picks on very weak goal', async () => {
    const res = await runFrameControl({
      goal: 'Améliorer',
      opts: { autoPickFrame: true, frameGate: false },
    });
    assert.ok(res.assessment.needsReframe);
    assert.ok(res.events.some((e) => e.type === 'frame_assess'));
    assert.ok(res.effectiveFrame);
    assert.notEqual(res.effectiveFrame, 'Améliorer');
  });
});
