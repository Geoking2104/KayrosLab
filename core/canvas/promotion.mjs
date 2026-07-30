// KayrosLab — Canvas : convergence vers le cycle gouverne.
// EF-257 (matrice Impact x Effort), EF-258 (scorecard), EF-259 (promotion ->
// intake Recueillir), EF-260 (lien bidirectionnel canvas <-> idee).
//
// C'est la charniere du produit : sans elle le canvas est un tableau blanc de
// plus. Avec elle, une session divergente entre dans le cycle 8 etapes avec
// ses hypotheses et ses cibles d'attaque deja constituees.

import { Scorecard } from '../scorecard.mjs';
import { createIdea } from '../model.mjs';
import { processIntake } from '../intake.mjs';
import { getNode, edgesOf } from './model.mjs';

// ---------------------------------------------------------------------------
// Matrice Impact x Effort (EF-257 / EF-258)
// ---------------------------------------------------------------------------

/**
 * Grille dediee a la priorisation amont. Echelle 10 : a ce stade on trie, on
 * n'evalue pas finement — l'evaluation approfondie reste celle d'`arbitrer`.
 */
export function impactEffortScorecard() {
  return new Scorecard({
    id: 'canvas-impact-effort', stage: 'cartographier',
    label: 'Priorisation amont (Impact x Effort)', scale: 10,
    criteria: [
      { id: 'impact', label: 'Impact attendu', weight: 1 },
      { id: 'effort', label: "Effort d'execution", weight: 1 },
      { id: 'confiance', label: 'Confiance dans l estimation', weight: 0.5 },
    ],
  });
}

/** Quadrant a partir des notes brutes. Seuil median de l'echelle. */
export function quadrant(impact, effort, echelle = 10) {
  if (typeof impact !== 'number' || typeof effort !== 'number') return null;
  const m = echelle / 2;
  if (impact >= m && effort < m) return 'quick-win';
  if (impact >= m && effort >= m) return 'chantier';
  if (impact < m && effort < m) return 'appoint';
  return 'gouffre';
}

/**
 * Positionne les noeuds sur la matrice.
 *
 * EF-258 : une evaluation partielle est SIGNALEE comme telle (couverture),
 * jamais presentee comme complete. Un noeud non note ressort avec
 * `quadrant: null` et `evalue: false` — il n'est pas pousse par defaut
 * dans un quadrant, ce qui reviendrait a inventer une donnee absente.
 */
export function buildMatrix(ws, notes = {}, { scorecard = null } = {}) {
  const card = scorecard ?? impactEffortScorecard();
  const cellules = ws.nodes
    .filter((n) => ['idee', 'hypothese', 'decision'].includes(n.type))
    .map((n) => {
      const v = notes[n.id] ?? {};
      const s = card.score(v);
      return {
        nodeId: n.id, titre: n.titre, type: n.type, clusterId: n.clusterId,
        impact: typeof v.impact === 'number' ? v.impact : null,
        effort: typeof v.effort === 'number' ? v.effort : null,
        quadrant: quadrant(v.impact, v.effort, card.scale),
        score: s.normalise, couverture: s.couverture, evalue: s.evalue,
        promotedIdeaId: n.promotedIdeaId,
      };
    });

  const notes_ = cellules.filter((c) => c.evalue).length;
  return {
    scorecardId: card.id, echelle: card.scale, cellules,
    // Compteurs explicites : on sait toujours sur quoi porte la lecture.
    total: cellules.length, evaluees: notes_, nonEvaluees: cellules.length - notes_,
    couvertureGlobale: cellules.length ? Math.round((notes_ / cellules.length) * 100) / 100 : null,
    parQuadrant: ['quick-win', 'chantier', 'appoint', 'gouffre'].reduce((acc, q) => {
      acc[q] = cellules.filter((c) => c.quadrant === q).length; return acc;
    }, {}),
  };
}

// ---------------------------------------------------------------------------
// Promotion vers une Idee (EF-259 / EF-260)
// ---------------------------------------------------------------------------

/**
 * Construit un canevas d'intake a partir d'un noeud et de son voisinage.
 * Les aretes typees portent le sens : ce qui `soutient` alimente la valeur,
 * ce qui `contredit` alimente les risques. C'est la raison d'etre du typage
 * des aretes (EF-212) — sans lui, cette derivation serait du devinement.
 */
export function nodeToIntake(ws, nodeId) {
  const n = getNode(ws, nodeId);
  if (!n) throw new Error(`nodeToIntake: noeud introuvable "${nodeId}"`);

  const voisins = edgesOf(ws, nodeId).map((e) => ({
    relation: e.relation,
    autre: getNode(ws, e.from === nodeId ? e.to : e.from),
    sortant: e.from === nodeId,
  })).filter((v) => v.autre);

  const par = (rel) => voisins.filter((v) => v.relation === rel).map((v) => v.autre);
  const soutiens = par('soutient');
  const contres = par('contredit');
  const deps = par('depend');

  const preuves = voisins.filter((v) => v.autre.type === 'preuve').map((v) => v.autre);
  const critiques = voisins.filter((v) => v.autre.type === 'critique').map((v) => v.autre);

  const joindre = (arr) => arr.map((x) => x.titre).join(' ; ');

  return {
    valeur: [n.titre, n.corps].filter(Boolean).join(' — ').slice(0, 2000),
    probleme: joindre(par('derive').filter((x) => x.type === 'question'))
      || joindre(voisins.filter((v) => v.autre.type === 'question').map((v) => v.autre))
      || '',
    ressources: joindre(deps),
    partiesPrenantes: '',
    // Les critiques et contradictions deviennent des risques declares : le
    // desaccord produit sur le canvas n'est pas perdu a la promotion.
    risques: joindre([...contres, ...critiques]),
    equipe: '',
    _canvas: {
      workspaceId: ws.id, nodeId: n.id,
      appuis: soutiens.length, contradictions: contres.length,
      preuves: preuves.length, sourcees: preuves.filter((p) => p.provenance).length,
    },
  };
}

/** Idem pour un cluster entier : le noeud le plus connecte sert de tete. */
export function clusterToIntake(ws, clusterId) {
  const c = ws.clusters.find((x) => x.id === clusterId);
  if (!c) throw new Error(`clusterToIntake: cluster introuvable "${clusterId}"`);
  if (!c.nodeIds.length) throw new Error('clusterToIntake: cluster vide');

  const membres = c.nodeIds.map((id) => getNode(ws, id)).filter(Boolean);
  const tete = [...membres].sort((a, b) => edgesOf(ws, b.id).length - edgesOf(ws, a.id).length
    || (a.id < b.id ? -1 : 1))[0];

  const base = nodeToIntake(ws, tete.id);
  const autres = membres.filter((m) => m.id !== tete.id);
  return {
    ...base,
    valeur: [c.label ? `[${c.label}] ` : '', base.valeur].join(''),
    probleme: base.probleme || autres.filter((m) => m.type === 'question').map((m) => m.titre).join(' ; '),
    risques: [base.risques, autres.filter((m) => m.type === 'critique').map((m) => m.titre).join(' ; ')]
      .filter(Boolean).join(' ; '),
    _canvas: { ...base._canvas, clusterId, membres: membres.length },
  };
}

/**
 * Promeut un noeud ou un cluster en Idee du portefeuille.
 *
 * EF-259 : l'intake derive alimente automatiquement hypotheses (Construire) et
 * cibles d'attaque (Eprouver) via `processIntake` — y compris les ANGLES MORTS
 * pour les champs non renseignes, conformement a EF-60.
 * EF-260 : le lien est pose des deux cotes (noeud -> idee, workspace -> idees).
 *
 * @returns {{workspace:object, idea:object, traitement:object}}
 */
export function promote(ws, { nodeId = null, clusterId = null, ideaId, titre = null, author = null, tenantId = null, category = 'general' } = {}) {
  if (!nodeId && !clusterId) throw new Error('promote: nodeId ou clusterId requis');
  if (nodeId && clusterId) throw new Error('promote: nodeId et clusterId mutuellement exclusifs');
  if (!ideaId) throw new Error('promote: ideaId requis');

  const intake = clusterId ? clusterToIntake(ws, clusterId) : nodeToIntake(ws, nodeId);
  const source = clusterId
    ? ws.clusters.find((c) => c.id === clusterId)
    : getNode(ws, nodeId);

  const titreIdee = titre
    ?? (clusterId ? (source.label ?? `Cluster ${clusterId}`) : source.titre);

  const idea = createIdea({
    id: ideaId, title: titreIdee, author,
    tenantId: tenantId ?? ws.tenantId,
    stage: 'recueillir', status: 'nouveau',
    intake, category,
  });

  // Lien retour cote canvas.
  const cibles = clusterId ? source.nodeIds : [nodeId];
  const ts = new Date().toISOString();
  const workspace = {
    ...ws,
    nodes: ws.nodes.map((n) => (cibles.includes(n.id) ? { ...n, promotedIdeaId: ideaId } : n)),
    promotedIdeaIds: ws.promotedIdeaIds.includes(ideaId) ? ws.promotedIdeaIds : [...ws.promotedIdeaIds, ideaId],
    updatedAt: ts,
    history: [...ws.history, { type: 'promote', ideaId, nodeId, clusterId, by: author, ts }],
  };

  return { workspace, idea, traitement: processIntake(intake) };
}

/**
 * EF-260, sens inverse : retrouve le contexte d'origine d'une idee.
 * Sans ce chemin de retour, la tracabilite est declarative — on saurait qu'une
 * idee vient d'un canvas sans pouvoir y remonter.
 */
export function originOf(ws, ideaId) {
  if (!ws.promotedIdeaIds.includes(ideaId)) return null;
  const nodes = ws.nodes.filter((n) => n.promotedIdeaId === ideaId);
  const clusterIds = [...new Set(nodes.map((n) => n.clusterId).filter(Boolean))];
  const entree = [...ws.history].reverse().find((h) => h.type === 'promote' && h.ideaId === ideaId) ?? null;
  return {
    workspaceId: ws.id, nom: ws.nom, ideaId,
    nodes, clusters: ws.clusters.filter((c) => clusterIds.includes(c.id)),
    sources: nodes.filter((n) => n.provenance).map((n) => n.provenance),
    promuLe: entree?.ts ?? null, promuPar: entree?.by ?? null,
  };
}
