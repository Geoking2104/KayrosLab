// KayrosLab — Canvas : ingestion multimodale de contexte (RAG).
// EF-200 (ingestion + vectorisation), EF-201 (attribution des sources),
// EF-206 (scope tenant), EF-207 (retrait + invalidation), EF-208 (sensibilite),
// EF-209 (plafond annonce avant depassement).
//
// PERIMETRE ASSUME. Le decodage binaire (PDF, DOCX) est IMPOSSIBLE en zero
// dependance et n'a rien a faire dans un coeur qui doit tourner dans le
// navigateur. Le coeur traite du TEXTE ; l'extraction binaire est injectee via
// `extractors` — implementee cote backend Fastify (pdf-parse, mammoth) ou cote
// navigateur. La frontiere est ici, et elle est explicite.

import { classifySensitive } from '../governance.mjs';
import { scopeKey } from './vectors.mjs';

const nowIso = () => new Date().toISOString();
const uid = (p = 'd') => globalThis.crypto?.randomUUID?.() ?? `${p}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

/** Types acceptes nativement (texte). Le reste exige un extracteur. */
export const MIMES_TEXTE = ['text/plain', 'text/markdown', 'text/csv', 'text/html'];

// ---------------------------------------------------------------------------
// Decoupage
// ---------------------------------------------------------------------------

/**
 * Decoupe un texte en fragments avec chevauchement.
 * Le decoupage suit les frontieres de PARAGRAPHE quand c'est possible : couper
 * au milieu d'une phrase produit des citations inexploitables, et une citation
 * inexploitable vide EF-201 de son sens.
 *
 * @returns {{index:number, texte:string, debut:number, fin:number}[]}
 */
export function chunkText(texte, { taille = 900, chevauchement = 150 } = {}) {
  // On ne trim PAS la source : les offsets `debut`/`fin` doivent rester
  // absolus pour correspondre a la pagination fournie par un extracteur.
  // Un trim en tete decalerait toutes les pages d'un document.
  const t = String(texte ?? '');
  if (!t.trim()) return [];
  if (chevauchement >= taille) throw new Error('chunkText: chevauchement doit etre < taille');

  const out = [];
  let debut = 0;
  while (debut < t.length) {
    let fin = Math.min(debut + taille, t.length);
    if (fin < t.length) {
      // Cherche une frontiere propre dans le dernier tiers du fragment.
      const fenetre = t.slice(debut + Math.floor(taille * 0.66), fin);
      const coupe = Math.max(fenetre.lastIndexOf('\n\n'), fenetre.lastIndexOf('. '), fenetre.lastIndexOf('\n'));
      if (coupe > 0) fin = debut + Math.floor(taille * 0.66) + coupe + 1;
    }
    const morceau = t.slice(debut, fin).trim();
    if (morceau) out.push({ index: out.length, texte: morceau, debut, fin });
    if (fin >= t.length) break;
    debut = Math.max(fin - chevauchement, debut + 1);
  }
  return out;
}

/** Numero de page approximatif, si le document en expose la pagination. */
function pageDe(offset, pages) {
  if (!Array.isArray(pages) || !pages.length) return null;
  for (const p of pages) if (offset >= p.debut && offset < p.fin) return p.numero;
  return null;
}

// ---------------------------------------------------------------------------
// Service d'ingestion
// ---------------------------------------------------------------------------

export class IngestionService {
  /**
   * @param {{index:object, plafondCaracteres?:number, extractors?:Object<string,Function>,
   *          classifier?:Function, sovereignty?:'cloud'|'local', onSensitive?:'refuser'|'local'}} opts
   */
  constructor({ index, plafondCaracteres = 2_000_000, extractors = {}, classifier = null, sovereignty = 'cloud', onSensitive = 'refuser' } = {}) {
    if (!index) throw new Error('IngestionService: index vectoriel requis');
    this.index = index;
    this.plafond = plafondCaracteres;
    this.extractors = extractors;
    this.classifier = classifier;
    this.sovereignty = sovereignty;
    this.onSensitive = onSensitive;
    this._docs = new Map();  // docId -> SourceDoc
  }

  /** Documents vivants d'un workspace (les retires sont exclus). */
  docs(workspaceId) {
    return [...this._docs.values()].filter((d) => d.workspaceId === workspaceId && !d.retiredAt);
  }
  get(docId) { return this._docs.get(docId) ?? null; }

  /**
   * EF-209 : etat du quota. Appele AVANT l'ingestion pour que le plafond soit
   * annonce avant d'etre atteint, jamais decouvert apres coup.
   */
  quota(workspaceId, tailleEnvisagee = 0) {
    const utilise = this.docs(workspaceId).reduce((n, d) => n + d.taille, 0);
    const restant = Math.max(0, this.plafond - utilise);
    return {
      utilise, plafond: this.plafond, restant,
      taux: Math.round((utilise / this.plafond) * 1000) / 1000,
      tailleEnvisagee,
      depasserait: tailleEnvisagee > restant,
      // Palier d'alerte : l'utilisateur est prevenu avant le mur.
      alerte: utilise / this.plafond >= 0.8,
    };
  }

  /** Texte brut a partir du contenu, via extracteur si le mime l'exige. */
  async _extraire(mime, contenu) {
    if (MIMES_TEXTE.includes(mime)) return { texte: String(contenu ?? ''), pages: null };
    const ex = this.extractors[mime];
    if (!ex) {
      const e = new Error(`Aucun extracteur pour "${mime}" — brancher un extracteur cote backend`);
      e.code = 'NO_EXTRACTOR';
      throw e;
    }
    const r = await ex(contenu);
    return { texte: String(r?.texte ?? r ?? ''), pages: r?.pages ?? null };
  }

  /**
   * Ingere un document : extraction -> classification -> decoupage -> vecteurs.
   *
   * EF-208 : un document classe sensible n'est pas transmis a un fournisseur
   * externe. Selon `onSensitive`, l'ingestion est REFUSEE AVEC MOTIF ou basculee
   * en local. Il n'y a pas de troisieme voie : pas d'envoi silencieux.
   *
   * @returns {Promise<{ok:boolean, doc?:object, motif?:string, quota:object}>}
   */
  async ingest(workspaceId, { id, nom, mime = 'text/plain', contenu, tenantId = 'default', by = null } = {}) {
    if (!workspaceId) throw new Error('ingest: workspaceId requis');
    if (!nom) throw new Error('ingest: nom requis');

    const { texte, pages } = await this._extraire(mime, contenu);
    // Un document de blancs purs est vide : `length` seul le laisserait passer.
    const taille = texte.trim().length;
    if (!taille) return { ok: false, motif: 'document vide apres extraction', quota: this.quota(workspaceId) };

    // EF-209 : verification AVANT tout traitement couteux.
    const q = this.quota(workspaceId, taille);
    if (q.depasserait) {
      return {
        ok: false,
        motif: `plafond de ${this.plafond} caracteres depasse (${q.restant} restants, ${taille} demandes)`,
        quota: q,
      };
    }

    // EF-208 : classification avant toute sortie vers un fournisseur.
    const sensibilite = await classifySensitive(texte.slice(0, 4000), { classifier: this.classifier });
    let sovereignty = this.sovereignty;
    if (sensibilite.sensitive && sovereignty !== 'local') {
      if (this.onSensitive === 'refuser') {
        return {
          ok: false,
          motif: `document classe sensible (${sensibilite.label}) et palier non souverain — ingestion refusee`,
          sensibilite, quota: q,
        };
      }
      sovereignty = 'local'; // bascule explicite, tracee sur le document
    }

    const brut = chunkText(texte);
    const docId = id ?? uid('doc');
    const chunks = brut.map((c) => ({
      id: `${docId}#${c.index}`,
      docId, index: c.index, texte: c.texte,
      debut: c.debut, fin: c.fin,
      page: pageDe(c.debut, pages),
    }));

    // Les fragments sont indexes comme des noeuds : meme scope, meme store.
    await this.index.indexNodes(workspaceId, chunks.map((c) => ({ id: c.id, titre: c.texte, corps: '' })));

    const doc = {
      id: docId, workspaceId, tenantId, nom, mime, taille,
      chunks, sensibilite, sovereignty, ingestedAt: nowIso(), ingestedBy: by,
      retiredAt: null,
    };
    this._docs.set(docId, doc);
    return { ok: true, doc, quota: this.quota(workspaceId) };
  }

  /**
   * EF-207 : retrait d'un document. Les vecteurs sont oublies et la liste des
   * fragments concernes est renvoyee pour que l'appelant invalide les
   * assertions qui s'y appuyaient (`invalidateNodes`).
   */
  retire(docId) {
    const doc = this._docs.get(docId);
    if (!doc) throw new Error(`retire: document introuvable "${docId}"`);
    if (doc.retiredAt) return { docId, chunkIds: [], dejaRetire: true };
    for (const c of doc.chunks) this.index.forget(c.id);
    this._docs.set(docId, { ...doc, retiredAt: nowIso(), chunks: doc.chunks.map((c) => ({ ...c, texte: null })) });
    return { docId, chunkIds: doc.chunks.map((c) => c.id), dejaRetire: false };
  }

  /**
   * EF-200 : recuperation des fragments pertinents.
   * Les fragments issus de documents retires sont ecartes : un vecteur oublie
   * peut subsister dans un store distant, le filtre applicatif est la garantie.
   */
  async retrieve(workspaceId, question, k = 5) {
    const bruts = await this.index.search(workspaceId, question, k * 2);
    const vivants = new Map();
    for (const d of this.docs(workspaceId)) for (const c of d.chunks) vivants.set(c.id, { chunk: c, doc: d });
    return bruts
      .filter((r) => vivants.has(r.id))
      .slice(0, k)
      .map((r, i) => {
        const { chunk, doc } = vivants.get(r.id);
        return {
          marqueur: i + 1,                    // [1], [2]… utilise dans le prompt
          chunkId: chunk.id, docId: doc.id, doc: doc.nom,
          page: chunk.page, index: chunk.index,
          texte: chunk.texte, score: Math.round(r.score * 10000) / 10000,
        };
      });
  }

  scope(workspaceId) { return scopeKey(workspaceId); }
}

// ---------------------------------------------------------------------------
// Attribution (EF-201)
// ---------------------------------------------------------------------------

/** Contexte numerote a injecter dans un prompt. Les marqueurs sont stables. */
export function buildContext(passages) {
  return passages
    .map((p) => `[${p.marqueur}] (${p.doc}${p.page ? `, p.${p.page}` : ''})\n${p.texte}`)
    .join('\n\n');
}

/**
 * EF-201 : extrait les citations d'une reponse et etablit son statut.
 *
 * Une reponse sans marqueur reconnu est declaree `sourced: false`. Elle n'est
 * pas rejetee — un modele peut repondre juste sans citer — mais elle ne sera
 * JAMAIS presentee comme sourcee. C'est tout l'objet de l'exigence : ne pas
 * mentir par omission sur l'origine d'une assertion.
 */
export function extractCitations(reponse, passages) {
  const texte = String(reponse ?? '');
  const connus = new Map(passages.map((p) => [p.marqueur, p]));
  const trouves = [...texte.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const uniques = [...new Set(trouves)];

  const citations = uniques.filter((n) => connus.has(n)).map((n) => {
    const p = connus.get(n);
    return { marqueur: n, docId: p.docId, doc: p.doc, page: p.page, chunkId: p.chunkId };
  });
  // Un marqueur inconnu est une citation inventee : on le signale au lieu de l'ignorer.
  const inventees = uniques.filter((n) => !connus.has(n));

  return {
    texte,
    citations,
    inventees,
    sourced: citations.length > 0 && inventees.length === 0,
    // Motif explicite : l'UI affiche pourquoi une reponse n'est pas sourcee.
    motif: citations.length === 0
      ? 'aucune source citee'
      : (inventees.length ? `citations inconnues : ${inventees.join(', ')}` : null),
  };
}

/**
 * Reponse "avec recus" (transposition B5 de Buzz).
 * Le prompt impose la citation ; le resultat porte son propre statut de
 * sourcage. Aucune assertion ne circule sans son etiquette d'origine.
 */
export async function answerWithReceipts(service, workspaceId, question, { llm, k = 5, model = null } = {}) {
  if (!llm?.complete) throw new Error('answerWithReceipts: llm.complete requis');
  const passages = await service.retrieve(workspaceId, question, k);
  if (!passages.length) {
    return { texte: null, citations: [], sourced: false, motif: 'aucun document pertinent', passages: [] };
  }
  const messages = [
    {
      role: 'system',
      content: "Reponds UNIQUEMENT a partir des extraits fournis. Cite tes sources avec leur marqueur entre crochets, par exemple [1]. Si les extraits ne permettent pas de repondre, dis-le explicitement.",
    },
    { role: 'user', content: `Extraits :\n\n${buildContext(passages)}\n\nQuestion : ${question}` },
  ];
  const res = await llm.complete({ messages, role: 'Synthesizer', model, temperature: 0 });
  return { ...extractCitations(res?.text ?? '', passages), passages };
}

/**
 * EF-207, volet canvas : marque les noeuds dont la source a ete retiree.
 * On ne supprime pas le noeud — l'idee reste, c'est son etayage qui tombe.
 * L'effacement silencieux serait pire que l'absence de source.
 */
export function invalidateNodes(ws, docId, { by = null } = {}) {
  let touches = 0;
  const nodes = ws.nodes.map((n) => {
    if (n.provenance?.sourceDocId !== docId || n.provenance?.retracted) return n;
    touches++;
    return {
      ...n,
      provenance: { ...n.provenance, retracted: true, retractedAt: nowIso(), motif: 'source retiree' },
    };
  });
  if (!touches) return ws;
  const ts = nowIso();
  return {
    ...ws, nodes, updatedAt: ts,
    history: [...ws.history, { type: 'source.retire', docId, noeudsInvalides: touches, by, ts }],
  };
}
