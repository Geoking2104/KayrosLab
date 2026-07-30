// KayrosLab — Canvas : indexation vectorielle des noeuds.
// EF-215 (clustering), EF-217 (deduplication), EF-222 (recherche semantique).
//
// CHOIX D'INTEGRATION. Les stores existants (`InMemoryVectorStore`,
// `QdrantVectorStore`) exposent `upsert({id, ideaId, text, embedding})` et
// filtrent par `ideaId`. Le canvas a besoin d'un scope `workspaceId`.
// Plutot que de modifier `core/memory.mjs` — et de risquer une regression sur
// la memoire agent, qui est en service — on encapsule le mapping ici.
// Un seul endroit a changer le jour ou les stores acceptent un scope generique.

import { cosine } from '../memory.mjs';
import { nodeText } from './model.mjs';

/** Cle de scope : prefixee pour ne jamais entrer en collision avec un ideaId. */
export const scopeKey = (workspaceId) => `ws:${workspaceId}`;

export class CanvasVectorIndex {
  /**
   * @param {{embeddings:{embed:Function,embedBatch:Function}, store:{upsert:Function,search:Function}}} deps
   */
  constructor({ embeddings, store }) {
    if (!embeddings || !store) throw new Error('CanvasVectorIndex: embeddings + store requis');
    this.embeddings = embeddings;
    this.store = store;
    // Cache local des vecteurs : le clustering a besoin de TOUS les vecteurs,
    // or l'interface `search(k)` ne permet pas de tout relire. Le store reste
    // la source de verite pour la recherche ; ce cache sert le calcul local.
    this._vecs = new Map(); // nodeId -> number[]
  }

  /** Vectorise et indexe des noeuds. Renvoie le nombre de vecteurs ecrits. */
  async indexNodes(workspaceId, nodes) {
    if (!nodes.length) return 0;
    const textes = nodes.map(nodeText);
    const vecs = await this.embeddings.embedBatch(textes);
    await Promise.all(nodes.map((n, k) => {
      this._vecs.set(n.id, vecs[k]);
      return this.store.upsert({ id: n.id, ideaId: scopeKey(workspaceId), text: textes[k], embedding: vecs[k] });
    }));
    return vecs.length;
  }

  /** Indexe uniquement les noeuds absents du cache (appels repetes peu couteux). */
  async indexMissing(workspaceId, nodes) {
    const manquants = nodes.filter((n) => !this._vecs.has(n.id));
    return this.indexNodes(workspaceId, manquants);
  }

  get(nodeId) { return this._vecs.get(nodeId) ?? null; }
  has(nodeId) { return this._vecs.has(nodeId); }
  forget(nodeId) { return this._vecs.delete(nodeId); }
  size() { return this._vecs.size; }

  /** Vecteurs des noeuds fournis, dans l'ordre. `null` si non indexe. */
  vectorsFor(nodes) { return nodes.map((n) => this._vecs.get(n.id) ?? null); }

  /** EF-222 : recherche semantique intra-canvas, deleguee au store. */
  async search(workspaceId, query, k = 10) {
    const q = await this.embeddings.embed(query);
    return this.store.search(q, k, { ideaId: scopeKey(workspaceId) });
  }

  /** Similarite entre deux noeuds deja indexes. `null` si l'un manque. */
  similarity(aId, bId) {
    const a = this._vecs.get(aId); const b = this._vecs.get(bId);
    if (!a || !b) return null;
    return cosine(a, b);
  }
}

/** Centroide normalise d'un ensemble de vecteurs. `null` si vide. */
export function centroid(vectors) {
  const valides = vectors.filter(Array.isArray);
  if (!valides.length) return null;
  const dim = valides[0].length;
  const out = new Array(dim).fill(0);
  for (const v of valides) for (let i = 0; i < dim; i++) out[i] += v[i] ?? 0;
  const norme = Math.hypot(...out) || 1;
  return out.map((x) => x / norme);
}
