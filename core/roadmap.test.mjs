import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoadmap, projectFromIdea, isProjected } from './roadmap.mjs';

const scenarios = [{ probability: 1, value: 50 }, { probability: 1, value: 100 }]; // normalisee -> 0.5/0.5, EV = 75
const costHypotheses = { costPerPersonMonth: 100, overheadRate: 0.2, horizonMonths: 6 };
const milestones = [{ name: 'M1', effortPersonMonths: 3, durationMonths: 2 }, { name: 'M2', effortPersonMonths: 2, durationMonths: 4 }];

describe('roadmap', () => {
  it('buildRoadmap computes ressources + projections deterministically', () => {
    const { roadmap, ressources, projections } = buildRoadmap({ milestones, costHypotheses, scenarios, seed: 42, iterations: 1000 });
    assert.equal(roadmap.jalons.length, 2);
    assert.ok(roadmap.ressources);
    // budget = (3+2)*100*1.2 = 600 ; etp = 5/6
    assert.equal(ressources.budget, 600);
    assert.equal(ressources.totalEffortPersonMonths, 5);
    assert.equal(projections.valeurAttendue, 75);
  });

  it('sans scenarios, projections est null', () => {
    const { projections } = buildRoadmap({ milestones, costHypotheses });
    assert.equal(projections, null);
  });

  it('projectFromIdea rebuild from stored fields with deterministic seed', () => {
    const idea = { roadmap: { jalons: milestones, raci: [], kpis: [], risques: [], gatesFuturs: [], costHypotheses }, projection: { scenarios, variables: [], iterations: 1000, seed: 7 } };
    const a = projectFromIdea(idea);
    const b = projectFromIdea(idea);
    assert.equal(a.roadmap.jalons.length, 2);
    assert.equal(a.projections.valeurAttendue, 75);
    assert.deepEqual(a.projections, b.projections); // reproductible
  });

  it('isProjected detects a roadmap or projections on idea', () => {
    assert.equal(isProjected({}), false);
    assert.equal(isProjected({ roadmap: { jalons: [{}] } }), true);
    assert.equal(isProjected({ projections: { p50: 1 } }), true);
  });
});
