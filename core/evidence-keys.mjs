// KayrosLab -- lecture de la clé de signature d'audit depuis l'environnement.
// KAYROS_AUDIT_SIGNING_KEY : PEM PKCS#8 Ed25519, en clair (\n échappés acceptés) ou en base64.
// KAYROS_AUDIT_SIGNING_KEY_FILE : chemin d'un fichier PEM (prioritaire, recommandé en production).
import { readFileSync } from 'node:fs';

export function normalizePem(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (text.includes('-----BEGIN')) return `${text.replace(/\\n/g, '\n')}\n`;
  const decoded = Buffer.from(text, 'base64').toString('utf8');
  if (decoded.includes('-----BEGIN')) return decoded;
  throw new Error('KAYROS_AUDIT_SIGNING_KEY : ni PEM ni PEM en base64');
}

export function readSigningKeyFromEnv(env = process.env, { readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  if (env.KAYROS_AUDIT_SIGNING_KEY_FILE) return normalizePem(readFile(env.KAYROS_AUDIT_SIGNING_KEY_FILE));
  return normalizePem(env.KAYROS_AUDIT_SIGNING_KEY);
}
