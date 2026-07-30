// KayrosLab — Canvas : tests ingestion, swarms et frameworks.
// EF-200 a EF-209, EF-225 a EF-237.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspace, createNode, addNode, getNode, isSourced, stats } from './model.mjs';
import { CanvasVectorIndex } from './vectors.mjs';
import { InMemoryVectorStore } from '../memory.mjs';
import {
  IngestionService, chunkText, buildContext, extractCitations,
  answerWithReceipts, invalidateNodes, MIMES_TEXTE,
} from './ingest.mjs';
import {
  PERSONAS_STANDARD, PersonaRegistry, runSwarm, applySwarm, expandNode, parsePersonaOutput,
} from './personas.mjs';
import {
  SCAMPER, SIX_CHAPEAUX, PREMIERS_PRINCIPES, scamper, sixChapeaux, premiersPrincipes,
  preMortem, parseCause, niveau, causesToHypotheses,
} from './frameworks.mjs';

// ---------------------------------------------------------------------------
// Outillage
// ---------------------------------------------------------------------------
class Emb {
  async embed(t) {
    const s = String(t).toLowerCase();
    const axes = ['solaire', 'mobilite', 'juridique', 'autre'];
    const v = axes.map((a) => (s.includes(a) ? 1 : 0));
    if (!v.some(Boolean)) v[3] = 1;
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  }
  async embedBatch(ts) { return Promise.all(ts.map((t) => this.embed(t))); }
}
const mkIndex = () => new CanvasVectorIndex({ embeddings: new Emb(), store: new InMemoryVectorStore() });

/** LLM scriptable : renvoie les reponses fournies, dans l'ordre. */
function mkLLM(reponses, { usage = { tokensIn: 10, tokensOut: 20, costUsd: 0.001 } } = {}) {
  let i = 0;
  const appels = [];
  return {
    appels,
    async complete(req) {
      appels.push(req);
      const t = typeof reponses === 'function' ? reponses(req, i) : (reponses[i] ?? reponses[reponses.length - 1]);
      i++;
      if (t instanceof Error) throw t;
      return { text: t, usage, provider: 'test' };
    },
  };
}

const wsSimple = () => addNode(
  createWorkspace({ id: 'w1', nom: 'Atelier' }),
  createNode({ id: 'n1', titre: 'Offre solaire en autoconsommation', corps: 'pour PME' }),
);

// ==========================================================================
// EF-200 — decoupage et ingestion
// ==========================================================================

test('EF-200 chunkText decoupe avec chevauchement et couvre tout le texte', () => {
  const texte = Array.from({ length: 40 }, (_, i) => `Paragraphe numero ${i} avec du contenu.`).join('\n\n');
  const c = chunkText(texte, { taille: 300, chevauchement: 50 });
  assert.ok(c.length > 1);
  assert.equal(c[0].index, 0);
  assert.ok(c.every((x) => x.texte.length <= 320), 'aucun fragment ne deborde franchement');
  assert.ok(c.at(-1).fin >= texte.length - 1, 'la fin du document est couverte');
});

test('EF-200 chunkText gere le vide et refuse un chevauchement absurde', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText('   '), []);
  assert.deepEqual(chunkText(null), []);
  assert.throws(() => chunkText('abc', { taille: 10, chevauchement: 10 }), /chevauchement/);
  assert.equal(chunkText('court').length, 1);
});

test('EF-200 ingest vectorise le document et le rend interrogeable', async () => {
  const svc = new IngestionService({ index: mkIndex() });
  const r = await svc.ingest('w1', { nom: 'note.md', mime: 'text/markdown', contenu: 'Le solaire en autoconsommation reduit la facture.' });
  assert.equal(r.ok, true);
  assert.equal(r.doc.chunks.length, 1);
  assert.equal(svc.docs('w1').length, 1);
  const p = await svc.retrieve('w1', 'solaire', 3);
  assert.equal(p.length, 1);
  assert.equal(p[0].marqueur, 1);
  assert.equal(p[0].doc, 'note.md');
});

test('EF-200 un mime binaire sans extracteur echoue explicitement', async () => {
  const svc = new IngestionService({ index: mkIndex() });
  await assert.rejects(
    () => svc.ingest('w1', { nom: 'x.pdf', mime: 'application/pdf', contenu: 'binaire' }),
    /Aucun extracteur/,
  );
  assert.ok(MIMES_TEXTE.includes('text/plain'));
});

test('EF-200 un extracteur injecte prend le relais et transmet la pagination', async () => {
  const svc = new IngestionService({
    index: mkIndex(),
    extractors: {
      'application/pdf': async () => ({
        texte: 'Contenu solaire page une.\n\nContenu mobilite page deux.',
        pages: [{ numero: 1, debut: 0, fin: 26 }, { numero: 2, debut: 26, fin: 100 }],
      }),
    },
  });
  const r = await svc.ingest('w1', { nom: 'rapport.pdf', mime: 'application/pdf', contenu: Buffer.from('x') });
  assert.equal(r.ok, true);
  assert.equal(r.doc.chunks[0].page, 1, 'la page est reportee sur le fragment');
});

test('EF-200 un document vide est refuse avec motif', async () => {
  const svc = new IngestionService({ index: mkIndex() });
  const r = await svc.ingest('w1', { nom: 'vide.txt', contenu: '   ' });
  assert.equal(r.ok, false);
  assert.match(r.motif, /vide/);
});

// ==========================================================================
// EF-206 — scope
// ==========================================================================

test('EF-206 les documents sont isoles par workspace', async () => {
  const svc = new IngestionService({ index: mkIndex() });
  await svc.ingest('wA', { nom: 'a.txt', contenu: 'contenu solaire A' });
  await svc.ingest('wB', { nom: 'b.txt', contenu: 'contenu solaire B' });
  assert.equal(svc.docs('wA').length, 1);
  assert.equal((await svc.retrieve('wA', 'solaire', 5)).length, 1, 'aucune fuite entre workspaces');
  assert.equal(svc.scope('wA'), 'ws:wA');
});

// ==========================================================================
// EF-201 — attribution
// ==========================================================================

test('EF-201 extractCitations distingue sourcee, non sourcee et citation inventee', () => {
  const passages = [
    { marqueur: 1, docId: 'd1', doc: 'a.md', page: 2, chunkId: 'd1#0' },
    { marqueur: 2, docId: 'd2', doc: 'b.md', page: null, chunkId: 'd2#0' },
  ];
  const ok = extractCitations('Le marche croit [1] et se concentre [2].', passages);
  assert.equal(ok.sourced, true);
  assert.equal(ok.citations.length, 2);
  assert.equal(ok.motif, null);

  const sans = extractCitations('Le marche croit fortement.', passages);
  assert.equal(sans.sourced, false);
  assert.match(sans.motif, /aucune source/);

  const invente = extractCitations('Voir [1] et [7].', passages);
  assert.equal(invente.sourced, false, 'une citation inventee invalide le sourcage');
  assert.deepEqual(invente.inventees, [7]);
  assert.match(invente.motif, /inconnues/);
});

test('EF-201 buildContext numerote les passages et expose la page', () => {
  const c = buildContext([{ marqueur: 1, doc: 'a.md', page: 4, texte: 'Extrait.' }]);
  assert.match(c, /\[1\] \(a\.md, p\.4\)/);
});

test('EF-201 answerWithReceipts impose la citation et rend son statut', async () => {
  const svc = new IngestionService({ index: mkIndex() });
  await svc.ingest('w1', { nom: 'source.md', contenu: 'Le solaire en autoconsommation reduit la facture de 30 pourcent.' });
  const llm = mkLLM(['La facture baisse de 30 pourcent [1].']);
  const r = await answerWithReceipts(svc, 'w1', 'solaire', { llm });
  assert.equal(r.sourced, true);
  assert.equal(r.citations[0].doc, 'source.md');
  assert.match(llm.appels[0].messages[0].content, /Cite tes sources/);
});

test('EF-201 answerWithReceipts sans document pertinent ne fabrique pas de reponse', async () => {
  const svc = new IngestionService({ index: mkIndex() });
  const llm = mkLLM(['reponse inventee']);
  const r = await answerWithReceipts(svc, 'w1', 'question', { llm });
  assert.equal(r.texte, null);
  assert.equal(r.sourced, false);
  assert.match(r.motif, /aucun document/);
  assert.equal(llm.appels.length, 0, 'aucun appel LLM sans matiere');
});

// ==========================================================================
// EF-207 — retrait et invalidation
// ==========================================================================

test('EF-207 le retrait oublie les vecteurs et exclut les fragments des resultats', async () => {
  const index = mkIndex();
  const svc = new IngestionService({ index });
  const r = await svc.ingest('w1', { nom: 'a.md', contenu: 'contenu solaire' });
  assert.equal((await svc.retrieve('w1', 'solaire', 5)).length, 1);

  const ret = svc.retire(r.doc.id);
  assert.equal(ret.chunkIds.length, 1);
  assert.equal(svc.docs('w1').length, 0);
  assert.equal((await svc.retrieve('w1', 'solaire', 5)).length, 0, 'les fragments retires ne remontent plus');
  assert.equal(svc.retire(r.doc.id).dejaRetire, true, 'retrait idempotent');
  assert.throws(() => svc.retire('inconnu'), /introuvable/);
});

test('EF-207 invalidateNodes marque les noeuds sans les supprimer', () => {
  let ws = createWorkspace({ id: 'w1', nom: 'A' });
  ws = addNode(ws, createNode({ id: 'n1', titre: 'Assertion', provenance: { sourceDocId: 'd1', page: 1 } }));
  ws = addNode(ws, createNode({ id: 'n2', titre: 'Autre', provenance: { sourceDocId: 'd2' } }));
  assert.equal(isSourced(getNode(ws, 'n1')), true);

  const next = invalidateNodes(ws, 'd1', { by: 'geoffroy' });
  assert.equal(next.nodes.length, 2, "le noeud reste : c'est son etayage qui tombe");
  assert.equal(getNode(next, 'n1').provenance.retracted, true);
  assert.equal(isSourced(getNode(next, 'n1')), false, 'une source retiree ne source plus rien');
  assert.equal(isSourced(getNode(next, 'n2')), true, 'les autres sources sont intactes');
  assert.equal(next.history.at(-1).noeudsInvalides, 1);
  assert.equal(stats(next).tauxSourcage, 0.5);
});

test('EF-207 invalidateNodes est sans effet si aucun noeud n est concerne', () => {
  const ws = addNode(createWorkspace({ id: 'w1', nom: 'A' }), createNode({ id: 'n1', titre: 'X' }));
  assert.equal(invalidateNodes(ws, 'dInconnu'), ws, 'aucune entree d historique parasite');
});

// ==========================================================================
// EF-208 — sensibilite
// ==========================================================================

test('EF-208 un document sensible est refuse avec motif en palier non souverain', async () => {
  const svc = new IngestionService({ index: mkIndex(), sovereignty: 'cloud', onSensitive: 'refuser' });
  const r = await svc.ingest('w1', { nom: 'conf.md', contenu: 'Note de conformite RGPD sur le traitement des donnees.' });
  assert.equal(r.ok, false);
  assert.equal(r.sensibilite.sensitive, true);
  assert.match(r.motif, /sensible/);
  assert.match(r.motif, /refusee/);
  assert.equal(svc.docs('w1').length, 0, 'rien n a ete indexe');
});

test('EF-208 la bascule locale est explicite et tracee sur le document', async () => {
  const svc = new IngestionService({ index: mkIndex(), sovereignty: 'cloud', onSensitive: 'local' });
  const r = await svc.ingest('w1', { nom: 'conf.md', contenu: 'Note de conformite RGPD.' });
  assert.equal(r.ok, true);
  assert.equal(r.doc.sovereignty, 'local', 'la bascule est inscrite, pas implicite');
});

test('EF-208 en palier local un document sensible passe sans bascule', async () => {
  const svc = new IngestionService({ index: mkIndex(), sovereignty: 'local' });
  const r = await svc.ingest('w1', { nom: 'conf.md', contenu: 'Note de conformite RGPD.' });
  assert.equal(r.ok, true);
  assert.equal(r.doc.sovereignty, 'local');
});

// ==========================================================================
// EF-209 — plafond
// ==========================================================================

test('EF-209 le quota est consultable AVANT et le depassement est refuse', async () => {
  const svc = new IngestionService({ index: mkIndex(), plafondCaracteres: 100 });
  const avant = svc.quota('w1', 150);
  assert.equal(avant.depasserait, true, 'le depassement est annonce avant la tentative');
  assert.equal(avant.restant, 100);

  const r = await svc.ingest('w1', { nom: 'gros.txt', contenu: 'x'.repeat(150) });
  assert.equal(r.ok, false);
  assert.match(r.motif, /plafond/);
  assert.equal(svc.quota('w1').utilise, 0);
});

test('EF-209 le seuil d alerte se declenche a 80 pourcent', async () => {
  const svc = new IngestionService({ index: mkIndex(), plafondCaracteres: 100 });
  await svc.ingest('w1', { nom: 'a.txt', contenu: 'x'.repeat(85) });
  const q = svc.quota('w1');
  assert.equal(q.alerte, true);
  assert.equal(q.utilise, 85);
  assert.equal(q.restant, 15);
});

// ==========================================================================
// EF-227 / EF-228 — personas
// ==========================================================================

test('EF-227 les personas standard exposent prompt et criteres', () => {
  assert.equal(PERSONAS_STANDARD.length, 6);
  for (const p of PERSONAS_STANDARD) {
    assert.ok(p.prompt && p.prompt.length > 40, `${p.id} : prompt expose`);
    assert.ok(Array.isArray(p.criteres) && p.criteres.length, `${p.id} : criteres exposes`);
    assert.ok(p.angle, `${p.id} : angle declare`);
  }
});

test('EF-228 une persona custom exige des criteres — pas de boite noire', () => {
  const r = new PersonaRegistry();
  assert.throws(() => r.register({ id: 'x', nom: 'X', prompt: 'p' }), /criteres requis/);
  assert.throws(() => r.register({ id: 'y', nom: 'Y', criteres: ['a'] }), /prompt ou agent requis/);
  assert.throws(() => r.register({ nom: 'Z' }), /id et nom requis/);
  r.register({ id: 'ok', nom: 'OK', prompt: 'p', criteres: ['a'] });
  assert.equal(r.get('ok').poidsVote, 1, 'valeur par defaut appliquee');
  assert.equal(r.list().length, 7);
  r.remove('ok');
  assert.equal(r.get('ok'), null);
});

test('EF-229 les agents du coeur deviennent des personas sans etre redefinis', () => {
  const faux = { execute: async () => ({ agent: 'Critic', output: '- point' }) };
  const r = new PersonaRegistry().withCoreAgents({ Critic: faux, RedTeam: faux });
  assert.equal(r.get('critic').agent, faux, "c'est l'agent du coeur qui fait autorite");
  assert.equal(r.get('critic').prompt, undefined, 'aucun prompt duplique');
  assert.equal(r.get('bisociateur'), null, 'seuls les agents fournis sont enregistres');
});

// ==========================================================================
// EF-226 / EF-230 / EF-231 — swarm
// ==========================================================================

test('parsePersonaOutput extrait points et verdict, avec repli sans puces', () => {
  const a = parsePersonaOutput('- un\n- deux\nVERDICT: contredit');
  assert.deepEqual(a.points, ['un', 'deux']);
  assert.equal(a.verdict, 'contredit');
  const b = parsePersonaOutput('ligne libre\nautre ligne');
  assert.deepEqual(b.points, ['ligne libre', 'autre ligne'], 'le travail du modele n est pas jete');
  assert.equal(b.verdict, null);
  assert.deepEqual(parsePersonaOutput('').points, []);
});

test('EF-226 le swarm interroge chaque persona et cumule le cout', async () => {
  const llm = mkLLM(['- point A\nVERDICT: soutient']);
  const personas = new PersonaRegistry().list().slice(0, 3);
  const r = await runSwarm({ noeud: { titre: 'Idee', corps: '' }, personas, llm });
  assert.equal(r.runs.length, 3);
  assert.equal(llm.appels.length, 3);
  assert.equal(r.cout.appels, 3);
  assert.equal(r.cout.tokensIn, 30);
  assert.ok(r.cout.coutUsd > 0);
});

test('EF-230 les sorties sont emises au fil de l eau et le cout est expose en cours', async () => {
  const vus = [];
  const llm = mkLLM(['- point\nVERDICT: soutient']);
  await runSwarm({
    noeud: { titre: 'Idee' }, personas: new PersonaRegistry().list().slice(0, 2), llm,
    onOutput: (s) => vus.push(s.cout.appels),
  });
  assert.equal(vus.length, 2);
  assert.ok(vus.every((n) => n >= 1), 'le compteur est lisible pendant le run');
});

test('EF-230 un signal d interruption empeche les appels restants', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const llm = mkLLM(['- point']);
  const r = await runSwarm({ noeud: { titre: 'X' }, personas: new PersonaRegistry().list(), llm, signal: ctrl.signal });
  assert.equal(llm.appels.length, 0);
  assert.equal(r.avorte, true);
  assert.ok(r.runs.every((x) => !x.ok));
});

test('EF-226 la panne d une persona ne fait pas tomber le swarm', async () => {
  const llm = mkLLM((req, i) => (i === 1 ? new Error('502 upstream') : '- point\nVERDICT: soutient'));
  const r = await runSwarm({ noeud: { titre: 'X' }, personas: new PersonaRegistry().list().slice(0, 3), llm });
  assert.equal(r.runs.filter((x) => x.ok).length, 2);
  assert.equal(r.runs.filter((x) => !x.ok).length, 1);
  assert.match(r.runs.find((x) => !x.ok).erreur, /502/);
});

test('EF-231 les desaccords deviennent des aretes contredit et ne sont pas lisses', async () => {
  const ws = wsSimple();
  const llm = mkLLM((req, i) => (i % 2 === 0 ? '- ca tient\nVERDICT: soutient' : '- ca ne tient pas\nVERDICT: contredit'));
  const personas = new PersonaRegistry().list().slice(0, 4);
  const { runs } = await runSwarm({ noeud: getNode(ws, 'n1'), personas, llm });
  const res = applySwarm(ws, 'n1', runs);

  assert.equal(res.crees.length, 4);
  assert.equal(res.desaccords.length, 2);
  assert.equal(res.appuis.length, 2);
  const rel = res.workspace.edges.map((e) => e.relation).sort();
  assert.deepEqual(rel, ['contredit', 'contredit', 'soutient', 'soutient']);
  assert.ok(res.workspace.nodes.filter((n) => n.authorKind === 'agent').length === 4, 'les sorties sont attribuees aux agents');
  assert.equal(stats(res.workspace).contradictions, 2, 'le conflit reste visible dans les statistiques');
});

test('EF-231 sans verdict explicite la position n est pas inventee', async () => {
  const ws = wsSimple();
  const llm = mkLLM(['- observation sans position']);
  const { runs } = await runSwarm({ noeud: getNode(ws, 'n1'), personas: new PersonaRegistry().list().slice(0, 1), llm });
  const res = applySwarm(ws, 'n1', runs);
  assert.equal(res.workspace.edges[0].relation, 'derive', 'ni soutien ni contradiction par defaut');
  assert.equal(res.desaccords.length, 0);
  assert.equal(res.appuis.length, 0);
});

test('EF-229 une persona adossee a un agent delegue son execution', async () => {
  let recu = null;
  const agent = { async execute(task, ctx) { recu = { task, ctx }; return { agent: 'Critic', output: '- angle mort\nVERDICT: contredit', structured: { issues: [] } }; } };
  const personas = new PersonaRegistry([]).withCoreAgents({ Critic: agent }).list();
  const r = await runSwarm({ noeud: { titre: 'Idee testee' }, personas, llm: null, contexte: 'ctx' });
  assert.equal(r.runs[0].ok, true);
  assert.equal(r.runs[0].verdict, 'contredit');
  assert.match(recu.task, /Idee testee/);
  assert.equal(recu.ctx.context, 'ctx');
});

test('runSwarm valide ses entrees', async () => {
  await assert.rejects(() => runSwarm({ personas: [], llm: {} }), /noeud requis/);
  await assert.rejects(() => runSwarm({ noeud: { titre: 'x' }, personas: [], llm: {} }), /au moins une persona/);
  await assert.rejects(() => runSwarm({ noeud: { titre: 'x' }, personas: PERSONAS_STANDARD, llm: {} }), /llm.complete requis/);
});

// ==========================================================================
// EF-225 — expansion
// ==========================================================================

test('EF-225 expandNode cree N enfants relies par des aretes typees', async () => {
  const ws = wsSimple();
  const llm = mkLLM(['- variante A\n- variante B\n- variante C']);
  const r = await expandNode(ws, 'n1', { llm, n: 3 });
  assert.equal(r.crees.length, 3);
  assert.ok(r.workspace.edges.every((e) => e.relation === 'derive' && e.to === 'n1'));
  assert.ok(r.workspace.nodes.filter((n) => n.type === 'idee').length === 4);
});

test('EF-225 l angle change le type de noeud et la relation', async () => {
  const ws = wsSimple();
  const llm = mkLLM(['- echoue si le prix baisse\n- echoue hors zone urbaine']);
  const r = await expandNode(ws, 'n1', { llm, n: 2, angle: 'contre-exemples' });
  assert.ok(r.workspace.edges.every((e) => e.relation === 'contredit'));
  assert.ok(r.crees.every((id) => getNode(r.workspace, id).type === 'critique'));

  const r2 = await expandNode(ws, 'n1', { llm: mkLLM(['- comment financer ?']), angle: 'sous-problemes' });
  assert.equal(getNode(r2.workspace, r2.crees[0]).type, 'question');
});

test('EF-225 expandNode valide ses entrees', async () => {
  const ws = wsSimple();
  await assert.rejects(() => expandNode(ws, 'inconnu', { llm: mkLLM(['- x']) }), /introuvable/);
  await assert.rejects(() => expandNode(ws, 'n1', {}), /llm.complete requis/);
});

// ==========================================================================
// EF-232 / EF-233 / EF-234 — frameworks
// ==========================================================================

test('EF-232 SCAMPER applique les 7 transformations et les etiquette', async () => {
  const ws = wsSimple();
  const llm = mkLLM(['- proposition']);
  const r = await scamper(ws, 'n1', { llm });
  assert.equal(llm.appels.length, 7);
  assert.equal(r.crees.length, 7);
  assert.equal(SCAMPER.length, 7);
  const titres = r.crees.map((id) => getNode(r.workspace, id).titre);
  assert.ok(titres.some((t) => t.startsWith('[Substituer]')));
  assert.ok(titres.some((t) => t.startsWith('[Eliminer]')));
  assert.equal(r.cout.appels, 7);
});

test('EF-233 les six chapeaux produisent des types de noeuds distincts', async () => {
  const ws = wsSimple();
  const r = await sixChapeaux(ws, 'n1', { llm: mkLLM(['- lecture']) });
  assert.equal(SIX_CHAPEAUX.length, 6);
  assert.equal(r.crees.length, 6);
  const types = new Set(r.crees.map((id) => getNode(r.workspace, id).type));
  assert.ok(types.has('critique'), 'le chapeau noir produit une critique');
  assert.ok(types.has('preuve'), 'le chapeau blanc produit une preuve');
  assert.ok(types.has('decision'), 'le chapeau bleu produit une decision');
});

test('EF-234 les premiers principes se rattachent par depend', async () => {
  const ws = wsSimple();
  const r = await premiersPrincipes(ws, 'n1', { llm: mkLLM(['- contrainte incompressible']) });
  assert.equal(PREMIERS_PRINCIPES.length, 3);
  assert.equal(r.crees.length, 3);
  assert.ok(r.workspace.edges.every((e) => e.relation === 'depend'));
  assert.ok(r.crees.every((id) => getNode(r.workspace, id).type === 'hypothese'));
});

test('EF-232 une transformation en echec n annule pas les autres', async () => {
  const ws = wsSimple();
  const llm = mkLLM((req, i) => (i === 2 ? new Error('timeout') : '- proposition'));
  const r = await scamper(ws, 'n1', { llm });
  assert.equal(r.crees.length, 6);
  assert.equal(r.echecs.length, 1);
  assert.match(r.echecs[0].erreur, /timeout/);
});

test('les frameworks valident leurs entrees', async () => {
  const ws = wsSimple();
  await assert.rejects(() => scamper(ws, 'inconnu', { llm: mkLLM(['- x']) }), /introuvable/);
  await assert.rejects(() => sixChapeaux(ws, 'n1', {}), /llm.complete requis/);
});

// ==========================================================================
// EF-236 / EF-237 — pre-mortem
// ==========================================================================

test('niveau et parseCause normalisent, et une ligne mal formee n est pas jetee', () => {
  assert.equal(niveau('elevee'), 3);
  assert.equal(niveau('Moyenne'), 2);
  assert.equal(niveau('inconnu'), null);
  assert.equal(niveau(7), 3, 'borne haute');

  const c = parseCause('- Le marche ne decolle pas | probabilite: elevee | severite: moyenne');
  assert.equal(c.cause, 'Le marche ne decolle pas');
  assert.equal(c.criticite, 6);
  assert.equal(c.complet, true);

  const brut = parseCause('- Cause sans niveaux');
  assert.equal(brut.cause, 'Cause sans niveaux');
  assert.equal(brut.criticite, null, 'pas de criticite inventee');
  assert.equal(brut.complet, false);
  assert.equal(parseCause('  '), null);
});

test('EF-236 le pre-mortem produit un cluster de causes notees', async () => {
  const ws = wsSimple();
  const llm = mkLLM([[
    '- Le marche ne decolle pas | probabilite: elevee | severite: elevee',
    '- Le partenaire se retire | probabilite: moyenne | severite: elevee',
    '- Cause mal formatee',
  ].join('\n')]);
  const r = await preMortem(ws, 'n1', { llm, horizon: '2029' });

  assert.equal(r.causes.length, 3);
  assert.equal(r.crees.length, 3);
  assert.equal(r.causes[0].criticite, 9);
  assert.equal(r.couverture, Math.round((2 / 3) * 100) / 100, 'la part reellement notee est declaree');
  const cluster = r.workspace.clusters.find((c) => c.id === r.clusterId);
  assert.equal(cluster.label, 'Pre-mortem 2029');
  assert.ok(r.workspace.edges.every((e) => e.relation === 'contredit'), "une cause d'echec contredit l'idee");
  assert.match(llm.appels[0].messages[0].content, /L'echec est POSTULE/);
});

test('EF-237 les causes deviennent des hypotheses refutables et des cibles priorisees', () => {
  const causes = [
    { cause: 'Le marche ne decolle pas', probabilite: 3, severite: 3, criticite: 9, complet: true },
    { cause: 'Retard fournisseur', probabilite: 2, severite: 1, criticite: 2, complet: true },
    { cause: 'Cause non notee', probabilite: null, severite: null, criticite: null, complet: false },
  ];
  const r = causesToHypotheses(causes);
  assert.equal(r.hypotheses.length, 3);
  assert.equal(r.hypotheses[0].critique, true, 'criticite 9 => hypothese critique');
  assert.equal(r.hypotheses[1].critique, false);
  assert.match(r.hypotheses[0].enonce, /demontrer/, 'formulation refutable');
  assert.equal(r.cibles[0].priorite, 'haute');
  assert.equal(r.cibles[1].priorite, 'basse');
  assert.equal(r.cibles[2].priorite, 'basse');
  assert.ok(r.cibles.every((c) => c.agent === 'RedTeam'));
  assert.equal(r.nonNotees, 1, 'les causes non notees restent visibles');
});

// ==========================================================================
// Integration studio
// ==========================================================================

test('studio : ingestion -> contexte injecte dans le swarm -> retrait invalide', async () => {
  const { createCanvasStudio } = await import('./index.mjs');
  const llm = mkLLM(['- avis fonde\nVERDICT: soutient']);
  const engine = { embeddings: new Emb(), vectors: new InMemoryVectorStore(), llm, agents: {} };
  const studio = createCanvasStudio(engine, { ingestion: { sovereignty: 'local' } });

  await studio.create({ id: 'w1', nom: 'Session' });
  const ing = await studio.ingest('w1', { nom: 'etude.md', contenu: 'Le solaire en autoconsommation progresse.' });
  assert.equal(ing.ok, true);
  assert.equal(studio.quota('w1').utilise, ing.doc.taille);

  await studio.addNode('w1', { id: 'n1', titre: 'Offre solaire PME', provenance: { sourceDocId: ing.doc.id } });
  const sw = await studio.swarm('w1', 'n1', { personaIds: ['vc-sceptique', 'client-cible'] });
  assert.equal(sw.crees.length, 2);
  assert.match(llm.appels[0].messages[1].content, /Contexte disponible/, 'le contexte documentaire est injecte');

  const ret = await studio.retireDoc('w1', ing.doc.id, { by: 'geoffroy' });
  assert.equal(isSourced(getNode(ret.workspace, 'n1')), false, "l'assertion perd son etayage");
  assert.equal((await studio.contexte('w1', 'solaire')).passages.length, 0);
});

test('studio : pre-mortem puis conversion en cibles d attaque', async () => {
  const { createCanvasStudio } = await import('./index.mjs');
  const llm = mkLLM(['- Adoption trop lente | probabilite: elevee | severite: elevee']);
  const studio = createCanvasStudio({ embeddings: new Emb(), vectors: new InMemoryVectorStore(), llm, agents: {} });
  await studio.create({ id: 'w1', nom: 'S' });
  await studio.addNode('w1', { id: 'n1', titre: 'Offre solaire' });

  const pm = await studio.preMortem('w1', 'n1', { horizon: '2030' });
  const conv = causesToHypotheses(pm.causes);
  assert.equal(conv.cibles[0].priorite, 'haute');
  assert.equal(conv.hypotheses[0].critique, true);

  await assert.rejects(() => studio.framework('w1', 'n1', 'inconnu'), /inconnu/);
  await assert.rejects(() => studio.swarm('w1', 'nX'), /noeud introuvable/);
  await assert.rejects(() => studio.swarm('w1', 'n1', { personaIds: ['nexistepas'] }), /aucune persona/);
});
