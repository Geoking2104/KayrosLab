import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  canonicalize, generateEvidenceKeys, createEd25519Signer, createSignedChainSink,
  verifyEvidenceChain, GENESIS_HASH, EVIDENCE_FORMAT,
} from './evidence-chain.mjs';
import { createMemorySink, createJsonlSink } from './log-sink.mjs';
import { createEngine } from './index.mjs';

const keys = generateEvidenceKeys();
const signer = createEd25519Signer(keys.privateKey);

async function sealed(entries, extra = {}) {
  const inner = createMemorySink();
  const sink = createSignedChainSink({ inner, signer, ...extra });
  for (const e of entries) await sink.append(e);
  await sink.flush();
  return { sink, lines: inner.lines };
}

const sample = [
  { runId: 'r1', type: 'swarm.vote', agent_id: 'critic', verdict: 'GO' },
  { runId: 'r1', type: 'swarm.verdict', verdict: 'GO', score: 0.82 },
  { runId: 'r1', type: 'human.arbitration', by: 'alice', decision: 'approve' },
];

test('canonicalize trie les clés et ignore undefined', () => {
  assert.equal(canonicalize({ b: 1, a: [2, { d: undefined, c: 'x' }] }), '{"a":[2,{"c":"x"}],"b":1}');
});

test('chaque enveloppe est chaînée, signée et vérifiable', async () => {
  const { lines } = await sealed(sample);
  const envs = lines.map((l) => JSON.parse(l));
  assert.equal(envs[0].v, EVIDENCE_FORMAT);
  assert.equal(envs[0].prev, GENESIS_HASH);
  assert.equal(envs[1].prev, envs[0].hash);
  assert.deepEqual(envs.map((e) => e.seq), [0, 1, 2]);
  assert.equal(envs[0].kid, keys.kid);
  const result = verifyEvidenceChain(lines.join('\n'), { publicKeys: keys.publicKey });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.chains.r1.length, 3);
});

test('une modification du contenu est détectée', async () => {
  const { lines } = await sealed(sample);
  const tampered = lines.map((l) => l.replace('"decision":"approve"', '"decision":"reject"'));
  const result = verifyEvidenceChain(tampered, { publicKeys: keys.publicKey });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].line, 3);
  assert.match(result.errors[0].reason, /payload modifié/);
});

test('un re-scellement sans la clé privée est détecté (signature)', async () => {
  const { lines } = await sealed(sample);
  const forger = createEd25519Signer(generateEvidenceKeys().privateKey);
  const result = verifyEvidenceChain(lines.slice(0, 1).concat(JSON.stringify({ ...JSON.parse(lines[1]), kid: keys.kid, sig: forger.sign(JSON.parse(lines[1]).hash) })), { publicKeys: keys.publicKey });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].reason, /signature invalide/);
});

test('suppression, réordonnancement et clé inconnue sont détectés', async () => {
  const { lines } = await sealed(sample);
  assert.match(verifyEvidenceChain([lines[0], lines[2]], { publicKeys: keys.publicKey }).errors[0].reason, /séquence rompue/);
  assert.equal(verifyEvidenceChain([lines[1], lines[0], lines[2]], { publicKeys: keys.publicKey }).ok, false);
  const other = generateEvidenceKeys();
  assert.match(verifyEvidenceChain(lines, { publicKeys: other.publicKey }).errors[0].reason, /clé inconnue/);
  assert.match(verifyEvidenceChain(['{"type":"raw"}'], { publicKeys: keys.publicKey }).errors[0].reason, /non scellé/);
});

test('un checkpoint ancré détecte une troncature de fin de journal', async () => {
  const { sink, lines } = await sealed(sample);
  const cp = sink.checkpoint('r1');
  assert.equal(cp.seq, 2);
  assert.equal(verifyEvidenceChain(lines, { publicKeys: keys.publicKey, checkpoint: cp }).ok, true);
  const truncated = verifyEvidenceChain(lines.slice(0, 2), { publicKeys: keys.publicKey, checkpoint: cp });
  assert.equal(truncated.ok, false);
  assert.match(truncated.errors[0].reason, /tronqué/);
  const bad = verifyEvidenceChain(lines, { publicKeys: keys.publicKey, checkpoint: { ...cp, seq: 1 } });
  assert.match(bad.errors[0].reason, /checkpoint : signature invalide/);
});

test('chaînes séparées par runId et ordre garanti en appels concurrents', async () => {
  const inner = createMemorySink();
  const sink = createSignedChainSink({ inner, signer });
  await Promise.all([
    sink.append({ runId: 'a', n: 1 }), sink.append({ runId: 'b', n: 1 }), sink.append({ runId: 'a', n: 2 }),
  ]);
  const result = verifyEvidenceChain(inner.lines, { publicKeys: keys.publicKey });
  assert.equal(result.ok, true);
  assert.equal(result.chains.a.length, 2);
  assert.equal(result.chains.b.length, 1);
});

test('onCheckpoint reçoit la tête de chaîne périodiquement', async () => {
  const anchored = [];
  await sealed(sample, { checkpointEvery: 2, onCheckpoint: (cp) => anchored.push(cp) });
  assert.equal(anchored.length, 1);
  assert.equal(anchored[0].seq, 1);
});

test('createEngine scelle les audits de l’essaim quand une clé est fournie', async () => {
  const inner = createMemorySink();
  const engine = createEngine({ auditSink: inner, auditSigningKey: keys.privateKey });
  assert.ok(engine.auditEvidence);
  engine.swarm._audit({ type: 'swarm.test', runId: 'eng' });
  await engine.auditEvidence.flush();
  assert.equal(inner.lines.length, 1);
  assert.equal(verifyEvidenceChain(inner.lines, { publicKeys: keys.publicKey }).ok, true);
  assert.equal(createEngine({}).auditEvidence, null);
});

test('le sink JSONL et le vérificateur en ligne de commande fonctionnent de bout en bout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kayros-evidence-'));
  const jsonl = createJsonlSink({ dir });
  const sink = createSignedChainSink({ inner: jsonl, signer });
  for (const e of sample) await sink.append(e);
  const pub = join(dir, 'pub.pem');
  writeFileSync(pub, keys.publicKey);
  const script = new URL('../scripts/verify-audit-chain.mjs', import.meta.url).pathname;
  const out = execFileSync(process.execPath, [script, jsonl.pathFor('r1'), '--pubkey', pub], { encoding: 'utf8' });
  assert.match(out, /OK : chaîne intacte/);
  writeFileSync(jsonl.pathFor('r1'), readFileSync(jsonl.pathFor('r1'), 'utf8').replace('"score":0.82', '"score":0.99'));
  assert.throws(() => execFileSync(process.execPath, [script, jsonl.pathFor('r1'), '--pubkey', pub], { encoding: 'utf8' }), (e) => e.status === 1);
});
