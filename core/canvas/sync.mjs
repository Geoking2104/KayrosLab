// KayrosLab — Canvas : reconciliation d'etats concurrents.
// EF-220 (edition collaborative), EF-221 (hors ligne + reconciliation sans perte).
//
// POURQUOI PAS YJS ICI. Yjs est le bon transport, mais c'est une dependance :
// elle n'a pas sa place dans un coeur zero dependance. Ce module implemente la
// SEMANTIQUE de fusion — deterministe, commutative, idempotente, testable sans
// reseau — et le binding Yjs vit cote frontend, ou les dependances sont permises.
//
// Le modele de fusion est un LWW-Element-Set : chaque element porte son
// horodatage, les suppressions sont des pierres tombales. Ce n'est pas un CRDT
// de texte (Yjs le fera mieux pour l'edition caractere par caractere), c'est un
// CRDT d'objets — ce dont un canvas de noeuds a besoin.

import { canonical } from './identity.mjs';

/**
 * Departage deterministe de deux versions concurrentes.
 * L'horodatage tranche ; a horodatage EGAL on compare la forme canonique.
 * Sans cette seconde cle, deux pairs pourraient converger vers deux etats
 * differents — ce qui annulerait l'interet d'un CRDT.
 */
function plusRecent(a, b, champ = 'updatedAt') {
  const ta = a?.[champ] ?? ''; const tb = b?.[champ] ?? '';
  if (ta > tb) return a;
  if (tb > ta) return b;
  return canonical(a) >= canonical(b) ? a : b;
}

/** Index des tombstones par id, en conservant la plus RECENTE. */
function indexTombstones(...listes) {
  const m = new Map();
  for (const l of listes) {
    for (const t of l ?? []) {
      const ex = m.get(t.id);
      if (!ex || t.ts > ex.ts) m.set(t.id, t);
    }
  }
  return m;
}

/**
 * Fusionne deux etats d'un meme workspace.
 *
 * Regles :
 *   - element present des deux cotes -> le plus recemment modifie gagne ;
 *   - element present d'un seul cote -> conserve, SAUF si une tombstone
 *     posterieure a sa derniere modification existe ;
 *   - suppression concurrente d'une modification -> la plus recente l'emporte.
 *     Ni « remove-wins » ni « add-wins » systematique : les deux perdraient de
 *     l'information dans un cas ou l'autre, alors que l'horodatage tranche.
 *
 * Proprietes garanties (couvertes par les tests) : commutativite, idempotence,
 * associativite.
 */
export function mergeWorkspaces(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.id !== b.id) throw new Error(`mergeWorkspaces: workspaces distincts ("${a.id}" vs "${b.id}")`);

  const tombs = indexTombstones(a.tombstones, b.tombstones);

  const fusionner = (listeA, listeB, champTs) => {
    const m = new Map();
    for (const el of listeA) m.set(el.id, el);
    for (const el of listeB) {
      const ex = m.get(el.id);
      m.set(el.id, ex ? plusRecent(ex, el, champTs) : el);
    }
    // Application des tombstones : seule une suppression POSTERIEURE elimine.
    for (const [id, el] of [...m]) {
      const t = tombs.get(id);
      if (t && t.ts >= (el[champTs] ?? el.createdAt ?? '')) m.delete(id);
    }
    return [...m.values()].sort((x, y) => (x.id < y.id ? -1 : 1));
  };

  const nodes = fusionner(a.nodes, b.nodes, 'updatedAt');
  const idsNoeuds = new Set(nodes.map((n) => n.id));
  // Une arete dont un extremite a disparu ne survit pas : garder une arete
  // orpheline produirait un graphe incoherent que rien ne pourrait afficher.
  const edges = fusionner(a.edges, b.edges, 'createdAt').filter((e) => idsNoeuds.has(e.from) && idsNoeuds.has(e.to));

  // Clusters : le jeu le plus recent l'emporte en bloc. Fusionner les
  // appartenances produirait des clusters chimeriques qu'aucun calcul n'a
  // generes ; un re-clustering est bien moins couteux qu'un etat incoherent.
  const clusters = (a.updatedAt >= b.updatedAt ? a : b).clusters;
  // …sauf les libelles humains, qui ne doivent jamais etre perdus (EF-216).
  const humains = new Map();
  for (const c of [...a.clusters, ...b.clusters]) if (c.labelSource === 'human') humains.set(c.id, c);
  const clustersFusionnes = clusters.map((c) => humains.get(c.id) ?? c);

  const recent = a.updatedAt >= b.updatedAt ? a : b;
  return {
    ...recent,
    nodes, edges, clusters: clustersFusionnes,
    tombstones: [...tombs.values()].sort((x, y) => (x.id < y.id ? -1 : 1)),
    promotedIdeaIds: [...new Set([...a.promotedIdeaIds, ...b.promotedIdeaIds])].sort(),
    updatedAt: a.updatedAt >= b.updatedAt ? a.updatedAt : b.updatedAt,
    // L'historique est une UNION dedupliquee : c'est un journal, on n'en perd
    // pas les entrees sous pretexte qu'un pair ne les avait pas vues.
    history: dedupHistory([...a.history, ...b.history]),
  };
}

function dedupHistory(entrees) {
  const vues = new Set();
  const out = [];
  for (const e of entrees) {
    const k = canonical(e);
    if (vues.has(k)) continue;
    vues.add(k);
    out.push(e);
  }
  return out.sort((x, y) => (x.ts < y.ts ? -1 : x.ts > y.ts ? 1 : 0));
}

/** Fusionne n etats. L'ordre n'influe pas sur le resultat. */
export function mergeAll(...etats) {
  return etats.filter(Boolean).reduce((acc, e) => (acc ? mergeWorkspaces(acc, e) : e), null);
}

/**
 * EF-221 : file d'operations locales accumulees hors ligne.
 *
 * Les operations ne sont pas appliquees « en aveugle » a la reconnexion : on
 * fusionne l'etat local complet avec l'etat distant. Rejouer des operations
 * sur un etat qui a change entre-temps est la source classique de perte.
 */
export class OfflineQueue {
  constructor({ limite = 1000 } = {}) { this._ops = []; this.limite = limite; }
  get taille() { return this._ops.length; }
  get vide() { return this._ops.length === 0; }

  enfiler(op) {
    if (this._ops.length >= this.limite) throw new Error(`OfflineQueue: limite de ${this.limite} operations atteinte`);
    this._ops.push({ ...op, ts: op.ts ?? new Date().toISOString() });
    return this;
  }
  vider() { const o = [...this._ops]; this._ops = []; return o; }
  operations() { return [...this._ops]; }
}

/**
 * Reconciliation a la reconnexion.
 * @returns {{workspace:object, conflits:object[]}}
 */
export function reconcilier(local, distant) {
  const fusionne = mergeWorkspaces(local, distant);

  // Conflits SIGNALES (pas resolus en silence) : l'utilisateur doit savoir que
  // sa version d'un noeud a ete supplantee, sinon la fusion ressemble a une
  // perte de donnees inexpliquee.
  const conflits = [];
  const parId = new Map(distant.nodes.map((n) => [n.id, n]));
  for (const l of local.nodes) {
    const d = parId.get(l.id);
    if (!d || canonical(l) === canonical(d)) continue;
    const gagnant = fusionne.nodes.find((n) => n.id === l.id);
    if (gagnant && canonical(gagnant) !== canonical(l)) {
      conflits.push({ nodeId: l.id, titreLocal: l.titre, titreRetenu: gagnant.titre, versionLocalePerdue: l });
    }
  }
  return { workspace: fusionne, conflits };
}

/**
 * Etat partage minimal a diffuser sur le reseau : sans l'historique, qui est
 * volumineux et reconstructible. Les curseurs et selections des pairs (EF-220)
 * sont de la presence, pas de l'etat : ils passent par un canal ephemere.
 */
export function snapshotReseau(ws) {
  return {
    id: ws.id, updatedAt: ws.updatedAt,
    nodes: ws.nodes, edges: ws.edges, clusters: ws.clusters,
    tombstones: ws.tombstones ?? [], promotedIdeaIds: ws.promotedIdeaIds,
    history: [],
  };
}

/** Empreinte d'un etat : compare deux pairs sans transferer tout le contenu. */
export function empreinte(ws) {
  return canonical({
    n: ws.nodes.map((x) => [x.id, x.updatedAt]).sort(),
    e: ws.edges.map((x) => x.id).sort(),
    t: (ws.tombstones ?? []).map((x) => x.id).sort(),
  });
}
