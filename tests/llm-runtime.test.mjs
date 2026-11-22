// /health doit dire ce qui a *réellement* répondu, pas seulement ce qui est
// configuré. Un repli NVIDIA → Mistral était invisible : le health annonçait
// nvidia pendant que les répliques venaient de mistral.
import assert from 'node:assert/strict';
import test from 'node:test';

import { KayrosLLM, RoutingPolicy, llmRuntimeSnapshot, resetLlmRuntime } from '../core/kayros-llm.mjs';

function provider(id, behaviour) {
  return {
    id,
    async complete() {
      if (behaviour === 'fail') throw Object.assign(new Error(`${id} indisponible`), { status: 410 });
      return { text: `réponse de ${id}`, provider: id, model: `${id}-model` };
    },
  };
}

test('runtime : un succès direct note le fournisseur effectif', async () => {
  resetLlmRuntime();
  const llm = new KayrosLLM({ nvidia: provider('nvidia', 'ok') }, new RoutingPolicy({ defaultProvider: 'nvidia', fallback: [] }), {
    retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
  const res = await llm.complete({ messages: [{ role: 'user', content: 'bonjour' }], role: 'default' }, { harness: 'off' });
  assert.equal(res.provider, 'nvidia');
  const snap = llmRuntimeSnapshot();
  assert.equal(snap.effective, 'nvidia');
  assert.equal(snap.lastFallback, null);
});

test('runtime : un repli est enregistré (from/to/erreur)', async () => {
  resetLlmRuntime();
  const llm = new KayrosLLM(
    { nvidia: provider('nvidia', 'fail'), mistral: provider('mistral', 'ok') },
    new RoutingPolicy({ defaultProvider: 'nvidia', fallback: ['mistral'] }),
    { retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 } },
  );
  const res = await llm.complete({ messages: [{ role: 'user', content: 'bonjour' }], role: 'default' }, { harness: 'off' });
  assert.equal(res.provider, 'mistral');
  const snap = llmRuntimeSnapshot();
  assert.equal(snap.effective, 'mistral');
  assert.equal(snap.lastFallback.from, 'nvidia');
  assert.equal(snap.lastFallback.to, 'mistral');
  assert.match(snap.lastFallback.error, /indisponible/);
});

test('runtime : l\'instantané ne fuite aucune clé', () => {
  resetLlmRuntime();
  const snap = llmRuntimeSnapshot();
  assert.deepEqual(Object.keys(snap).sort(), ['effective', 'effectiveAt', 'lastFallback']);
});
