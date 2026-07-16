// KayrosLab — Kayroslab Index (KI).
// Réf. specs techniques §11 + décision : KI D'ABORD STRATÉGIQUE, puis technique.
// Les 6 dimensions techniques (instrumentation) alimentent les 5 dimensions stratégiques (décision).

export const STRATEGIC_DIMS = ['fitStrategique', 'desirabilite', 'faisabilite', 'viabilite', 'adaptabilite'];
export const TECHNICAL_DIMS = ['global', 'velocite', 'divergence', 'fiabilite', 'impact', 'originalite'];

const clamp10 = (x) => Math.max(0, Math.min(10, x));

/**
 * Matrice de pondération par défaut technique -> stratégique (identité pondérée, à calibrer — §11).
 * Chaque dimension stratégique = moyenne pondérée de dimensions techniques.
 */
export const DEFAULT_WEIGHTS = {
  fitStrategique: { global: 0.5, impact: 0.5 },
  desirabilite: { impact: 0.6, originalite: 0.4 },
  faisabilite: { fiabilite: 0.7, velocite: 0.3 },
  viabilite: { global: 0.4, fiabilite: 0.6 },
  adaptabilite: { divergence: 0.5, originalite: 0.5 },
};

/**
 * Calcule les 5 dimensions stratégiques à partir des 6 techniques.
 * @param {Record<string,number>} technical
 * @param {object} [weights]
 * @returns {Record<string,number>} dimensions stratégiques (0..10)
 */
export function toStrategic(technical = {}, weights = DEFAULT_WEIGHTS) {
  const out = {};
  for (const dim of STRATEGIC_DIMS) {
    const w = weights[dim] || {};
    let sum = 0, wsum = 0;
    for (const [tech, coef] of Object.entries(w)) {
      sum += (technical[tech] ?? 0) * coef;
      wsum += coef;
    }
    out[dim] = clamp10(wsum > 0 ? sum / wsum : 0);
  }
  return out;
}

/** Score global stratégique = moyenne des 5 dimensions. */
export function strategicGlobal(strategic) {
  const vals = STRATEGIC_DIMS.map((d) => strategic[d] ?? 0);
  return clamp10(vals.reduce((a, b) => a + b, 0) / vals.length);
}
