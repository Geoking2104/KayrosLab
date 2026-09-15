import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashE164,
  last4,
  normalizeE164,
  openingProtocol,
  parseInbound,
  projectTurn,
  rememberWamid,
  resolveHandle,
} from '../lib/salon-whatsapp.mjs';

test('normalise et masque le numéro', () => {
  assert.equal(normalizeE164('06 69 28 29 16'), '+33669282916');
  assert.equal(normalizeE164('+33669282916'), '+33669282916');
  assert.equal(last4('+33669282916'), '2916');
  assert.equal(hashE164('+33669282916', 'x').length, 64);
});

test('résout les handles sans créer d’identité', () => {
  const known = ['voltaire', 'rousseau', 'montaigne', 'kant'];
  assert.equal(resolveHandle('@Voltaire', known).id, 'voltaire');
  assert.equal(resolveHandle('voltair', known).id, 'voltaire');
  assert.equal(resolveHandle('hugo', known).kind, 'unknown');
});

test('parse @ et commandes', () => {
  const a = parseInbound('@voltaire l’optimisme n’est-il qu’une politesse ?');
  assert.equal(a.kind, 'address');
  assert.equal(a.handle, 'voltaire');
  assert.equal(parseInbound('laissez parler').name, 'tour');
  assert.equal(parseInbound('/fiche @kant').handle, 'kant');
  assert.equal(parseInbound('on parle entre nous').kind, 'chat');
});

test('projette un bandeau de voix', () => {
  const text = projectTurn(
    { name: 'Voltaire', handle: 'voltaire' },
    { act: 'réponse', other: 'Rousseau', body: 'Cultivez votre jardin.', cite: 'On se mit à table', work: 'Candide' },
  );
  assert.match(text, /@voltaire/);
  assert.match(text, /Candide/);
});

test('protocole d’ouverture FR', () => {
  const t = openingProtocol({ circleName: 'Lumières', question: 'Que reste-t-il ?', seats: ['voltaire', 'kant'] });
  assert.match(t, /@voltaire/);
  assert.match(t, /domaine public/);
});

test('journal wamid idempotent', async () => {
  const a = await rememberWamid('wamid.A');
  const b = await rememberWamid('wamid.A');
  assert.equal(a.fresh, true);
  assert.equal(b.fresh, false);
});
