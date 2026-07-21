// KayrosLab — Impact reel : investissements, benefices, et ECART realise vs projete.
// C'est le bouclage de l'etape Projeter : la projection Monte-Carlo (deterministe)
// est confrontee aux valeurs constatees. Differenciateur vs les plateformes qui
// tracent le realise sans jamais l'avoir projete.

const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const nowIso = () => new Date().toISOString();

/** Structure d'impact vierge. */
export function emptyImpact() {
  return { investissements: [], benefices: [], releves: [] };
}

/** Enregistre un investissement constate. */
export function recordInvestment(impact = emptyImpact(), { montant, libelle = null, ts = null } = {}) {
  if (typeof montant !== 'number') throw new Error('recordInvestment: montant numerique requis');
  return { ...impact, investissements: [...impact.investissements, { montant, libelle, ts: ts ?? nowIso() }] };
}

/** Enregistre un benefice constate. */
export function recordBenefit(impact = emptyImpact(), { montant, libelle = null, ts = null } = {}) {
  if (typeof montant !== 'number') throw new Error('recordBenefit: montant numerique requis');
  return { ...impact, benefices: [...impact.benefices, { montant, libelle, ts: ts ?? nowIso() }] };
}

/** Enregistre un releve de KPI (alimente aussi la boucle EF-43). */
export function recordActual(impact = emptyImpact(), { kpiId, value, ts = null } = {}) {
  if (!kpiId) throw new Error('recordActual: kpiId requis');
  return { ...impact, releves: [...impact.releves, { kpiId, value, ts: ts ?? nowIso() }] };
}

/** Totaux constates + ROI reel. */
export function totals(impact = emptyImpact()) {
  const investi = impact.investissements.reduce((n, x) => n + (Number(x.montant) || 0), 0);
  const beneficie = impact.benefices.reduce((n, x) => n + (Number(x.montant) || 0), 0);
  return {
    investi: round2(investi),
    beneficie: round2(beneficie),
    net: round2(beneficie - investi),
    roiReel: investi > 0 ? round2((beneficie - investi) / investi) : null,
  };
}

/**
 * ECART realise vs projete.
 * @param {{valeurAttendue?:number, p10?:number, p50?:number, p90?:number}} projection  sortie de simulateTrajectory
 * @param {object} impact
 * @returns {{projete:number|null, realise:number, ecart:number|null, ecartPct:number|null, position:string, dansIntervalle:boolean|null}}
 */
export function computeVariance(projection = {}, impact = emptyImpact()) {
  const t = totals(impact);
  const realise = t.net;                                  // benefice net constate
  const projete = typeof projection.valeurAttendue === 'number' ? projection.valeurAttendue : null;
  if (projete === null) {
    return { projete: null, realise, ecart: null, ecartPct: null, position: 'non_projete', dansIntervalle: null };
  }
  const ecart = round2(realise - projete);
  const ecartPct = projete !== 0 ? round2((realise - projete) / Math.abs(projete)) : null;
  const p10 = typeof projection.p10 === 'number' ? projection.p10 : null;
  const p90 = typeof projection.p90 === 'number' ? projection.p90 : null;
  const dansIntervalle = p10 !== null && p90 !== null ? realise >= p10 && realise <= p90 : null;
  let position = 'conforme';
  if (p10 !== null && realise < p10) position = 'sous_performance';
  else if (p90 !== null && realise > p90) position = 'sur_performance';
  return { projete: round2(projete), realise, ecart, ecartPct, position, dansIntervalle };
}

/** Synthese complete pour le suivi d'impact (etape Projeter / Impact Tracking). */
export function impactReport(projection, impact = emptyImpact()) {
  return { totaux: totals(impact), ecart: computeVariance(projection, impact), nbReleves: impact.releves.length };
}
