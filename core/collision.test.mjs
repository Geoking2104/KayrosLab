import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  idCollision, distanceConcepts, dejaCollisionne, normalizeCollision,
  scoreCollision, runCollisionMode, addCollision, rapportCollision,
} from './collision.mjs';

describe('Construire Collision Mode (EF-06 / F3-F7)', () => {
  it('distanceConcepts : partage de tags → proximité, aucun → distance forte, déterministe', () => {
    assert.equal(distanceConcepts({ tags: ['ia'] }, { tags: ['ia'] }), 0);
    assert.equal(distanceConcepts({ tags: ['ia', 'retail'] }, { tags: ['retail', 'logistique'] }), 67); // jaccard 1/3
    assert.equal(distanceConcepts({ tags: ['ia'] }, { tags: ['retail'] }), 100);
    assert.equal(distanceConcepts({ tags: [] }, { tags: [] }), 100); // aucun partage mesuré
  });

  it('normalizeCollision exige 2 concepts, clamp faisabilité, id stable', () => {
    const c = normalizeCollision({ concepts: ['IA', 'Retail'], faisabilite: 120 });
    assert.equal(c.id, idCollision('IA', 'Retail'));
    assert.deepEqual(c.concepts, ['IA', 'Retail']);
    assert.equal(c.faisabilite, 100);
    assert.equal(c.proposition, null); // jamais inventée
    assert.throws(() => normalizeCollision({ concepts: ['seul'] }));
  });

  it('scoreCollision : nouveauté × faisabilité / 100, null sans faisabilité', () => {
    const c = scoreCollision(normalizeCollision({ concepts: ['a', 'b'], faisabilite: 50 }), { distance: 80 });
    assert.equal(c.nouveaute, 80);
    assert.equal(c.score, 40);
    const c2 = scoreCollision(normalizeCollision({ concepts: ['a', 'b'] }), { distance: 80 });
    assert.equal(c2.score, null);
    assert.equal(c2.nouveaute, 80);
  });

  it('runCollisionMode : paires distantes seulement, triées par score', () => {
    const concepts = [
      { id: 'c1', nom: 'IA', tags: ['ia'] },
      { id: 'c2', nom: 'Retail', tags: ['retail'] },
      { id: 'c3', nom: 'IA Retail', tags: ['ia', 'retail'] },
    ];
    const { collisions } = runCollisionMode(concepts, { plancher: 60 });
    // c1-c3 et c2-c3 partagent un tag → distance < plancher → exclus ; c1-c2 = 100
    assert.equal(collisions.length, 1);
    assert.equal(collisions[0].concepts[0], 'c1');
    assert.equal(collisions[0].nouveaute, 100);
    assert.equal(collisions[0].score, null); // pas de faisabilité fournie
  });

  it('runCollisionMode : generer() importe proposition + faisabilité (jamais devinée)', () => {
    const concepts = [{ id: 'a', nom: 'A', tags: ['x'] }, { id: 'b', nom: 'B', tags: ['y'] }];
    const { collisions } = runCollisionMode(concepts, {
      generer: ({ de, vers, distance }) => ({
        proposition: `Collision ${de.nom} × ${vers.nom}`, faisabilite: 60, framework: 'Mycelial Network',
      }),
    });
    assert.equal(collisions.length, 1);
    assert.equal(collisions[0].proposition, 'Collision A × B');
    assert.equal(collisions[0].faisabilite, 60);
    assert.equal(collisions[0].score, 60); // 100 × 60 / 100
    assert.equal(collisions[0].framework, 'Mycelial Network');
  });

  it('runCollisionMode : ignore les paires déjà liées par le réseau ou l historique', () => {
    const concepts = [{ id: 'a', nom: 'A', tags: ['x'] }, { id: 'b', nom: 'B', tags: ['y'] }];
    const reseau = { noeuds: concepts, aretes: [{ de: 'a', vers: 'b', type: 'correlation' }] };
    assert.equal(runCollisionMode(concepts, { reseau }).collisions.length, 0);
    const historique = [{ id: 'h', concepts: ['a', 'b'] }];
    assert.equal(runCollisionMode(concepts, { historique }).collisions.length, 0);
    assert.equal(dejaCollisionne(historique, 'a', 'b'), true);
  });

  it('addCollision : timeline append-only horodatée + signée, dédup', () => {
    const { timeline } = addCollision([], { concepts: ['a', 'b'], proposition: 'P' }, { by: 'comex@kayros.local', ideaId: 'idea-1' });
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].ajout.by, 'comex@kayros.local');
    assert.equal(timeline[0].ajout.ideaId, 'idea-1');
    assert.ok(timeline[0].ajout.ts);
    assert.throws(() => addCollision(timeline, { concepts: ['a', 'b'] }));
  });

  it('rapportCollision : comptages réels, jamais de moyennes inventées', () => {
    const timeline = [
      { score: 60, nouveaute: 100 },
      { score: 40, nouveaute: 80 },
      { score: null, nouveaute: 100 },
    ];
    const r = rapportCollision(timeline);
    assert.equal(r.totalIdees, 3);
    assert.equal(r.scorees, 2);
    assert.equal(r.nonScorees, 1);
    assert.equal(r.meilleurScore, 60);
    assert.equal(r.scoreMoyen, 50);
    assert.equal(r.distanceMoyenne, 93);
    assert.ok(r.rendu.includes('scorée'));
    const vide = rapportCollision([]);
    assert.equal(vide.totalIdees, 0);
    assert.equal(vide.meilleurScore, null);
    assert.equal(vide.scoreMoyen, null);
  });
});
