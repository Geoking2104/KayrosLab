#!/usr/bin/env node
// Vérification ouverte d'un journal d'audit KayrosLab scellé (pilote Proof-of-Control).
//
//   node scripts/verify-audit-chain.mjs <journal.jsonl | dossier> --pubkey <cle.pem> [--pubkey <autre.pem>]
//        [--anchor <manifeste.json | anchors.jsonl>]... [--checkpoint <checkpoint.json>] [--json]
//   node scripts/verify-audit-chain.mjs --keygen <dossier>
//
// --anchor : manifeste(s) publié(s) hors du système (scripts/anchor-audit-chain.mjs,
//            gist, dossier d'ancrage). Sa signature est vérifiée, puis chaque tête
//            ancrée doit se retrouver à l'identique dans le journal.
// Sortie : 0 intact, 1 rupture détectée, 2 usage incorrect.
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { verifyEvidenceChain, generateEvidenceKeys } from '../core/evidence-chain.mjs';
import { verifyAnchorManifest, verifyEvidenceDir } from '../core/evidence-anchor.mjs';

const args = process.argv.slice(2);
const FLAGS_WITH_VALUE = new Set(['--pubkey', '--anchor', '--checkpoint']);
const values = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
const usage = (msg) => {
  if (msg) console.error(msg);
  console.error('Usage : verify-audit-chain.mjs <journal.jsonl|dossier> --pubkey <cle.pem> [--anchor <manifeste>] [--checkpoint <cp.json>] [--json]');
  process.exit(2);
};

if (args[0] === '--keygen') {
  const dir = args[1] || '.';
  mkdirSync(dir, { recursive: true });
  const priv = `${dir}/audit-signing.key.pem`;
  if (existsSync(priv)) usage(`Refus : ${priv} existe déjà (ne jamais écraser une clé de signature).`);
  const keys = generateEvidenceKeys();
  writeFileSync(priv, keys.privateKey, { mode: 0o600 });
  writeFileSync(`${dir}/audit-signing.pub.pem`, keys.publicKey);
  console.log(`Paire générée (${keys.kid})`);
  console.log(`  clé privée (secrète) : ${priv}`);
  console.log(`  clé publique (à publier) : ${dir}/audit-signing.pub.pem`);
  console.log(`  KAYROS_AUDIT_SIGNING_KEY_FILE=${priv}   ou   KAYROS_AUDIT_SIGNING_KEY=$(base64 -w0 ${priv})`);
  process.exit(0);
}

const target = args.find((a, i) => !a.startsWith('--') && !FLAGS_WITH_VALUE.has(args[i - 1]));
let pubkeys;
try { pubkeys = values('--pubkey').map((p) => readFileSync(p, 'utf8')); } catch (e) { usage(`Clé publique illisible : ${e.message}`); }
if (!target || !pubkeys.length) usage();

// Manifestes d'ancrage : fichier JSON unique ou index anchors.jsonl.
const anchorErrors = [];
const anchors = [];
for (const path of values('--anchor')) {
  let manifests;
  try {
    const text = readFileSync(path, 'utf8').trim();
    manifests = text.startsWith('{') && !text.includes('\n{') ? [JSON.parse(text)] : text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) { usage(`Manifeste illisible ${path} : ${e.message}`); }
  for (const m of manifests) {
    const r = verifyAnchorManifest(m, { publicKeys: pubkeys });
    if (!r.ok) anchorErrors.push({ manifest: path, created: m?.created, reason: r.errors[0] });
    else anchors.push(...r.entries);
  }
}
// Pour une même chaîne, l'ancre la plus avancée suffit, mais toutes sont contrôlées.
const [cpPath] = values('--checkpoint');
const checkpoint = cpPath ? JSON.parse(readFileSync(cpPath, 'utf8')) : null;

let result;
if (statSync(target).isDirectory()) {
  const dir = await verifyEvidenceDir(target, { publicKeys: pubkeys, anchors });
  result = {
    ok: dir.ok,
    files: dir.files.map((f) => ({ file: f.file, ok: f.ok, count: f.count, chains: f.chains, errors: f.errors })),
    missing: dir.missing,
  };
} else {
  result = verifyEvidenceChain(readFileSync(target, 'utf8'), { publicKeys: pubkeys, checkpoint, anchors });
}
result.anchors = { checked: anchors.length, errors: anchorErrors };
if (anchorErrors.length) result.ok = false;

const firstError = anchorErrors[0]?.reason
  || result.errors?.[0]?.reason
  || result.files?.find((f) => !f.ok)?.errors?.[0]?.reason
  || result.missing?.[0]?.reason;

if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
else {
  const count = result.files ? result.files.reduce((n, f) => n + f.count, 0) : result.count;
  console.log(`${count} enregistrement(s), ${anchors.length} ancre(s) contrôlée(s).`);
}
console.log(result.ok ? 'OK : chaîne intacte' : `ÉCHEC : ${firstError}`);
process.exit(result.ok ? 0 : 1);
