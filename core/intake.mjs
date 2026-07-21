// KayrosLab — Etape 0 "Recueillir" : canevas d'intake structure.
// Normalise l'entree pour rendre les idees comparables des la soumission, ET
// alimente directement les hypotheses de Construire + les cibles d'attaque d'Eprouver.

/** Champs du canevas (inspire des "Extra Questions" observees chez Brightidea). */
export const INTAKE_FIELDS = [
  { id: 'valeur', label: 'Quelle est la proposition de valeur ?', required: true },
  { id: 'probleme', label: 'Quel problème résolvez-vous ?', required: true },
  { id: 'ressources', label: 'Quelles ressources clés sont nécessaires ?', required: false },
  { id: 'partiesPrenantes', label: 'Qui sont les parties prenantes clés ?', required: false },
  { id: 'risques', label: "Quels sont les risques clés d'exécution ?", required: false },
  { id: 'equipe', label: "Expérience de l'équipe", required: false },
];

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

/** Valide un intake. Renvoie {ok, missing[], completude} (0..1). */
export function validateIntake(intake = {}) {
  const missing = INTAKE_FIELDS.filter((f) => f.required && !nonEmpty(intake[f.id])).map((f) => f.id);
  const filled = INTAKE_FIELDS.filter((f) => nonEmpty(intake[f.id])).length;
  return {
    ok: missing.length === 0,
    missing,
    completude: Math.round((filled / INTAKE_FIELDS.length) * 100) / 100,
  };
}

/**
 * Derive les HYPOTHESES a eprouver (entree de Construire).
 * La proposition de valeur et le probleme sont des affirmations a valider ;
 * les ressources/parties prenantes sont des dependances hypothetiques.
 */
export function intakeToHypotheses(intake = {}) {
  const h = [];
  if (nonEmpty(intake.valeur)) h.push({ id: 'h-valeur', source: 'valeur', enonce: `La proposition de valeur tient : ${intake.valeur}`, critique: true });
  if (nonEmpty(intake.probleme)) h.push({ id: 'h-probleme', source: 'probleme', enonce: `Le problème est réel et prioritaire : ${intake.probleme}`, critique: true });
  if (nonEmpty(intake.ressources)) h.push({ id: 'h-ressources', source: 'ressources', enonce: `Les ressources sont mobilisables : ${intake.ressources}`, critique: false });
  if (nonEmpty(intake.partiesPrenantes)) h.push({ id: 'h-parties', source: 'partiesPrenantes', enonce: `Les parties prenantes adhèrent : ${intake.partiesPrenantes}`, critique: false });
  return h;
}

/**
 * Derive les CIBLES D'ATTAQUE (entree d'Eprouver).
 * Les risques declares par l'auteur sont des cibles prioritaires pour la Red Team ;
 * un champ non renseigne devient lui-meme une cible (angle mort).
 */
export function intakeToAttackTargets(intake = {}) {
  const t = [];
  if (nonEmpty(intake.risques)) {
    t.push({ id: 't-risques', origine: 'declare', priorite: 'haute', cible: intake.risques, agent: 'RedTeam' });
  } else {
    t.push({ id: 't-risques-absent', origine: 'angle_mort', priorite: 'haute', cible: "Aucun risque déclaré par l'auteur — angle mort probable", agent: 'DevilsAdvocate' });
  }
  if (!nonEmpty(intake.equipe)) {
    t.push({ id: 't-equipe-absent', origine: 'angle_mort', priorite: 'moyenne', cible: "Capacité d'exécution de l'équipe non documentée", agent: 'Critic' });
  }
  if (nonEmpty(intake.valeur)) {
    t.push({ id: 't-valeur', origine: 'declare', priorite: 'haute', cible: `Contester la proposition de valeur : ${intake.valeur}`, agent: 'DevilsAdvocate' });
  }
  return t;
}

/** Raccourci : intake -> { hypotheses, cibles, validation }. */
export function processIntake(intake = {}) {
  return {
    validation: validateIntake(intake),
    hypotheses: intakeToHypotheses(intake),
    cibles: intakeToAttackTargets(intake),
  };
}
