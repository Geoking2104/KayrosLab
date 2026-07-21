// KayrosLab — Campagnes (EF-61) & moderation (EF-62).
// Une campagne cadre la collecte : peiimetre, fenetre de soumission, moderation.
// Une idee en attente de moderation N'ENTRE PAS dans le portefeuille : elle ne
// pollue ni les compteurs WIP ni l'entonnoir tant qu'elle n'est pas approuvee.

export const MODERATION_ETATS = ['en_attente', 'approuve', 'rejete'];

const nowIso = () => new Date().toISOString();

/** Cree une campagne (defi thematique). */
export function createCampaign({
  id, nom, description = null, tenantId = 'default',
  moderation = false, ouverteLe = null, fermeeLe = null, ts = null,
} = {}) {
  if (!id) throw new Error('createCampaign: id requis');
  if (!nom) throw new Error('createCampaign: nom requis');
  const t = ts ?? nowIso();
  return { id, nom, description, tenantId, moderation: !!moderation, ouverteLe, fermeeLe, createdAt: t };
}

/** La campagne accepte-t-elle des soumissions maintenant ? */
export function estOuverte(campagne, { now = () => new Date() } = {}) {
  if (!campagne) return { ouverte: true, raison: null };          // hors campagne = libre
  const d = now();
  if (campagne.ouverteLe && d < new Date(campagne.ouverteLe)) return { ouverte: false, raison: 'pas_encore_ouverte' };
  if (campagne.fermeeLe && d > new Date(campagne.fermeeLe)) return { ouverte: false, raison: 'fermee' };
  return { ouverte: true, raison: null };
}

/** Etat de moderation initial d'une idee, selon la campagne. */
export function etatInitial(campagne) {
  return campagne?.moderation
    ? { etat: 'en_attente', by: null, motif: null, ts: nowIso() }
    : { etat: 'approuve', by: null, motif: 'campagne sans moderation', ts: nowIso() };
}

/**
 * Decision de moderation. Un REJET exige un motif — meme regle que le veto :
 * on ne ferme jamais la porte a un contributeur sans lui dire pourquoi.
 */
export function moderer(idea, { decision, by, motif = '' } = {}) {
  if (!MODERATION_ETATS.includes(decision) || decision === 'en_attente') {
    throw new Error(`moderer: decision attendue "approuve" ou "rejete" (recu "${decision}")`);
  }
  if (decision === 'rejete' && !motif) throw new Error('Motif obligatoire pour rejeter une soumission');
  const t = nowIso();
  return {
    ...idea,
    moderation: { etat: decision, by, motif: motif || null, ts: t },
    updatedAt: t,
    history: [...(idea.history ?? []), { type: 'moderation', a: decision, by, motif: motif || null, ts: t }],
  };
}

/** Une idee est-elle visible dans le portefeuille (moderation franchie) ? */
export function estPubliee(idea) {
  const e = idea?.moderation?.etat;
  return e === undefined || e === 'approuve';                    // pas de moderation = publiee
}

/** File de moderation : ce qui attend un arbitrage de recevabilite. */
export function fileModeration(ideas = [], { tenantId = null } = {}) {
  return ideas.filter((i) =>
    i?.moderation?.etat === 'en_attente' &&
    (!tenantId || (i.tenantId ?? 'default') === tenantId));
}

/** Statistiques de collecte par campagne. */
export function statsCampagne(ideas = [], campagneId) {
  const lot = ideas.filter((i) => i.campagneId === campagneId);
  const par = (e) => lot.filter((i) => i.moderation?.etat === e).length;
  return {
    campagneId, soumises: lot.length,
    enAttente: par('en_attente'), approuvees: par('approuve'), rejetees: par('rejete'),
    contributeurs: new Set(lot.map((i) => i.author).filter(Boolean)).size,
  };
}
