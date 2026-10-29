import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_SYSTEM_PROMPT, HARNESS_MARKER, HARNESS_EXAMPLE_QUERY, withHarness, hasHarness, checkCompliance } from './agent-harness.mjs';
import { KayrosLLM, RoutingPolicy } from './kayros-llm.mjs';
import { speakWithModel } from './impersonator-voice.mjs';

test('withHarness préfixe le bloc système, idempotent, fusionne un système existant', () => {
  const a = withHarness([{ role: 'user', content: 'x' }]);
  assert.equal(a[0].role, 'system'); assert.ok(a[0].content.startsWith(HARNESS_MARKER));
  assert.equal(withHarness(a), a);
  const b = withHarness([{ role: 'system', content: 'Tu es le CFO.' }, { role: 'user', content: 'x' }]);
  assert.equal(b.length, 2); assert.match(b[0].content, /Tu es le CFO\.$/); assert.ok(hasHarness(b));
  for (const k of ['Local-first', 'pair-à-pair', 'builder-first', 'point de défaillance unique', 'faisabilité']) assert.ok(HARNESS_SYSTEM_PROMPT.includes(k), k);
});

function capture(text) {
  const seen = [];
  const provider = { id: 'nvidia', async complete(req) { seen.push(req); return { text, provider: 'nvidia', model: req.model }; } };
  const policy = new RoutingPolicy(); policy.choose = () => 'nvidia'; policy.modelFor = () => null;
  return { llm: new KayrosLLM({ nvidia: provider }, policy, { retry: { maxRetries: 0 } }), seen };
}

test('KayrosLLM injecte le harnais dans tout appel et note la conformité', async () => {
  const { llm, seen } = capture('```ts\ntype Op = { id: string; clock: number }\n```\nCRDT local-first sur WebRTC.');
  const res = await llm.complete({ role: 'planner', messages: [{ role: 'user', content: HARNESS_EXAMPLE_QUERY }] });
  assert.ok(hasHarness(seen[0].messages));
  assert.equal(seen[0].messages.at(-1).content, HARNESS_EXAMPLE_QUERY);
  assert.equal(res.compliance.compliant, true, JSON.stringify(res.compliance));
});

test('opt-out harness:false : aucun bloc, aucune notation', async () => {
  const { llm, seen } = capture('ok');
  const res = await llm.complete({ harness: false, messages: [{ role: 'user', content: 'ping' }] });
  assert.equal(hasHarness(seen[0].messages), false); assert.equal(res.compliance, undefined);
});

test('checkCompliance signale les trois écarts de la checklist', () => {
  const bad = checkCompliance('Bien sûr ! Voici un aperçu stratégique : hébergeons tout sur AWS avec DynamoDB et une API centralisée.');
  assert.deepEqual(bad.flags.sort(), ['architectural_default', 'directness', 'output_type']);
  const lockinNamed = checkCompliance('```sql\nCREATE TABLE ops(id text);\n```\nS3 en option, mais attention au lock-in : réplication P2P par défaut.');
  assert.equal(lockinNamed.compliant, true);
  assert.deepEqual(checkCompliance('En résumé, la vision stratégique est claire.').flags.sort(), ['directness', 'output_type']);
});

test('voix persona : Output Type non applicable, compliance remontée par speakWithModel', async () => {
  assert.equal(checkCompliance('Simulation — Quel gain, et pour quand ?', { role: 'impersonator_voice' }).compliant, true);
  assert.deepEqual(checkCompliance('Simulation — Bien sûr, excellente idée !', { role: 'impersonator_voice' }).flags, ['directness']);
  const { llm, seen } = capture('Simulation — Quel gain, et pour quand ? Donnez-moi une recommandation, pas des options.');
  const out = await speakWithModel(llm, { disc: { primary: 'D' } }, 'Offre premium');
  assert.ok(hasHarness(seen[0].messages));
  if (out.source === 'model') assert.equal(out.compliance.version, 'kayros-harness/1');
});
