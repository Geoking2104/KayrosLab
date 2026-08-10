import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFuturGate, setGatesFuturs, gatesFutursStatus, dueGates, materialiserGate } from './gates-futurs.mjs';

const FUTUR = '2030-01-01';
const PASSE = '2020-01-01';
const now = () => new Date('2026-08-01');

describe('gates futurs (EF-45)', () => {
  it('normalizeFuturGate valide la date et applique les defauts', () => {
    const g = normalizeFuturGate({ libelle: 'Gate COMEX rollout', date: '2027-05-01', questions: ['OK?'] }, { index: 0 });
    assert.equal(g.id, 'gf1');
    assert.equal(g.type, 'comex_arbitrage');
    assert.equal(g.requiredRole, 'comex');
    assert.equal(g.statut, 'planifie');
    assert.ok(!Number.isNaN(new Date(g.date).getTime()));
    assert.throws(() => normalizeFuturGate({ libelle: 'x' }));
    assert.throws(() => normalizeFuturGate({ libelle: 'x', date: 'pas-une-date' }));
  });

  it('setGatesFuturs remplace la liste de la roadmap', () => {
    const roadmap = { jalons: [], gatesFuturs: [] };
    const out = setGatesFuturs(roadmap, [{ libelle: 'A', date: FUTUR }, { libelle: 'B', date: PASSE }]);
    assert.equal(out.gatesFuturs.length, 2);
    assert.equal(out.gatesFutursCount, 2);
    assert.equal(roadmap.gatesFuturs.length, 0); // immuable
  });

  it('gatesFutursStatus distingue a venir / dus / materialises', () => {
    const gates = [
      normalizeFuturGate({ libelle: 'A', date: PASSE }),
      normalizeFuturGate({ libelle: 'B', date: FUTUR }),
      materialiserGate(normalizeFuturGate({ libelle: 'C', date: PASSE }), { gateId: 'g-real' }),
    ];
    const s = gatesFutursStatus(gates, { now });
    assert.equal(s.aVenir, 1);
    assert.equal(s.dus, 1);
    assert.equal(s.materialises, 1);
    assert.equal(s.items.find((x) => x.id === 'gf1').enRetard, true);
  });

  it('dueGates retourne les gates dus non materialises', () => {
    const gates = [
      normalizeFuturGate({ libelle: 'A', date: PASSE }),
      normalizeFuturGate({ libelle: 'B', date: FUTUR }),
      materialiserGate(normalizeFuturGate({ libelle: 'C', date: PASSE }), { gateId: 'g-real' }),
    ];
    const dus = dueGates(gates, { now });
    assert.equal(dus.length, 1);
    assert.equal(dus[0].libelle, 'A');
  });

  it('materialiserGate marque avec le gateId du vrai gate', () => {
    const g = materialiserGate(normalizeFuturGate({ libelle: 'A', date: PASSE }), { gateId: 'g-x' });
    assert.equal(g.statut, 'materialise');
    assert.equal(g.materialise.gateId, 'g-x');
    assert.throws(() => materialiserGate(g, {}));
  });
});
