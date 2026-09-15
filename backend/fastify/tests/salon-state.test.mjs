import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTestApp, bearer, registerComex } from './test-helpers.mjs';
import { SalonStateStore, sanitizeSalonState, safeUserKey } from '../lib/salon-state.mjs';

describe('Salon : mémoire par compte', () => {
  it('refuse un identifiant pathologique', () => {
    assert.throws(() => safeUserKey('../etc/passwd'), /identifiant/);
    assert.equal(safeUserKey('user-abc_1'), 'user-abc_1');
  });

  it('borne le payload et force la locale', () => {
    const state = sanitizeSalonState({
      locale: 'de',
      rooms: [{ id: 'lumieres', name: 'Lumières', question: '?', authorIds: ['voltaire'], turns: [{ text: 'bonjour', origin: 'user' }] }],
      extra: 'drop-me',
    });
    assert.equal(state.locale, 'fr');
    assert.equal(state.rooms[0].turns[0].text, 'bonjour');
    assert.equal(state.rooms[0].turns[0].origin, 'user');
    assert.equal(state.extra, undefined);
  });

  it('écrit un fichier par utilisateur, sans se mélanger', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'salon-state-'));
    const store = new SalonStateStore({ dir });
    await store.put('alice', { locale: 'en', rooms: [{ id: 'a', name: 'A', question: '', authorIds: [], turns: [] }] });
    await store.put('bob', { locale: 'fr', rooms: [{ id: 'b', name: 'B', question: '', authorIds: [], turns: [] }] });
    const alice = await store.get('alice');
    const bob = await store.get('bob');
    assert.equal(alice.locale, 'en');
    assert.equal(alice.rooms[0].id, 'a');
    assert.equal(bob.rooms[0].id, 'b');
    const disk = JSON.parse(await readFile(join(dir, 'alice.json'), 'utf8'));
    assert.equal(disk.rooms[0].id, 'a');
  });

  let app, ctx;
  beforeEach(async () => {
    const built = await buildTestApp();
    app = built.app;
    ctx = built.ctx;
  });
  afterEach(async () => { if (app) await app.close(); });

  it('exige un jeton et isole les mémoires', async () => {
    const naked = await app.inject({ method: 'GET', url: '/v1/salon/state' });
    assert.equal(naked.statusCode, 401);

    await registerComex(ctx, { email: 'a@test.local', password: 'secret1234', name: 'A' });
    await ctx.auth.register({ email: 'b@test.local', password: 'secret1234', name: 'B', role: 'contributeur', tenantId: 't1' });
    const tokA = await bearer(ctx, 'a@test.local', 'secret1234');
    const tokB = await bearer(ctx, 'b@test.local', 'secret1234');

    const putA = await app.inject({
      method: 'PUT',
      url: '/v1/salon/state',
      headers: { authorization: `Bearer ${tokA}` },
      payload: {
        state: {
          locale: 'en',
          rooms: [{
            id: 'lumieres',
            name: 'Enlightenment',
            question: 'What remains of freedom?',
            authorIds: ['voltaire', 'rousseau'],
            turns: [{ id: 't1', authorId: 'user', text: 'secret-of-a', origin: 'user', act: 'adresse', to: 'voltaire', createdAt: '2026-09-10T10:00:00.000Z', citations: [] }],
          }],
        },
      },
    });
    assert.equal(putA.statusCode, 200, putA.body);
    assert.equal(putA.json().state.locale, 'en');
    assert.equal(putA.json().state.rooms[0].turns[0].text, 'secret-of-a');

    const getB = await app.inject({
      method: 'GET',
      url: '/v1/salon/state',
      headers: { authorization: `Bearer ${tokB}` },
    });
    assert.equal(getB.statusCode, 200);
    const bRooms = getB.json().state.rooms || [];
    assert.equal(bRooms.some((room) => room.turns?.some((turn) => turn.text === 'secret-of-a')), false);

    const getA = await app.inject({
      method: 'GET',
      url: '/v1/salon/state',
      headers: { authorization: `Bearer ${tokA}` },
    });
    assert.equal(getA.json().state.rooms[0].turns[0].text, 'secret-of-a');
  });
});
