import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  idTendance, normalizeTendance, buildReseau, centralite, zonesTension,
  horizonEffectif, etiqueterHorizons, distanceClusters, dejaLie, suggestPonts,
  scorePont, sendNetworkSelectionToScenario, rapportCartographie,
} from './cartographier.mjs';

const T = (nom, extra = {}) => ({ nom, ...extra });

describe('Cartographier (EF-03 / EF-04)', () => {
  it('normalizeTendance valide nom/horizon et dedupe tags', () => {
    const t = normalizeTendance(T('IA générative', { horizon: 'court', tags: ['ia', 'retail', 'ia'] }));
    assert.equal(t.id, idTendance('IA générative'));
    assert.deepEqual(t.tags, ['ia', 'retail']);
    assert.equal(t.horizon, 'court');
    assert.throws(() => normalizeTendance({ nom: '  ' }));
    assert.throws(() => normalizeTendance(T('x', { horizon: 'demain' })));
  });

  it('buildReseau normalise les noeuds et ne garde que les aretes valides/dedupliquees', () => {
    const reseau = buildReseau(
      [T('A'), T('B'), T('C')],
      [{ de: 'a', vers: 'b', type: 'causalite' }, { de: 'a', vers: 'b', type: 'causalite' }, { de: 'zz', vers: 'b' }, { de: 'a', vers: 'a' }],
    );
    // ids sont des hashes, pas 'a'/'b' : les aretes invalides sont ecartees.
    assert.equal(reseau.noeuds.length, 3);
    assert.equal(reseau.aretes.length, 0);
    const r2 = buildReseau([T('A'), T('B')], [{ de: idTendance('A'), vers: idTendance('B'), type: 'opposition' }]);
    assert.equal(r2.aretes.length, 1);
    assert.equal(r2.aretes[0].type, 'opposition');
    assert.equal(r2.aretes[0].id, `${idTendance('A')}|opposition|${idTendance('B')}`);
  });

  it('centralite identifie les pivots (noeuds leviers)', () => {
    const A = idTendance('A'), B = idTendance('B'), C = idTendance('C');
    const reseau = { noeuds: [{ id: A }, { id: B }, { id: C }], aretes: [
      { id: '1', de: A, vers: B }, { id: '2', de: A, vers: C }, { id: '3', de: B, vers: C },
    ] };
    const c = centralite(reseau);
    assert.deepEqual(c.pivots, [A, B, C]); // tous degre 2
    assert.equal(c.degres[A], 2);
  });

  it('zonesTension ne liste que les aretes d opposition', () => {
    const A = idTendance('A'), B = idTendance('B');
    const reseau = { noeuds: [{ id: A }, { id: B }], aretes: [
      { id: '1', de: A, vers: B, type: 'opposition' },
      { id: '2', de: A, vers: B, type: 'correlation' },
    ] };
    const z = zonesTension(reseau);
    assert.equal(z.length, 1);
    assert.equal(z[0].de, A);
  });

  it('horizonEffectif : renseigne > derive d une date > null', () => {
    const now = () => new Date('2026-08-01');
    assert.equal(horizonEffectif({ horizon: 'long' }, { now }), 'long');
    assert.equal(horizonEffectif({ date: '2026-01-01' }, { now }), 'court');   // 7 mois
    assert.equal(horizonEffectif({ date: '2024-01-01' }, { now }), 'moyen');   // 31 mois
    assert.equal(horizonEffectif({ date: '2023-01-01' }, { now }), 'long');    // 43 mois
    assert.equal(horizonEffectif({}, { now }), null);
    assert.equal(etiqueterHorizons([{ horizon: 'moyen' }, {}], { now })[1].horizonEffectif, null);
  });

  it('distanceClusters mesure la distance reelle entre clusters', () => {
    const l = [T('A', { tags: ['ia', 'sante'] }), T('B', { tags: ['ia', 'retail'] })];
    const d = distanceClusters(l, 'ia', 'sante');
    assert.equal(d.distance, Math.round(100 * (1 - 2 / 3))); // partage partiel de tags
    const d2 = distanceClusters(l, 'ia', 'ia');
    assert.equal(d2.distance, 0);
  });

  it('suggestPonts : ponts entre clusters distants uniquement, nouveaute deterministe', () => {
    const l = [
      T('A', { tags: ['ia'] }),
      T('B', { tags: ['retail'] }),
      T('C', { tags: ['logistique'] }),
    ];
    const ponts = suggestPonts(l, { plancher: 100, plausibilite: null });
    assert.equal(ponts.length, 3); // paires 2 a 2, toutes distantes
    assert.equal(ponts[0].distance, 100);
    assert.equal(ponts[0].nouveaute, 100);
    assert.equal(ponts[0].plausibilite, null);
    assert.equal(ponts[0].score, null); // pas de note invente sans plausibilite
    assert.ok(ponts[0].justification.includes('tag(s) commun(s) sur'));
  });

  it('suggestPonts ignore les paires deja liees par une arete', () => {
    const l = [T('A', { tags: ['ia'] }), T('B', { tags: ['retail'] })];
    const reseau = { noeuds: l.map((t) => normalizeTendance(t)), aretes: [] };
    reseau.aretes.push({ id: `${reseau.noeuds[0].id}|correlation|${reseau.noeuds[1].id}`, de: reseau.noeuds[0].id, vers: reseau.noeuds[1].id, type: 'correlation' });
    const ponts = suggestPonts(l, { reseau, plancher: 100 });
    assert.equal(ponts.length, 0);
    assert.equal(dejaLie(reseau, 'ia', 'retail'), true);
  });

  it('scorePont applique nouveaute x plausibilite / 100', () => {
    const p = { nouveaute: 80, de: 'a', vers: 'b' };
    assert.equal(scorePont(p, { plausibilite: 50 }).score, 40);
    assert.equal(scorePont(p).plausibilite, null);
    assert.equal(scorePont(p).score, null);
  });

  it('sendNetworkSelectionToScenario produit le payload pour Construire', () => {
    const { payload } = sendNetworkSelectionToScenario({ noeuds: [{ id: 'n1' }], ponts: [{ id: 'p1' }] });
    assert.equal(payload.destination, 'construire');
    assert.equal(payload.noeuds[0].id, 'n1');
    assert.equal(payload.ponts[0].id, 'p1');
    assert.ok(payload.ts);
  });

  it('rapportCartographie aggrege reseau + centralite + tensions + ponts', () => {
    const A = idTendance('A'), B = idTendance('B');
    const reseau = { noeuds: [normalizeTendance(T('A')), normalizeTendance(T('B'))], aretes: [{ id: '1', de: A, vers: B, type: 'opposition' }] };
    const r = rapportCartographie(reseau, { ponts: [{ id: 'p1' }] });
    assert.equal(r.totalNoeuds, 2);
    assert.equal(r.totalAretes, 1);
    assert.equal(r.zonesTension.length, 1);
    assert.equal(r.ponts.length, 1);
    assert.equal(r.reseau.noeuds[0].horizonEffectif, null); // rien n est devine
  });
});
