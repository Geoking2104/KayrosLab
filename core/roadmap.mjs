// KayrosLab — Etape Projeter : construction pure de la roadmap + projections (EF-39/40/41).
// Calcule ressources/budget et projections probabilistes (Monte-Carlo déterministe)
// a partir d'hypothesess fournis par le Planner/LLM. Aucun chiffre n'est invente.
import { estimateResources, simulateTrajectory } from './projection.mjs';

export function buildRoadmap({
  milestones = [], raci = [], kpis = [], risques = [], gatesFuturs = [],
  costHypotheses = {}, scenarios = [], variables = [], iterations = 10000, seed = 42,
} = {}) {
  const jalons = Array.isArray(milestones) ? milestones : [];
  const ressources = estimateResources({ milestones: jalons, costHypotheses });
  let projections = null;
  if (Array.isArray(scenarios) && scenarios.length) {
    projections = simulateTrajectory({ scenarios, variables, iterations, seed });
  }
  const roadmap = {
    jalons, raci, kpis, risques, gatesFuturs,
    ressources,
    kpisResume: kpis.length, risquesResume: risques.length,
  };
  return { roadmap, ressources, projections };
}

export function projectFromIdea(idea = {}) {
  const r = idea?.roadmap ?? {};
  return buildRoadmap({
    milestones: r.jalons ?? r.milestones ?? [],
    raci: r.raci ?? [],
    kpis: r.kpis ?? [],
    risques: r.risques ?? [],
    gatesFuturs: r.gatesFuturs ?? [],
    costHypotheses: idea?.projection?.costHypotheses ?? r.costHypotheses ?? {},
    scenarios: idea?.projection?.scenarios ?? [],
    variables: idea?.projection?.variables ?? [],
    iterations: idea?.projection?.iterations, seed: idea?.projection?.seed,
  });
}

export function isProjected(idea = {}) {
  return !!(idea.roadmap?.jalons?.length || idea.roadmap?.ressources || idea.projections);
}
