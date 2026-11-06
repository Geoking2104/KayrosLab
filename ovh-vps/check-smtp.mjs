#!/usr/bin/env node
// Check credentials/connectivity without sending mail or logging secrets.
import { readFile } from 'node:fs/promises';
import { smtpFromEnv, parseEnvFile, createSmtpTransport } from '../../backend/fastify/lib/smtp.mjs';

let transport;
try {
  const envPath = process.argv[2] || '/opt/kayroslab/backend/fastify/.env';
  const smtp = smtpFromEnv(parseEnvFile(await readFile(envPath, 'utf8')));
  if (!smtp.enabled) {
    console.warn('AVERTISSEMENT : SMTP absent. La récupération par e-mail est indisponible. Configurer KAYROS_SMTP_PASS ou KAYROS_SMTP_URL.');
  } else {
    transport = await createSmtpTransport(smtp);
    await transport.verify();
    console.info('SMTP : connexion et authentification vérifiées (la réception reste à tester).');
  }
} catch (error) {
  console.error(`SMTP : vérification échouée (${String(error.code || 'SMTP_ERROR').replace(/[^A-Z0-9_]/g, '')}).`);
  process.exitCode = 1;
} finally {
  transport?.close();
}
