#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnvFile, smtpFromEnv, patchAutheliaConfig } from '../../backend/fastify/lib/smtp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = process.argv[2] || resolve(here, '../../backend/fastify/.env');
const yamlPath = process.argv[3];
if (!yamlPath) {
  console.error('usage: patch-authelia-smtp.mjs <backend.env> <authelia/configuration.yml>');
  process.exit(1);
}

let envText = '';
try { envText = readFileSync(envPath, 'utf8'); }
catch { /* pas de .env = pas de SMTP */ }

const smtp = smtpFromEnv(parseEnvFile(envText));
const next = patchAutheliaConfig(readFileSync(yamlPath, 'utf8'), smtp);
writeFileSync(yamlPath, next, { mode: 0o600 });
console.log(smtp.enabled
  ? `SSO Authelia : notifier SMTP ${smtp.host}`
  : 'SSO Authelia : notifier fichier (pas de KAYROS_SMTP_PASS).');
