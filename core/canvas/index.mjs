// KayrosLab — Canvas d'ideation : point d'assemblage.
// Lot v11 (CDC_CANVAS_IDEATION.md) : EF-210 a EF-218, EF-222, EF-231,
// EF-257 a EF-260.
//
// Perimetre v11 : modele, persistance, clustering, deduplication, layout,
// matrice de priorisation, promotion vers le cycle gouverne.
// Perimetre v11 (suite) : ingestion RAG (EF-200 a EF-209), swarms de personas
// (EF-225 a EF-231), frameworks SCAMPER / Six chapeaux / Premiers principes /
// Pre-mortem (EF-232 a EF-237).
// Perimetre v12 : identite agent signee (EF-240 a EF-243), journal chaine et
// rejouable (EF-244 a EF-247), reconciliation collaborative (EF-220/221).
// Perimetre v13 : workflows declaratifs (EF-248 a EF-251), recherche unifiee
// (EF-252 a EF-254), CLI agent-first (EF-255/256), voix (EF-204/205).
// Perimetre complet : EF-239 (synthese visuelle) incluse.

export * from './model.mjs';
export * from './vectors.mjs';
export * from './clustering.mjs';
export * from './repository.mjs';
export * from './promotion.mjs';
export * from './ingest.mjs';
export * from './personas.mjs';
export * from './frameworks.mjs';
export * from './identity.mjs';
export * from './journal.mjs';
export * from './sync.mjs';
export * from './workflow.mjs';
export * from './search.mjs';
export * from './voice.mjs';
export * from './cli.mjs';
export * from './visual.mjs';

import { createWorkspace, addNode, applyClusters } from './model.mjs';
import { CanvasVectorIndex } from './vectors.mjs';
import { clusterWorkspace, layoutClusters, findDuplicates, proposeClusterLabels } from './clustering.mjs';
import { InMemoryCanvasRepository } from './repository.mjs';
import { IngestionService, buildContext, invalidateNodes } from './ingest.mjs';
import { PersonaRegistry, runSwarm, applySwarm, expandNode } from './personas.mjs';
import { scamper, sixChapeaux, premiersPrincipes, preMortem } from './frameworks.mjs';

/**
 * Fabrique un atelier de canvas branche sur un moteur `createEngine()`.
 * Reutilise les embeddings et le vector store deja configures : le canvas
 * herite ainsi automatiquement du palier de souverainete actif (mock en P0,
 * Ollama en P1, proxy en P2) sans configuration propre — exigence EF-262.
 *
 * @param {{embeddings:object, vectors:object}} engine sortie de createEngine()
 */
export function createCanvasStudio(engine, { repository = null, personas = null, ingestion = {} } = {}) {
  if (!engine?.embeddings || !engine?.vectors) {
    throw new Error('createCanvasStudio: moteur invalide (embeddings + vectors requis)');
  }
  const index = new CanvasVectorIndex({ embeddings: engine.embeddings, store: engine.vectors });
  const repo = repository ?? new InMemoryCanvasRepository();
  const docs = new IngestionService({ index, sovereignty: engine.sovereignty ?? 'cloud', ...ingestion });
  // EF-229 : les agents du coeur rejoignent le registre sans etre redefinis.
  const registry = (personas ?? new PersonaRegistry()).withCoreAgents(engine.agents ?? {});

  /** Charge un workspace ou echoue explicitement. */
  const charger = async (id, op) => {
    const ws = await repo.get(id);
    if (!ws) throw new Error(`${op}: workspace introuvable "${id}"`);
    return ws;
  };

  return {
    index, repo, docs, personas: registry,

    async create(opts) { return repo.save(createWorkspace(opts)); },

    /** Ajoute un noeud et l'indexe immediatement (dedup et clustering a jour). */
    async addNode(workspaceId, node) {
      const ws = await repo.get(workspaceId);
      if (!ws) throw new Error(`addNode: workspace introuvable "${workspaceId}"`);
      const next = addNode(ws, node);
      await index.indexMissing(workspaceId, next.nodes);
      return repo.save(next);
    },

    /**
     * Re-clusterise, libelle (si un LLM est fourni) et re-dispose.
     * Le libellage est optionnel et tolerant a la panne : un cluster sans nom
     * reste exploitable, un canvas casse ne l'est pas.
     */
    async recluster(workspaceId, { llm = null, seuil = null, layout = true } = {}) {
      let ws = await repo.get(workspaceId);
      if (!ws) throw new Error(`recluster: workspace introuvable "${workspaceId}"`);
      await index.indexMissing(workspaceId, ws.nodes);

      const res = clusterWorkspace(ws, index, { seuil });
      ws = applyClusters(ws, res.clusters);

      if (llm) {
        const props = await proposeClusterLabels(ws, { llm });
        for (const p of props) {
          const c = ws.clusters.find((x) => x.id === p.clusterId);
          // EF-216 : un libelle humain n'est jamais ecrase.
          if (c && c.labelSource !== 'human') {
            ws = { ...ws, clusters: ws.clusters.map((x) => (x.id === p.clusterId ? { ...x, label: p.label, labelSource: 'llm' } : x)) };
          }
        }
      }
      if (layout) ws = layoutClusters(ws);
      await repo.save(ws);
      // On renvoie les clusters DU WORKSPACE, pas ceux du calcul : eux seuls
      // portent les libelles qui viennent d'etre poses.
      return { ...res, workspace: ws, clusters: ws.clusters };
    },

    /** EF-217 : suggestions de fusion. Jamais applique automatiquement. */
    async duplicates(workspaceId, opts = {}) {
      const ws = await repo.get(workspaceId);
      if (!ws) throw new Error(`duplicates: workspace introuvable "${workspaceId}"`);
      await index.indexMissing(workspaceId, ws.nodes);
      return findDuplicates(ws, index, opts);
    },

    /** EF-222 : recherche semantique intra-canvas. */
    async search(workspaceId, q, k = 10) { return index.search(workspaceId, q, k); },

    // ---- Ingestion (EF-200 a EF-209) -------------------------------------

    /** EF-200/208/209. Renvoie {ok, doc|motif, quota} — jamais d'echec muet. */
    async ingest(workspaceId, doc) {
      const ws = await charger(workspaceId, 'ingest');
      return docs.ingest(workspaceId, { tenantId: ws.tenantId, ...doc });
    },

    /** EF-209 : etat du quota, consultable AVANT de deposer un document. */
    quota(workspaceId, taille = 0) { return docs.quota(workspaceId, taille); },

    /**
     * EF-207 : retrait d'un document ET invalidation des noeuds qui s'y
     * appuyaient. Les deux vont ensemble : retirer sans invalider laisserait
     * des assertions orphelines presentees comme etayees.
     */
    async retireDoc(workspaceId, docId, { by = null } = {}) {
      const ws = await charger(workspaceId, 'retireDoc');
      const r = docs.retire(docId);
      const next = invalidateNodes(ws, docId, { by });
      await repo.save(next);
      return { ...r, workspace: next };
    },

    /** Contexte documentaire pertinent, pret a etre injecte dans un prompt. */
    async contexte(workspaceId, question, k = 5) {
      const passages = await docs.retrieve(workspaceId, question, k);
      return { passages, texte: buildContext(passages) };
    },

    // ---- Sparring (EF-225 a EF-237) --------------------------------------

    /**
     * EF-226/230/231 : swarm de personas sur un noeud, avec contexte
     * documentaire injecte, sorties streamees et desaccords materialises.
     */
    async swarm(workspaceId, noeudId, { personaIds = null, onOutput = null, signal = null, model = null, avecContexte = true, by = null } = {}) {
      const ws = await charger(workspaceId, 'swarm');
      const noeud = ws.nodes.find((n) => n.id === noeudId);
      if (!noeud) throw new Error(`swarm: noeud introuvable "${noeudId}"`);
      const choisies = personaIds ? personaIds.map((id) => registry.get(id)).filter(Boolean) : registry.list();
      if (!choisies.length) throw new Error('swarm: aucune persona selectionnee');

      let contexte = '';
      if (avecContexte && docs.docs(workspaceId).length) {
        contexte = buildContext(await docs.retrieve(workspaceId, noeud.titre, 4));
      }
      const { runs, cout, avorte } = await runSwarm({ noeud, personas: choisies, llm: engine.llm, contexte, model, onOutput, signal });
      const res = applySwarm(ws, noeudId, runs, { by });
      await repo.save(res.workspace);
      return { ...res, runs, cout, avorte };
    },

    /** EF-225 : expansion d'un noeud en variantes / sous-problemes / contre-exemples. */
    async expand(workspaceId, noeudId, opts = {}) {
      const ws = await charger(workspaceId, 'expand');
      const r = await expandNode(ws, noeudId, { llm: engine.llm, ...opts });
      await repo.save(r.workspace);
      return r;
    },

    /** EF-232/233/234 : frameworks en un clic. */
    async framework(workspaceId, noeudId, nom, opts = {}) {
      const ws = await charger(workspaceId, 'framework');
      const fn = { scamper, 'six-chapeaux': sixChapeaux, 'premiers-principes': premiersPrincipes }[nom];
      if (!fn) throw new Error(`framework: inconnu "${nom}"`);
      const r = await fn(ws, noeudId, { llm: engine.llm, ...opts });
      await repo.save(r.workspace);
      return r;
    },

    /** EF-236 : pre-mortem. Ses causes alimentent EF-237 via causesToHypotheses. */
    async preMortem(workspaceId, noeudId, opts = {}) {
      const ws = await charger(workspaceId, 'preMortem');
      const r = await preMortem(ws, noeudId, { llm: engine.llm, ...opts });
      await repo.save(r.workspace);
      return r;
    },
  };
}
