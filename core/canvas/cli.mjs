// KayrosLab — Canvas : surface d'appel pour agents externes.
// EF-255 (JSON in / JSON out), EF-256 (jeton scope, revocable, memes limites).
//
// Transposition B6 de Buzz (`buzz-cli`). Concu pour etre appele comme un OUTIL
// par un LLM externe (Claude Code, Goose) : une commande, un objet JSON, une
// reponse JSON. Aucune sortie decorative, aucun texte a parser.

import { canAct } from './identity.mjs';
import { buildMatrix, promote, originOf } from './promotion.mjs';
import { causesToHypotheses } from './frameworks.mjs';

/** Portees. `write` implique `read` ; `admin` n'existe pas — voir EF-243. */
export const PORTEES = Object.freeze(['read', 'write']);

/**
 * EF-256 : jetons d'agent scopes et revocables.
 * Un jeton ne porte JAMAIS de portee d'administration : le perimetre maximal
 * d'un acteur automatique est celui defini par `canAct`, et un jeton ne peut
 * pas l'elargir.
 */
export class TokenStore {
  constructor() { this._t = new Map(); }

  emettre({ token, agentId, tenantId = 'default', workspaces = [], scopes = ['read'] }) {
    if (!token || !agentId) throw new Error('emettre: token et agentId requis');
    const inconnues = scopes.filter((s) => !PORTEES.includes(s));
    if (inconnues.length) throw new Error(`emettre: portee inconnue "${inconnues.join(', ')}"`);
    const t = { token, agentId, tenantId, workspaces: [...workspaces], scopes: [...scopes], revoked: false, createdAt: new Date().toISOString() };
    this._t.set(token, t);
    return t;
  }

  revoquer(token) {
    const t = this._t.get(token);
    if (!t) return false;
    this._t.set(token, { ...t, revoked: true, revokedAt: new Date().toISOString() });
    return true;
  }

  /** @returns {{ok:boolean, jeton?:object, motif?:string}} */
  verifier(token, { workspaceId = null, scope = 'read' } = {}) {
    const t = this._t.get(token);
    if (!t) return { ok: false, motif: 'jeton inconnu' };
    if (t.revoked) return { ok: false, motif: 'jeton revoque' };
    if (scope === 'write' && !t.scopes.includes('write')) return { ok: false, motif: 'jeton en lecture seule' };
    // Une liste vide ne vaut PAS « tous les espaces » : un jeton sans espace
    // n'accede a rien. L'inverse serait une escalade par omission.
    if (workspaceId && !t.workspaces.includes(workspaceId)) {
      return { ok: false, motif: `jeton non habilite sur "${workspaceId}"` };
    }
    return { ok: true, jeton: t };
  }
}

/** Commandes exposees, avec la portee et l'action de gouvernance associees. */
export const COMMANDES = Object.freeze({
  'workspace.list':   { scope: 'read',  action: null },
  'workspace.create': { scope: 'write', action: 'node.add' },
  'workspace.get':    { scope: 'read',  action: null },
  'node.add':         { scope: 'write', action: 'node.add' },
  'node.update':      { scope: 'write', action: 'node.update' },
  'node.remove':      { scope: 'write', action: 'node.remove' },
  'edge.add':         { scope: 'write', action: 'edge.add' },
  'recluster':        { scope: 'write', action: 'cluster.label' },
  'swarm':            { scope: 'write', action: 'swarm.run' },
  'framework':        { scope: 'write', action: 'framework.run' },
  'premortem':        { scope: 'write', action: 'framework.run' },
  'matrix':           { scope: 'read',  action: null },
  'promote':          { scope: 'write', action: 'promote' },
  'origin':           { scope: 'read',  action: null },
  'search':           { scope: 'read',  action: null },
  'journal.verify':   { scope: 'read',  action: null },
  // Presentes pour etre explicitement REFUSEES plutot qu'inconnues : un agent
  // qui les tente doit lire pourquoi, pas « commande inconnue ».
  'gate.resolve':     { scope: 'write', action: 'gate.resolve' },
  'veto':             { scope: 'write', action: 'veto' },
});

const ok = (data) => ({ ok: true, data });
const ko = (motif, code = 'ERREUR') => ({ ok: false, error: { code, motif } });

/**
 * Execute une commande. Ne leve jamais : toute erreur devient un objet JSON,
 * parce qu'un appelant LLM ne sait pas rattraper une exception.
 *
 * @returns {Promise<{ok:boolean, data?:any, error?:{code:string,motif:string}}>}
 */
export async function executer({ cmd, args = {}, token = null }, { studio, tokens, registry = null, journal = null, index = null } = {}) {
  const spec = COMMANDES[cmd];
  if (!spec) return ko(`commande inconnue "${cmd}"`, 'CMD_INCONNUE');
  if (!studio) return ko('studio non fourni', 'CONFIG');

  const wsId = args.workspaceId ?? null;

  // 1. Jeton.
  if (tokens) {
    const v = tokens.verifier(token, { workspaceId: wsId, scope: spec.scope });
    if (!v.ok) return ko(v.motif, 'AUTH');
    args._agentId = v.jeton.agentId;

    // 2. Gouvernance. Le jeton dit « qui » ; `canAct` dit « quoi ». Un jeton
    //    valide ne suffit pas a franchir la frontiere d'EF-243.
    if (spec.action) {
      const acteur = registry?.get?.(v.jeton.agentId) ?? { id: v.jeton.agentId, kind: 'agent' };
      const a = canAct(acteur, spec.action);
      if (!a.autorise) return ko(a.motif, 'INTERDIT');
    }
  } else if (spec.action && ['gate.resolve', 'veto'].includes(spec.action)) {
    return ko('action reservee a un acteur humain', 'INTERDIT');
  }

  try {
    switch (cmd) {
      case 'workspace.list':
        return ok(await studio.repo.list({ tenantId: args.tenantId }));
      case 'workspace.create':
        return ok(await studio.create({ ...args, createdBy: args._agentId }));
      case 'workspace.get': {
        const ws = await studio.repo.get(wsId);
        return ws ? ok(ws) : ko(`workspace introuvable "${wsId}"`, 'INTROUVABLE');
      }
      case 'node.add':
        return ok(await studio.addNode(wsId, { ...args.node, authorId: args._agentId, authorKind: 'agent' }));
      case 'node.update': {
        const { updateNode } = await import('./model.mjs');
        const ws = updateNode(await studio.repo.get(wsId), args.id, args.patch, { by: args._agentId });
        return ok(await studio.repo.save(ws));
      }
      case 'node.remove': {
        const { removeNode } = await import('./model.mjs');
        const ws = removeNode(await studio.repo.get(wsId), args.id, { by: args._agentId });
        return ok(await studio.repo.save(ws));
      }
      case 'edge.add': {
        const { addEdge } = await import('./model.mjs');
        const ws = addEdge(await studio.repo.get(wsId), { ...args.edge, authorId: args._agentId, authorKind: 'agent' });
        return ok(await studio.repo.save(ws));
      }
      case 'recluster':
        return ok(await studio.recluster(wsId, { llm: args.llm === false ? null : studio.engine?.llm }));
      case 'swarm':
        return ok(await studio.swarm(wsId, args.nodeId, { personaIds: args.personaIds ?? null, by: args._agentId }));
      case 'framework':
        return ok(await studio.framework(wsId, args.nodeId, args.nom, { by: args._agentId }));
      case 'premortem': {
        const r = await studio.preMortem(wsId, args.nodeId, { horizon: args.horizon, by: args._agentId });
        return ok({ ...r, conversion: causesToHypotheses(r.causes) });
      }
      case 'matrix':
        return ok(buildMatrix(await studio.repo.get(wsId), args.notes ?? {}));
      case 'promote': {
        const r = promote(await studio.repo.get(wsId), { nodeId: args.nodeId, clusterId: args.clusterId, ideaId: args.ideaId, author: args._agentId });
        await studio.repo.save(r.workspace);
        return ok({ idea: r.idea, traitement: r.traitement });
      }
      case 'origin':
        return ok(originOf(await studio.repo.get(wsId), args.ideaId));
      case 'search':
        return index
          ? ok(await index.chercher(args.q, { workspaceId: wsId, types: args.types, k: args.k ?? 10 }))
          : ok(await studio.search(wsId, args.q, args.k ?? 10));
      case 'journal.verify':
        return journal ? ok(await journal.verify()) : ko('aucun journal branche', 'CONFIG');
      default:
        return ko(`commande non implementee "${cmd}"`, 'NON_IMPLEMENTE');
    }
  } catch (e) {
    return ko(e.message, e.code ?? 'ERREUR');
  }
}

/** Traite un flux de commandes JSONL. Une commande fautive n'arrete pas le lot. */
export async function executerLot(jsonl, deps) {
  const out = [];
  for (const ligne of String(jsonl ?? '').split('\n').filter((l) => l.trim())) {
    try {
      out.push(await executer(JSON.parse(ligne), deps));
    } catch (e) {
      out.push(ko(`ligne illisible : ${e.message}`, 'JSON_INVALIDE'));
    }
  }
  return out;
}

/** Aide machine : permet a un LLM de decouvrir la surface sans documentation. */
export function schema() {
  return {
    commandes: Object.entries(COMMANDES).map(([nom, s]) => ({ nom, scope: s.scope, action: s.action })),
    portees: PORTEES,
    note: "Les commandes 'gate.resolve' et 'veto' sont exposees mais toujours refusees a un acteur non humain (EF-243).",
  };
}
