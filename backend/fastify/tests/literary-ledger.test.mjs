import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBookPolicy, scoreWorkAgainstAgent, pickBestAgentForWork, appendLedgerEntry, readLedgerEntries } from '../lib/literary-ledger.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('politique 15/3 : cap quand le stock est large', () => {
  const policy = applyBookPolicy(20, { max: 15, min: 3 });
  assert.equal(policy.assign, 15);
  assert.equal(policy.withheld, 5);
  assert.equal(policy.rule, 'cap');
  assert.equal(policy.manualRequired, false);
});

test('politique 15/3 : tout est assigné entre 3 et 15', () => {
  const policy = applyBookPolicy(8, { max: 15, min: 3 });
  assert.equal(policy.assign, 8);
  assert.equal(policy.withheld, 0);
  assert.equal(policy.rule, 'floor-ok');
  assert.equal(policy.manualRequired, false);
});

test('politique 15/3 : plancher court-circuité sous 3 → repli manuel', () => {
  const policy = applyBookPolicy(1, { max: 15, min: 3 });
  assert.equal(policy.assign, 1);
  assert.equal(policy.rule, 'floor-short');
  assert.equal(policy.manualRequired, true);
  assert.equal(policy.missing, 2);
  assert.equal(applyBookPolicy(0, { max: 15, min: 3 }).manualRequired, true);
});

test('score d’attribution : nom d’auteur + termes signatures', () => {
  const agent = {
    agent_id: 'auteur_hugo', display_name: 'Victor Hugo',
    metadata: { literary: { name: 'Victor Hugo', era: '1802–1885 · romantisme', terms: ['misère', 'paris', 'gringoire', 'cloître'] } },
  };
  const work = { title: 'Les Contemplations — Paris', author: 'Victor Hugo', terms: ['paris', 'misère', 'poésie'] };
  const { score, reasons } = scoreWorkAgainstAgent(work, agent);
  assert.ok(score > 0.5, `score attendu > 0.5, reçu ${score}`);
  assert.ok(reasons.some((reason) => reason.includes('Victor Hugo')));
  assert.ok(reasons.some((reason) => reason.includes('terme')));

  const other = { title: 'Flatland', author: 'Edwin Abbott', terms: ['dimension', 'carré'] };
  const low = scoreWorkAgainstAgent(other, agent);
  assert.ok(low.score === 0);
  assert.ok(pickBestAgentForWork(work, [agent, { agent_id: 'auteur_stendhal', display_name: 'Stendhal', metadata: { literary: { name: 'Stendhal', terms: ['rouge', 'noir'] } } }]).agent.agent_id === 'auteur_hugo');
});

test('registre : roundtrip append/read JSONL', async () => {
  const file = path.join(tmpdir(), `kayros-ledger-test-${Date.now()}.jsonl`);
  await appendLedgerEntry(file, { type: 'cap', agent_id: 'auteur_hugo', rule: 'max 15', details: '5 retenues' });
  await appendLedgerEntry(file, { type: 'manual_add', agent_id: 'auteur_hugo', book: 'Les Contemplations', rule: 'ajout manuel' });
  const entries = await readLedgerEntries(file, 50);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].type, 'cap');
  assert.equal(entries[0].type, 'manual_add');
  assert.ok(entries[0].ts);
  const tail = await readLedgerEntries(file, 1);
  assert.equal(tail.length, 1);
  assert.equal(tail[0].type, 'manual_add');
});
