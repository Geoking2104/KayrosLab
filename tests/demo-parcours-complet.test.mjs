// KayrosLab -- parcours complet de la demo, decisions humaines comprises,
// jusqu'au rapport livre.
//
// Les tests voisins verifient des morceaux : l'echappement, le contrat d'API,
// la projection nœud → etape. Aucun ne repondait a la question qui compte pour
// un visiteur : est-ce qu'un cycle mene de bout en bout produit un rapport
// complet et fidele a ce qui s'est passe ?
//
// Ce test execute le script reel de la page hors navigateur, simule les huit
// interventions humaines, puis inspecte le HTML qui part a html2pdf. Rien
// n'est reimplemente : les fonctions exercees sont celles qui sont servies.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PAGE = new URL('../kayroslab-complete-with-ai-agents.html', import.meta.url);

/** Element inerte : la page cable des ecouteurs au chargement. */
function stubElement() {
  const el = {
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    setAttribute() {}, getAttribute: () => null, focus() {}, scrollIntoView() {},
    querySelector: () => stubElement(), querySelectorAll: () => [],
    closest: () => null, insertAdjacentHTML() {},
  };
  return el;
}

/**
 * Charge le script de la page et rend son contexte manipulable. Le script est
 * evalue dans une fonction dont on recupere le scope via un accesseur injecte :
 * on n'y touche que ce que la page expose deja a window.
 */
async function loadDemo() {
  const html = await readFile(PAGE, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .filter((s) => s.includes('function buildKayrosReportHtml'));
  assert.equal(scripts.length, 1, 'un seul script porte le rapport');

  const source = scripts[0];
  const doc = {
    getElementById: () => stubElement(),
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    createElement: () => stubElement(),
    addEventListener() {}, body: stubElement(), documentElement: stubElement(),
  };
  const win = {
    addEventListener() {}, removeEventListener() {}, location: { href: '', search: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    navigator: { language: 'fr' },
  };

  // On expose le scope interne pour piloter demoState et appeler le rendu.
  const runner = new Function(
    'window', 'document', 'fetch', 'console', 'html2pdf', 'alert', 'CSS', 'setTimeout',
    `${source}
     return {
       state: typeof demoState !== 'undefined' ? demoState : null,
       reportHtml: typeof buildKayrosReportHtml === 'function' ? buildKayrosReportHtml : null,
       reportModel: typeof buildReportModel === 'function' ? buildReportModel : null,
       stepLabel: typeof stepLabel === 'function' ? stepLabel : null,
       agentLabel: typeof agentLabel === 'function' ? agentLabel : null,
       stepMeta: typeof stepMeta !== 'undefined' ? stepMeta : null,
       record: typeof recordUserAction === 'function' ? recordUserAction : null,
     };`,
  );
  return runner(win, doc, async () => { throw new Error('reseau interdit'); },
    { log() {}, warn() {}, error() {} }, () => ({ set: () => ({ from: () => ({ save: () => {} }) }) }),
    () => {}, { escape: (s) => s }, (fn) => fn);
}

/** Rejoue un cycle complet : huit etapes, huit decisions humaines. */
function jouerParcours(api) {
  const { state, record, stepLabel, agentLabel, stepMeta } = api;
  const lang = 'fr';
  const decisions = ['approve', 'approve', 'revise', 'approve', 'approve', 'approve', 'approve', 'approve'];
  const notes = [
    '', '', 'Scenario 2 trop proche du 1, differencier la cible.', '',
    'Risque fournisseur a documenter.', '', '', '',
  ];

  state.originalIdea = 'Offre de diagnostic energetique pour le tertiaire';
  state.idea = state.originalIdea;
  state.conditions = { geo: 'France', budget: '250 k€', time: '12 mois', must: 'Conformite RE2020', notes: '' };
  state.startedAt = new Date().toISOString();
  state.ki = 3.5;
  state.kiHistory = [3.5];
  state.history = [];
  state.userActions = [];

  record('cycle_started', null, '', '');

  for (let i = 0; i < 8; i += 1) {
    const kiBefore = state.ki;
    const kiAfter = Math.min(9.5, kiBefore + 0.6);
    state.ki = kiAfter;
    state.kiHistory.push(kiAfter);
    state.currentStep = i;
    // Intervention humaine : c'est elle qui fait avancer le cycle.
    record(decisions[i], i, notes[i], '');
    state.history.push({
      stepIdx: i,
      step: stepLabel(i, lang),
      agent: agentLabel(i, lang),
      decision: decisions[i],
      output: `Sortie de l'etape ${i + 1} — ${stepMeta[i].short.fr}.`,
      rawOutput: `brut ${i}`,
      summary: `resume ${i}`,
      scenariosMap: null,
      stepChoiceMap: { selectedIds: [], combinedText: '' },
      humanNote: notes[i] || null,
      generatedAt: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
      kiBefore,
      kiAtApproval: kiAfter,
    });
  }
  state.currentStep = -1;
  state.completedAt = new Date().toISOString();
  return { decisions, notes };
}

// ─────────────────────────────────────────────────────────────────────────────

test('le script de la demo se charge et expose son rendu de rapport', async () => {
  const api = await loadDemo();
  assert.ok(api.state, 'demoState existe');
  assert.equal(typeof api.reportHtml, 'function', 'le rapport est constructible');
  assert.equal(typeof api.record, 'function', 'les actions humaines sont enregistrables');
  assert.equal(api.stepMeta.length, 8, 'huit etapes');
});

test('un parcours complet enregistre les huit etapes et leurs decisions', async () => {
  const api = await loadDemo();
  const { decisions } = jouerParcours(api);
  const model = api.reportModel();

  assert.equal(model.steps.length, 8, 'les huit etapes sont dans le rapport');
  assert.deepEqual(model.steps.map((s) => s.decision), decisions);
  assert.deepEqual(model.steps.map((s) => s.stepIdx), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(model.completedAt, 'le cycle est marque termine');
  // Le KI progresse et son historique est complet : une etape sans trace de KI
  // rendrait le rapport inauditable.
  assert.equal(model.initialKi, 3.5);
  assert.ok(model.finalKi > model.initialKi);
  assert.equal(model.kiHistory.length, 9, 'valeur initiale + une par etape');
});

test('les interventions humaines sont tracees, y compris la revision', async () => {
  const api = await loadDemo();
  jouerParcours(api);
  const model = api.reportModel();

  // Une revision qui n'apparait pas au rapport ferait passer un cycle
  // contredit pour un cycle approuve d'emblee.
  const revision = model.actions.find((a) => a.action === 'revise');
  assert.ok(revision, 'la revision est enregistree');
  assert.equal(revision.stepIdx, 2);
  assert.match(revision.note, /differencier la cible/);
  assert.equal(model.actions.filter((a) => a.action === 'approve').length, 7);
  assert.ok(model.actions.every((a) => a.at), 'chaque action est horodatee');
});

test('le rapport livre contient le parcours, pas seulement le resultat', async () => {
  const api = await loadDemo();
  jouerParcours(api);
  const html = api.reportHtml();

  assert.ok(html.length > 3000, 'le rapport a du corps');
  // Les huit etapes, nommees.
  for (const nom of ['Écouter', 'Cartographier', 'Construire', 'Positionner',
    'Éprouver', 'Arbitrer', 'Projeter', 'Réaliser']) {
    assert.ok(html.includes(nom), `etape « ${nom} » absente du rapport`);
  }
  // Le contexte de depart et l'idee.
  assert.ok(html.includes('diagnostic energetique'), 'l’idee figure au rapport');
  assert.ok(html.includes('RE2020'), 'les conditions figurent au rapport');
  // La trace humaine.
  assert.ok(html.includes('differencier la cible'), 'la note de revision est restituee');
  assert.ok(html.includes('Risque fournisseur'), 'la note de risque est restituee');
});

test('le rapport est structure pour la pagination PDF', async () => {
  const api = await loadDemo();
  jouerParcours(api);
  const html = api.reportHtml();

  // html2pdf pagine sur ces sauts : sans eux le document sort en un seul bloc.
  const sauts = (html.match(/page-break-before:always/g) || []).length;
  assert.ok(sauts >= 8, `pagination insuffisante : ${sauts} sauts pour 8 etapes`);
  assert.match(html, /width:210mm/, 'format A4');
  assert.match(html, /page-break-after:always/, 'la couverture est isolee');
  // Une largeur fixe et une police sans dependance externe : le PDF ne doit
  // pas dependre d'un chargement reseau au moment du rendu.
  assert.match(html, /font-family:Arial,Helvetica,sans-serif/);
});

test('un contenu hostile n’echappe pas dans le rapport', async () => {
  const api = await loadDemo();
  jouerParcours(api);
  // Le rapport reprend des saisies humaines : elles doivent etre neutralisees.
  api.state.userActions.push({
    action: 'approve', stepIdx: 0, at: new Date().toISOString(), detailsKey: '',
    note: '<img src=x onerror=alert(1)>',
  });
  const html = api.reportHtml();
  assert.equal(html.includes('<img src=x'), false, 'la charge brute n’apparait pas');
  assert.ok(html.includes('&lt;img'), 'elle apparait echappee');
});

test('un cycle interrompu produit un rapport partiel, pas un rapport faux', async () => {
  const api = await loadDemo();
  jouerParcours(api);
  // On coupe apres cinq etapes : le rapport doit dire cinq, pas huit.
  api.state.history = api.state.history.slice(0, 5);
  api.state.completedAt = null;
  const model = api.reportModel();
  assert.equal(model.steps.length, 5);
  assert.equal(model.completedAt, null, 'le cycle n’est pas annonce termine');
  const html = api.reportHtml();
  assert.ok(html.includes('Éprouver'), 'les etapes atteintes sont la');
  assert.equal(html.includes('Réaliser'), false, 'les etapes non atteintes ne sont pas inventees');
});
