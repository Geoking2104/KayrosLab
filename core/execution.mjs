// KayrosLab — Cycle aval (EF-80 a EF-83) : etape "Realiser".
// Projeter PLANIFIE (roadmap, projections) ; Realiser EXECUTE et constate.
// Les sous-phases sont internes a l'etape : le kanban reste lisible.

export const EXECUTION_PHASES = ['pilote', 'deploiement', 'bilan'];
export const JALON_STATUTS = ['a_faire', 'en_cours', 'fait', 'bloque'];

const nowIso = () => new Date().toISOString();
const pct = (x) => Math.round(x * 1000) / 1000;

/**
 * Demarre l'execution a partir de la roadmap produite en Projeter (EF-80/82).
 * Les jalons planifies deviennent des jalons SUIVIS.
 */
export function startExecution({ roadmap = null, phase = 'pilote', ts = null } = {}) {
  if (!EXECUTION_PHASES.includes(phase)) throw new Error(`startExecution: phase invalide "${phase}"`);
  const t = ts ?? nowIso();
  const jalons = (roadmap?.jalons ?? []).map((j, i) => ({
    id: j.id ?? `j${i + 1}`,
    nom: j.name ?? j.nom ?? `Jalon ${i + 1}`,
    statut: 'a_faire',
    dateCible: j.dateCible ?? null,
    dateReelle: null,
    effortPrevu: j.effortPersonMonths ?? null,
  }));
  return {
    phase, jalons, demarreLe: t, cloture: null,
    history: [{ type: 'execution', evenement: 'demarrage', phase, ts: t }],
  };
}

/** Met a jour un jalon (avancement reel). */
export function updateJalon(exec, jalonId, patch = {}, { by = null } = {}) {
  const idx = (exec.jalons ?? []).findIndex((j) => j.id === jalonId);
  if (idx < 0) throw new Error(`updateJalon: jalon inconnu "${jalonId}"`);
  if (patch.statut && !JALON_STATUTS.includes(patch.statut)) throw new Error(`statut de jalon invalide "${patch.statut}"`);
  const t = nowIso();
  const avant = exec.jalons[idx];
  const apres = { ...avant, ...patch };
  // Un jalon passe a "fait" date automatiquement sa realisation.
  if (patch.statut === 'fait' && !apres.dateReelle) apres.dateReelle = t;
  const jalons = [...exec.jalons]; jalons[idx] = apres;
  return {
    ...exec, jalons,
    history: [...(exec.history ?? []), { type: 'jalon', jalonId, de: avant.statut, a: apres.statut, by, ts: t }],
  };
}

/** Progression : avancement, retards, blocages. Deterministe. */
export function progression(exec, { now = () => new Date() } = {}) {
  const jalons = exec?.jalons ?? [];
  if (!jalons.length) return { total: 0, faits: 0, avancement: 0, bloques: 0, enRetard: 0, jalonsEnRetard: [] };
  const faits = jalons.filter((j) => j.statut === 'fait').length;
  const bloques = jalons.filter((j) => j.statut === 'bloque').length;
  const d = now();
  const jalonsEnRetard = jalons.filter((j) =>
    j.statut !== 'fait' && j.dateCible && new Date(j.dateCible) < d).map((j) => j.id);
  return {
    total: jalons.length, faits, avancement: pct(faits / jalons.length),
    bloques, enRetard: jalonsEnRetard.length, jalonsEnRetard,
  };
}

/**
 * Passe a la phase suivante (EF-80/81). Le passage au BILAN exige que tous les
 * jalons soient traites : on ne clot pas un projet en laissant des jalons ouverts,
 * sauf `force` explicite (qui reste trace).
 */
export function advancePhase(exec, { force = false, by = null } = {}) {
  const i = EXECUTION_PHASES.indexOf(exec?.phase);
  if (i < 0) throw new Error('advancePhase: phase courante invalide');
  if (i === EXECUTION_PHASES.length - 1) throw new Error('advancePhase: deja en phase finale (bilan)');
  const suivante = EXECUTION_PHASES[i + 1];
  const p = progression(exec);
  if (suivante === 'bilan' && p.faits < p.total && !force) {
    const e = new Error(`${p.total - p.faits} jalon(s) non termine(s) : clôture refusée (utiliser force)`);
    e.code = 'JALONS_OUVERTS'; throw e;
  }
  const t = nowIso();
  return {
    ...exec, phase: suivante,
    history: [...(exec.history ?? []), { type: 'execution', evenement: 'phase', de: exec.phase, a: suivante, force: !!force, by, ts: t }],
  };
}

/** Clot l'execution avec un bilan (EF-83) : enseignements + verdict. */
export function cloturer(exec, { enseignements = [], verdict = 'succes', by = null } = {}) {
  if (!['succes', 'echec', 'mitige'].includes(verdict)) throw new Error(`verdict invalide "${verdict}"`);
  const t = nowIso();
  const p = progression(exec);
  return {
    ...exec, phase: 'bilan',
    cloture: { verdict, enseignements, progression: p, by, ts: t },
    history: [...(exec.history ?? []), { type: 'execution', evenement: 'cloture', verdict, by, ts: t }],
  };
}
