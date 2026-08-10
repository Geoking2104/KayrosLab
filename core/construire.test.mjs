import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  idScenario, normalizeScenario, canvasConstruire, scenarioCanvas,
  addScenario, updateScenario, removeScenario, rapportConstruire,
} from './construire.mjs';

describe('Construire (EF-05 / F1)', () => {
  it('normalizeScenario valide nom/type, dedupe listes, id stable par nom', () => {
    const s = normalizeScenario({
      nom: 'Retail augmenté', type: 'rupture', hypotheses: ['h1', 'h1', ' h2 '],
      metriques: ['m1', 'm1'], noeuds: ['n1', 'n1', 'n2'], ponts: ['p1'],
    });
    assert.equal(s.id, idScenario('Retail augmenté'));
    assert.deepEqual(s.hypotheses, ['h1', 'h2']);
    assert.deepEqual(s.metriques, ['m1']);
    assert.deepEqual(s.noeuds, ['n1', 'n2']);
    assert.deepEqual(s.ponts, ['p1']);
    assert.throws(() => normalizeScenario({ nom: '  ' }));
    assert.throws(() => normalizeScenario({ nom: 'x', type: 'autre' }));
  });

  it('canvasConstruire se construit depuis la selection Cartographier (payload F6)', () => {
    const selection = {
      destination: 'construire',
      noeuds: [{ id: 'tend-1', nom: 'IA générative' }, { id: 'tend-2', nom: 'Retail' }],
      ponts: [{ id: 'pont-a--b', de: 'ia', vers: 'retail' }],
      ts: '2026-08-01T00:00:00.000Z',
    };
    const c = canvasConstruire(selection);
    assert.equal(c.noeuds.length, 2);
    assert.equal(c.noeuds[0].nom, 'IA générative');
    assert.equal(c.ponts[0].de, 'ia');
    assert.equal(c.ts, selection.ts);
    assert.deepEqual(canvasConstruire(null, { noeuds: ['n1'], ponts: ['p1'] }).noeuds[0].id, 'n1');
  });

  it('addScenario dedupe par id et compose le canvas', () => {
    const selection = { noeuds: [{ id: 'n1', nom: 'N1' }], ponts: [] };
    const canvas = canvasConstruire(selection);
    const r1 = addScenario(canvas, { nom: 'Scénario A', type: 'prudente' });
    assert.equal(r1.canvas.scenarios.length, 1);
    assert.equal(r1.scenario.type, 'prudente');
    assert.throws(() => addScenario(r1.canvas, { nom: 'Scénario A' }));
    const r2 = addScenario(r1.canvas, { nom: 'Scénario B' });
    assert.equal(r2.canvas.scenarios.length, 2);
  });

  it('updateScenario merge et re-normalise, id preserve', () => {
    let canvas = addScenario(canvasConstruire(null), { nom: 'A' }).canvas;
    const r = updateScenario(canvas, idScenario('A'), { type: 'optimiste', hypotheses: ['h'] });
    assert.equal(r.scenario.type, 'optimiste');
    assert.equal(r.scenario.nom, 'A');
    assert.deepEqual(r.scenario.hypotheses, ['h']);
    assert.throws(() => updateScenario(canvas, 'scen-inconnu', {}));
  });

  it('removeScenario retire et protege contre les ids inconnus', () => {
    let canvas = addScenario(addScenario(canvasConstruire(null), { nom: 'A' }).canvas, { nom: 'B' }).canvas;
    const r = removeScenario(canvas, idScenario('A'));
    assert.equal(r.canvas.scenarios.length, 1);
    assert.throws(() => removeScenario(canvas, 'scen-inconnu'));
  });

  it('rapportConstruire aggrege comptages reels + types', () => {
    let canvas = addScenario(canvasConstruire({ noeuds: [{ id: 'n1' }], ponts: [{ id: 'p1' }] }), { nom: 'A', type: 'rupture' }).canvas;
    canvas = addScenario(canvas, { nom: 'B' }).canvas;
    const r = rapportConstruire(canvas);
    assert.equal(r.totalScenarios, 2);
    assert.equal(r.totalNoeuds, 1);
    assert.equal(r.totalPonts, 1);
    assert.equal(r.types.find((t) => t.type === 'rupture').count, 1);
    assert.ok(r.rendu.includes('scenario(s)'));
  });

  it('rapportConstruire sur canvas vide : comptages a zero, jamais devines', () => {
    const r = rapportConstruire(undefined);
    assert.equal(r.totalScenarios, 0);
    assert.equal(r.totalNoeuds, 0);
    assert.deepEqual(scenarioCanvas().noeuds, []);
  });
});
