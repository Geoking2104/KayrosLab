/**
 * Client REST du backend KayrosLab.
 *
 * Le frontend fonctionne dans DEUX modes :
 *   - local   : tout en memoire, hors ligne (palier P0, aucune configuration) ;
 *   - distant : le backend detient les donnees et les cles (palier P2).
 *
 * Le mode est determine par `VITE_BACKEND_URL`. Aucun appel reseau n'a lieu en
 * mode local — c'est la promesse de souverainete, pas une option de repli.
 */

const RACINE = import.meta.env.VITE_BACKEND_URL ?? '';

export const modeDistant = () => Boolean(RACINE);

/** Le jeton vit dans la session, jamais dans le code ni dans l'URL. */
let jeton = sessionStorage.getItem('kayros_token') ?? '';
export const setJeton = (t) => { jeton = t ?? ''; if (t) sessionStorage.setItem('kayros_token', t); else sessionStorage.removeItem('kayros_token'); };
export const getJeton = () => jeton;

class ErreurApi extends Error {
  constructor(statut, corps) {
    super(corps?.error ?? corps?.motif ?? `HTTP ${statut}`);
    this.statut = statut;
    this.corps = corps;
  }
}
export { ErreurApi };

async function appel(methode, chemin, corps) {
  const res = await fetch(`${RACINE}${chemin}`, {
    method: methode,
    headers: {
      'content-type': 'application/json',
      ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const texte = await res.text();
  let data = null;
  try { data = texte ? JSON.parse(texte) : null; } catch { data = texte; }
  // Une erreur HTTP porte son corps : le motif d'un refus (plafond depasse,
  // document sensible) est aussi utile que le code de statut.
  if (!res.ok) throw new ErreurApi(res.status, data);
  return data;
}

export const api = {
  listerCanvas: (params = {}) => appel('GET', `/v1/canvas?${new URLSearchParams(params)}`),
  creerCanvas: (b) => appel('POST', '/v1/canvas', b),
  lireCanvas: (id) => appel('GET', `/v1/canvas/${id}`),

  ajouterNoeud: (id, node) => appel('POST', `/v1/canvas/${id}/nodes`, node),
  majNoeud: (id, nodeId, patch) => appel('PATCH', `/v1/canvas/${id}/nodes/${nodeId}`, patch),
  supprimerNoeud: (id, nodeId) => appel('DELETE', `/v1/canvas/${id}/nodes/${nodeId}`),
  ajouterArete: (id, edge) => appel('POST', `/v1/canvas/${id}/edges`, edge),

  reclusteriser: (id, b = {}) => appel('POST', `/v1/canvas/${id}/recluster`, b),
  doublons: (id) => appel('GET', `/v1/canvas/${id}/duplicates`),
  chercher: (id, q, k = 10) => appel('GET', `/v1/canvas/${id}/search?q=${encodeURIComponent(q)}&k=${k}`),

  quota: (id, taille = 0) => appel('GET', `/v1/canvas/${id}/quota?taille=${taille}`),
  ingerer: (id, b) => appel('POST', `/v1/canvas/${id}/sources`, b),
  retirerSource: (id, docId) => appel('DELETE', `/v1/canvas/${id}/sources/${docId}`),

  swarm: (id, nodeId, b = {}) => appel('POST', `/v1/canvas/${id}/nodes/${nodeId}/swarm`, b),
  framework: (id, nodeId, b) => appel('POST', `/v1/canvas/${id}/nodes/${nodeId}/framework`, b),

  matrice: (id, notes) => appel('POST', `/v1/canvas/${id}/matrix`, { notes }),
  promouvoir: (id, b) => appel('POST', `/v1/canvas/${id}/promote`, b),
  origine: (id, ideaId) => appel('GET', `/v1/canvas/${id}/origin/${ideaId}`),

  verifierJournal: (id) => appel('GET', `/v1/canvas/${id}/journal/verify`),
};
