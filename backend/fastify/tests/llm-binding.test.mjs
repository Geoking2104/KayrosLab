// N5 / EF-23 / ENF-09 : le swarm des missions console doit utiliser le LLM du
// serveur, pas le LLM local (Ollama) du moteur créé en `sovereignty: 'local'`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../../../core/index.mjs';
import { bindEngineToServer, llmBindings } from '../lib/context.mjs';
import { buildTestApp } from './test-helpers.mjs';

function localEngine(ollamaCalls) {
  // Même configuration que context.mjs : moteur souverain local, Ollama injoignable
  // (llama3.2 non installé sur le VPS).
  return createEngine({
    sovereignty: 'local', model: 'llama3.2', ollamaEndpoint: 'http://127.0.0.1:9',
    fetchImpl: async (url) => { ollamaCalls.push(String(url)); throw new Error('connect ECONNREFUSED'); },
  });
}
const serverLlm = {
  calls: 0,
  async complete() { this.calls += 1; return { text: '{"verdict":"GO","primary_reason":"Preuves suffisantes."}', provider: 'mistral' }; },
};

test('cause N5 : sans liaison, le swarm reste sur le LLM local et retombe en [mock]', async () => {
  const ollamaCalls = [];
  const engine = localEngine(ollamaCalls);
  const run = await engine.swarm.run({ swarm_name: 'Avant', active_agents: ['cfo'] }, { question: 'Lancer ?' });
  assert.ok(ollamaCalls.length > 0, 'le swarm tente Ollama');
  assert.match(run.analyses[0].primary_reason, /^\[mock\]/);
  assert.equal(run.llm.mock, true);
  assert.match(run.analyses[0].unverified_assumptions[0], /parsable formal verdict/);
});

test('bindEngineToServer branche aussi engine.swarm (et donc hybridGateway) sur le LLM serveur', async () => {
  const ollamaCalls = [];
  const engine = localEngine(ollamaCalls);
  bindEngineToServer(engine, { llm: serverLlm });
  assert.equal(engine.swarm.llm, serverLlm);
  assert.equal(engine.hybridGateway.swarm.llm, serverLlm);
  assert.deepEqual(llmBindings(engine, serverLlm), { engine: 'server', orchestrator: 'server', agents: 'server', swarm: 'server' });

  const room = await engine.hybridGateway.createRoom({ platform: 'console', external_room_id: 'n5', name: 'N5', mode: 'always', active_agents: ['cfo', 'cto'] }, { tenantId: 't' });
  const result = await engine.hybridGateway.handleMessage({ platform: 'console', room_id: room.room_id, tenantId: 't', text: 'Lancer ?', explicit: true });
  assert.equal(ollamaCalls.length, 0, 'aucun appel Ollama');
  assert.ok(result.run.analyses.every((analysis) => analysis.llm_provider === 'mistral' && !/\[mock\]/.test(analysis.primary_reason)));
  assert.equal(result.run.consensus.verdict, 'GO');
  assert.equal(result.summary.llm.mock, false);
  assert.equal(result.thread.status, 'awaiting_arbitration');
});

test('/health expose la liaison LLM par composant (ENF-09)', async (t) => {
  const { app } = await buildTestApp();
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().llm.components, { engine: 'server', orchestrator: 'server', agents: 'server', swarm: 'server' });
  assert.equal(app.kayrosContext.engine.swarm.llm, app.kayrosContext.llm);
});
