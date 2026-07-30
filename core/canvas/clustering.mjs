// KayrosLab — Canvas : clustering semantique, deduplication, layout.
// EF-215 (auto-clustering deterministe), EF-216 (libelles), EF-217 (dedup),
// EF-218 (noeuds figes respectes).

import { cosine } from '../memory.mjs';
// Le PRNG vient du coeur : le determinisme du layout et celui du Monte-Carlo
// de `projection.mjs` reposent ainsi sur la MEME source. Deux implementations
// divergentes du meme generateur seraient un piege silencieux.
import { mulberry32 } from '../projection.mjs';
import { createCluster, getNode } from './model.mjs';
import { centroid } from './vectors.mjs';

// ---------------------------------------------------------------------------
// Determinisme
// ---------------------------------------------------------------------------

/**
 * ECART ASSUME AU CDC §5. Le CDC recommandait HDBSCAN. En zero dependance,
 * HDBSCAN complet (arbre de portee minimale + hierarchie de stabilite) est
 * disproportionne pour le lot v11. On implemente un **single-linkage a seuil**
 * par union-find, qui conserve les proprietes qui nous importaient :
 *   - pas de `k` a fixer d'avance ;
 *   - le bruit reste du bruit (un noeud isole forme un singleton) ;
 *   - resultat exact et **deterministe sans graine** — plus fort que
 *     "rejouable a graine fixee" exige par EF-215.
 *
 * LIMITE CONNUE : le single-linkage souffre de l'effet de chainage (deux
 * groupes distincts relies par une suite de noeuds ponts fusionnent).
 * Garde-fou : `maxTaille` declenche une COUPE D'ARBRE COUVRANT MAXIMAL
 * (`splitBySize`). Relever le seuil ne suffit pas — sur une chaine dense tous
 * les liens sont forts et aucun seuil ne separe ; il faut couper les liens les
 * plus FAIBLES du squelette, ce qui est exactement la coupe du dendrogramme
 * single-link. HDBSCAN reste ouvert en v12 si la mesure l'impose.
 */

/** Union-find avec compression de chemin. */
class UnionFind {
  constructor(ids) { this.p = new Map(ids.map((i) => [i, i])); }
  find(x) {
    let r = x;
    while (this.p.get(r) !== r) r = this.p.get(r);
    while (this.p.get(x) !== r) { const n = this.p.get(x); this.p.set(x, r); x = n; }
    return r;
  }
  union(a, b) {
    const ra = this.find(a); const rb = this.find(b);
    if (ra === rb) return false;
    // Rattachement par ordre lexicographique d'id : deterministe.
    if (ra < rb) this.p.set(rb, ra); else this.p.set(ra, rb);
    return true;
  }
}

/**
 * Regroupe des elements {id, vector} par similarite cosinus >= seuil.
 * @returns {string[][]} groupes d'ids, tries — ordre stable garanti.
 */
export function agglomerate(items, seuil, { maxTaille = Infinity } = {}) {
  const valides = items.filter((i) => Array.isArray(i.vector)).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!valides.length) return [];
  const uf = new UnionFind(valides.map((i) => i.id));
  for (let i = 0; i < valides.length; i++) {
    for (let j = i + 1; j < valides.length; j++) {
      if (cosine(valides[i].vector, valides[j].vector) >= seuil) uf.union(valides[i].id, valides[j].id);
    }
  }
  const groupes = new Map();
  for (const it of valides) {
    const r = uf.find(it.id);
    if (!groupes.has(r)) groupes.set(r, []);
    groupes.get(r).push(it.id);
  }
  let out = [...groupes.values()].map((g) => g.sort());

  if (maxTaille !== Infinity) {
    const parId = new Map(valides.map((i) => [i.id, i.vector]));
    out = out.flatMap((g) => (g.length <= maxTaille
      ? [g]
      : splitBySize(g.map((id) => ({ id, vector: parId.get(id) })), maxTaille)));
  }
  return out.sort((a, b) => (b.length - a.length) || (a[0] < b[0] ? -1 : 1));
}

/**
 * Decoupe un groupe trop gros en coupant les liens les plus faibles de son
 * arbre couvrant maximal. Deterministe (egalites brisees par id).
 * @returns {string[][]}
 */
export function splitBySize(entrees, maxTaille) {
  // Ordre CANONIQUE d'abord. Sur des poids ex aequo l'arbre couvrant maximal
  // n'est pas unique : sans tri prealable, deux ordres d'entree produiraient
  // deux decoupes valides mais differentes. Le determinisme vient de l'ordre,
  // pas d'un pari sur l'unicite de l'arbre.
  const items = [...entrees].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = items.length;
  if (n <= maxTaille) return [items.map((i) => i.id).sort()];

  // Arbre couvrant MAXIMAL (Prim) : le squelette de similarite du groupe.
  const dans = [0];
  const reste = new Set(items.map((_, k) => k).slice(1));
  const aretes = [];
  while (reste.size) {
    let best = null;
    for (const a of dans) {
      for (const b of reste) {
        const w = cosine(items[a].vector, items[b].vector);
        // Egalite tranchee par id : reproductibilite garantie.
        if (!best || w > best.w || (w === best.w && items[b].id < items[best.b].id)) best = { a, b, w };
      }
    }
    aretes.push(best);
    dans.push(best.b);
    reste.delete(best.b);
  }

  // Retrait des liens les plus faibles jusqu'a ce que chaque composante tienne.
  aretes.sort((x, y) => (x.w - y.w) || (items[x.b].id < items[y.b].id ? -1 : 1));
  let coupes = 0;
  let composantes;
  do {
    const uf = new UnionFind(items.map((i) => i.id));
    for (const e of aretes.slice(coupes)) uf.union(items[e.a].id, items[e.b].id);
    const m = new Map();
    for (const it of items) {
      const r = uf.find(it.id);
      if (!m.has(r)) m.set(r, []);
      m.get(r).push(it.id);
    }
    composantes = [...m.values()].map((g) => g.sort());
    coupes++;
  } while (composantes.some((c) => c.length > maxTaille) && coupes <= aretes.length);

  return composantes;
}

// ---------------------------------------------------------------------------
// Clustering d'un workspace (EF-215 / EF-216)
// ---------------------------------------------------------------------------

/**
 * Calcule les clusters d'un workspace a partir de l'index vectoriel.
 * Ne mute rien : renvoie des clusters a passer a `applyClusters`.
 *
 * Les libelles existants sont REPORTES quand le cluster est reconnaissable
 * (majorite de noeuds communs), et un libelle `human` n'est jamais degrade en
 * `llm` (EF-216).
 */
export function clusterWorkspace(ws, index, { seuil = null, maxTaille = 25 } = {}) {
  const s = seuil ?? ws.settings.clusterThreshold ?? 0.7;
  const items = ws.nodes
    .filter((n) => n.type !== 'groupe')
    .map((n) => ({ id: n.id, vector: index.get(n.id) }));

  const nonIndexes = items.filter((i) => !i.vector).map((i) => i.id);
  const groupes = agglomerate(items, s, { maxTaille });

  const clusters = groupes.map((nodeIds, k) => {
    const ancien = reconnaitreCluster(ws, nodeIds);
    return createCluster({
      // Id stable : derive du plus petit id membre, pour que deux executions
      // sur le meme contenu produisent les memes identifiants de cluster.
      id: ancien?.id ?? `c_${nodeIds[0]}`,
      label: ancien?.label ?? null,
      labelSource: ancien?.labelSource ?? 'llm',
      nodeIds,
      centroid: centroid(nodeIds.map((id) => index.get(id))),
    });
  });

  return {
    clusters,
    seuil: s,
    // EF-215 : on declare ce qui n'a pas pu etre traite plutot que de le
    // ranger silencieusement dans un cluster par defaut.
    nonIndexes,
    singletons: clusters.filter((c) => c.nodeIds.length === 1).length,
  };
}

/** Retrouve le cluster precedent le plus recouvrant (>= 50 % des membres). */
function reconnaitreCluster(ws, nodeIds) {
  let best = null; let bestScore = 0;
  for (const c of ws.clusters) {
    const communs = c.nodeIds.filter((id) => nodeIds.includes(id)).length;
    const score = communs / Math.max(c.nodeIds.length, nodeIds.length);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 0.5 ? best : null;
}

/**
 * EF-216 : propose un libelle par cluster via le LLM.
 * Les clusters dont le libelle est d'origine `human` sont IGNORES — pas
 * d'appel LLM inutile, pas de risque d'ecrasement.
 * @returns {Promise<{clusterId:string,label:string}[]>} propositions
 */
export async function proposeClusterLabels(ws, { llm, model = null, max = 20 } = {}) {
  if (!llm?.complete) throw new Error('proposeClusterLabels: llm.complete requis');
  const cibles = ws.clusters.filter((c) => c.labelSource !== 'human').slice(0, max);
  const out = [];
  for (const c of cibles) {
    const titres = c.nodeIds.map((id) => getNode(ws, id)?.titre).filter(Boolean);
    if (!titres.length) continue;
    const contenu = [
      'Voici des idees regroupees par proximite semantique :',
      ...titres.map((t) => `- ${t}`),
      '',
      'Donne un libelle de 2 a 5 mots qui nomme le THEME COMMUN.',
      "Reponds uniquement par le libelle, sans guillemets ni ponctuation finale.",
    ].join('\n');
    try {
      // Format `messages` : contrat de `KayrosLLM.complete` (cf. kayros-llm.mjs).
      const r = await llm.complete({
        messages: [{ role: 'user', content: contenu }],
        role: 'Synthesizer', model, temperature: 0,
      });
      const label = String(r?.text ?? r ?? '').trim().split('\n')[0].slice(0, 60);
      if (label) out.push({ clusterId: c.id, label });
    } catch {
      // Un echec de libellage ne doit pas faire echouer le clustering :
      // un cluster sans nom reste exploitable, un canvas casse ne l'est pas.
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deduplication (EF-217)
// ---------------------------------------------------------------------------

/**
 * EF-217 : detecte les quasi-doublons et renvoie des SUGGESTIONS.
 * La fusion n'est jamais automatique : deux formulations proches peuvent
 * porter deux intentions distinctes, et l'ecrasement silencieux d'une nuance
 * est exactement ce qu'un atelier d'ideation doit eviter.
 */
export function findDuplicates(ws, index, { seuil = null, limite = 50 } = {}) {
  const s = seuil ?? ws.settings.dedupeThreshold ?? 0.92;
  const nodes = [...ws.nodes].sort((a, b) => (a.id < b.id ? -1 : 1));
  const paires = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = index.get(nodes[i].id); const b = index.get(nodes[j].id);
      if (!a || !b) continue;
      const sim = cosine(a, b);
      if (sim >= s) {
        paires.push({
          // Convention : on garde le plus ancien, on propose d'absorber le plus recent.
          garder: nodes[i].createdAt <= nodes[j].createdAt ? nodes[i].id : nodes[j].id,
          absorber: nodes[i].createdAt <= nodes[j].createdAt ? nodes[j].id : nodes[i].id,
          similarite: Math.round(sim * 10000) / 10000,
          memeAuteur: nodes[i].authorId === nodes[j].authorId,
        });
      }
    }
  }
  return paires.sort((x, y) => y.similarite - x.similarite).slice(0, limite);
}

/**
 * Fusion EXPLICITE de deux noeuds. Le corps absorbe est conserve en annexe :
 * on ne detruit pas une formulation, on l'archive.
 * Les aretes du noeud absorbe sont reportees sur le noeud conserve.
 */
export function mergeNodes(ws, garderId, absorberId, { by = null } = {}) {
  const g = getNode(ws, garderId); const a = getNode(ws, absorberId);
  if (!g) throw new Error(`mergeNodes: noeud introuvable "${garderId}"`);
  if (!a) throw new Error(`mergeNodes: noeud introuvable "${absorberId}"`);
  if (garderId === absorberId) throw new Error('mergeNodes: fusion d un noeud avec lui-meme');

  const fusionne = {
    ...g,
    corps: [g.corps, `\n\n— fusionne depuis « ${a.titre} » —\n${a.corps}`.trimEnd()].join('').trim(),
    meta: { ...g.meta, fusions: [...(g.meta?.fusions ?? []), { id: a.id, titre: a.titre, ts: new Date().toISOString() }] },
    updatedAt: new Date().toISOString(),
  };

  // Report des aretes, sans creer de boucle ni de doublon.
  const reportees = [];
  for (const e of ws.edges) {
    if (e.from !== absorberId && e.to !== absorberId) { reportees.push(e); continue; }
    const from = e.from === absorberId ? garderId : e.from;
    const to = e.to === absorberId ? garderId : e.to;
    if (from === to) continue;
    if (reportees.some((x) => x.from === from && x.to === to && x.relation === e.relation)) continue;
    reportees.push({ ...e, from, to });
  }

  const ts = new Date().toISOString();
  return {
    ...ws,
    nodes: ws.nodes.filter((n) => n.id !== absorberId).map((n) => (n.id === garderId ? fusionne : n)),
    edges: reportees,
    updatedAt: ts,
    history: [...ws.history, { type: 'node.merge', garde: garderId, absorbe: absorberId, by, ts }],
  };
}

// ---------------------------------------------------------------------------
// Layout (EF-215 volet spatial, EF-218)
// ---------------------------------------------------------------------------

/**
 * Dispose les noeuds par cluster : clusters en spirale, membres en anneau.
 * EF-218 : un noeud `pinned` conserve strictement ses coordonnees.
 * A graine egale et clusters egaux, la sortie est identique.
 */
export function layoutClusters(ws, { espacement = 420, rayon = 150, seed = null } = {}) {
  const rnd = mulberry32(seed ?? ws.seed ?? 1);
  const positions = new Map();

  ws.clusters.forEach((c, ci) => {
    // Spirale de Vogel : repartition reguliere sans chevauchement.
    const angle = ci * 2.399963229728653;
    const d = espacement * Math.sqrt(ci);
    const cx = Math.round(Math.cos(angle) * d);
    const cy = Math.round(Math.sin(angle) * d);
    const membres = [...c.nodeIds].sort();
    membres.forEach((nid, k) => {
      const n = getNode(ws, nid);
      if (!n || n.pinned) return; // EF-218
      const a = (k / Math.max(membres.length, 1)) * Math.PI * 2;
      const r = membres.length === 1 ? 0 : rayon + rnd() * 40;
      positions.set(nid, { x: cx + Math.round(Math.cos(a) * r), y: cy + Math.round(Math.sin(a) * r) });
    });
  });

  return {
    ...ws,
    nodes: ws.nodes.map((n) => (positions.has(n.id) ? { ...n, ...positions.get(n.id) } : n)),
    updatedAt: new Date().toISOString(),
    history: [...ws.history, { type: 'layout', nb: positions.size, ts: new Date().toISOString() }],
  };
}
