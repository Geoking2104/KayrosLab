// KayrosLab — Projection (etape Projeter) : calculs DETERMINISTES.
// Ref. specs techniques §4.1. Le LLM fournit hypotheses/distributions ; ici on CALCULE.
// Aucun chiffre "invente" : tout est reproductible (PRNG seede).

/** Arrondi stable (6 decimales) pour des sorties comparables en test. */
export const round6 = (x) => Math.round((Number(x) || 0) * 1e6) / 1e6;

/** PRNG deterministe (mulberry32) — reproductible pour les tests. */
export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Quantile (interpolation lineaire) sur un tableau trie croissant. */
export function quantile(sorted, q) {
  if (!sorted.length) return 0;
  if (q <= 0) return sorted[0];
  if (q >= 1) return sorted[sorted.length - 1];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Normalise les probabilites des scenarios (somme = 1). */
function normalizeScenarios(scenarios) {
  const s = scenarios.reduce((n, x) => n + (Number(x.probability) || 0), 0);
  if (s <= 0) return scenarios.map((x) => ({ ...x, probability: 1 / scenarios.length }));
  return scenarios.map((x) => ({ ...x, probability: (Number(x.probability) || 0) / s }));
}

/**
 * Simulation de trajectoire (Monte-Carlo deterministe).
 * @param {{scenarios:{name?:string,probability:number,value:number}[], variables?:{name?:string,min:number,max:number}[], iterations?:number, seed?:number}} input
 * @returns {{scenariosPonderes:any[], valeurAttendue:number, moyenneSimulee:number, p10:number, p50:number, p90:number, iterations:number}}
 */
export function simulateTrajectory({ scenarios = [], variables = [], iterations = 10000, seed = 42 } = {}) {
  if (!Array.isArray(scenarios) || !scenarios.length) throw new Error('simulateTrajectory: scenarios requis');
  const scn = normalizeScenarios(scenarios);
  // Esperance analytique (exacte, deterministe).
  const valeurAttendue = scn.reduce((n, x) => n + x.probability * (Number(x.value) || 0), 0);
  // Bornes cumulees pour l'echantillonnage par probabilite.
  const cum = []; let acc = 0;
  for (const x of scn) { acc += x.probability; cum.push(acc); }
  const rng = mulberry32(seed);
  const n = Math.max(1, Math.floor(iterations));
  const outcomes = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = rng();
    let k = cum.findIndex((c) => r <= c); if (k < 0) k = scn.length - 1;
    let v = Number(scn[k].value) || 0;
    for (const varr of variables) {
      const lo = Number(varr.min) || 0, hi = Number(varr.max) || 0;
      v += lo + (hi - lo) * rng(); // bruit uniforme [min,max]
    }
    outcomes[i] = v;
  }
  outcomes.sort((a, b) => a - b);
  const mean = outcomes.reduce((s, v) => s + v, 0) / n;
  return {
    scenariosPonderes: scn.map((x) => ({ name: x.name ?? null, probability: round6(x.probability), value: Number(x.value) || 0 })),
    valeurAttendue: round6(valeurAttendue),
    moyenneSimulee: round6(mean),
    p10: round6(quantile(outcomes, 0.10)),
    p50: round6(quantile(outcomes, 0.50)),
    p90: round6(quantile(outcomes, 0.90)),
    iterations: n,
  };
}

/**
 * Estimation ressources & budget (deterministe).
 * @param {{milestones:{name?:string,effortPersonMonths:number,durationMonths?:number}[], costHypotheses?:{costPerPersonMonth?:number, overheadRate?:number, expectedRevenue?:number, runRateMonthly?:number, horizonMonths?:number}}} input
 * @returns {{etp:number, budget:number, tco:number, roiProjete:number|null, totalEffortPersonMonths:number, horizonMonths:number}}
 */
export function estimateResources({ milestones = [], costHypotheses = {} } = {}) {
  const cpm = Number(costHypotheses.costPerPersonMonth) || 0;
  const overhead = Number(costHypotheses.overheadRate) || 0;
  const runRate = Number(costHypotheses.runRateMonthly) || 0;
  const revenue = Number(costHypotheses.expectedRevenue) || 0;
  const totalEffort = milestones.reduce((n, m) => n + (Number(m.effortPersonMonths) || 0), 0);
  const durSum = milestones.reduce((n, m) => n + (Number(m.durationMonths) || 0), 0);
  const horizon = Number(costHypotheses.horizonMonths) || durSum || 1;
  const budget = totalEffort * cpm * (1 + overhead);
  const tco = budget + runRate * horizon;
  const roiProjete = tco > 0 ? round6((revenue - tco) / tco) : null;
  return {
    etp: round6(totalEffort / horizon),
    budget: round6(budget),
    tco: round6(tco),
    roiProjete,
    totalEffortPersonMonths: round6(totalEffort),
    horizonMonths: horizon,
  };
}
