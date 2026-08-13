// KayrosLab -- la demo publique est branchee sur le vrai moteur.
//
// Jusqu'ici la page enchainait des prompts vers /v1/demo/chat : ce que le
// visiteur voyait n'etait pas le produit mais une imitation cote navigateur.
// Ces tests tiennent le branchement et, surtout, ce qu'il ne doit pas casser.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const DEMO = new URL('../kayroslab-complete-with-ai-agents.html', import.meta.url);
const ROUTE = new URL('../backend/fastify/routes/demo-cycle.mjs', import.meta.url);
const INDEX = new URL('../backend/fastify/index.mjs', import.meta.url);

const read = (u) => readFile(u, 'utf8');

async function demoScripts() {
  const html = await read(DEMO);
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]).filter((s) => s.trim());
  return { html, source: scripts.join('\n') };
}

test('la demo appelle le moteur, pas seulement le proxy LLM', async () => {
  const { source } = await demoScripts();
  assert.match(source, /ENGINE_URL/, 'une URL de moteur existe');
  assert.match(source, /\/cycle\/run/, 'elle pointe vers la route de cycle');
  assert.match(source, /async function runLiveEngine\(/);
  assert.match(source, /preset: 'cycle8'/, 'le preset dont les nœuds sont les huit etapes');
});

test('la projection nœud → etape est bijective', async () => {
  const { source } = await demoScripts();
  const { CYCLE8_STEPS } = await import('../core/workflow-presets.mjs');

  // Ce que la page declare.
  const bloc = source.slice(source.indexOf('const ENGINE_STEP_IDS'));
  const ids = JSON.parse(
    bloc.slice(bloc.indexOf('['), bloc.indexOf(']') + 1).replace(/'/g, '"').replace(/\s+/g, ' '),
  );
  // Ce que le moteur declare.
  const moteur = CYCLE8_STEPS.map((s) => s.id);

  assert.deepEqual(ids, moteur, 'meme identifiants, meme ordre des deux cotes');
  assert.equal(new Set(ids).size, ids.length, 'aucun doublon : la projection est injective');

  // Et le meme nombre d'etapes que l'affichage pedagogique.
  const meta = source.slice(source.indexOf('const stepMeta = ['));
  const nbEtapes = (meta.slice(0, meta.indexOf('\n];')).match(/\{ icon:/g) || []).length;
  assert.equal(ids.length, nbEtapes, 'une etape affichee par nœud, sans reste');
  assert.equal(ids.length, 8);
});

test('une etape non atteinte reste visible et signalee', async () => {
  const { source } = await demoScripts();
  const fn = source.slice(source.indexOf('function renderEngineSteps('));
  // Masquer les etapes non jouees donnerait l'illusion d'un cycle complet.
  assert.match(fn, /non atteinte/);
  assert.match(fn, /opacity-40/, 'elle est visuellement distinguee');
  assert.match(fn, /ENGINE_STEP_IDS\.map\(\)|parEtape = ENGINE_STEP_IDS\.map/,
    'le rendu part des huit etapes, pas des evenements recus');
});

test('les phases degradees sont dites, pas tues', async () => {
  const { source } = await demoScripts();
  assert.match(source, /function renderEngineSoftErrors\(/);
  assert.match(source, /Phases dégradées/);
});

test('le moteur est lance au demarrage du cycle', async () => {
  const { source } = await demoScripts();
  const begin = source.slice(source.indexOf('function beginGovernedCycle('));
  const body = begin.slice(0, begin.indexOf('\n}\n'));
  assert.match(body, /runLiveEngine\(idea\)/, 'le cycle declenche le moteur');
});

test('un moteur injoignable degrade sans casser la demonstration', async () => {
  const { source } = await demoScripts();
  const fn = source.slice(source.indexOf('async function runLiveEngine('));
  // Une demo publique qui casse vaut moins qu'une demo degradee : l'echec est
  // affiche, le parcours pas a pas continue de fonctionner.
  assert.match(fn, /catch \(e\)/, 'l’echec est rattrape');
  assert.match(fn, /Moteur injoignable/);
  assert.match(fn, /reste disponible/i, 'le repli est annonce au visiteur');
  assert.equal(/throw /.test(fn.slice(0, fn.indexOf('catch'))) && !/catch/.test(fn), false);
});

test('tout ce qui vient du moteur est echappe avant affichage', async () => {
  const { source } = await demoScripts();
  // Chaque valeur issue de l'API et inseree en HTML doit passer par esc.
  for (const champ of ['nom', 'agent', 'ev.status', "ev.gateType || ''",
    "e.phase || ''", 'final.recommendation', 'final.message', 'status']) {
    assert.ok(source.includes(`escapeHtml(${champ})`), `${champ} doit etre echappe`);
  }
  // Et rien n'est concatene brut depuis un evenement.
  const rendu = source.slice(source.indexOf('function renderEngineSteps('),
    source.indexOf('function renderEngineFinal('));
  assert.equal(/\+ ev\.(agent|nodeId|status|gateType)\b/.test(rendu), false,
    'aucune valeur d’evenement concatenee sans echappement');
});

test('la topologie reelle du graphe est montree au visiteur', async () => {
  const { source, html } = await demoScripts();
  assert.match(source, /function renderEngineGraph\(/);
  assert.match(source, /nœuds/, 'le nombre de nœuds est affiche');
  assert.match(source, /gate\(s\) humain\(s\)/, 'les gates sont visibles');
  assert.match(source, /étapes du cycle couvertes par le graphe/, 'la couverture est chiffree');
  assert.match(html, /id="engine-panel"/);
  assert.match(html, /id="engine-trace"/);
  assert.match(html, /Les huit etapes ci-dessous sont les nœuds du graphe/);
});

test('un run suspendu est presente comme tel, pas comme un echec', async () => {
  const { source } = await demoScripts();
  assert.match(source, /pending_review/);
  assert.match(source, /attend une decision humaine/i);
  assert.match(source, /vue Arbitrage/, 'la suite du parcours est nommee');
});

test('la route publique est enregistree par le serveur', async () => {
  const index = await read(INDEX);
  assert.match(index, /routes\/demo-cycle\.mjs/);
  const route = await read(ROUTE);
  // Le prefixe /v1/demo/ est ce qui exempte la route du secret partage.
  assert.match(route, /'\/v1\/demo\/cycle\/run'/);
});

test('la route publique reste bridee', async () => {
  const route = await read(ROUTE);
  // Chaque bride correspond a un cout ou a un risque precis sur une route
  // ouverte : memoire, persistance, blocage, budget.
  for (const [bride, motif] of [
    ['recall: false', 'aucune lecture memoire'],
    ['remember: false', 'aucune ecriture memoire'],
    ['positionning: false', 'aucun appel externe'],
    ['runStore: null', 'aucune persistance de run'],
    ['logSink: null', 'aucun journal disque'],
    ['waitGate: false', 'aucun blocage sur gate terminal'],
    ['waitNodeGate: false', 'aucun blocage sur gate de nœud'],
    ['maxSteps: DEMO_MAX_STEPS', 'budget de pas borne'],
    ['stepTimeoutMs: DEMO_STEP_TIMEOUT_MS', 'timeout par etape'],
  ]) {
    assert.ok(route.includes(bride), `${bride} manquant (${motif})`);
  }
  assert.match(route, /max: 5, timeWindow: '1 minute'/, 'limite de debit propre');
});

test('l’etat interne du moteur ne sort pas de la route', async () => {
  const route = await read(ROUTE);
  assert.match(route, /function publicEvent\(/, 'les evenements sont filtres');
  // Le critere est ce qui est affecte a la sortie, pas la presence du mot :
  // un commentaire qui explique la precaution n'est pas une fuite.
  assert.equal(/out\.workflowState/.test(route), false, 'l’etat complet ne sort pas');
  assert.equal(/out\.permissions/.test(route), false, 'les permissions ne sortent pas');
  assert.equal(/out\.maxAttempts/.test(route), false, 'les budgets ne sortent pas');
  // La construction est une liste blanche : chaque champ expose est nomme.
  const corps = route.slice(route.indexOf('function publicEvent'), route.indexOf('export default'));
  assert.equal(/\.\.\.event/.test(corps), false, 'aucun etalement aveugle de l’evenement');
});
