import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENTS_EPREUVE, SEUIL_CRITIQUE, idAttaque, niveauSeverite, normalizeAttaque,
  buildContexteEprouver, criticHeuristique, devilAdvocateHeuristique, redTeamHeuristique,
  runAgent, runFutureProofing, addRun, rapportEprouver,
} from './eprouver.mjs';

const idea = {
  id: 'i1',
  construire: {
    noeuds: [{ id: 'n1', nom: 'IA' }],
    ponts: [{ id: 'p1', de: 'n1', vers: 'n2' }],
    scenarios: [{
      id: 's1', nom: 'Prudent', type: 'prudente', proposition: 'Retail augmenté par IA', cible: 'Retailers mid-market',
      metriques: ['Taux d\'adoption'], hypotheses: ['Le coût d\'acquisition reste sous 30 €', 'Les retailers adoptent en 6 mois'],
    }],
    selectionCollisions: ['coll-a--b'],
    collisions: [{ id: 'coll-a--b', concepts: ['a', 'b'], proposition: 'IA + retail' }],
  },
};

describe('Éprouver — Future Proofing multi-agents (EF-08 / F1-F5)', () => {
  it('normalizeAttaque : argument obligatoire, agent par défaut, sévérité clampée + niveau', () => {
    assert.throws(() => normalizeAttaque({}), /argument requis/);
    const a = normalizeAttaque({ agent: 'nimporte', argument: 'x', severite: 1.4 });
    assert.equal(a.agent, 'red_team'); // agent invalide → red_team par défaut
    assert.equal(a.severite, 1);
    assert.equal(a.niveau, 'critique');
    assert.equal(normalizeAttaque({ argument: 'x', severite: 0.6 }).niveau, 'moyenne');
    assert.equal(normalizeAttaque({ argument: 'x', severite: 0.2 }).niveau, 'faible');
    assert.equal(normalizeAttaque({ argument: 'x' }).niveau, null); // rien d inventé
  });

  it('idAttaque et niveauSeverite : stables et déterministes', () => {
    assert.equal(idAttaque('critic', 0), 'att-critic-0');
    assert.equal(niveauSeverite(SEUIL_CRITIQUE), 'critique');
    assert.equal(niveauSeverite(0.79), 'moyenne');
    assert.equal(niveauSeverite(null), null);
  });

  it('buildContexteEprouver extrait hypotheses/proposition/cible/metriques réels', () => {
    const ctx = buildContexteEprouver(idea);
    assert.equal(ctx.proposition, 'Retail augmenté par IA');
    assert.equal(ctx.cible, 'Retailers mid-market');
    assert.deepEqual(ctx.metriques, ['Taux d\'adoption']);
    assert.equal(ctx.hypotheses.length, 2);
    assert.equal(ctx.scenarioCount, 1);
    assert.equal(ctx.collisionCount, 1);
  });

  it('buildContexteEprouver sur idée vide : aucun contenu deviné', () => {
    const ctx = buildContexteEprouver({});
    assert.equal(ctx.proposition, null);
    assert.equal(ctx.cible, null);
    assert.deepEqual(ctx.metriques, []);
    assert.deepEqual(ctx.hypotheses, []);
  });

  it('criticHeuristique : angles morts réels, sévérité déterministe', () => {
    const attaques = criticHeuristique({});
    assert.ok(attaques.length >= 4);
    assert.ok(attaques.some((a) => a.type === 'angle_mort' && a.severite === 0.85));
    assert.ok(attaques.every((a) => a.source === 'heuristique'));
  });

  it('devilAdvocateHeuristique : conteste chaque hypothèse, bloque sans hypothèses', () => {
    const ctx = buildContexteEprouver(idea);
    const attaques = devilAdvocateHeuristique(ctx);
    assert.equal(attaques.length, 2);
    assert.ok(attaques.every((a) => a.type === 'conteste' && a.hypothese));
    const vides = devilAdvocateHeuristique({ hypotheses: [] });
    assert.equal(vides.length, 1);
    assert.equal(vides[0].type, 'absence');
    assert.equal(vides[0].severite, 0.8);
  });

  it('redTeamHeuristique : kill shots + scénarios d échec', () => {
    const ctx = buildContexteEprouver(idea);
    const attaques = redTeamHeuristique(ctx);
    assert.ok(attaques.some((a) => a.type === 'kill_shot'));
    assert.ok(attaques.some((a) => a.type === 'echec'));
  });

  it('runAgent : apport humain/LLM importé, jamais deviné à la place', async () => {
    const ctx = buildContexteEprouver(idea);
    const apport = [{ type: 'angle_mort', argument: 'Constat humain', severite: 0.3 }];
    const res = await runAgent('critic', ctx, { apport: { critic: apport } });
    assert.equal(res.length, 1);
    assert.equal(res[0].argument, 'Constat humain');
    assert.equal(res[0].source, 'humain');
    assert.equal(res[0].niveau, 'faible');
    // apport fonction (LLM) :
    const llm = await runAgent('red_team', ctx, { apport: { red_team: async () => ({ attaques: [{ argument: 'Kill shot LLM', severite: 0.9 }] }) } });
    assert.equal(llm[0].argument, 'Kill shot LLM');
    assert.equal(llm[0].niveau, 'critique');
  });

  it('runFutureProofing : timeline horodatée Critic → Devil\'s Advocate → Red Team', async () => {
    const ctx = buildContexteEprouver(idea);
    const run = await runFutureProofing(ctx);
    assert.deepEqual(run.steps.map((s) => s.agent), AGENTS_EPREUVE);
    assert.ok(run.steps.every((s) => s.ts && Array.isArray(s.attaques)));
    assert.equal(run.totalAttaques, run.attaques.length);
    assert.ok(run.totalAttaques >= 5);
    assert.equal(run.critiques, run.attaques.filter((a) => a.niveau === 'critique').length);
  });

  it('addRun : append-only horodaté, dédup par passe', () => {
    const run = { ts: '2026-08-11T00:00:00.000Z', steps: [{ agent: 'critic', attaques: [] }], attaques: [] };
    const { timeline } = addRun([], run, { by: 'geoff', ideaId: 'i1' });
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].declenchePar.by, 'geoff');
    assert.throws(() => addRun(timeline, run, { by: 'geoff' }), /deja presente/);
    assert.equal(timeline.length, 1);
  });

  it('rapportEprouver : comptages réels, red flags résiduels, vulnérabilités critiques', async () => {
    const ctx = buildContexteEprouver(idea);
    const run = await runFutureProofing(ctx);
    const { timeline } = addRun([], run, { by: 'geoff' });
    const rapport = rapportEprouver(timeline);
    assert.equal(rapport.totalPassees, 1);
    assert.equal(rapport.totalAttaques, run.totalAttaques);
    assert.ok(rapport.rendu.includes('Éprouver'));
    assert.ok(rapport.redFlags.every((f) => f.niveau !== undefined));
    const critiques = run.attaques.filter((a) => a.niveau === 'critique');
    assert.equal(rapport.bloquantes.length, critiques.length);
    // sans timeline : zéros réels, jamais devinés
    const vide = rapportEprouver([]);
    assert.equal(vide.totalAttaques, 0);
    assert.equal(vide.bloquantes.length, 0);
  });
});
