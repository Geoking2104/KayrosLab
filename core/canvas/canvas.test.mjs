// KayrosLab — Canvas : suite de tests (node --test, zero dependance).
// Chaque exigence couverte a AU MOINS un cas nominal et un cas limite,
// conformement au DoD du CDC §8.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorkspace, createNode, addNode, getNode, updateNode, removeNode, duplicateNode,
  pinNode, addEdge, removeEdge, edgesOf, contradictions, createCluster, setClusterLabel,
  applyClusters, searchNodes, isSourced, nodeText, stats, UndoStack,
  NODE_TYPES, EDGE_RELATIONS,
} from './model.mjs';
import { CanvasVectorIndex, centroid, scopeKey } from './vectors.mjs';
import { agglomerate, clusterWorkspace, findDuplicates, mergeNodes, layoutClusters, splitBySize, proposeClusterLabels } from './clustering.mjs';
import { mulberry32 } from '../projection.mjs';
import { InMemoryCanvasRepository, canvasPortfolio } from './repository.mjs';
import { buildMatrix, quadrant, nodeToIntake, clusterToIntake, promote, originOf, impactEffortScorecard } from './promotion.mjs';
import { InMemoryVectorStore } from '../memory.mjs';

// --------------------------------------------------------------------------
// Outillage : embeddings deterministes et CONTROLABLES.
// MockEmbeddings (core) somme des charCodes : deux textes quelconques y sont
// souvent tres similaires, ce qui rendrait les assertions de clustering
// ininterpretables. Ici chaque mot-cle porte une dimension propre.
// --------------------------------------------------------------------------
const AXES = ['mobilite', 'energie', 'sante', 'finance', 'logistique', 'bruit'];
class AxisEmbeddings {
  constructor() { this.id = 'axis'; }
  async embed(text) {
    const t = String(text).toLowerCase();
    const v = AXES.map((a) => (t.includes(a) ? 1 : 0));
    if (!v.some(Boolean)) v[AXES.length - 1] = 1;      // sans mot-cle -> axe "bruit"
    // Perturbation stable liee au texte : evite des vecteurs strictement egaux.
    const h = [...t].reduce((n, c) => (n + c.charCodeAt(0)) % 97, 0);
    const out = v.map((x, i) => x + (i === h % AXES.length ? 0.05 : 0));
    const n = Math.hypot(...out) || 1;
    return out.map((x) => x / n);
  }
  async embedBatch(texts) { return Promise.all(texts.map((t) => this.embed(t))); }
}

const mkIndex = () => new CanvasVectorIndex({ embeddings: new AxisEmbeddings(), store: new InMemoryVectorStore() });

function wsAvec(nodes) {
  let ws = createWorkspace({ id: 'w1', nom: 'Atelier', createdBy: 'geoffroy' });
  for (const n of nodes) ws = addNode(ws, createNode(n));
  return ws;
}

// ==========================================================================
// EF-211 / EF-213 — modele, CRUD, immutabilite
// ==========================================================================

test('EF-211 createNode refuse un type inconnu et un titre vide', () => {
  assert.throws(() => createNode({ titre: 'x', type: 'sticky' }), /type invalide/);
  assert.throws(() => createNode({ titre: '   ' }), /titre requis/);
  assert.throws(() => createNode({ titre: 'x', authorKind: 'robot' }), /authorKind invalide/);
  assert.equal(NODE_TYPES.length, 7);
});

test('EF-213 addNode est immuable : le workspace source est inchange', () => {
  const ws0 = createWorkspace({ id: 'w1', nom: 'A' });
  const ws1 = addNode(ws0, createNode({ id: 'n1', titre: 'Idee' }));
  assert.equal(ws0.nodes.length, 0, 'la source ne doit pas etre mutee');
  assert.equal(ws1.nodes.length, 1);
  assert.equal(ws1.history.at(-1).type, 'node.add');
});

test('EF-213 addNode refuse un id deja present', () => {
  const ws = wsAvec([{ id: 'n1', titre: 'A' }]);
  assert.throws(() => addNode(ws, createNode({ id: 'n1', titre: 'B' })), /deja present/);
});

test('EF-213 updateNode ignore les champs non editables et refuse un titre vide', () => {
  const ws = wsAvec([{ id: 'n1', titre: 'A' }]);
  const next = updateNode(ws, 'n1', { titre: 'B', id: 'PIRATE', authorKind: 'agent', createdAt: '1970' });
  const n = getNode(next, 'n1');
  assert.equal(n.titre, 'B');
  assert.equal(n.id, 'n1', "l'id n'est pas modifiable");
  assert.equal(n.authorKind, 'human', "authorKind n'est pas modifiable");
  assert.throws(() => updateNode(ws, 'n1', { titre: '  ' }), /titre vide/);
  assert.throws(() => updateNode(ws, 'inconnu', { titre: 'X' }), /introuvable/);
});

test('EF-213 removeNode supprime les aretes rattachees (aucune arete orpheline)', () => {
  let ws = wsAvec([{ id: 'n1', titre: 'A' }, { id: 'n2', titre: 'B' }, { id: 'n3', titre: 'C' }]);
  ws = addEdge(ws, { from: 'n1', to: 'n2', relation: 'soutient' });
  ws = addEdge(ws, { from: 'n2', to: 'n3', relation: 'contredit' });
  const next = removeNode(ws, 'n2');
  assert.equal(next.nodes.length, 2);
  assert.equal(next.edges.length, 0);
  assert.equal(next.history.at(-1).aretesRetirees, 2);
});

test('EF-213 duplicateNode decale la copie et ne recopie ni le pin ni la promotion', () => {
  let ws = wsAvec([{ id: 'n1', titre: 'A', x: 10, y: 10 }]);
  ws = pinNode(ws, 'n1', true);
  ws = { ...ws, nodes: ws.nodes.map((n) => ({ ...n, promotedIdeaId: 'i1' })) };
  const next = duplicateNode(ws, 'n1');
  const copie = next.nodes.find((n) => n.id !== 'n1');
  assert.equal(copie.x, 42);
  assert.equal(copie.pinned, false);
  assert.equal(copie.promotedIdeaId, null);
});

// ==========================================================================
// EF-212 — aretes typees orientees
// ==========================================================================

test('EF-212 addEdge valide relation, existence, boucle et doublon', () => {
  let ws = wsAvec([{ id: 'n1', titre: 'A' }, { id: 'n2', titre: 'B' }]);
  assert.throws(() => addEdge(ws, { from: 'n1', to: 'n2', relation: 'ressemble' }), /relation invalide/);
  assert.throws(() => addEdge(ws, { from: 'n1', to: 'n1', relation: 'soutient' }), /boucle/);
  assert.throws(() => addEdge(ws, { from: 'n1', to: 'nX', relation: 'soutient' }), /cible introuvable/);
  ws = addEdge(ws, { from: 'n1', to: 'n2', relation: 'soutient' });
  assert.throws(() => addEdge(ws, { from: 'n1', to: 'n2', relation: 'soutient' }), /deja presente/);
  // Meme couple mais relation differente : autorise, le sens differe.
  ws = addEdge(ws, { from: 'n1', to: 'n2', relation: 'depend' });
  assert.equal(ws.edges.length, 2);
  assert.equal(edgesOf(ws, 'n2').length, 2);
  assert.equal(EDGE_RELATIONS.length, 5);
});

test('EF-231 les contradictions sont exposees, pas lissees', () => {
  let ws = wsAvec([{ id: 'n1', titre: 'A' }, { id: 'n2', titre: 'B' }]);
  ws = addEdge(ws, { from: 'n2', to: 'n1', relation: 'contredit', authorKind: 'agent', authorId: 'RedTeam' });
  const c = contradictions(ws);
  assert.equal(c.length, 1);
  assert.equal(c[0].parAgent, true);
  assert.equal(c[0].cible.id, 'n1');
  assert.equal(stats(ws).contradictions, 1);
});

// ==========================================================================
// EF-201 — sourcage
// ==========================================================================

test('EF-201 un noeud sans provenance est declare non source', () => {
  const sans = createNode({ titre: 'Affirmation' });
  const avec = createNode({ titre: 'Affirmation', provenance: { sourceDocId: 'd1', page: 3 } });
  const vide = createNode({ titre: 'Affirmation', provenance: { page: 3 } }); // ni doc ni url
  assert.equal(isSourced(sans), false);
  assert.equal(isSourced(avec), true);
  assert.equal(isSourced(vide), false, 'une provenance sans source ne compte pas');
});

test('EF-201 stats expose le taux de sourcage, null si aucun noeud', () => {
  const vide = createWorkspace({ id: 'w', nom: 'V' });
  assert.equal(stats(vide).tauxSourcage, null, 'pas de division par zero affichee comme 0');
  const ws = wsAvec([
    { id: 'n1', titre: 'A', provenance: { url: 'https://x' } },
    { id: 'n2', titre: 'B' },
  ]);
  assert.equal(stats(ws).tauxSourcage, 0.5);
});

// ==========================================================================
// EF-214 — annuler / retablir
// ==========================================================================

test('EF-214 undo/redo restitue les etats et le futur est invalide par une nouvelle action', () => {
  const ws0 = createWorkspace({ id: 'w', nom: 'A' });
  const pile = new UndoStack(ws0, { limite: 5 });
  const ws1 = pile.push(addNode(ws0, createNode({ id: 'n1', titre: 'A' })));
  const ws2 = pile.push(addNode(ws1, createNode({ id: 'n2', titre: 'B' })));
  assert.equal(pile.present.nodes.length, 2);
  assert.equal(pile.undo().nodes.length, 1);
  assert.equal(pile.undo().nodes.length, 0);
  assert.equal(pile.canUndo, false);
  assert.equal(pile.undo().nodes.length, 0, 'undo sur pile vide est sans effet');
  assert.equal(pile.redo().nodes.length, 1);
  pile.push(addNode(pile.present, createNode({ id: 'n9', titre: 'Z' })));
  assert.equal(pile.canRedo, false, 'une nouvelle action invalide la branche future');
  assert.ok(ws2.nodes.length === 2);
});

test('EF-214 la pile respecte sa limite (>= 50 en usage reel)', () => {
  let ws = createWorkspace({ id: 'w', nom: 'A' });
  const pile = new UndoStack(ws, { limite: 3 });
  for (let i = 0; i < 10; i++) { ws = addNode(ws, createNode({ id: `n${i}`, titre: `T${i}` })); pile.push(ws); }
  assert.equal(pile.profondeur, 3);
});

test('EF-214 les mutations d agent sont empilees comme les autres', () => {
  const ws0 = createWorkspace({ id: 'w', nom: 'A' });
  const pile = new UndoStack(ws0);
  pile.push(addNode(ws0, createNode({ id: 'a1', titre: 'Critique', authorKind: 'agent', authorId: 'Critic' })));
  assert.equal(pile.present.nodes.length, 1);
  assert.equal(pile.undo().nodes.length, 0);
});

// ==========================================================================
// EF-215 — clustering deterministe
// ==========================================================================

test('EF-215 agglomerate regroupe par seuil et laisse les isoles en singletons', () => {
  const items = [
    { id: 'a', vector: [1, 0, 0] },
    { id: 'b', vector: [0.99, 0.1, 0] },
    { id: 'c', vector: [0, 1, 0] },
  ];
  const g = agglomerate(items, 0.9);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0], ['a', 'b']);
  assert.deepEqual(g[1], ['c'], 'le bruit reste du bruit');
});

test('EF-215 agglomerate ignore les elements non vectorises et gere le vide', () => {
  assert.deepEqual(agglomerate([], 0.8), []);
  const g = agglomerate([{ id: 'a', vector: [1, 0] }, { id: 'b', vector: null }], 0.8);
  assert.deepEqual(g, [['a']]);
});

test('EF-215 le clustering est deterministe : deux executions donnent le meme resultat', async () => {
  const index = mkIndex();
  const ws = wsAvec([
    { id: 'n1', titre: 'mobilite urbaine partagee' },
    { id: 'n2', titre: 'mobilite douce en centre-ville' },
    { id: 'n3', titre: 'energie solaire sur toiture' },
    { id: 'n4', titre: 'energie eolienne offshore' },
    { id: 'n5', titre: 'sante mentale au travail' },
  ]);
  await index.indexNodes('w1', ws.nodes);
  const a = clusterWorkspace(ws, index, { seuil: 0.8 });
  const b = clusterWorkspace(ws, index, { seuil: 0.8 });
  assert.deepEqual(a.clusters.map((c) => [c.id, c.nodeIds]), b.clusters.map((c) => [c.id, c.nodeIds]));
  assert.equal(a.clusters.length, 3, 'mobilite / energie / sante');
  assert.equal(a.nonIndexes.length, 0);
});

test('EF-215 les noeuds non indexes sont declares, pas ranges par defaut', async () => {
  const index = mkIndex();
  const ws = wsAvec([{ id: 'n1', titre: 'mobilite' }, { id: 'n2', titre: 'energie' }]);
  await index.indexNodes('w1', [ws.nodes[0]]);   // n2 volontairement non indexe
  const res = clusterWorkspace(ws, index, { seuil: 0.8 });
  assert.deepEqual(res.nonIndexes, ['n2']);
  assert.equal(res.clusters.flatMap((c) => c.nodeIds).includes('n2'), false);
});

test('EF-215 le garde-fou anti-chainage re-decoupe un cluster trop gros', () => {
  // Chaine continue : chaque element est proche du suivant, single-linkage
  // fusionnerait tout. maxTaille force la re-segmentation.
  const items = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 40;
    return { id: `x${i}`, vector: [Math.cos(a), Math.sin(a)] };
  });
  const sans = agglomerate(items, 0.9);
  const avec = agglomerate(items, 0.9, { maxTaille: 3 });
  assert.equal(sans.length, 1, 'effet de chainage confirme sans garde-fou');
  assert.ok(avec.length > 1, 'le garde-fou segmente');
  assert.equal(avec.flat().length, 8, 'aucun element perdu');
});

test('EF-215 un cluster conserve son id quand sa composition est reconnaissable', async () => {
  const index = mkIndex();
  let ws = wsAvec([
    { id: 'n1', titre: 'mobilite urbaine' },
    { id: 'n2', titre: 'mobilite douce' },
  ]);
  await index.indexNodes('w1', ws.nodes);
  ws = applyClusters(ws, clusterWorkspace(ws, index, { seuil: 0.8 }).clusters);
  const idInitial = ws.clusters[0].id;
  ws = addNode(ws, createNode({ id: 'n3', titre: 'mobilite partagee' }));
  await index.indexNodes('w1', [getNode(ws, 'n3')]);
  const res = clusterWorkspace(ws, index, { seuil: 0.8 });
  assert.equal(res.clusters[0].id, idInitial, "l'identite du cluster survit a un ajout");
});

// ==========================================================================
// EF-216 — libelles de clusters
// ==========================================================================

test('EF-216 un libelle humain n est jamais ecrase par le LLM, l inverse est permis', () => {
  let ws = createWorkspace({ id: 'w', nom: 'A' });
  ws = { ...ws, clusters: [createCluster({ id: 'c1', label: 'auto', labelSource: 'llm' })] };
  ws = setClusterLabel(ws, 'c1', 'Mobilite', { source: 'human', by: 'geoffroy' });
  assert.equal(ws.clusters[0].label, 'Mobilite');
  assert.equal(ws.clusters[0].labelSource, 'human');
  const apres = setClusterLabel(ws, 'c1', 'Theme 3', { source: 'llm' });
  assert.equal(apres.clusters[0].label, 'Mobilite', 'le LLM ne peut pas ecraser un choix humain');
  assert.throws(() => setClusterLabel(ws, 'inconnu', 'X'), /introuvable/);
});

test('EF-216 proposeClusterLabels ignore les clusters libelles par un humain', async () => {
  let appels = 0;
  const llm = { async complete({ messages }) { appels++; return { text: `Theme ${messages.length}` }; } };
  let ws = wsAvec([{ id: 'n1', titre: 'A' }, { id: 'n2', titre: 'B' }]);
  ws = {
    ...ws,
    clusters: [
      createCluster({ id: 'c1', nodeIds: ['n1'], labelSource: 'llm' }),
      createCluster({ id: 'c2', nodeIds: ['n2'], label: 'Fixe', labelSource: 'human' }),
    ],
  };
  const props = await proposeClusterLabels(ws, { llm });
  assert.equal(appels, 1, 'un seul appel LLM : le cluster humain est exclu');
  assert.equal(props.length, 1);
  assert.equal(props[0].clusterId, 'c1');
});

test('EF-216 un echec de libellage ne fait pas echouer le clustering', async () => {
  const llm = { async complete() { throw new Error('LLM indisponible'); } };
  let ws = wsAvec([{ id: 'n1', titre: 'A' }]);
  ws = { ...ws, clusters: [createCluster({ id: 'c1', nodeIds: ['n1'] })] };
  const props = await proposeClusterLabels(ws, { llm });
  assert.deepEqual(props, [], 'degradation silencieuse cote libelle, pas d exception');
});

// ==========================================================================
// EF-217 — deduplication
// ==========================================================================

test('EF-217 findDuplicates propose une fusion sans jamais l appliquer', async () => {
  const index = mkIndex();
  const ws = wsAvec([
    { id: 'n1', titre: 'mobilite urbaine', ts: '2026-01-01T00:00:00.000Z' },
    { id: 'n2', titre: 'mobilite urbaine', ts: '2026-02-01T00:00:00.000Z' },
    { id: 'n3', titre: 'sante publique' },
  ]);
  await index.indexNodes('w1', ws.nodes);
  const dups = findDuplicates(ws, index, { seuil: 0.95 });
  assert.equal(dups.length, 1);
  assert.equal(dups[0].garder, 'n1', 'le plus ancien est conserve');
  assert.equal(dups[0].absorber, 'n2');
  assert.ok(dups[0].similarite >= 0.95);
  assert.equal(ws.nodes.length, 3, 'le canvas est inchange : suggestion uniquement');
});

test('EF-217 mergeNodes reporte les aretes, evite boucles et doublons, archive le corps', () => {
  let ws = wsAvec([
    { id: 'n1', titre: 'Garde', corps: 'texte 1' },
    { id: 'n2', titre: 'Absorbe', corps: 'texte 2' },
    { id: 'n3', titre: 'Tiers' },
  ]);
  ws = addEdge(ws, { from: 'n1', to: 'n2', relation: 'soutient' });   // deviendrait une boucle
  ws = addEdge(ws, { from: 'n3', to: 'n2', relation: 'soutient' });   // a reporter
  ws = addEdge(ws, { from: 'n3', to: 'n1', relation: 'contredit' });  // conservee
  const next = mergeNodes(ws, 'n1', 'n2');

  assert.equal(next.nodes.length, 2);
  assert.equal(getNode(next, 'n2'), null);
  const relations = next.edges.map((e) => `${e.from}->${e.to}:${e.relation}`).sort();
  assert.deepEqual(relations, ['n3->n1:contredit', 'n3->n1:soutient']);
  assert.match(getNode(next, 'n1').corps, /fusionne depuis/, 'la formulation absorbee est archivee');
  assert.equal(getNode(next, 'n1').meta.fusions.length, 1);
  assert.equal(next.history.at(-1).type, 'node.merge');
});

test('EF-217 mergeNodes ne cree pas de doublon d arete au report', () => {
  let ws = wsAvec([{ id: 'n1', titre: 'A' }, { id: 'n2', titre: 'B' }, { id: 'n3', titre: 'C' }]);
  ws = addEdge(ws, { from: 'n3', to: 'n1', relation: 'soutient' });
  ws = addEdge(ws, { from: 'n3', to: 'n2', relation: 'soutient' });
  const next = mergeNodes(ws, 'n1', 'n2');
  assert.equal(next.edges.length, 1, 'le report ne duplique pas une arete existante');
  assert.throws(() => mergeNodes(ws, 'n1', 'n1'), /avec lui-meme/);
  assert.throws(() => mergeNodes(ws, 'n1', 'inconnu'), /introuvable/);
});

// ==========================================================================
// EF-218 — noeuds figes / layout
// ==========================================================================

test('EF-218 le layout ne deplace pas un noeud fige et reste deterministe', () => {
  let ws = wsAvec([
    { id: 'n1', titre: 'A', x: 999, y: 999 },
    { id: 'n2', titre: 'B' }, { id: 'n3', titre: 'C' },
  ]);
  ws = pinNode(ws, 'n1', true);
  ws = applyClusters(ws, [createCluster({ id: 'c1', nodeIds: ['n1', 'n2', 'n3'] })]);
  const a = layoutClusters(ws, { seed: 42 });
  const b = layoutClusters(ws, { seed: 42 });
  assert.equal(getNode(a, 'n1').x, 999, 'noeud fige inchange');
  assert.equal(getNode(a, 'n1').y, 999);
  assert.deepEqual(a.nodes.map((n) => [n.x, n.y]), b.nodes.map((n) => [n.x, n.y]), 'meme graine, meme sortie');
  const c = layoutClusters(ws, { seed: 7 });
  assert.notDeepEqual(a.nodes.map((n) => n.x), c.nodes.map((n) => n.x), 'graine differente, disposition differente');
});

test('EF-215 splitBySize est deterministe et ne perd aucun element', () => {
  const items = Array.from({ length: 9 }, (_, i) => {
    const a = (i * Math.PI) / 40;
    return { id: `x${i}`, vector: [Math.cos(a), Math.sin(a)] };
  });
  const a = splitBySize(items, 3);
  const b = splitBySize([...items].reverse(), 3);
  assert.deepEqual(a, b, "l'ordre d'entree n'influence pas la sortie");
  assert.equal(a.flat().length, 9);
  assert.ok(a.every((g) => g.length <= 3));
  assert.deepEqual(splitBySize(items.slice(0, 2), 3), [['x0', 'x1']], 'groupe deja assez petit : inchange');
});

test('mulberry32 (coeur) est reproductible et borne dans [0,1[', () => {
  const r1 = mulberry32(3); const r2 = mulberry32(3);
  const s1 = [r1(), r1(), r1()];
  assert.deepEqual(s1, [r2(), r2(), r2()]);
  assert.ok(s1.every((x) => x >= 0 && x < 1));
});

// ==========================================================================
// EF-222 — recherche
// ==========================================================================

test('EF-222 searchNodes filtre par texte, type et origine', () => {
  const ws = wsAvec([
    { id: 'n1', titre: 'Mobilite urbaine', type: 'idee' },
    { id: 'n2', titre: 'Risque de mobilite', type: 'critique', authorKind: 'agent', authorId: 'RedTeam' },
  ]);
  assert.equal(searchNodes(ws, 'mobilite').length, 2, 'recherche insensible a la casse');
  assert.equal(searchNodes(ws, 'mobilite', { type: 'critique' }).length, 1);
  assert.equal(searchNodes(ws, '', { authorKind: 'agent' }).length, 1);
  assert.equal(searchNodes(ws, 'inexistant').length, 0);
});

test('EF-222 la recherche semantique passe par le store et le scope workspace', async () => {
  const index = mkIndex();
  const ws = wsAvec([{ id: 'n1', titre: 'energie solaire' }, { id: 'n2', titre: 'sante publique' }]);
  await index.indexNodes('w1', ws.nodes);
  const res = await index.search('w1', 'energie', 1);
  assert.equal(res[0].id, 'n1');
  assert.equal(scopeKey('w1'), 'ws:w1', 'le scope ne peut pas entrer en collision avec un ideaId');
  assert.equal((await index.search('autre-ws', 'energie', 5)).length, 0, 'isolation par workspace');
});

// ==========================================================================
// Index vectoriel
// ==========================================================================

test('indexMissing ne revectorise pas ce qui est deja indexe', async () => {
  let appels = 0;
  const emb = { async embed(t) { return new AxisEmbeddings().embed(t); }, async embedBatch(ts) { appels++; return Promise.all(ts.map((t) => this.embed(t))); } };
  const index = new CanvasVectorIndex({ embeddings: emb, store: new InMemoryVectorStore() });
  const ws = wsAvec([{ id: 'n1', titre: 'A' }, { id: 'n2', titre: 'B' }]);
  await index.indexMissing('w1', ws.nodes);
  assert.equal(index.size(), 2);
  await index.indexMissing('w1', ws.nodes);
  assert.equal(appels, 1, 'aucun appel supplementaire si rien de nouveau');
  assert.equal(index.has('n1'), true);
  index.forget('n1');
  assert.equal(index.similarity('n1', 'n2'), null, 'similarite indisponible = null, pas 0');
});

test('centroid renvoie null sur un ensemble vide et normalise sinon', () => {
  assert.equal(centroid([]), null);
  assert.equal(centroid([null, undefined]), null);
  const c = centroid([[1, 0], [0, 1]]);
  assert.ok(Math.abs(Math.hypot(...c) - 1) < 1e-9);
});

test('nodeText pondere le titre par repetition', () => {
  const t = nodeText(createNode({ titre: 'Titre', corps: 'Corps' }));
  assert.equal(t.split('Titre').length - 1, 2);
});

// ==========================================================================
// EF-257 / EF-258 — matrice Impact x Effort
// ==========================================================================

test('EF-257 quadrant classe correctement et refuse les entrees non numeriques', () => {
  assert.equal(quadrant(8, 2), 'quick-win');
  assert.equal(quadrant(8, 8), 'chantier');
  assert.equal(quadrant(2, 2), 'appoint');
  assert.equal(quadrant(2, 8), 'gouffre');
  assert.equal(quadrant(null, 3), null);
  assert.equal(quadrant(5, undefined), null);
});

test('EF-258 un noeud non note ressort non evalue, jamais place par defaut', () => {
  const ws = wsAvec([
    { id: 'n1', titre: 'A', type: 'idee' },
    { id: 'n2', titre: 'B', type: 'idee' },
    { id: 'n3', titre: 'Preuve', type: 'preuve' },
  ]);
  const m = buildMatrix(ws, { n1: { impact: 9, effort: 2, confiance: 7 } });
  assert.equal(m.total, 2, 'seuls idee/hypothese/decision entrent dans la matrice');
  assert.equal(m.evaluees, 1);
  assert.equal(m.nonEvaluees, 1);
  assert.equal(m.couvertureGlobale, 0.5);
  const n2 = m.cellules.find((c) => c.nodeId === 'n2');
  assert.equal(n2.quadrant, null, 'aucun quadrant invente');
  assert.equal(n2.score, null, 'pas de score fabrique a zero');
  assert.equal(m.parQuadrant['quick-win'], 1);
});

test('EF-258 une notation partielle est signalee par sa couverture', () => {
  const ws = wsAvec([{ id: 'n1', titre: 'A' }]);
  const m = buildMatrix(ws, { n1: { impact: 6 } }); // effort et confiance manquants
  const c = m.cellules[0];
  assert.equal(c.evalue, true);
  assert.ok(c.couverture < 1, 'la couverture partielle est explicite');
  assert.equal(c.quadrant, null, "sans effort, pas de quadrant");
  assert.equal(impactEffortScorecard().scale, 10);
});

// ==========================================================================
// EF-259 / EF-260 — promotion et lien bidirectionnel
// ==========================================================================

test('EF-259 nodeToIntake derive les risques des contradictions et des critiques', () => {
  let ws = wsAvec([
    { id: 'n1', titre: 'Offre de mobilite', corps: 'abonnement mensuel', type: 'idee' },
    { id: 'n2', titre: 'Le marche est sature', type: 'critique' },
    { id: 'n3', titre: 'Depend d un partenariat operateur', type: 'idee' },
    { id: 'n4', titre: 'Quel segment vise-t-on ?', type: 'question' },
  ]);
  ws = addEdge(ws, { from: 'n2', to: 'n1', relation: 'contredit' });
  ws = addEdge(ws, { from: 'n1', to: 'n3', relation: 'depend' });
  ws = addEdge(ws, { from: 'n4', to: 'n1', relation: 'derive' });
  const intake = nodeToIntake(ws, 'n1');
  assert.match(intake.valeur, /Offre de mobilite/);
  assert.match(intake.risques, /marche est sature/);
  assert.match(intake.ressources, /partenariat operateur/);
  assert.match(intake.probleme, /segment/);
  assert.equal(intake._canvas.contradictions, 1);
});

test('EF-259 promote cree une idee en recueillir et derive hypotheses + cibles d attaque', () => {
  let ws = wsAvec([{ id: 'n1', titre: 'Offre de mobilite', corps: 'abonnement', type: 'idee' }]);
  const { workspace, idea, traitement } = promote(ws, { nodeId: 'n1', ideaId: 'i1', author: 'geoffroy' });
  assert.equal(idea.stage, 'recueillir');
  assert.equal(idea.status, 'nouveau');
  assert.equal(idea.tenantId, ws.tenantId);
  assert.ok(traitement.hypotheses.length >= 1, 'les hypotheses de Construire sont derivees');
  // EF-60 : les champs absents deviennent des angles morts assignes a un agent.
  const anglesMorts = traitement.cibles.filter((c) => c.origine === 'angle_mort');
  assert.ok(anglesMorts.length >= 1, 'un champ non renseigne devient un angle mort');
  assert.ok(anglesMorts.every((c) => c.agent), 'chaque angle mort est assigne');
  assert.equal(traitement.validation.ok, false, 'intake incomplet declare incomplet');
  assert.equal(getNode(workspace, 'n1').promotedIdeaId, 'i1');
  assert.deepEqual(workspace.promotedIdeaIds, ['i1']);
});

test('EF-259 promote refuse des arguments incoherents', () => {
  const ws = wsAvec([{ id: 'n1', titre: 'A' }]);
  assert.throws(() => promote(ws, { ideaId: 'i1' }), /nodeId ou clusterId requis/);
  assert.throws(() => promote(ws, { nodeId: 'n1', clusterId: 'c1', ideaId: 'i1' }), /mutuellement exclusifs/);
  assert.throws(() => promote(ws, { nodeId: 'n1' }), /ideaId requis/);
});

test('EF-259 promote sur un cluster prend le noeud le plus connecte comme tete', () => {
  let ws = wsAvec([
    { id: 'n1', titre: 'Peripherique', type: 'idee' },
    { id: 'n2', titre: 'Central', type: 'idee' },
    { id: 'n3', titre: 'Autre', type: 'idee' },
  ]);
  ws = addEdge(ws, { from: 'n2', to: 'n1', relation: 'soutient' });
  ws = addEdge(ws, { from: 'n2', to: 'n3', relation: 'soutient' });
  ws = applyClusters(ws, [createCluster({ id: 'c1', label: 'Mobilite', nodeIds: ['n1', 'n2', 'n3'] })]);
  const { idea, workspace } = promote(ws, { clusterId: 'c1', ideaId: 'i2' });
  assert.equal(idea.title, 'Mobilite', 'le libelle du cluster nomme l idee');
  assert.match(idea.intake.valeur, /Central/, 'la tete est le noeud le plus connecte');
  assert.equal(idea.intake._canvas.membres, 3);
  assert.equal(workspace.nodes.filter((n) => n.promotedIdeaId === 'i2').length, 3);
  assert.throws(() => clusterToIntake(ws, 'cX'), /introuvable/);
});

test('EF-260 originOf permet de remonter du portefeuille au canvas', () => {
  let ws = wsAvec([{ id: 'n1', titre: 'A', provenance: { url: 'https://source' } }]);
  ws = applyClusters(ws, [createCluster({ id: 'c1', nodeIds: ['n1'] })]);
  const { workspace } = promote(ws, { nodeId: 'n1', ideaId: 'i1', author: 'geoffroy' });
  const o = originOf(workspace, 'i1');
  assert.equal(o.workspaceId, 'w1');
  assert.equal(o.nodes.length, 1);
  assert.equal(o.clusters.length, 1);
  assert.equal(o.sources.length, 1, 'les sources qui ont nourri l idee sont retrouvables');
  assert.equal(o.promuPar, 'geoffroy');
  assert.equal(originOf(workspace, 'inconnue'), null);
});

// ==========================================================================
// Persistance
// ==========================================================================

test('le repository isole par tenant avant toute autre facette', async () => {
  const repo = new InMemoryCanvasRepository();
  await repo.save(createWorkspace({ id: 'a', nom: 'Alpha', tenantId: 't1' }));
  await repo.save(createWorkspace({ id: 'b', nom: 'Alpha', tenantId: 't2' }));
  const res = await repo.list({ tenantId: 't1', q: 'alpha' });
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 'a');
  assert.equal((await repo.size()), 2);
  assert.equal(await repo.get('zzz'), null);
});

test('le repository retrouve un canvas par son texte de noeud et par idee promue', async () => {
  const repo = new InMemoryCanvasRepository();
  let ws = wsAvec([{ id: 'n1', titre: 'energie marine' }]);
  ({ workspace: ws } = promote(ws, { nodeId: 'n1', ideaId: 'i9' }));
  await repo.save(ws);
  assert.equal((await repo.list({ q: 'marine' })).length, 1);
  assert.equal((await repo.list({ ideaId: 'i9' })).length, 1);
  assert.equal((await repo.list({ ideaId: 'i0' })).length, 0);
});

test('canvasPortfolio agrege les statistiques par canvas', async () => {
  const repo = new InMemoryCanvasRepository();
  await repo.save(wsAvec([{ id: 'n1', titre: 'A', provenance: { url: 'u' } }, { id: 'n2', titre: 'B' }]));
  const p = await canvasPortfolio(repo, {});
  assert.equal(p.total, 1);
  assert.equal(p.workspaces[0].noeuds, 2);
  assert.equal(p.workspaces[0].tauxSourcage, 0.5);
});

test('FileCanvasRepository ecrit de facon atomique (temporaire puis rename)', async () => {
  const { FileCanvasRepository } = await import('./repository.mjs');
  const ecrits = []; const renommes = [];
  const fakeFs = {
    async readFile() { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
    async writeFile(p, c) { ecrits.push(p); this._c = c; },
    async rename(a, b) { renommes.push([a, b]); },
  };
  const repo = new FileCanvasRepository({ path: '/tmp/x.json', fs: fakeFs });
  await repo.load();
  assert.equal(await repo.size(), 0, 'fichier absent = aucun canvas, pas une erreur');
  await repo.save(createWorkspace({ id: 'a', nom: 'A' }));
  assert.deepEqual(ecrits, ['/tmp/x.json.tmp'], 'ecriture dans un fichier temporaire');
  assert.deepEqual(renommes, [['/tmp/x.json.tmp', '/tmp/x.json']]);
  assert.throws(() => new FileCanvasRepository({}), /path requis/);
});

// ==========================================================================
// Integration : parcours complet du lot v11
// ==========================================================================

test('parcours v11 : noeuds -> index -> clusters -> dedup -> matrice -> promotion', async () => {
  const { createCanvasStudio } = await import('./index.mjs');
  const engine = { embeddings: new AxisEmbeddings(), vectors: new InMemoryVectorStore() };
  const studio = createCanvasStudio(engine);

  await studio.create({ id: 'w9', nom: 'Session strategique', createdBy: 'geoffroy' });
  for (const t of [
    'mobilite urbaine partagee', 'mobilite douce quotidienne',
    'energie solaire decentralisee', 'energie de recuperation',
    'sante au travail',
  ]) await studio.addNode('w9', { titre: t });

  const llm = { async complete({ messages }) { return { text: `Theme ${messages[0].content.length % 7}` }; } };
  const res = await studio.recluster('w9', { llm, seuil: 0.8 });

  assert.equal(res.clusters.length, 3);
  assert.ok(res.clusters.every((c) => c.label), 'chaque cluster est libelle');
  assert.ok(res.workspace.nodes.every((n) => n.clusterId), 'chaque noeud est rattache');

  const dups = await studio.duplicates('w9', { seuil: 0.999 });
  assert.equal(dups.length, 0, 'aucun doublon strict dans ce jeu');

  const m = buildMatrix(res.workspace, {});
  assert.equal(m.evaluees, 0);
  assert.equal(m.couvertureGlobale, 0, 'rien de note : la couverture le dit');

  const cluster = res.clusters[0];
  const { idea, traitement } = promote(res.workspace, { clusterId: cluster.id, ideaId: 'idee-1' });
  assert.equal(idea.stage, 'recueillir');
  assert.ok(traitement.cibles.some((c) => c.agent === 'RedTeam' || c.agent === 'DevilsAdvocate'));

  assert.throws(() => createCanvasStudio({}), /moteur invalide/);
});
