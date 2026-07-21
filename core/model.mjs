// KayrosLab — Modele de donnees canonique.
// Deux axes ORTHOGONAUX (cf. analyse d'ecarts Brightidea) :
//   - `stage`  : ou en est l'EXECUTION (processus en 7 etapes, Recueillir inclus)
//   - `status` : ou en est la DECISION (etat social/decisionnel)
// Une idee peut etre "en_revue" (statut) tout en etant en "construire" (etape).

export const STAGES = ['recueillir', 'ecouter', 'cartographier', 'construire', 'eprouver', 'arbitrer', 'projeter'];

export const STATUSES = [
  'nouveau', 'en_revue', 'discussion', 'en_developpement',
  'termine', 'non_poursuivi', 'consideration_future', 'en_pause',
];

/** Statuts terminaux : l'idee ne progresse plus (mais reste reactivable). */
export const TERMINAL_STATUSES = ['termine', 'non_poursuivi'];
/** Statuts "dormants" : reactivables (capitalisation). */
export const DORMANT_STATUSES = ['consideration_future', 'en_pause', 'non_poursuivi'];

export const isValidStage = (s) => STAGES.includes(s);
export const isValidStatus = (s) => STATUSES.includes(s);

const nowIso = () => new Date().toISOString();

/** Cree une idee valide. `stage` et `status` sont independants. */
export function createIdea({
  id, title, author = null, stage = 'recueillir', status = 'nouveau',
  intake = null, category = 'general', ki = null, scores = {}, votes = [],
  impact = null, roadmap = null, ts = null, tenantId = 'default',
} = {}) {
  if (!id) throw new Error('createIdea: id requis');
  if (!title) throw new Error('createIdea: title requis');
  if (!isValidStage(stage)) throw new Error(`createIdea: stage invalide "${stage}"`);
  if (!isValidStatus(status)) throw new Error(`createIdea: status invalide "${status}"`);
  const t = ts ?? nowIso();
  return {
    id, title, author, stage, status, intake, category, ki, scores, votes,
    impact, roadmap, tenantId, createdAt: t, updatedAt: t,
    history: [{ type: 'created', stage, status, ts: t }],
  };
}

/** Change l'ETAPE (execution). Immuable : renvoie une nouvelle idee + trace d'audit. */
export function setStage(idea, stage, { by = null, motif = null } = {}) {
  if (!isValidStage(stage)) throw new Error(`setStage: stage invalide "${stage}"`);
  const ts = nowIso();
  return {
    ...idea, stage, updatedAt: ts,
    history: [...idea.history, { type: 'stage', from: idea.stage, to: stage, by, motif, ts }],
  };
}

/** Change le STATUT (decision). Independant de l'etape. */
export function setStatus(idea, status, { by = null, motif = null } = {}) {
  if (!isValidStatus(status)) throw new Error(`setStatus: status invalide "${status}"`);
  const ts = nowIso();
  return {
    ...idea, status, updatedAt: ts,
    history: [...idea.history, { type: 'status', from: idea.status, to: status, by, motif, ts }],
  };
}

/** Reactive une idee dormante (capitalisation No-Go -> retour en jeu). */
export function reactivate(idea, { by = null, motif = null, stage = null } = {}) {
  if (!DORMANT_STATUSES.includes(idea.status)) {
    throw new Error(`reactivate: statut "${idea.status}" non dormant`);
  }
  let out = setStatus(idea, 'en_revue', { by, motif: motif ?? 'reactivation' });
  if (stage) out = setStage(out, stage, { by, motif: 'reactivation' });
  return out;
}

/** Applique une decision d'Arbitrer sur les DEUX axes de facon coherente. */
export function applyDecision(idea, decision, { by = null } = {}) {
  const map = { Go: 'en_developpement', 'No-Go': 'non_poursuivi', 'Révision': 'en_revue', Revision: 'en_revue' };
  const status = map[decision?.status];
  if (!status) throw new Error(`applyDecision: decision inconnue "${decision?.status}"`);
  let out = setStatus(idea, status, { by, motif: decision.motif ?? null });
  if (decision.status === 'Go') out = setStage(out, 'projeter', { by, motif: 'decision Go' });
  if (decision.status === 'Révision' || decision.status === 'Revision') out = setStage(out, 'eprouver', { by, motif: 'revision demandee' });
  return out;
}
