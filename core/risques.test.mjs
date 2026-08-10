import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { niveauRisque, enrichirRisque, addRisque, updateRisque, removeRisque, matriceRisques, detectDeclencheurs, rapportRisques } from './risques.mjs';

describe('risques (matrice EF-42)', () => {
  it('niveauRisque classe par score probabilite x impact', () => {
    assert.deepEqual(niveauRisque(0.9, 0.9), { score: 0.81, niveau: 'critique' });
    assert.deepEqual(niveauRisque(0.7, 0.7), { score: 0.49, niveau: 'eleve' });
    assert.deepEqual(niveauRisque(0.6, 0.5), { score: 0.3, niveau: 'moyen' });
    assert.deepEqual(niveauRisque(0.2, 0.2), { score: 0.04, niveau: 'faible' });
  });

  it('addRisque enrichit (id, score, niveau, statut) et est idempotent par id', () => {
    let l = addRisque([], { libelle: 'Concurrent', probabilite: 0.8, impact: 0.6 });
    assert.equal(l.length, 1);
    assert.equal(l[0].id, 'r1');
    assert.equal(l[0].score, 0.48);
    assert.equal(l[0].niveau, 'eleve');
    assert.equal(l[0].statut, 'actif');
    l = addRisque(l, { id: 'r1', libelle: 'Concurrent', probabilite: 0.9, impact: 0.9 });
    assert.equal(l.length, 1);
    assert.equal(l[0].score, 0.81);
  });

  it('updateRisque recalcule et valide le statut', () => {
    let l = addRisque([], { id: 'rX', libelle: 'Reglementaire', probabilite: 0.5, impact: 0.5 });
    l = updateRisque(l, 'rX', { probabilite: 0.95, impact: 0.95 });
    assert.equal(l[0].niveau, 'critique');
    l = updateRisque(l, 'rX', { statut: 'traite' });
    assert.equal(l[0].statut, 'traite');
    assert.throws(() => updateRisque(l, 'rX', { statut: 'nimporte' }));
  });

  it('removeRisque retire l entree', () => {
    const l = addRisque([{ id: 'keep', probabilite: 0.5, impact: 0.5 }], { id: 'drop', probabilite: 0.5, impact: 0.5 });
    assert.equal(removeRisque(l, 'drop').length, 1);
  });

  it('matriceRisques compte les cases 5x5 et la distribution', () => {
    const l = [
      { probabilite: 0.9, impact: 0.9 },
      { probabilite: 0.1, impact: 0.1 },
      { probabilite: 0.95, impact: 0.95 },
    ].map((r, i) => enrichirRisque(r, { index: i }));
    const m = matriceRisques(l);
    assert.equal(m.total, 3);
    assert.equal(m.grille['5x5'], 2);
    assert.equal(m.distribution.critique, 2);
    assert.equal(m.distribution.faible, 1);
  });

  it('detectDeclencheurs signale les risques actifs au-dessus du seuil', () => {
    const l = [
      { id: 'a', libelle: 'Big bang', probabilite: 0.95, impact: 0.9 },   // 0.855 -> declenche
      { id: 'b', libelle: 'Timing', probabilite: 0.3, impact: 0.5 },      // 0.15  -> non
      { id: 'c', libelle: 'Traite', probabilite: 0.95, impact: 0.9, statut: 'traite' }, // exclu
    ].map((r, i) => enrichirRisque(r, { index: i }));
    const d = detectDeclencheurs(l);
    assert.equal(d.necessaire, true);
    assert.deepEqual(d.declenchements.map((x) => x.id), ['a']);
    assert.match(d.raisons[0], /Big bang/);
  });

  it('rapportRisques agrege matrice + declencheurs', () => {
    const r = rapportRisques([{ id: 'a', probabilite: 0.9, impact: 0.9 }]);
    assert.equal(r.matrice.total, 1);
    assert.equal(r.declencheurs.necessaire, true);
  });
});
