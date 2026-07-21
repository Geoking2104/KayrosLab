// KayrosLab — Fil de commentaires (EF-67).
// Discussion par idee, avec reponses imbriquees. La suppression est DOUCE :
// on conserve la trace (auteur, date) et on masque le contenu, car un fil de
// decision fait partie de l'audit — on ne reecrit pas l'histoire.

export const MAX_LONGUEUR = 5000;

const nowIso = () => new Date().toISOString();
const uid = () => globalThis.crypto?.randomUUID?.() ?? `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;

/** Ajoute un commentaire (ou une reponse si `parentId` est fourni). */
export function addComment(fil = [], { by, role = null, texte, parentId = null } = {}) {
  if (!by) throw new Error('addComment: auteur requis');
  const t = String(texte ?? '').trim();
  if (!t) throw new Error('addComment: texte vide');
  if (t.length > MAX_LONGUEUR) throw new Error(`addComment: texte trop long (max ${MAX_LONGUEUR})`);
  if (parentId && !fil.some((c) => c.id === parentId)) throw new Error('addComment: parent introuvable');
  // Pas de reponse a une reponse : on garde un fil a deux niveaux, lisible.
  const parent = parentId ? fil.find((c) => c.id === parentId) : null;
  if (parent?.parentId) throw new Error('addComment: imbrication limitee a deux niveaux');
  return [...fil, { id: uid(), by, role, texte: t, parentId, ts: nowIso(), edite: null, supprime: null }];
}

/** Modifie son propre commentaire. L'edition est datee (transparence). */
export function editComment(fil = [], id, { texte, by } = {}) {
  const c = fil.find((x) => x.id === id);
  if (!c) throw new Error('editComment: commentaire introuvable');
  if (c.by !== by) throw new Error('editComment: seul l auteur peut modifier son commentaire');
  if (c.supprime) throw new Error('editComment: commentaire supprime');
  const t = String(texte ?? '').trim();
  if (!t) throw new Error('editComment: texte vide');
  return fil.map((x) => (x.id === id ? { ...x, texte: t, edite: nowIso() } : x));
}

/**
 * Suppression douce. L'auteur peut supprimer le sien ; un facilitateur/COMEX
 * peut moderer celui d'autrui — l'auteur et l'horodatage restent visibles.
 */
export function removeComment(fil = [], id, { by, role = null } = {}) {
  const c = fil.find((x) => x.id === id);
  if (!c) throw new Error('removeComment: commentaire introuvable');
  const moderateur = ['comex', 'facilitateur'].includes(role);
  if (c.by !== by && !moderateur) throw new Error('removeComment: non autorise');
  return fil.map((x) => (x.id === id
    ? { ...x, texte: null, supprime: { by, role, ts: nowIso() } }
    : x));
}

/** Arborescence a deux niveaux, triee chronologiquement. */
export function commentTree(fil = []) {
  const parJour = (a, b) => new Date(a.ts) - new Date(b.ts);
  const racines = fil.filter((c) => !c.parentId).sort(parJour);
  return racines.map((r) => ({ ...r, reponses: fil.filter((c) => c.parentId === r.id).sort(parJour) }));
}

/** Nombre de commentaires actifs (les supprimes ne comptent pas). */
export function countComments(fil = []) {
  return fil.filter((c) => !c.supprime).length;
}
