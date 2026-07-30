// KayrosLab — Canvas : recherche unifiee.
// EF-252 (index transversal), EF-253 (recherche hybride), EF-254 (reponse avec recus).
//
// Transposition B5 de Buzz : un seul point d'entree sur TOUS les types. Chez
// Buzz c'est natif — tout est deja un evenement. Ici il faut agreger des
// sources heterogenes, ce que fait `indexerTout`.

import { cosine } from '../memory.mjs';
import { scopeKey } from './vectors.mjs';

/** Types indexables. Un type absent de cette liste n'est pas cherchable — et
 *  c'est visible, plutot que silencieusement omis des resultats. */
export const TYPES_INDEXABLES = Object.freeze(['node', 'comment', 'agent-output', 'idea', 'gate', 'transition', 'source']);

/** Normalise pour la comparaison lexicale : minuscules, sans accents. */
export function normaliser(t) {
  return String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Score lexical BM25-like simplifie : frequence ponderee par la rarete. */
function scoreLexical(requete, texte, df, n) {
  const mots = normaliser(requete).split(/\W+/).filter((m) => m.length > 2);
  if (!mots.length) return 0;
  const doc = normaliser(texte);
  let s = 0;
  for (const m of mots) {
    const occurrences = doc.split(m).length - 1;
    if (!occurrences) continue;
    const idf = Math.log(1 + (n - (df.get(m) ?? 0) + 0.5) / ((df.get(m) ?? 0) + 0.5));
    s += (occurrences / (occurrences + 1.2)) * Math.max(idf, 0.1);
  }
  return s / mots.length;
}

/** Entree d'index normalisee, quelle que soit la source. */
export function entree({ id, type, texte, workspaceId, tenantId = 'default', auteur = null, auteurKind = 'human', ts = null, ref = null }) {
  if (!TYPES_INDEXABLES.includes(type)) throw new Error(`entree: type non indexable "${type}"`);
  return { id, type, texte: String(texte ?? ''), workspaceId, tenantId, auteur, auteurKind, ts: ts ?? null, ref };
}

/**
 * EF-252 : agrege les sources d'un espace en entrees homogenes.
 * Le journal, les commentaires et les idees sont fournis par l'appelant :
 * le coeur du canvas ne connait pas le portefeuille, et ne doit pas le connaitre.
 */
export function indexerTout({ workspace, commentaires = [], idees = [], journal = [], documents = [] }) {
  const out = [];
  const ws = workspace;
  if (ws) {
    for (const n of ws.nodes) {
      out.push(entree({
        id: n.id, type: n.authorKind === 'agent' ? 'agent-output' : 'node',
        texte: `${n.titre}\n${n.corps ?? ''}`, workspaceId: ws.id, tenantId: ws.tenantId,
        auteur: n.authorId, auteurKind: n.authorKind, ts: n.updatedAt, ref: { noeud: n.id, clusterId: n.clusterId },
      }));
    }
    for (const h of ws.history ?? []) {
      if (!h.type?.startsWith('node.') && !h.type?.startsWith('cluster.')) continue;
      out.push(entree({
        id: `hist:${ws.id}:${h.ts}:${h.type}`, type: 'transition',
        texte: `${h.type} ${h.nodeId ?? h.clusterId ?? ''}`, workspaceId: ws.id, tenantId: ws.tenantId,
        auteur: h.by, ts: h.ts, ref: h,
      }));
    }
  }
  for (const c of commentaires) {
    if (c.supprime) continue;   // un commentaire supprime ne remonte pas
    out.push(entree({ id: c.id, type: 'comment', texte: c.texte ?? '', workspaceId: ws?.id, auteur: c.by, ts: c.ts, ref: { commentaire: c.id } }));
  }
  for (const i of idees) {
    out.push(entree({
      id: i.id, type: 'idea', texte: `${i.title}\n${JSON.stringify(i.intake ?? {})}`,
      workspaceId: ws?.id, tenantId: i.tenantId, auteur: i.author, ts: i.updatedAt, ref: { idee: i.id, stage: i.stage, status: i.status },
    }));
  }
  for (const e of journal) {
    if (!['gate.open', 'gate.resolve', 'promote'].includes(e.type)) continue;
    out.push(entree({
      id: `evt:${e.hash ?? e.seq}`, type: 'gate', texte: `${e.type} ${JSON.stringify(e.payload ?? {})}`,
      workspaceId: e.workspaceId, auteur: e.actorId, auteurKind: e.actorKind, ts: e.ts, ref: { seq: e.seq, hash: e.hash },
    }));
  }
  for (const d of documents) {
    if (d.retiredAt) continue;  // EF-207 : une source retiree sort de l'index
    out.push(entree({ id: d.id, type: 'source', texte: d.nom, workspaceId: d.workspaceId, tenantId: d.tenantId, ts: d.ingestedAt, ref: { docId: d.id } }));
  }
  return out;
}

/** Index unifie interrogeable en lexical, en semantique ou les deux. */
export class UnifiedIndex {
  constructor({ embeddings = null, store = null } = {}) {
    this.embeddings = embeddings;
    this.store = store;
    this._e = new Map();
    this._df = new Map();
    this._vecs = new Map();
  }

  get taille() { return this._e.size; }

  async indexer(entrees) {
    for (const e of entrees) {
      this._e.set(e.id, e);
      for (const m of new Set(normaliser(e.texte).split(/\W+/).filter((x) => x.length > 2))) {
        this._df.set(m, (this._df.get(m) ?? 0) + 1);
      }
    }
    if (this.embeddings) {
      const vecs = await this.embeddings.embedBatch(entrees.map((e) => e.texte));
      entrees.forEach((e, i) => this._vecs.set(e.id, vecs[i]));
    }
    return this.taille;
  }

  oublier(id) { this._e.delete(id); this._vecs.delete(id); }
  vider() { this._e.clear(); this._df.clear(); this._vecs.clear(); }

  /**
   * EF-253 : recherche hybride. `alpha` pondere lexical (0) vs semantique (1).
   * Les deux scores sont RENDUS separement : un resultat qui ne ressort que
   * par proximite vectorielle n'a pas le meme statut qu'une correspondance
   * litterale, et l'utilisateur doit pouvoir le voir.
   */
  async chercher(requete, { types = null, workspaceId = null, tenantId = null, auteur = null, depuis = null, jusqua = null, k = 10, alpha = 0.5, seuilSemantique = 0.6 } = {}) {
    let candidats = [...this._e.values()];
    if (tenantId) candidats = candidats.filter((e) => e.tenantId === tenantId);
    if (workspaceId) candidats = candidats.filter((e) => e.workspaceId === workspaceId);
    if (types?.length) candidats = candidats.filter((e) => types.includes(e.type));
    if (auteur) candidats = candidats.filter((e) => e.auteur === auteur);
    if (depuis) candidats = candidats.filter((e) => e.ts && e.ts >= depuis);
    if (jusqua) candidats = candidats.filter((e) => e.ts && e.ts <= jusqua);

    const n = Math.max(this._e.size, 1);
    let qv = null;
    if (this.embeddings && alpha > 0) qv = await this.embeddings.embed(requete);

    const notes = candidats.map((e) => {
      const lex = scoreLexical(requete, e.texte, this._df, n);
      const sem = qv && this._vecs.has(e.id) ? Math.max(0, cosine(qv, this._vecs.get(e.id))) : 0;
      return { entree: e, lexical: Math.round(lex * 1e4) / 1e4, semantique: Math.round(sem * 1e4) / 1e4, score: (1 - alpha) * lex + alpha * sem };
    });

    // PLANCHER SEMANTIQUE. Un espace vectoriel n'a pas de notion de « rien ne
    // correspond » : sans plancher, une requete sans rapport avec le corpus
    // remonte quand meme ses voisins les moins eloignes, et la recherche ne
    // renvoie JAMAIS zero resultat. Un resultat est donc retenu s'il
    // correspond litteralement (lexical > 0) ou s'il est semantiquement proche
    // au-dela du plancher. `seuilSemantique: 0` restaure l'ancien comportement.
    return notes
      .filter((x) => x.lexical > 0 || x.semantique >= seuilSemantique)
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (a.entree.id < b.entree.id ? -1 : 1))
      .slice(0, k)
      .map((x, i) => ({ marqueur: i + 1, ...x, score: Math.round(x.score * 1e4) / 1e4 }));
  }

  scope(workspaceId) { return scopeKey(workspaceId); }
}

/**
 * EF-254 : reponse avec recus sur l'historique.
 * Le prompt impose la citation par marqueur et le resultat porte les
 * evenements sources. Une reponse non citee est renvoyee `sourced: false`
 * plutot que presentee comme un resultat de recherche.
 */
export async function repondreAvecRecus(index, question, { llm, k = 6, model = null, ...filtres } = {}) {
  if (!llm?.complete) throw new Error('repondreAvecRecus: llm.complete requis');
  const trouves = await index.chercher(question, { k, ...filtres });
  if (!trouves.length) {
    return { texte: null, sourced: false, motif: 'aucun element pertinent dans l historique', resultats: [] };
  }
  const contexte = trouves
    .map((r) => `[${r.marqueur}] (${r.entree.type}${r.entree.auteur ? ` · ${r.entree.auteur}` : ''}${r.entree.ts ? ` · ${r.entree.ts.slice(0, 10)}` : ''})\n${r.entree.texte.slice(0, 500)}`)
    .join('\n\n');

  const res = await llm.complete({
    messages: [
      { role: 'system', content: "Reponds a partir de l'historique fourni. Cite chaque element utilise par son marqueur entre crochets, par exemple [1]. Si l'historique ne permet pas de repondre, dis-le." },
      { role: 'user', content: `Historique :\n\n${contexte}\n\nQuestion : ${question}` },
    ],
    role: 'Synthesizer', model, temperature: 0,
  });

  const texte = res?.text ?? '';
  const cites = [...new Set([...texte.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))];
  const connus = new Map(trouves.map((r) => [r.marqueur, r]));
  const recus = cites.filter((c) => connus.has(c)).map((c) => connus.get(c).entree);
  const inventees = cites.filter((c) => !connus.has(c));

  return {
    texte, recus, inventees,
    sourced: recus.length > 0 && inventees.length === 0,
    motif: recus.length === 0 ? 'aucun element cite' : (inventees.length ? `citations inconnues : ${inventees.join(', ')}` : null),
    resultats: trouves,
  };
}
