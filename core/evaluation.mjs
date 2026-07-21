// KayrosLab — Evaluation collaborative : vote/notation multi-evaluateurs.
// Se place EN AMONT du gate : le resultat agrege devient une ENTREE de la decision
// COMEX. Le veto reste entier (l'agregat instruit, il ne tranche pas).

/** Poids par role (le COMEX pese plus, mais ne remplace pas le veto). */
export const ROLE_WEIGHTS = { comex: 3, expert: 2, redteam: 2, facilitateur: 1, contributeur: 1 };

/** Recommandations derivees du score agrege (indicatif, non contraignant). */
export const SEUILS = { go: 70, revision: 45 };

/**
 * Agrege des votes.
 * @param {{by:string, role?:string, score:number, comment?:string}[]} votes  score sur 0..100
 * @param {{roleWeights?:object, seuils?:object}} [opts]
 */
export function aggregateVotes(votes = [], { roleWeights = ROLE_WEIGHTS, seuils = SEUILS } = {}) {
  const valides = votes.filter((v) => v && typeof v.score === 'number' && !Number.isNaN(v.score));
  if (!valides.length) {
    return { count: 0, moyenne: null, moyennePonderee: null, parRole: {}, dispersion: null, consensus: null, recommandation: 'insuffisant' };
  }
  let sum = 0, wsum = 0, wtot = 0;
  const parRole = {};
  for (const v of valides) {
    const s = Math.max(0, Math.min(100, v.score));
    const role = v.role ?? 'contributeur';
    const w = Number(roleWeights[role]) || 1;
    sum += s; wsum += s * w; wtot += w;
    (parRole[role] ??= { count: 0, somme: 0 });
    parRole[role].count++; parRole[role].somme += s;
  }
  for (const r of Object.keys(parRole)) parRole[r].moyenne = round2(parRole[r].somme / parRole[r].count);

  const moyenne = round2(sum / valides.length);
  const moyennePonderee = round2(wsum / wtot);
  const ecarts = valides.map((v) => (Math.max(0, Math.min(100, v.score)) - moyenne) ** 2);
  const dispersion = round2(Math.sqrt(ecarts.reduce((a, b) => a + b, 0) / valides.length));
  return {
    count: valides.length, moyenne, moyennePonderee, parRole, dispersion,
    consensus: dispersion <= 15,               // faible dispersion = consensus
    recommandation: recommander(moyennePonderee, seuils),
  };
}

const round2 = (x) => Math.round(x * 100) / 100;
function recommander(score, seuils) {
  if (score >= seuils.go) return 'Go';
  if (score >= seuils.revision) return 'Révision';
  return 'No-Go';
}
