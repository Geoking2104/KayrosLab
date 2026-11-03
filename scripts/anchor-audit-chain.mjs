#!/usr/bin/env node
// Ancrage externe des têtes de chaîne d'audit KayrosLab (pilote Proof-of-Control).
//
// Vérifie d'abord tous les journaux d'un dossier, puis publie un manifeste
// signé des têtes (chain, seq, head) hors du serveur. À lancer en cron depuis
// une machine distincte, ou à la main avant un audit.
//
//   node scripts/anchor-audit-chain.mjs <dossier-journaux> --pubkey <cle.pem>
//        [--out <dossier-ancres>] [--gist [--gist-id <id>] [--public]] [--note "texte"]
//
// Clé de signature : KAYROS_AUDIT_SIGNING_KEY (PEM ou PEM en base64) ou
// KAYROS_AUDIT_SIGNING_KEY_FILE. Jeton gist : KAYROS_AUDIT_ANCHOR_GITHUB_TOKEN.
// Sortie : 0 ancré, 1 journal invalide (rien n'est ancré), 2 usage incorrect.
import { readFileSync } from 'node:fs';
import { createEd25519Signer } from '../core/evidence-chain.mjs';
import { buildAnchorManifest, createFileAnchor, createGistAnchor, verifyEvidenceDir } from '../core/evidence-anchor.mjs';
import { readSigningKeyFromEnv } from '../core/evidence-keys.mjs';

const args = process.argv.slice(2);
const FLAGS_WITH_VALUE = new Set(['--pubkey', '--out', '--gist-id', '--note']);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const usage = (msg) => { if (msg) console.error(msg); console.error('Usage : anchor-audit-chain.mjs <dossier> --pubkey <cle.pem> [--out <dossier>] [--gist] [--note <texte>]'); process.exit(2); };

const dir = args.find((a, i) => !a.startsWith('--') && !FLAGS_WITH_VALUE.has(args[i - 1]));
const pubPath = value('--pubkey');
if (!dir || !pubPath) usage();

let signer;
try {
  const pem = readSigningKeyFromEnv(process.env);
  if (!pem) usage('Clé absente : définir KAYROS_AUDIT_SIGNING_KEY ou KAYROS_AUDIT_SIGNING_KEY_FILE.');
  signer = createEd25519Signer(pem);
} catch (e) { usage(`Clé de signature invalide : ${e.message}`); }
const publicKey = readFileSync(pubPath, 'utf8');

const check = await verifyEvidenceDir(dir, { publicKeys: publicKey });
if (!check.ok) {
  const bad = check.files.find((f) => !f.ok);
  console.error(`ÉCHEC : ${bad?.file} — ${bad?.errors?.[0]?.reason}. Rien n'est ancré.`);
  process.exit(1);
}
if (!check.checkpoints.length) { console.log('Aucune chaîne à ancrer.'); process.exit(0); }

const manifest = buildAnchorManifest({ checkpoints: check.checkpoints, signer, note: value('--note') });
const publishers = [createFileAnchor({ dir: value('--out') || `${dir}/anchors` })];
if (args.includes('--gist')) {
  const token = process.env.KAYROS_AUDIT_ANCHOR_GITHUB_TOKEN;
  if (!token) usage('--gist demande KAYROS_AUDIT_ANCHOR_GITHUB_TOKEN (droit gist).');
  publishers.push(createGistAnchor({ token, gistId: value('--gist-id') || process.env.KAYROS_AUDIT_ANCHOR_GIST_ID || null, isPublic: args.includes('--public') }));
}
let failed = false;
for (const p of publishers) {
  try { const r = await p.publish(manifest); console.log(`Ancré (${r.kind}) : ${r.location}`); } catch (e) { failed = true; console.error(`Ancrage ${p.kind} échoué : ${e.message}`); }
}
console.log(`${manifest.entries.length} chaîne(s), manifeste ${manifest.digest.slice(0, 16)}…`);
process.exit(failed ? 1 : 0);
