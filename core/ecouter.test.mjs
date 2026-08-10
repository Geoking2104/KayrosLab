import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  idSignal, normalizeSignal, freshnessScore, scoreSignal, reductionBruit,
  renderNoiseReduction, promoteSignal, clusterSignals, rapportEcoute,
} from './ecouter.mjs';

const NOW = '2026-08-01T00:00:00.000Z';
const now = () => new Date(NOW);

describe('Écouter (EF-01 / EF-02)', () => {
  it('normalizeSignal valide contenu/date, dedupe tags, id canonique stable', () => {
    const s = normalizeSignal({ contenu: '  IA générative dans le retail  ', source: 'presse', date: '2026-07-01', tags: ['ia', 'retail', 'ia'] });
    assert.equal(s.contenu, 'IA générative dans le retail');
    assert.equal(s.source, 'presse');
    assert.deepEqual(s.tags, ['ia', 'retail']);
    assert.equal(s.qualifie, false);
    assert.equal(s.id, idSignal({ source: 'presse', contenu: 'IA générative dans le retail' }));
    assert.throws(() => normalizeSignal({ contenu: '   ' }));
    assert.throws(() => normalizeSignal({ contenu: 'x', date: 'pas-une-date' }));
  });

  it('idSignal dedupe : même (source, contenu) → même id', () => {
    assert.equal(idSignal({ source: 'web', contenu: 'A' }), idSignal({ source: 'web', contenu: 'A' }));
    assert.notEqual(idSignal({ source: 'web', contenu: 'A' }), idSignal({ source: 'web', contenu: 'B' }));
    assert.notEqual(idSignal({ source: 'web', contenu: 'A' }), idSignal({ source: 'x', contenu: 'A' }));
  });

  it('freshnessScore : déterministe, récent → 100, âgé → décroît', () => {
    assert.equal(freshnessScore(NOW, { now }).score, 100);
    const unJour = freshnessScore('2026-07-31', { now });
    assert.equal(unJour.ageJours, 1);
    assert.ok(unJour.score > 95 && unJour.score < 100, `score ${unJour.score}`);
    const q = freshnessScore('2026-05-02', { now });                 // ~91 jours
    assert.ok(q.score < 50 && q.score > 30, `score ${q.score}`);
    const an = freshnessScore('2025-08-01', { now });                // 1 an
    assert.ok(an.score <= 3, `score ${an.score}`);
  });

  it('scoreSignal : note = moyenne pondérée des dimensions renseignées', () => {
    const s = normalizeSignal({ contenu: 'A', date: NOW });
    const res = scoreSignal(s, { pertinence: 90, impact: 50, now });
    // 90*0.5 + 100*0.25 + 50*0.25 = 82.5 → 83
    assert.equal(res.note, 83);
    assert.equal(res.dimensions.length, 3);
    const p = res.dimensions.find((d) => d.dimension === 'pertinence');
    assert.equal(p.score, 90);
    assert.ok(res.explication.includes('Note 83/100'));
    assert.ok(p.raison.includes('90/100'));
  });

  it('scoreSignal : aucune note inventée si rien n est renseigné — fraîcheur seule reste expliquée', () => {
    const vieux = normalizeSignal({ contenu: 'A', date: '2025-08-01' });
    const res = scoreSignal(vieux, { now });
    assert.ok(res.note != null);                 // fraicheur = dim réelle
    assert.equal(res.dimensions.length, 1);      // seule la fraicheur
    assert.equal(res.dimensions[0].dimension, 'fraicheur');
    assert.ok(res.dimensions[0].raison.includes('décroissance exponentielle'));
  });

  it('reductionBruit : sous le seuil masqué mais conservé (réversible), sans note jamais masqué', () => {
    const signaux = [
      { id: 'a', contenu: 'fort', note: 80 },
      { id: 'b', contenu: 'faible', note: 20 },
      { id: 'c', contenu: 'sans note' },
    ];
    const r = reductionBruit(signaux, { seuil: 50 });
    assert.deepEqual(r.conserves.map((s) => s.id), ['a', 'c']);
    assert.deepEqual(r.masques.map((s) => s.id), ['b']);
    assert.equal(r.conservesCount, 2);
    assert.equal(r.masquesCount, 1);
    assert.equal(reductionBruit(signaux, { seuil: 10 }).masques.length, 0); // réversible
  });

  it('renderNoiseReduction résume en clair', () => {
    const r = reductionBruit([{ id: 'a', contenu: 'x', note: 80 }], { seuil: 50 });
    const rendu = renderNoiseReduction(r);
    assert.match(rendu, /seuil 50/);
    assert.match(rendu, /1 signal\(s\) conservé\(s\), 0 masqué\(s\)/);
  });

  it('promoteSignal : qualifie + horodaté + signé, double promotion refusée', () => {
    const s = normalizeSignal({ contenu: 'A', source: 'x' });
    const q = promoteSignal(s, { by: 'stratege@kayros.local', ideaId: 'i1' });
    assert.equal(q.qualifie, true);
    assert.equal(q.promote.by, 'stratege@kayros.local');
    assert.equal(q.promote.ideaId, 'i1');
    assert.ok(q.promote.ts);
    assert.equal(s.qualifie, false); // immuable
    assert.throws(() => promoteSignal(q, { by: 'x@y' }));
    assert.throws(() => promoteSignal(s, {}));
  });

  it('clusterSignals regroupe par tag (+ non_tagué) et par source', () => {
    const l = [
      { id: 'a', tags: ['ia'], source: 'web' },
      { id: 'b', tags: ['ia', 'retail'], source: 'web' },
      { id: 'c', tags: [], source: 'presse' },
    ];
    const parTag = clusterSignals(l);
    assert.equal(parTag.find((c) => c.tag === 'ia').count, 2);
    assert.equal(parTag.find((c) => c.tag === 'non_tagué').ids[0], 'c');
    const parSource = clusterSignals(l, { by: 'source' });
    assert.equal(parSource.find((c) => c.tag === 'web').count, 2);
  });

  it('rapportEcoute aggrège reduction + clusters + rendu', () => {
    const signaux = [
      normalizeSignal({ contenu: 'A', tags: ['ia'] }),
      normalizeSignal({ contenu: 'B', tags: ['retail'] }),
    ].map((s, i) => ({ ...s, note: i === 0 ? 80 : 10 }));
    const r = rapportEcoute(signaux, { seuil: 50 });
    assert.equal(r.total, 2);
    assert.equal(r.reduction.masquesCount, 1);
    assert.equal(r.clusters.length, 2);
    assert.ok(r.rendu.includes('seuil 50'));
  });
});
