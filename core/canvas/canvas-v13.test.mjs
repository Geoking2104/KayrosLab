// KayrosLab — Canvas v13 : workflows, recherche unifiee, voix, CLI.
// EF-204/205, EF-248 a EF-256.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseYAML, loadWorkflow, validateWorkflow, WorkflowEngine, evaluerConditions,
  DECLENCHEURS, ACTIONS, ACTIONS_INTERDITES_WORKFLOW, WORKFLOW_EXEMPLE,
} from './workflow.mjs';
import { UnifiedIndex, indexerTout, entree, normaliser, repondreAvecRecus, TYPES_INDEXABLES } from './search.mjs';
import { VoiceService, segmenterTranscription, transcriptionVersNoeuds } from './voice.mjs';
import { TokenStore, executer, executerLot, schema, COMMANDES } from './cli.mjs';
import { createWorkspace, createNode, addNode } from './model.mjs';
import { InMemoryCanvasRepository } from './repository.mjs';
import { InMemoryVectorStore } from '../memory.mjs';

/**
 * Embedder de test. La perturbation liee au texte est INDISPENSABLE : sans
 * elle, deux textes tombant sur le meme axe ont un cosinus de 1 exactement, ce
 * qu'aucun modele reel ne produit — et les tests de seuil deviendraient faux.
 */
class Emb {
  async embed(t) {
    const s = String(t).toLowerCase();
    const axes = ['solaire', 'mobilite', 'budget', 'autre'];
    const v = axes.map((a) => (s.includes(a) ? 1 : 0));
    if (!v.some(Boolean)) v[3] = 1;
    const h = [...s].reduce((n, c) => (n + c.charCodeAt(0)) % 89, 0);
    const out = v.map((x, i) => x + (i === h % axes.length ? 0.08 : 0.01));
    const n = Math.hypot(...out) || 1;
    return out.map((x) => x / n);
  }
  async embedBatch(ts) { return Promise.all(ts.map((t) => this.embed(t))); }
}
const mkLLM = (t) => ({ appels: [], async complete(r) { this.appels.push(r); return { text: typeof t === 'function' ? t(r) : t, usage: {} }; } });

// ==========================================================================
// EF-248 — parseur YAML
// ==========================================================================

test('EF-248 le parseur lit mappings, sequences, scalaires et commentaires', () => {
  const y = parseYAML(`
# commentaire ignore
nom: Test
actif: true
seuil: 8
ratio: 0.5
vide: null
liste: [a, b, 3]
imbrique:
  cle: valeur
  sous:
    profond: 1
sequence:
  - premier
  - second
`);
  assert.equal(y.nom, 'Test');
  assert.equal(y.actif, true);
  assert.equal(y.seuil, 8);
  assert.equal(y.ratio, 0.5);
  assert.equal(y.vide, null);
  assert.deepEqual(y.liste, ['a', 'b', 3]);
  assert.equal(y.imbrique.sous.profond, 1);
  assert.deepEqual(y.sequence, ['premier', 'second']);
});

test('EF-248 une sequence de mappings est correctement structuree', () => {
  const y = parseYAML(`
actions:
  - type: swarm
    cible: n1
  - type: notify
    canal: webhook
`);
  assert.equal(y.actions.length, 2);
  assert.deepEqual(y.actions[0], { type: 'swarm', cible: 'n1' });
  assert.deepEqual(y.actions[1], { type: 'notify', canal: 'webhook' });
});

test('EF-248 les chaines quotees preservent leur contenu', () => {
  const y = parseYAML(`a: "avec: deux points"\nb: 'simple'\nc: "123"`);
  assert.equal(y.a, 'avec: deux points');
  assert.equal(y.b, 'simple');
  assert.equal(y.c, '123', 'une chaine quotee reste une chaine');
});

test('EF-248 le non-supporte leve une erreur explicite, jamais une interpretation fausse', () => {
  assert.throws(() => parseYAML('a: &ancre valeur'), /ancres/);
  assert.throws(() => parseYAML('a: |\n  bloc'), /blocs litteraux/);
  assert.throws(() => parseYAML('a: 1\n---\nb: 2'), /multi-documents/);
  assert.throws(() => parseYAML('a:\n\tb: 1'), /tabulation/);
  assert.equal(parseYAML(''), null);
  assert.equal(parseYAML('# que des commentaires'), null);
});

// ==========================================================================
// EF-249 / EF-250 / EF-251 — schema et garde-fou
// ==========================================================================

test('EF-249 le workflow de reference se charge et expose ses declencheurs', () => {
  const wf = loadWorkflow(WORKFLOW_EXEMPLE);
  assert.equal(wf.declencheur.type, 'score.threshold');
  assert.equal(wf.declencheur.seuil, 8);
  assert.equal(wf.actions.length, 3);
  assert.equal(wf.conditions.length, 2);
  assert.ok(DECLENCHEURS.includes('webhook'));
  assert.ok(ACTIONS.includes('red-team'));
});

test('EF-249 la validation collecte toutes les erreurs, pas seulement la premiere', () => {
  const v = validateWorkflow({ declencheur: { type: 'inexistant' }, actions: [] });
  assert.equal(v.ok, false);
  assert.ok(v.erreurs.length >= 3, 'nom manquant + declencheur inconnu + aucune action');
  assert.ok(v.erreurs.some((e) => /nom/.test(e)));
  assert.ok(v.erreurs.some((e) => /declencheur inconnu/.test(e)));
});

test('EF-249 les declencheurs parametres exigent leurs parametres', () => {
  assert.ok(validateWorkflow({ nom: 'X', declencheur: { type: 'schedule' }, actions: [{ type: 'notify' }] })
    .erreurs.some((e) => /cron/.test(e)));
  assert.ok(validateWorkflow({ nom: 'X', declencheur: { type: 'score.threshold' }, actions: [{ type: 'notify' }] })
    .erreurs.some((e) => /seuil/.test(e)));
});

test('EF-251 un workflow ne peut pas resoudre un gate ni voter un veto', () => {
  for (const interdite of ACTIONS_INTERDITES_WORKFLOW) {
    const v = validateWorkflow({ nom: 'X', declencheur: { type: 'node.created' }, actions: [{ type: interdite }] });
    assert.equal(v.ok, false, `${interdite} doit etre refusee`);
    assert.ok(v.erreurs.some((e) => /EF-251/.test(e)));
  }
  assert.throws(() => loadWorkflow('nom: X\ndeclencheur:\n  type: node.created\nactions:\n  - type: veto\n'), /invalide/);
});

test('EF-251 ouvrir un gate reste permis — convoquer une decision n est pas la prendre', () => {
  const v = validateWorkflow({ nom: 'X', declencheur: { type: 'node.created' }, actions: [{ type: 'gate.open' }] });
  assert.equal(v.ok, true);
});

test('EF-251 la barriere est refaite a l execution, pas seulement au chargement', async () => {
  let appele = false;
  const moteur = new WorkflowEngine({ actions: { 'gate.resolve': async () => { appele = true; } } });
  // Enregistrement force, en contournant la validation — un appelant malveillant.
  moteur._wf.push({ nom: 'Contournement', declencheur: { type: 'node.created' }, actions: [{ type: 'gate.resolve' }] });
  const r = await moteur.traiter({ type: 'node.created', donnees: {} });
  assert.equal(appele, false, "l'action interdite n'est jamais executee");
  assert.equal(r.declenches[0].resultats[0].ok, false);
  assert.match(r.declenches[0].resultats[0].motif, /EF-251/);
});

// ==========================================================================
// Conditions
// ==========================================================================

test('les conditions couvrent les operateurs et refusent un champ absent', () => {
  const ctx = { noeud: { type: 'idee', titre: 'Offre solaire' }, score: { impact: 9 } };
  assert.equal(evaluerConditions([{ champ: 'noeud.type', operateur: 'eq', valeur: 'idee' }], ctx).ok, true);
  assert.equal(evaluerConditions([{ champ: 'score.impact', operateur: 'gte', valeur: 8 }], ctx).ok, true);
  assert.equal(evaluerConditions([{ champ: 'score.impact', operateur: 'lt', valeur: 5 }], ctx).ok, false);
  assert.equal(evaluerConditions([{ champ: 'noeud.titre', operateur: 'contient', valeur: 'SOLAIRE' }], ctx).ok, true);
  assert.equal(evaluerConditions([{ champ: 'noeud.type', operateur: 'dans', valeur: ['idee', 'question'] }], ctx).ok, true);

  const absent = evaluerConditions([{ champ: 'inexistant.champ', operateur: 'eq', valeur: 1 }], ctx);
  assert.equal(absent.ok, false, 'un champ absent ne declenche pas par defaut');
  assert.match(absent.details[0].motif, /absent/);

  assert.equal(evaluerConditions(null, ctx).ok, true, 'sans condition, le declencheur suffit');
  assert.match(evaluerConditions([{ champ: 'a', operateur: 'zzz', valeur: 1 }], { a: 1 }).details[0].motif, /operateur inconnu/);
});

// ==========================================================================
// Moteur
// ==========================================================================

test('EF-250 le moteur execute les actions branchees et trace le resultat', async () => {
  const vus = [];
  const audit = [];
  const moteur = new WorkflowEngine({
    actions: {
      'red-team': async (a) => { vus.push('red-team'); return { cible: a.cible }; },
      notify: async () => { vus.push('notify'); return { envoye: true }; },
      'gate.open': async () => { vus.push('gate.open'); return { gateId: 'g1' }; },
    },
    onAudit: (t) => audit.push(t),
  });
  moteur.registerYAML(WORKFLOW_EXEMPLE);

  const r = await moteur.traiter(
    { type: 'score.threshold', donnees: { noeud: { id: 'n1', type: 'idee' }, score: { impact: 9 } } },
  );
  assert.equal(r.declenches.length, 1);
  assert.deepEqual(vus, ['red-team', 'notify', 'gate.open']);
  assert.ok(r.declenches[0].resultats.every((x) => x.ok));
  assert.equal(audit.length, 1, "l'audit recoit la trace");
});

test('le moteur ignore un workflow dont les conditions ne passent pas', async () => {
  const moteur = new WorkflowEngine({ actions: { 'red-team': async () => ({}), notify: async () => ({}), 'gate.open': async () => ({}) } });
  moteur.registerYAML(WORKFLOW_EXEMPLE);
  const r = await moteur.traiter({ type: 'score.threshold', donnees: { noeud: { type: 'question' }, score: { impact: 9 } } });
  assert.equal(r.declenches.length, 0);
  assert.equal(r.ignores.length, 1);
  assert.match(r.ignores[0].motif, /conditions/);
});

test("l'echec d'une action n'empeche pas les suivantes", async () => {
  const moteur = new WorkflowEngine({
    actions: {
      'red-team': async () => { throw new Error('LLM indisponible'); },
      notify: async () => ({ envoye: true }),
      'gate.open': async () => ({ gateId: 'g1' }),
    },
  });
  moteur.registerYAML(WORKFLOW_EXEMPLE);
  const r = await moteur.traiter({ type: 'score.threshold', donnees: { noeud: { type: 'idee' }, score: { impact: 9 } } });
  const res = r.declenches[0].resultats;
  assert.equal(res[0].ok, false);
  assert.equal(res[1].ok, true, "l'alerte part malgre l'echec precedent");
  assert.equal(res[2].ok, true);
});

test('une action non branchee est signalee, un workflow inactif est ignore', async () => {
  const moteur = new WorkflowEngine({ actions: {} });
  moteur.register({ nom: 'A', declencheur: { type: 'node.created' }, actions: [{ type: 'swarm' }] });
  moteur.register({ nom: 'B', actif: false, declencheur: { type: 'node.created' }, actions: [{ type: 'swarm' }] });
  const r = await moteur.traiter({ type: 'node.created', donnees: {} });
  assert.equal(r.declenches.length, 1, 'le workflow inactif ne se declenche pas');
  assert.match(r.declenches[0].resultats[0].motif, /non branchee/);
  assert.throws(() => moteur.register({ nom: 'C' }), /invalide/);
});

// ==========================================================================
// EF-252 / EF-253 / EF-254 — recherche unifiee
// ==========================================================================

function corpus() {
  let ws = createWorkspace({ id: 'w1', nom: 'Atelier' });
  ws = addNode(ws, createNode({ id: 'n1', titre: 'Offre solaire pour PME', corps: 'autoconsommation' }));
  ws = addNode(ws, createNode({ id: 'n2', titre: 'Risque budget', corps: 'cout eleve', authorKind: 'agent', authorId: 'Critic' }));
  return ws;
}

test('EF-252 indexerTout agrege des sources heterogenes en entrees homogenes', () => {
  const ws = corpus();
  const e = indexerTout({
    workspace: ws,
    commentaires: [{ id: 'c1', texte: 'Bonne piste', by: 'geoffroy', ts: '2026-01-01T00:00:00Z' },
                   { id: 'c2', texte: 'supprime', supprime: { by: 'x' } }],
    idees: [{ id: 'i1', title: 'Idee promue', intake: { valeur: 'solaire' }, tenantId: 'default', updatedAt: '2026-01-02T00:00:00Z' }],
    journal: [{ seq: 3, type: 'gate.open', workspaceId: 'w1', payload: { motif: 'arbitrage' }, ts: '2026-01-03T00:00:00Z', hash: 'h3' }],
    documents: [{ id: 'd1', nom: 'etude.pdf', workspaceId: 'w1', ingestedAt: '2026-01-01T00:00:00Z' },
                { id: 'd2', nom: 'retire.pdf', workspaceId: 'w1', retiredAt: '2026-01-04T00:00:00Z' }],
  });
  const types = new Set(e.map((x) => x.type));
  assert.ok(types.has('node') && types.has('agent-output') && types.has('comment') && types.has('idea') && types.has('gate') && types.has('source'));
  assert.equal(e.filter((x) => x.type === 'comment').length, 1, 'un commentaire supprime ne remonte pas');
  assert.equal(e.filter((x) => x.type === 'source').length, 1, 'une source retiree sort de l index');
  assert.equal(e.find((x) => x.id === 'n2').type, 'agent-output', "la production d'agent est distinguee");
  assert.throws(() => entree({ id: 'x', type: 'inconnu', texte: 'a' }), /non indexable/);
  assert.ok(TYPES_INDEXABLES.includes('transition'));
});

test('EF-253 la recherche hybride rend lexical et semantique separement', async () => {
  const idx = new UnifiedIndex({ embeddings: new Emb() });
  await idx.indexer(indexerTout({ workspace: corpus() }));

  const lex = await idx.chercher('solaire', { alpha: 0 });
  assert.ok(lex.length >= 1);
  assert.ok(lex[0].lexical > 0);
  assert.equal(lex[0].semantique, 0, 'en pur lexical, le score semantique reste nul');

  const hyb = await idx.chercher('solaire', { alpha: 0.5 });
  assert.ok(hyb[0].semantique > 0, 'le score semantique est expose separement');
  assert.equal(hyb[0].entree.id, 'n1');
});

test('EF-253 les filtres par type, auteur et periode s appliquent', async () => {
  const idx = new UnifiedIndex({ embeddings: new Emb() });
  await idx.indexer(indexerTout({ workspace: corpus() }));
  assert.equal((await idx.chercher('budget', { types: ['agent-output'] }))[0].entree.auteur, 'Critic');
  assert.equal((await idx.chercher('budget', { types: ['node'] })).length, 0, 'le filtre de type exclut');
  assert.equal((await idx.chercher('budget', { auteur: 'Critic' })).length >= 1, true);
  assert.equal((await idx.chercher('budget', { workspaceId: 'autre' })).length, 0, 'isolation par espace');
  assert.equal((await idx.chercher('motinexistantxyz', { alpha: 0 })).length, 0, 'en lexical pur, rien ne correspond');
});

test('EF-253 une requete sans rapport remonte quand meme des voisins semantiques', async () => {
  const idx = new UnifiedIndex({ embeddings: new Emb() });
  await idx.indexer(indexerTout({ workspace: corpus() }));
  // Un espace vectoriel n'a pas de notion de « rien ne correspond » : c'est un
  // comportement a connaitre, pas un bug. Le seuil sert a le couper.
  const bruit = await idx.chercher('motinexistantxyz', { alpha: 1, seuilSemantique: 0 });
  assert.ok(bruit.length > 0, 'sans plancher, la recherche semantique renvoie toujours des voisins');
  assert.equal(bruit[0].lexical, 0, 'le score lexical nul revele que rien ne correspond litteralement');
  assert.equal(
    (await idx.chercher('motinexistantxyz', { alpha: 1, seuilSemantique: 0.999 })).length, 0,
    'le plancher coupe le bruit',
  );
});

test('normaliser ignore casse et accents', () => {
  assert.equal(normaliser('Éprouvé'), 'eprouve');
  assert.equal(normaliser(null), '');
});

test('EF-254 la reponse avec recus cite les elements et declare son statut', async () => {
  const idx = new UnifiedIndex({ embeddings: new Emb() });
  await idx.indexer(indexerTout({ workspace: corpus() }));

  const llm = mkLLM('Le cout est juge eleve [1].');
  const r = await repondreAvecRecus(idx, 'budget', { llm });
  assert.equal(r.sourced, true);
  assert.equal(r.recus.length, 1);
  assert.match(llm.appels[0].messages[0].content, /Cite chaque element/);

  const sans = await repondreAvecRecus(idx, 'budget', { llm: mkLLM('Le cout est eleve.') });
  assert.equal(sans.sourced, false);
  assert.match(sans.motif, /aucun element cite/);

  const invente = await repondreAvecRecus(idx, 'budget', { llm: mkLLM('Voir [1] et [9].') });
  assert.equal(invente.sourced, false);
  assert.deepEqual(invente.inventees, [9]);
});

test('EF-254 sans element pertinent, aucune reponse n est fabriquee', async () => {
  const idx = new UnifiedIndex({ embeddings: new Emb() });
  const llm = mkLLM('reponse inventee');
  const r = await repondreAvecRecus(idx, 'question sans corpus', { llm });
  assert.equal(r.texte, null);
  assert.equal(r.sourced, false);
  assert.equal(llm.appels.length, 0);
});

// ==========================================================================
// EF-204 / EF-205 — voix
// ==========================================================================

test('EF-205 sans moteur local, la fonction est desactivee et non basculee', async () => {
  const cloud = { local: false, transcribe: async () => ({ texte: 'contenu' }) };
  const svc = new VoiceService({ transcriber: cloud, sovereignty: 'local' });
  const d = svc.disponibilite();
  assert.equal(d.disponible, false);
  assert.match(d.motif, /desactivee/);
  const r = await svc.transcrire('audio');
  assert.equal(r.ok, false, 'aucun envoi vers le cloud en palier souverain');

  assert.equal(new VoiceService({}).disponibilite().disponible, false);
});

test('EF-205 un moteur local est accepte en palier souverain', async () => {
  const local = { local: true, transcribe: async () => ({ texte: 'une idee dite a voix haute' }) };
  const svc = new VoiceService({ transcriber: local, sovereignty: 'local' });
  assert.equal(svc.disponibilite().disponible, true);
  const r = await svc.transcrire('audio');
  assert.equal(r.ok, true);
  assert.equal(r.local, true);
});

test('EF-205 une panne de transcription est rendue, pas masquee', async () => {
  const casse = { local: true, transcribe: async () => { throw new Error('modele absent'); } };
  const r = await new VoiceService({ transcriber: casse, sovereignty: 'local' }).transcrire('a');
  assert.equal(r.ok, false);
  assert.match(r.motif, /modele absent/);

  const vide = { local: true, transcribe: async () => ({ texte: '   ' }) };
  assert.match((await new VoiceService({ transcriber: vide }).transcrire('a')).motif, /vide/);
});

test('EF-204 la transcription est segmentee en concepts, pas versee en bloc', () => {
  const texte = "On pourrait lancer une offre solaire pour les PME. Le retour sur investissement serait de trois ans. "
    + "Ensuite je pense a la mobilite partagee en zone rurale. Le besoin est reel mais le modele reste a trouver.";
  const s = segmenterTranscription(texte);
  assert.equal(s.length, 2, 'deux concepts distincts, pas un bloc');
  assert.match(s[0].titre, /offre solaire/);
  assert.match(s[1].titre, /mobilite partagee/);
  assert.ok(s[0].corps.startsWith('- '), 'le detail est mis en puces');
  assert.deepEqual(segmenterTranscription(''), []);
  assert.deepEqual(segmenterTranscription('trop court'), []);
});

test('EF-204 les noeuds issus de la voix sont attribues a un humain et traces', () => {
  const n = transcriptionVersNoeuds('Une premiere idee assez developpee ici. Un complement utile. Ensuite une seconde idee bien distincte. Avec son detail propre.');
  assert.ok(n.length >= 2);
  assert.equal(n[0].authorKind, 'human', "la voix est celle d'un humain, pas d'un agent");
  assert.equal(n[0].meta.origine, 'voix');
  assert.equal(n[0].provenance.origine, 'transcription');
});

// ==========================================================================
// EF-255 / EF-256 — CLI
// ==========================================================================

function mkStudio() {
  const repo = new InMemoryCanvasRepository();
  return {
    repo,
    async create(o) { const { createWorkspace: c } = { createWorkspace }; return repo.save(c(o)); },
    async addNode(id, n) {
      const ws = await repo.get(id);
      if (!ws) throw new Error(`addNode: workspace introuvable "${id}"`);
      return repo.save(addNode(ws, createNode(n)));
    },
    async search() { return []; },
  };
}

test('EF-256 un jeton inconnu, revoque ou hors perimetre est refuse', async () => {
  const tokens = new TokenStore();
  tokens.emettre({ token: 't1', agentId: 'a1', workspaces: ['w1'], scopes: ['read'] });
  const studio = mkStudio();

  assert.equal((await executer({ cmd: 'workspace.list', token: 'inconnu' }, { studio, tokens })).error.motif, 'jeton inconnu');
  assert.match((await executer({ cmd: 'node.add', token: 't1', args: { workspaceId: 'w1' } }, { studio, tokens })).error.motif, /lecture seule/);
  assert.match((await executer({ cmd: 'workspace.get', token: 't1', args: { workspaceId: 'w9' } }, { studio, tokens })).error.motif, /non habilite/);

  tokens.revoquer('t1');
  assert.match((await executer({ cmd: 'workspace.list', token: 't1' }, { studio, tokens })).error.motif, /revoque/);
  assert.equal(tokens.revoquer('inexistant'), false);
});

test('EF-256 un jeton sans espace n accede a rien — pas de « tous » par omission', async () => {
  const tokens = new TokenStore();
  tokens.emettre({ token: 't', agentId: 'a1', scopes: ['write'] });
  const r = await executer({ cmd: 'workspace.get', token: 't', args: { workspaceId: 'w1' } }, { studio: mkStudio(), tokens });
  assert.match(r.error.motif, /non habilite/);
  assert.throws(() => tokens.emettre({ token: 'x', agentId: 'a', scopes: ['admin'] }), /portee inconnue/);
  assert.throws(() => tokens.emettre({ token: 'x' }), /agentId requis/);
});

test('EF-256 un jeton en ecriture ne franchit pas la frontiere de gouvernance', async () => {
  const tokens = new TokenStore();
  tokens.emettre({ token: 't', agentId: 'a1', workspaces: ['w1'], scopes: ['read', 'write'] });
  for (const cmd of ['gate.resolve', 'veto']) {
    const r = await executer({ cmd, token: 't', args: { workspaceId: 'w1' } }, { studio: mkStudio(), tokens });
    assert.equal(r.ok, false, `${cmd} doit rester refusee`);
    assert.equal(r.error.code, 'INTERDIT');
  }
});

test('EF-255 une commande inconnue et une erreur metier renvoient du JSON, jamais une exception', async () => {
  const tokens = new TokenStore();
  tokens.emettre({ token: 't', agentId: 'a1', workspaces: ['w1'], scopes: ['read', 'write'] });
  const studio = mkStudio();

  const inconnue = await executer({ cmd: 'nimporte.quoi', token: 't' }, { studio, tokens });
  assert.equal(inconnue.error.code, 'CMD_INCONNUE');

  const absente = await executer({ cmd: 'workspace.get', token: 't', args: { workspaceId: 'w1' } }, { studio, tokens });
  assert.equal(absente.error.code, 'INTROUVABLE');

  const erreur = await executer({ cmd: 'node.add', token: 't', args: { workspaceId: 'w1', node: { titre: 'X' } } }, { studio, tokens });
  assert.equal(erreur.ok, false);
  assert.match(erreur.error.motif, /introuvable/);
});

test('EF-255 parcours complet : creation, ajout attribue a l agent, lecture', async () => {
  const tokens = new TokenStore();
  tokens.emettre({ token: 't', agentId: 'agent-cli', workspaces: ['w1'], scopes: ['read', 'write'] });
  const studio = mkStudio();

  assert.equal((await executer({ cmd: 'workspace.create', token: 't', args: { id: 'w1', nom: 'Via CLI' } }, { studio, tokens })).ok, true);
  const ajout = await executer({ cmd: 'node.add', token: 't', args: { workspaceId: 'w1', node: { id: 'n1', titre: 'Idee' } } }, { studio, tokens });
  assert.equal(ajout.ok, true);
  const n = ajout.data.nodes.find((x) => x.id === 'n1');
  assert.equal(n.authorId, 'agent-cli');
  assert.equal(n.authorKind, 'agent', "la production est attribuee a l'agent, pas anonyme");
});

test('EF-255 un lot JSONL continue apres une ligne fautive', async () => {
  const tokens = new TokenStore();
  tokens.emettre({ token: 't', agentId: 'a1', workspaces: ['w1'], scopes: ['read', 'write'] });
  const studio = mkStudio();
  const r = await executerLot(
    ['{"cmd":"workspace.create","token":"t","args":{"id":"w1","nom":"A"}}',
     'ceci n est pas du json',
     '{"cmd":"workspace.get","token":"t","args":{"workspaceId":"w1"}}'].join('\n'),
    { studio, tokens },
  );
  assert.equal(r.length, 3);
  assert.equal(r[0].ok, true);
  assert.equal(r[1].error.code, 'JSON_INVALIDE');
  assert.equal(r[2].ok, true, 'le lot se poursuit apres la ligne fautive');
});

test('EF-255 le schema est auto-descriptif pour un appelant LLM', () => {
  const s = schema();
  assert.ok(s.commandes.length >= 15);
  assert.ok(s.commandes.every((c) => c.nom && c.scope));
  assert.match(s.note, /EF-243/);
  assert.equal(COMMANDES['gate.resolve'].action, 'gate.resolve');
});
