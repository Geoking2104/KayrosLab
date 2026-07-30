// KayrosLab — Canvas : journal d'evenements chaine.
// EF-244 (toute mutation est un evenement typé), EF-245 (chainage par hachage),
// EF-246 (etat reconstructible par rejeu), EF-247 (export et verification hors ligne).
//
// Transposition B2 de Buzz : un log unique ou humains, agents et automatismes
// ecrivent la meme forme d'evenement. Sans le protocole Nostr — la valeur est
// dans le journal verifiable, pas dans le transport qui le porte chez eux.

import { canonical, sha256, sign, verify } from './identity.mjs';

const uid = (p) => globalThis.crypto?.randomUUID?.() ?? `${p}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
import {
  createWorkspace, createNode, addNode, updateNode, removeNode, addEdge, removeEdge,
  applyClusters, setClusterLabel, pinNode,
} from './model.mjs';
import { mergeNodes } from './clustering.mjs';

/** Types d'evenements admis. Une liste blanche : un type inconnu est refuse. */
export const TYPES_EVENEMENT = Object.freeze([
  'workspace.create', 'node.add', 'node.update', 'node.remove', 'node.pin',
  'node.merge', 'edge.add', 'edge.remove', 'cluster.apply', 'cluster.label',
  'promote', 'source.ingest', 'source.retire', 'swarm.apply', 'framework.run',
]);

const GENESE = 'genesis';

/** Champs entrant dans le hachage. `hash` et `sig` en sont exclus par nature. */
const aHacher = (e) => ({
  seq: e.seq, prevHash: e.prevHash, type: e.type,
  actorId: e.actorId, actorKind: e.actorKind, workspaceId: e.workspaceId,
  payload: e.payload, ts: e.ts,
});

export async function hashEvent(e) { return sha256(canonical(aHacher(e))); }

/**
 * Journal append-only chaine par hachage.
 *
 * Le chainage ne protege pas d'un acteur qui reecrirait TOUT le journal — il
 * rend detectable la modification d'un evenement isole, ce qui est le cas
 * reel : on ne falsifie pas un audit en le reconstruisant, on y retouche une
 * ligne. Pour aller plus loin il faudrait un ancrage externe ; c'est hors
 * perimetre et ce n'est pas ce que l'exigence demande.
 */
export class EventLog {
  constructor(evenements = []) { this._e = [...evenements]; }

  get longueur() { return this._e.length; }
  get dernier() { return this._e.at(-1) ?? null; }
  get tete() { return this.dernier?.hash ?? GENESE; }
  events() { return [...this._e]; }
  parWorkspace(id) { return this._e.filter((e) => e.workspaceId === id); }

  /**
   * Ajoute un evenement. Signature optionnelle : si `privateKey` est fourni,
   * l'evenement est signe de son auteur (EF-242 etendu au journal).
   */
  async append({ type, actorId = null, actorKind = 'human', workspaceId, payload = {}, ts = null, privateKey = null }) {
    if (!TYPES_EVENEMENT.includes(type)) throw new Error(`append: type inconnu "${type}"`);
    if (!workspaceId) throw new Error('append: workspaceId requis');
    const e = {
      seq: this._e.length,
      prevHash: this.tete,
      type, actorId, actorKind, workspaceId, payload,
      ts: ts ?? new Date().toISOString(),
    };
    e.hash = await hashEvent(e);
    if (privateKey) e.sig = await sign(aHacher(e), privateKey);
    this._e.push(e);
    return e;
  }

  /**
   * EF-245 : verifie l'integrite de la chaine.
   * Renvoie la PREMIERE rupture plutot qu'un simple booleen : savoir qu'un
   * journal est corrompu sans savoir ou ne sert a rien pour l'enqueter.
   */
  async verify({ registry = null } = {}) {
    let attendu = GENESE;
    for (const e of this._e) {
      if (e.prevHash !== attendu) {
        return { ok: false, seq: e.seq, motif: 'chainage rompu (prevHash inattendu)' };
      }
      if (await hashEvent(e) !== e.hash) {
        return { ok: false, seq: e.seq, motif: 'contenu altere (hash non reproductible)' };
      }
      if (e.sig && registry) {
        const agent = registry.get?.(e.actorId);
        if (!agent) return { ok: false, seq: e.seq, motif: `signataire inconnu "${e.actorId}"` };
        if (!await verify(aHacher(e), e.sig, agent.publicKey)) {
          return { ok: false, seq: e.seq, motif: 'signature invalide' };
        }
      }
      attendu = e.hash;
    }
    return { ok: true, seq: null, motif: null, longueur: this._e.length };
  }

  /** EF-247 : export JSONL, une ligne par evenement. */
  toJSONL() { return this._e.map((e) => JSON.stringify(e)).join('\n'); }

  static fromJSONL(texte) {
    const e = String(texte ?? '').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    return new EventLog(e);
  }
}

/**
 * EF-247 : verification HORS LIGNE d'un export, sans instancier de journal
 * ni disposer du systeme d'origine. C'est ce qui rend l'audit opposable.
 */
export async function verifyJSONL(texte) {
  try {
    return await EventLog.fromJSONL(texte).verify();
  } catch (e) {
    return { ok: false, seq: null, motif: `export illisible : ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// EF-246 — rejeu
// ---------------------------------------------------------------------------

/**
 * Applique un evenement a un etat. Fonction PURE : c'est elle qui garantit
 * qu'un rejeu produit le meme etat qu'une execution en direct.
 *
 * Les mutations passent par les fonctions du modele et non par des `spread`
 * ad hoc : une divergence entre le chemin direct et le chemin de rejeu serait
 * indetectable et ruinerait la valeur du journal.
 */
export function applyEvent(ws, e) {
  switch (e.type) {
    case 'workspace.create':
      return createWorkspace({ ...e.payload, ts: e.ts });
    case 'node.add':
      // L'acteur de l'EVENEMENT est l'auteur de la production. Sans cette
      // propagation, un noeud produit par un agent revenait `human` au rejeu :
      // l'audit reconstruit mentait sur son auteur (EF-242).
      return addNode(ws, createNode({
        authorId: e.actorId, authorKind: e.actorKind ?? 'human',
        ...e.payload, ts: e.ts,
      }));
    case 'node.update':
      return updateNode(ws, e.payload.id, e.payload.patch, { by: e.actorId });
    case 'node.remove':
      return removeNode(ws, e.payload.id, { by: e.actorId });
    case 'node.pin':
      return pinNode(ws, e.payload.id, e.payload.pinned, { by: e.actorId });
    case 'node.merge':
      return mergeNodes(ws, e.payload.garder, e.payload.absorber, { by: e.actorId });
    case 'edge.add':
      return addEdge(ws, { authorId: e.actorId, authorKind: e.actorKind ?? 'human', ...e.payload });
    case 'edge.remove':
      return removeEdge(ws, e.payload.id, { by: e.actorId });
    case 'cluster.apply':
      return applyClusters(ws, e.payload.clusters, { by: e.actorId });
    case 'cluster.label':
      return setClusterLabel(ws, e.payload.clusterId, e.payload.label, { source: e.payload.source, by: e.actorId });
    case 'promote':
      return {
        ...ws,
        nodes: ws.nodes.map((n) => (e.payload.nodeIds.includes(n.id) ? { ...n, promotedIdeaId: e.payload.ideaId } : n)),
        promotedIdeaIds: ws.promotedIdeaIds.includes(e.payload.ideaId) ? ws.promotedIdeaIds : [...ws.promotedIdeaIds, e.payload.ideaId],
      };
    // Evenements journalises pour l'audit mais sans effet sur l'etat du canvas.
    case 'source.ingest': case 'source.retire': case 'swarm.apply': case 'framework.run':
      return ws;
    default:
      throw new Error(`applyEvent: type non gere "${e.type}"`);
  }
}

/**
 * EF-246 : reconstruit l'etat d'un canvas depuis l'origine.
 * @returns {{workspace:object|null, appliques:number, ignores:object[]}}
 */
export function replay(log, workspaceId) {
  const evenements = (log instanceof EventLog ? log.parWorkspace(workspaceId) : log)
    .slice()
    .sort((a, b) => a.seq - b.seq);

  let ws = null;
  let appliques = 0;
  const ignores = [];
  for (const e of evenements) {
    try {
      if (!ws && e.type !== 'workspace.create') { ignores.push({ seq: e.seq, motif: 'aucun workspace initialise' }); continue; }
      ws = applyEvent(ws, e);
      appliques++;
    } catch (err) {
      // Un evenement irrejouable est SIGNALE, pas avale : un rejeu partiel
      // silencieux produirait un etat faux presente comme authentique.
      ignores.push({ seq: e.seq, type: e.type, motif: err.message });
    }
  }
  return { workspace: ws, appliques, ignores };
}

/**
 * Compare un etat courant a son rejeu. Sert de test de non-regression permanent :
 * toute mutation ajoutee sans evenement correspondant fait diverger les deux.
 */
export function diffEtats(a, b) {
  const cle = (ws) => canonical({
    nodes: [...(ws?.nodes ?? [])].sort((x, y) => (x.id < y.id ? -1 : 1))
      // L'attribution fait partie de l'etat : deux canvas identiques au
      // contenu pres mais divergents sur l'auteur ne sont PAS identiques.
      .map((n) => ({ id: n.id, type: n.type, titre: n.titre, corps: n.corps, x: n.x, y: n.y, pinned: n.pinned, clusterId: n.clusterId, promotedIdeaId: n.promotedIdeaId, authorId: n.authorId, authorKind: n.authorKind })),
    edges: [...(ws?.edges ?? [])].sort((x, y) => (x.id < y.id ? -1 : 1))
      .map((e) => ({ from: e.from, to: e.to, relation: e.relation, authorId: e.authorId, authorKind: e.authorKind })),
    clusters: [...(ws?.clusters ?? [])].sort((x, y) => (x.id < y.id ? -1 : 1))
      .map((c) => ({ id: c.id, label: c.label, nodeIds: [...c.nodeIds].sort() })),
    promotedIdeaIds: [...(ws?.promotedIdeaIds ?? [])].sort(),
  });
  const ca = cle(a); const cb = cle(b);
  return { identiques: ca === cb, a: ca, b: cb };
}

/**
 * Enregistreur : applique une mutation ET la journalise, en un seul point.
 * Deux chemins separes finiraient par diverger — c'est la raison d'etre de
 * cette facade plutot que d'un `log.append` disperse dans les appelants.
 */
export class Recorder {
  constructor(log = new EventLog()) { this.log = log; }

  /**
   * Fige les identifiants AVANT journalisation.
   *
   * DECOUVERT EN RECETTE. `createNode`/`addEdge` generent un UUID quand l'appelant
   * n'en fournit pas : un evenement `node.add` sans `id` produisait donc un
   * identifiant DIFFERENT a chaque rejeu, et EF-246 tombait des qu'un client
   * omettait l'id — ce que fait tout client normal. Un evenement doit etre
   * auto-suffisant : rien de ce qu'il decrit ne peut dependre du moment ou on
   * l'applique.
   */
  static normaliser(type, payload = {}) {
    if ((type === 'node.add' || type === 'edge.add') && !payload.id) {
      return { ...payload, id: uid(type === 'node.add' ? 'n' : 'e') };
    }
    return payload;
  }

  async record(ws, { type, payload, actorId = null, actorKind = 'human', workspaceId = null, privateKey = null }) {
    const fige = Recorder.normaliser(type, payload);
    const wsId = workspaceId ?? ws?.id ?? fige?.id;
    const e = await this.log.append({ type, actorId, actorKind, workspaceId: wsId, payload: fige, privateKey });
    return { workspace: applyEvent(ws, e), evenement: e };
  }
}
