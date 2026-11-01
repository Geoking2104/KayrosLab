import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  generateEvidenceKeys, createEd25519Signer, createSignedChainSink, createMemorySink, verifyEvidenceChain,
  buildAnchorManifest, verifyAnchorManifest, createFileAnchor, createGistAnchor, createAnchorService,
  createJsonlSink, jsonlHeadLoader, normalizePem,
} from './index.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const keys = generateEvidenceKeys();
const signer = createEd25519Signer(keys.privateKey);

async function sealed(n, chain = 'c') {
  const inner = createMemorySink();
  const sink = createSignedChainSink({ inner, signer });
  for (let i = 0; i < n; i += 1) await sink.append({ runId: chain, i });
  await sink.flush();
  return { sink, lines: inner.lines };
}

test('manifeste signé : vérifié, falsification et clé étrangère détectées', () => {
  const m = buildAnchorManifest({ checkpoints: [{ chain: 'b', seq: 1, head: 'x' }, { chain: 'a', seq: 0, head: 'y' }], signer });
  assert.deepEqual(m.entries.map((e) => e.chain), ['a', 'b']);
  assert.equal(verifyAnchorManifest(m, { publicKeys: keys.publicKey }).ok, true);
  assert.match(verifyAnchorManifest({ ...m, entries: [] }, { publicKeys: keys.publicKey }).errors[0], /modifié/);
  assert.match(verifyAnchorManifest(m, { publicKeys: generateEvidenceKeys().publicKey }).errors[0], /clé inconnue/);
});

test('sans runId : chaîne de session unique ; checkpoints() liste les têtes', async () => {
  const sink = createSignedChainSink({ inner: createMemorySink(), signer });
  await sink.append({ type: 'x' });
  await sink.append({ type: 'y', runId: 'r' });
  await sink.flush();
  assert.match(sink.sessionChain, /^session-\d+-[0-9a-f]{6}$/);
  assert.deepEqual(sink.checkpoints().map((c) => c.chain).sort(), ['r', sink.sessionChain].sort());
});

test('ancre : réécriture complète avec la clé et troncature détectées', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anc-'));
  const inner = createJsonlSink({ dir });
  const sink = createSignedChainSink({ inner, signer });
  for (let i = 0; i < 3; i += 1) await sink.append({ runId: 'c', i });
  await sink.flush();
  const anchors = buildAnchorManifest({ checkpoints: sink.checkpoints(), signer }).entries;
  const text = readFileSync(join(dir, 'c.jsonl'), 'utf8');
  assert.equal(verifyEvidenceChain(text, { publicKeys: keys.publicKey, anchors }).ok, true);
  // Troncature (dernière ligne retirée) : la signature reste valide, l'ancre non.
  const truncated = text.trim().split('\n').slice(0, 2).join('\n');
  assert.match(verifyEvidenceChain(truncated, { publicKeys: keys.publicKey, anchors }).errors[0].reason, /tronqué/);
  // Réécriture par le détenteur de la clé : chaîne valide, ancre trahit.
  const out = [];
  const fake = createSignedChainSink({ inner: { append: async (e) => { out.push(JSON.stringify(e)); }, flush: async () => true }, signer });
  for (let i = 0; i < 3; i += 1) await fake.append({ runId: 'c', i: i * 10 });
  await fake.flush();
  const res = verifyEvidenceChain(out.join('\n'), { publicKeys: keys.publicKey, anchors });
  assert.equal(res.ok, false);
  assert.match(res.errors[0].reason, /ancre/);
});

test('reprise : jsonlHeadLoader recolle la chaîne après redémarrage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'resume-'));
  for (const v of [1, 2]) {
    const inner = createJsonlSink({ dir });
    const sink = createSignedChainSink({ inner, signer, loadHead: jsonlHeadLoader({ pathFor: inner.pathFor }) });
    await sink.append({ runId: 'r', v });
    await sink.flush();
  }
  const res = verifyEvidenceChain(readFileSync(join(dir, 'r.jsonl'), 'utf8'), { publicKeys: keys.publicKey });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.count, 2);
});

test('service : ancrage fichier, saut si inchangé, échec d\'une destination isolé', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'svc-'));
  const { sink } = await sealed(2);
  const broken = { kind: 'broken', async publish() { throw new Error('réseau'); } };
  const svc = createAnchorService({ sink, signer, publishers: [createFileAnchor({ dir }), broken], logger: { warn() {} } });
  const r = await svc.anchorNow();
  assert.equal(r.receipts[0].ok, true);
  assert.equal(r.receipts[1].ok, false);
  assert.equal((await svc.anchorNow()).skipped, true);
  assert.equal(readFileSync(join(dir, 'anchors.jsonl'), 'utf8').trim().split('\n').length, 1);
  assert.equal(svc.start(), false); // intervalle 0 : pas de minuterie
});

test('gist : POST puis PATCH sur le même gist, jeton en en-tête', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ id: 'g1', html_url: 'https://gist.github.com/g1', history: [{ version: 'v' }] }) }; };
  const gist = createGistAnchor({ token: 't', fetchImpl });
  const m = buildAnchorManifest({ checkpoints: [{ chain: 'c', seq: 0, head: 'h' }], signer });
  await gist.publish(m);
  await gist.publish(m);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[1].init.method, 'PATCH');
  assert.match(calls[1].url, /gists\/g1$/);
  assert.equal(calls[0].init.headers.authorization, 'Bearer t');
  assert.equal(JSON.parse(calls[0].init.body).public, false);
});

test('normalizePem : PEM, \\n échappés, base64 ; refuse le reste', () => {
  assert.equal(createEd25519Signer(normalizePem(Buffer.from(keys.privateKey).toString('base64'))).kid, keys.kid);
  assert.equal(createEd25519Signer(normalizePem(keys.privateKey.replace(/\n/g, '\\n'))).kid, keys.kid);
  assert.throws(() => normalizePem('zzz'), /PEM/);
});

test('CLI : ancrage puis vérification avec --anchor ; suppression d\'un journal détectée', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'cli-anc-'));
  const kg = spawnSync(process.execPath, [join(root, 'scripts/verify-audit-chain.mjs'), '--keygen', tmp], { encoding: 'utf8' });
  assert.equal(kg.status, 0, kg.stderr);
  // Refus d'écraser une clé existante.
  assert.equal(spawnSync(process.execPath, [join(root, 'scripts/verify-audit-chain.mjs'), '--keygen', tmp]).status, 2);
  const priv = readFileSync(join(tmp, 'audit-signing.key.pem'), 'utf8');
  const s = createEd25519Signer(priv);
  const logs = join(tmp, 'logs');
  return (async () => {
    const inner = createJsonlSink({ dir: logs });
    const sink = createSignedChainSink({ inner, signer: s });
    await sink.append({ runId: 'a', x: 1 });
    await sink.append({ runId: 'b', x: 2 });
    await sink.flush();
    const env = { ...process.env, KAYROS_AUDIT_SIGNING_KEY_FILE: join(tmp, 'audit-signing.key.pem') };
    const pub = join(tmp, 'audit-signing.pub.pem');
    const out = join(tmp, 'anchors');
    const anc = spawnSync(process.execPath, [join(root, 'scripts/anchor-audit-chain.mjs'), logs, '--pubkey', pub, '--out', out], { encoding: 'utf8', env });
    assert.equal(anc.status, 0, anc.stderr + anc.stdout);
    const verify = (...extra) => spawnSync(process.execPath, [join(root, 'scripts/verify-audit-chain.mjs'), logs, '--pubkey', pub, '--anchor', join(out, 'anchors.jsonl'), ...extra], { encoding: 'utf8' });
    const ok = verify();
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /2 ancre/);
    unlinkSync(join(logs, 'b.jsonl'));
    const ko = verify();
    assert.equal(ko.status, 1);
    assert.match(ko.stdout, /supprimé/);
    // Un manifeste falsifié est rejeté.
    const file = readdirSync(out).find((n) => n.startsWith('anchor-'));
    const m = JSON.parse(readFileSync(join(out, file), 'utf8'));
    m.entries[0].seq = 99;
    writeFileSync(join(tmp, 'forged.json'), JSON.stringify(m));
    const forged = spawnSync(process.execPath, [join(root, 'scripts/verify-audit-chain.mjs'), logs, '--pubkey', pub, '--anchor', join(tmp, 'forged.json')], { encoding: 'utf8' });
    assert.equal(forged.status, 1);
    assert.match(forged.stdout, /manifeste modifié/);
    // Journal invalide : l'ancrage refuse.
    writeFileSync(join(logs, 'a.jsonl'), readFileSync(join(logs, 'a.jsonl'), 'utf8').replace('"x":1', '"x":7'));
    assert.equal(spawnSync(process.execPath, [join(root, 'scripts/anchor-audit-chain.mjs'), logs, '--pubkey', pub, '--out', out], { env }).status, 1);
  })();
});
