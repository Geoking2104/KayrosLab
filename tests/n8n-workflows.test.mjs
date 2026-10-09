// Workflows n8n du PoC Salesforce (integrations/n8n) : JSON importable, en phase
// avec le générateur, sans secret, et code des nœuds « Code » exécuté ici contre
// de vraies signatures KayrosLab (core/integrations/webhooks.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import {
  launchWorkflow, eventsWorkflow, CONFIG_CODE, LAUNCH_RESULT_CODE, PREPARE_CODE, VERIFY_CODE,
} from '../integrations/n8n/tools/build-workflows.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const FILES = {
  'integrations/n8n/workflows/salesforce-opportunity-review.json': launchWorkflow,
  'integrations/n8n/workflows/kayroslab-verdict-to-salesforce.json': eventsWorkflow,
};

// Signature identique à core/integrations/webhooks.mjs (signPayload).
function sign(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex')}`;
}
// Exécute le code d'un nœud Code n8n (mode « une fois pour tous les éléments »).
function runCode(code, items, { staticData = {}, nodes = {} } = {}) {
  const $input = { all: () => items.map((json) => ({ json })) };
  const $ = (name) => ({ itemMatching: (index) => ({ json: nodes[name][index] }), item: { json: nodes[name][0] } });
  return new AsyncFunction('$input', '$getWorkflowStaticData', '$', code)($input, () => staticData, $);
}
// Chaîne complète du workflow 2 : préparer → HMAC (nœud Crypto) → vérifier.
async function verifyChain(secret, headers, body, staticData = {}) {
  const prepared = await runCode(PREPARE_CODE, [{ headers, body }]);
  const withHmac = prepared.map(({ json }) => ({ ...json, expected_signature: createHmac('sha256', secret).update(json.signed_payload, 'utf8').digest('hex') }));
  return runCode(VERIFY_CODE, withHmac, { staticData });
}

const event = {
  event: 'mission.completed', event_id: 'evt_123', occurred_at: '2026-10-09T15:20:00.000Z', tenant_id: 't1',
  mission_id: 'msn_abc', status: 'awaiting_arbitration', state: 'completed', collective_id: 'room_1', question: 'Signer ACME ?', profile: 'fast',
  external_ref: { system: 'salesforce', object: 'Opportunity', id: '0065g00000XyZab', url: null },
  verdict: 'NO_GO', verdict_label: 'NO GO', summary: 'Marge insuffisante — « remise » trop forte.',
  risks: ['Marge < 12 %'], conditions: ['Plafonner la remise'], clarification_questions: [],
  agents: [{ agent_id: 'cfo', name: 'CFO', role: 'CFO', verdict: 'NO_GO', reason: 'Marge', persona: false }],
  human_decision: null, llm: { provider: 'nvidia-fast', profile: 'fast', simulated: false, degraded: false },
  error: null, dossier_url: 'https://www.kayroslab.com/console/#activity?thread=thread_1', created_at: 'x', updated_at: 'y',
};

test('les workflows sont du JSON importable, en phase avec le générateur et sans secret', async () => {
  for (const [path, build] of Object.entries(FILES)) {
    const raw = await read(path);
    const workflow = JSON.parse(raw);
    assert.deepEqual(workflow, JSON.parse(JSON.stringify(build())), `${path} : relancer node integrations/n8n/tools/build-workflows.mjs`);
    assert.ok(workflow.name && Array.isArray(workflow.nodes) && workflow.connections);
    const names = new Set(workflow.nodes.map((node) => node.name));
    assert.equal(names.size, workflow.nodes.length, 'noms de nœuds uniques');
    for (const node of workflow.nodes) {
      assert.match(node.type, /^n8n-nodes-base\.[a-zA-Z]+$/);
      assert.ok(typeof node.typeVersion === 'number' && Array.isArray(node.position) && node.id);
    }
    for (const [from, { main }] of Object.entries(workflow.connections)) {
      assert.ok(names.has(from), `connexion depuis ${from}`);
      for (const branch of main) for (const link of branch) assert.ok(names.has(link.node), `connexion vers ${link.node}`);
    }
    assert.doesNotMatch(raw, /kl_live_[a-z0-9]{10}_|whsec_[A-Za-z0-9]{8,}|"credentials"\s*:/, 'aucun secret ni identifiant embarqué');
  }
});

test('déclencheur : seule l’étape configurée lance une mission, une fois par opportunité et par étape', async () => {
  const staticData = {};
  const opps = [
    { Id: '006A', Name: 'ACME', StageName: 'Proposal/Price Quote', Amount: 120000, CloseDate: '2026-12-01', Description: 'Remise 15 %' },
    { Id: '006B', Name: 'Globex', StageName: 'Prospecting' },
  ];
  const first = await runCode(CONFIG_CODE, opps, { staticData });
  assert.equal(first.length, 1);
  const request = first[0].json;
  assert.equal(request.idempotency_key, 'sf-006A-Proposal/Price_Quote');
  assert.match(request.question, /ACME.*120000.*Proposal\/Price Quote/);
  assert.equal(request.profile, 'fast');
  assert.match(request.events_url, /^https:\/\/n8n\.kayroslab\.com\/webhook\/kayros-mission-events$/);

  const results = await runCode(LAUNCH_RESULT_CODE, [{ statusCode: 202, body: { mission_id: 'msn_1', eta_seconds: 90 } }], { staticData, nodes: { 'Configuration et filtre': [request] } });
  assert.equal(results[0].json.outcome, 'mission lancée');
  assert.equal((await runCode(CONFIG_CODE, opps, { staticData })).length, 0, 'pas de seconde mission pour la même étape');
  await assert.rejects(runCode(LAUNCH_RESULT_CODE, [{ statusCode: 404, body: { error: 'collectif introuvable' } }], { staticData: {}, nodes: { 'Configuration et filtre': [request] } }), /404.*collectif introuvable/);
});

test('webhook : signature KayrosLab valide → tâche Salesforce lisible', async () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify(event);
  const [task] = await verifyChain(secret, { 'x-kayros-signature': sign(secret, body) }, JSON.parse(body));
  assert.equal(task.json.opportunity_id, '0065g00000XyZab');
  assert.equal(task.json.task_subject, 'KayrosLab — Verdict : NO GO');
  assert.equal(task.json.task_priority, 'High');
  assert.equal(task.json.score, 0);
  assert.match(task.json.task_description, /Score d’adhésion : 0\/100 \(1 agents\)/);
  assert.match(task.json.task_description, /Risques :\n- Marge < 12 %/);
  assert.match(task.json.task_description, /Dossier complet et arbitrage : https:\/\/www\.kayroslab\.com\/console\/#activity\?thread=thread_1/);
});

test('webhook : signature fausse, corps modifié ou horodatage ancien → refus', async () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify(event);
  await assert.rejects(verifyChain('autre_secret', { 'x-kayros-signature': sign(secret, body) }, event), /Signature KayrosLab invalide/);
  await assert.rejects(verifyChain(secret, { 'x-kayros-signature': sign(secret, body) }, { ...event, verdict: 'GO' }), /Signature KayrosLab invalide/);
  await assert.rejects(verifyChain(secret, { 'x-kayros-signature': sign(secret, body, Math.floor(Date.now() / 1000) - 3600) }, event), /hors tolérance/);
  await assert.rejects(verifyChain(secret, {}, event), /absente/);
});

test('webhook : test de la console, doublon et arbitrage humain', async () => {
  const secret = 's';
  const staticData = {};
  const ping = { event: 'ping', event_id: 'evt_ping', tenant_id: 't1', message: 'test' };
  const [pong] = await verifyChain(secret, { 'x-kayros-signature': sign(secret, JSON.stringify(ping)) }, ping, staticData);
  assert.equal(pong.json.skipped, 'ping');
  assert.equal(pong.json.opportunity_id, undefined, 'aucune tâche pour un test');

  await verifyChain(secret, { 'x-kayros-signature': sign(secret, JSON.stringify(event)) }, event, staticData);
  const [again] = await verifyChain(secret, { 'x-kayros-signature': sign(secret, JSON.stringify(event)) }, event, staticData);
  assert.equal(again.json.skipped, 'doublon');

  const arbitrated = { ...event, event: 'mission.arbitrated', event_id: 'evt_arb', state: 'arbitrated', llm: { simulated: true }, human_decision: { action: 'override', verdict: 'CONDITIONAL_GO', by: 'geo@example.com', justification: 'Remise plafonnée à 12 %' } };
  const [task] = await verifyChain(secret, { 'x-kayros-signature': sign(secret, JSON.stringify(arbitrated)) }, arbitrated, staticData);
  assert.equal(task.json.task_subject, '[Démo] KayrosLab — Décision : CONDITIONAL GO');
  assert.match(task.json.task_description, /par geo@example\.com/);
  assert.match(task.json.task_description, /Mode démo/);
});
