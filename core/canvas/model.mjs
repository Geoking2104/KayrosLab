// KayrosLab — Canvas d'ideation : modele de donnees canonique.
// EF-211 (types de noeuds), EF-212 (aretes typees orientees), EF-213 (CRUD),
// EF-214 (annuler/retablir), EF-218 (noeuds figes).
//
// Meme discipline que `core/model.mjs` : structures IMMUABLES, chaque mutation
// renvoie un nouvel objet et laisse une trace dans `history`. C'est ce qui rend
// EF-214 (undo/redo) et EF-246 (rejeu du journal) possibles sans machinerie.
//
// Le canvas est une surface AMONT : il precede `00 Recueillir` et alimente
// `02 Cartographier` / `03 Construire`. Il ne remplace aucune etape du cycle.

const nowIso = () => new Date().toISOString();
const uid = (p = 'n') => globalThis.crypto?.randomUUID?.() ?? `${p}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

/**
 * Types de noeuds (EF-211). Chaque type porte une intention distincte :
 * on ne melange pas une preuve et une critique, sinon le canvas redevient
 * un mur de post-its indifferencies.
 */
export const NODE_TYPES = ['idee', 'question', 'hypothese', 'preuve', 'critique', 'decision', 'groupe'];

/**
 * Relations orientees (EF-212). Reprend la grammaire de l'ontologie
 * *Positionner* (EF-93) : un verbe, une direction, une cardinalite implicite.
 */
export const EDGE_RELATIONS = ['soutient', 'contredit', 'derive', 'depend', 'remplace'];

/** Origine d'un contenu : humain ou agent. Prepare EF-240/242 (identite agent). */
export const AUTHOR_KINDS = ['human', 'agent'];

export const isValidNodeType = (t) => NODE_TYPES.includes(t);
export const isValidRelation = (r) => EDGE_RELATIONS.includes(r);

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

/**
 * Cree un espace de travail (canvas).
 *
 * DECISION Q1 (CDC §10) — un workspace peut produire PLUSIEURS idees.
 * On retient le sur-ensemble : `promotedIdeaIds[]` plutot qu'un `ideaId`
 * unique. Restreindre ensuite a un-a-un coute une contrainte de validation ;
 * l'inverse couterait une migration. A trancher formellement, mais le defaut
 * ne ferme aucune porte.
 */
export function createWorkspace({
  id, nom, tenantId = 'default', createdBy = null, seed = 1,
  settings = {}, ts = null,
} = {}) {
  if (!id) throw new Error('createWorkspace: id requis');
  if (!nom) throw new Error('createWorkspace: nom requis');
  const t = ts ?? nowIso();
  return {
    id, nom, tenantId, createdBy,
    // Graine des layouts. Le clustering, lui, est deterministe SANS graine
    // (cf. clustering.mjs) ; seule la disposition spatiale a besoin d'alea.
    seed,
    settings: {
      dedupeThreshold: 0.92,   // EF-217 : seuil de suggestion de fusion
      clusterThreshold: 0.70,  // EF-215 : seuil d'agregation
      ...settings,
    },
    nodes: [], edges: [], clusters: [],
    // Pierres tombales : une suppression doit etre REPRESENTEE pour pouvoir se
    // propager. Sans elle, un pair hors ligne ne distingue pas « supprime » de
    // « pas encore recu » et ressusciterait le noeud a la reconnexion (EF-220).
    tombstones: [],
    promotedIdeaIds: [],
    createdAt: t, updatedAt: t,
    history: [{ type: 'created', by: createdBy, ts: t }],
  };
}

/** Applique une mutation + trace d'audit. Interne. */
function commit(ws, patch, entry) {
  const ts = nowIso();
  return {
    ...ws, ...patch, updatedAt: ts,
    history: [...ws.history, { ...entry, ts }],
  };
}

// ---------------------------------------------------------------------------
// Noeuds (EF-211 / EF-213)
// ---------------------------------------------------------------------------

/**
 * Cree un noeud detache (non encore attache a un workspace).
 * `provenance` porte la tracabilite EF-201 : sans source, une assertion est
 * explicitement marquee non sourcee — jamais presentee comme sourcee.
 */
export function createNode({
  id, type = 'idee', titre, corps = '', x = 0, y = 0, w = 220, h = 120,
  authorId = null, authorKind = 'human', provenance = null, pinned = false,
  clusterId = null, meta = {}, ts = null,
} = {}) {
  if (!titre || !String(titre).trim()) throw new Error('createNode: titre requis');
  if (!isValidNodeType(type)) throw new Error(`createNode: type invalide "${type}"`);
  if (!AUTHOR_KINDS.includes(authorKind)) throw new Error(`createNode: authorKind invalide "${authorKind}"`);
  const t = ts ?? nowIso();
  return {
    id: id ?? uid('n'),
    type, titre: String(titre).trim(), corps: String(corps ?? ''),
    x, y, w, h, pinned, clusterId,
    authorId, authorKind,
    // null => non source. `isSourced()` ci-dessous ne ment jamais par omission.
    provenance: provenance ?? null,
    // Reference vers l'idee issue de la promotion (EF-260, lien bidirectionnel).
    promotedIdeaId: null,
    meta,
    createdAt: t, updatedAt: t,
  };
}

/**
 * EF-201 : une assertion est sourcee ou ne l'est pas. Pas de zone grise.
 * EF-207 : une source RETIREE ne source plus rien. Sans ce test, le retrait
 * d'un document laisserait des noeuds affiches comme etayes par un document
 * qui n'existe plus — exactement le mensonge par omission que l'exigence vise.
 */
export function isSourced(node) {
  const p = node?.provenance;
  if (!p || p.retracted) return false;
  return Boolean(p.sourceDocId || p.url);
}

/** Texte servant a la vectorisation. Titre pondere par repetition (signal fort). */
export function nodeText(node) {
  return `${node.titre}\n${node.titre}\n${node.corps ?? ''}`.trim();
}

export function addNode(ws, node) {
  const n = (node && node.id && node.titre && node.type) ? node : createNode(node);
  if (ws.nodes.some((x) => x.id === n.id)) throw new Error(`addNode: id deja present "${n.id}"`);
  return commit(ws, { nodes: [...ws.nodes, n] }, { type: 'node.add', nodeId: n.id, by: n.authorId, kind: n.authorKind });
}

export function getNode(ws, id) { return ws.nodes.find((n) => n.id === id) ?? null; }

/** Champs modifiables par l'utilisateur. Le reste est derive ou immuable. */
const EDITABLE = ['titre', 'corps', 'type', 'x', 'y', 'w', 'h', 'pinned', 'clusterId', 'meta', 'provenance'];

export function updateNode(ws, id, patch = {}, { by = null } = {}) {
  const n = getNode(ws, id);
  if (!n) throw new Error(`updateNode: noeud introuvable "${id}"`);
  if (patch.type && !isValidNodeType(patch.type)) throw new Error(`updateNode: type invalide "${patch.type}"`);
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => EDITABLE.includes(k)));
  if (clean.titre !== undefined && !String(clean.titre).trim()) throw new Error('updateNode: titre vide');
  const next = { ...n, ...clean, updatedAt: nowIso() };
  return commit(
    ws,
    { nodes: ws.nodes.map((x) => (x.id === id ? next : x)) },
    { type: 'node.update', nodeId: id, champs: Object.keys(clean), by },
  );
}

/** EF-218 : un noeud fige n'est plus deplace par les layouts automatiques. */
export function pinNode(ws, id, pinned = true, { by = null } = {}) {
  return updateNode(ws, id, { pinned: Boolean(pinned) }, { by });
}

/** Supprime un noeud ET les aretes qui le referencent (pas d'arete orpheline). */
export function removeNode(ws, id, { by = null } = {}) {
  if (!getNode(ws, id)) throw new Error(`removeNode: noeud introuvable "${id}"`);
  const edges = ws.edges.filter((e) => e.from !== id && e.to !== id);
  const retirees = ws.edges.filter((e) => e.from === id || e.to === id);
  const ts = nowIso();
  return commit(
    ws,
    {
      nodes: ws.nodes.filter((n) => n.id !== id),
      edges,
      tombstones: [
        ...(ws.tombstones ?? []),
        { id, kind: 'node', ts, by },
        ...retirees.map((e) => ({ id: e.id, kind: 'edge', ts, by, cascade: true })),
      ],
    },
    { type: 'node.remove', nodeId: id, aretesRetirees: retirees.length, by },
  );
}

/** Duplique un noeud avec un decalage visible. */
export function duplicateNode(ws, id, { by = null, offset = 32 } = {}) {
  const n = getNode(ws, id);
  if (!n) throw new Error(`duplicateNode: noeud introuvable "${id}"`);
  const copie = {
    ...n, id: uid('n'), x: n.x + offset, y: n.y + offset,
    pinned: false, clusterId: null, promotedIdeaId: null,
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  return commit(ws, { nodes: [...ws.nodes, copie] }, { type: 'node.duplicate', from: id, nodeId: copie.id, by });
}

// ---------------------------------------------------------------------------
// Aretes (EF-212)
// ---------------------------------------------------------------------------

export function addEdge(ws, { id, from, to, relation, label = null, authorId = null, authorKind = 'human' } = {}) {
  if (!isValidRelation(relation)) throw new Error(`addEdge: relation invalide "${relation}"`);
  if (!from || !to) throw new Error('addEdge: from et to requis');
  if (from === to) throw new Error('addEdge: boucle sur soi-meme interdite');
  if (!getNode(ws, from)) throw new Error(`addEdge: noeud source introuvable "${from}"`);
  if (!getNode(ws, to)) throw new Error(`addEdge: noeud cible introuvable "${to}"`);
  if (ws.edges.some((e) => e.from === from && e.to === to && e.relation === relation)) {
    throw new Error('addEdge: arete deja presente (meme couple, meme relation)');
  }
  const e = { id: id ?? uid('e'), from, to, relation, label, authorId, authorKind, createdAt: nowIso() };
  return commit(ws, { edges: [...ws.edges, e] }, { type: 'edge.add', edgeId: e.id, relation, by: authorId });
}

export function removeEdge(ws, id, { by = null } = {}) {
  if (!ws.edges.some((e) => e.id === id)) throw new Error(`removeEdge: arete introuvable "${id}"`);
  return commit(
    ws,
    {
      edges: ws.edges.filter((e) => e.id !== id),
      tombstones: [...(ws.tombstones ?? []), { id, kind: 'edge', ts: nowIso(), by }],
    },
    { type: 'edge.remove', edgeId: id, by },
  );
}

/** Aretes touchant un noeud, dans les deux sens. */
export function edgesOf(ws, nodeId) {
  return ws.edges.filter((e) => e.from === nodeId || e.to === nodeId);
}

/**
 * EF-231 : les desaccords sont conserves, jamais lisses.
 * Cette fonction les expose explicitement pour que l'UI les montre au lieu
 * de produire une synthese moyennee ou le conflit disparait.
 */
export function contradictions(ws) {
  return ws.edges
    .filter((e) => e.relation === 'contredit')
    .map((e) => ({ edgeId: e.id, source: getNode(ws, e.from), cible: getNode(ws, e.to), parAgent: e.authorKind === 'agent' }));
}

// ---------------------------------------------------------------------------
// Clusters (EF-215 / EF-216)
// ---------------------------------------------------------------------------

export function createCluster({ id, label = null, labelSource = 'llm', nodeIds = [], centroid = null } = {}) {
  return {
    id: id ?? uid('c'),
    label, labelSource,   // 'llm' | 'human' — determine si un re-clustering peut ecraser
    nodeIds: [...nodeIds], centroid,
    createdAt: nowIso(),
  };
}

/**
 * EF-216 : un libelle edite a la main n'est JAMAIS ecrase par un re-clustering.
 * Sans cette garantie l'utilisateur cesse de nommer ses clusters, et le canvas
 * perd la seule couche de sens qu'il apporte au-dessus des vecteurs.
 */
export function setClusterLabel(ws, clusterId, label, { source = 'human', by = null } = {}) {
  const c = ws.clusters.find((x) => x.id === clusterId);
  if (!c) throw new Error(`setClusterLabel: cluster introuvable "${clusterId}"`);
  if (c.labelSource === 'human' && source === 'llm') {
    return ws; // refus cote LLM : l'humain a tranche.
  }
  const next = { ...c, label, labelSource: source };
  return commit(
    ws,
    { clusters: ws.clusters.map((x) => (x.id === clusterId ? next : x)) },
    { type: 'cluster.label', clusterId, source, by },
  );
}

/** Remplace le jeu de clusters (sortie de `clusterWorkspace`). */
export function applyClusters(ws, clusters, { by = null } = {}) {
  const parNoeud = new Map();
  for (const c of clusters) for (const nid of c.nodeIds) parNoeud.set(nid, c.id);
  return commit(
    ws,
    { clusters, nodes: ws.nodes.map((n) => ({ ...n, clusterId: parNoeud.get(n.id) ?? null })) },
    { type: 'cluster.apply', nb: clusters.length, by },
  );
}

// ---------------------------------------------------------------------------
// Recherche intra-canvas (EF-222, volet lexical)
// ---------------------------------------------------------------------------

export function searchNodes(ws, q, { type = null, authorKind = null } = {}) {
  const needle = String(q ?? '').toLowerCase().trim();
  return ws.nodes.filter((n) => {
    if (type && n.type !== type) return false;
    if (authorKind && n.authorKind !== authorKind) return false;
    if (!needle) return true;
    return `${n.titre} ${n.corps}`.toLowerCase().includes(needle);
  });
}

// ---------------------------------------------------------------------------
// Annuler / retablir (EF-214)
// ---------------------------------------------------------------------------

/**
 * Pile d'undo/redo bornee. On empile des ETATS complets et non des deltas :
 * un workspace est immuable et partage sa structure, le cout memoire est celui
 * des noeuds modifies, pas du canvas entier.
 *
 * Les mutations produites par les agents sont empilees comme les autres
 * (exigence EF-214 : "y compris les mutations produites par les agents").
 */
export class UndoStack {
  constructor(initial, { limite = 50 } = {}) {
    if (!initial) throw new Error('UndoStack: etat initial requis');
    this.limite = limite;
    this._passe = [];
    this._present = initial;
    this._futur = [];
  }
  get present() { return this._present; }
  get canUndo() { return this._passe.length > 0; }
  get canRedo() { return this._futur.length > 0; }
  get profondeur() { return this._passe.length; }

  /** Enregistre un nouvel etat. Invalide le futur (branche abandonnee). */
  push(etat) {
    if (!etat) throw new Error('UndoStack.push: etat requis');
    this._passe.push(this._present);
    if (this._passe.length > this.limite) this._passe.shift();
    this._present = etat;
    this._futur = [];
    return this._present;
  }
  undo() {
    if (!this.canUndo) return this._present;
    this._futur.unshift(this._present);
    this._present = this._passe.pop();
    return this._present;
  }
  redo() {
    if (!this.canRedo) return this._present;
    this._passe.push(this._present);
    this._present = this._futur.shift();
    return this._present;
  }
}

/** Statistiques d'un canvas (alimente le futur reporting). */
export function stats(ws) {
  const parType = Object.fromEntries(NODE_TYPES.map((t) => [t, 0]));
  let agents = 0, sources = 0;
  for (const n of ws.nodes) {
    if (parType[n.type] !== undefined) parType[n.type]++;
    if (n.authorKind === 'agent') agents++;
    if (isSourced(n)) sources++;
  }
  return {
    noeuds: ws.nodes.length,
    aretes: ws.edges.length,
    clusters: ws.clusters.length,
    parType,
    parAgent: agents,
    sources,
    // Une session ou tout est non source est un signal, pas un detail.
    tauxSourcage: ws.nodes.length ? Math.round((sources / ws.nodes.length) * 100) / 100 : null,
    contradictions: ws.edges.filter((e) => e.relation === 'contredit').length,
    promues: ws.promotedIdeaIds.length,
  };
}
