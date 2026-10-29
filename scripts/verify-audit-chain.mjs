#!/usr/bin/env node
// Vérification ouverte d'un journal d'audit KayrosLab scellé (pilote Proof-of-Control).
// Usage : node scripts/verify-audit-chain.mjs <journal.jsonl> --pubkey <cle.pem> [--pubkey <autre.pem>] [--checkpoint <checkpoint.json>]
//         node scripts/verify-audit-chain.mjs --keygen <dossier>   (génère une paire Ed25519)
// Code de sortie : 0 si la chaîne est intacte, 1 sinon, 2 en cas d'usage incorrect.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { verifyEvidenceChain, generateEvidenceKeys } from '../core/evidence-chain.mjs';

const args = process.argv.slice(2);
const values = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));

if (args[0] === '--keygen') {
  const dir = args[1] || '.';
  mkdirSync(dir, { recursive: true });
  const keys = generateEvidenceKeys();
  writeFileSync(`${dir}/audit-signing.key.pem`, keys.privateKey, { mode: 0o600 });
  writeFileSync(`${dir}/audit-signing.pub.pem`, keys.publicKey);
  console.log(`Paire générée (${keys.kid}) : ${dir}/audit-signing.key.pem (secret), ${dir}/audit-signing.pub.pem (à publier)`);
  process.exit(0);
}

const file = args.find((a, i) => !a.startsWith('--') && !['--pubkey', '--checkpoint'].includes(args[i - 1]));
const pubkeys = values('--pubkey').map((p) => readFileSync(p, 'utf8'));
if (!file || !pubkeys.length) {
  console.error('Usage : verify-audit-chain.mjs <journal.jsonl> --pubkey <cle.pem> [--checkpoint <checkpoint.json>]');
  process.exit(2);
}
const [cpPath] = values('--checkpoint');
const result = verifyEvidenceChain(readFileSync(file, 'utf8'), {
  publicKeys: pubkeys,
  checkpoint: cpPath ? JSON.parse(readFileSync(cpPath, 'utf8')) : null,
});
console.log(JSON.stringify(result, null, 2));
console.log(result.ok ? 'OK : chaîne intacte' : `ÉCHEC : ${result.errors[0].reason}`);
process.exit(result.ok ? 0 : 1);
