/* Fusion de deux versions du cercle : deux onglets qui écrivent en parallèle
 * ne doivent pas se supprimer mutuellement des tours.
 * Teste la vraie fonction utilisée par la route POST /v1/salon/room.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeRooms } from '../backend/fastify/lib/salon-merge.mjs';

const turn = (authorId, text, createdAt) => ({ authorId, text, createdAt, prise: `p-${authorId}` });

test('fusion : les tours des deux onglets sont conservés', () => {
  const stored = { question: 'Le rire ?', authorIds: ['voltaire', 'rousseau'], turns: [turn('voltaire', 'A', '2026-11-22T18:00:00Z')] };
  const incoming = { question: 'Le rire ?', authorIds: ['voltaire', 'rousseau'], turns: [turn('rousseau', 'B', '2026-11-22T18:00:05Z')] };
  const merged = mergeRooms(stored, incoming);
  assert.equal(merged.turns.length, 2);
  assert.deepEqual(merged.turns.map((t) => t.text), ['A', 'B']);
});

test('fusion : aucun doublon quand les deux ont le même tour', () => {
  const t = turn('voltaire', 'A', '2026-11-22T18:00:00Z');
  const merged = mergeRooms({ turns: [t] }, { turns: [{ ...t }] });
  assert.equal(merged.turns.length, 1);
});

test('fusion : ordre chronologique rétabli', () => {
  const stored = { turns: [turn('platon', 'C', '2026-11-22T18:00:10Z')] };
  const incoming = { turns: [turn('voltaire', 'A', '2026-11-22T18:00:00Z'), turn('rousseau', 'B', '2026-11-22T18:00:05Z')] };
  const merged = mergeRooms(stored, incoming);
  assert.deepEqual(merged.turns.map((t) => t.text), ['A', 'B', 'C']);
});

test('fusion : les convives sont unis sans doublon', () => {
  const merged = mergeRooms(
    { authorIds: ['voltaire', 'rousseau'], turns: [] },
    { authorIds: ['rousseau', 'montaigne'], turns: [] },
  );
  assert.deepEqual(merged.authorIds, ['voltaire', 'rousseau', 'montaigne']);
});

test('fusion : une question entrante vide ne remplace pas la question stockée', () => {
  const merged = mergeRooms({ question: 'Le rire ?', turns: [] }, { question: '', turns: [] });
  assert.equal(merged.question, 'Le rire ?');
});

test('fusion : la question entrante non vide gagne', () => {
  const merged = mergeRooms({ question: 'Le rire ?', turns: [] }, { question: 'La liberté ?', turns: [] });
  assert.equal(merged.question, 'La liberté ?');
});

test('fusion : un tour sans texte est ignoré', () => {
  const merged = mergeRooms({ turns: [] }, { turns: [{ authorId: 'voltaire', text: '   ', createdAt: '2026-11-22T18:00:00Z' }] });
  assert.equal(merged.turns.length, 0);
});

test('fusion : la prise de la version entrante est conservée', () => {
  const base = turn('voltaire', 'A', '2026-11-22T18:00:00Z');
  const merged = mergeRooms({ turns: [base] }, { turns: [{ ...base, prise: 'nouvelle prise' }] });
  assert.equal(merged.turns[0].prise, 'nouvelle prise');
});

test('fusion : un cercle vide ne casse rien', () => {
  const merged = mergeRooms(null, undefined);
  assert.deepEqual(merged.authorIds, []);
  assert.deepEqual(merged.turns, []);
});
