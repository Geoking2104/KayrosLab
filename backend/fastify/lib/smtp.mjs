/**
 * Transport SMTP KayrosLab.
 *
 * Réception : contact@kayroslab.com est une redirection IONOS vers
 * geoffroydelatournelle@gmail.com — ce n’est pas une boîte SMTP.
 * Envoi : Gmail (smtp.gmail.com), compte authentifié, From = ce compte
 * (Gmail refuse d’envoyer « en tant que » contact@ sans alias Send as).
 *
 * Secret : KAYROS_SMTP_PASS = mot de passe d’application Google
 * (https://myaccount.google.com/apppasswords), jamais le mot de passe du compte.
 */

const GMAIL_HOST = 'smtp.gmail.com';
const DEFAULT_FROM = 'KayrosLab <geoffroydelatournelle@gmail.com>';
const DEFAULT_USER = 'geoffroydelatournelle@gmail.com';

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function yamlQuote(value) {
  return `'${String(value ?? '').replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
}

function cleanPass(value) {
  // Les mots de passe d’application Google s’affichent par groupes de 4.
  return String(value || '').replace(/\s+/g, '');
}

export function parseSmtpUrl(url) {
  let parsed;
  try { parsed = new URL(String(url || '')); }
  catch {
    const e = new Error('KAYROS_SMTP_URL illisible');
    e.code = 'SMTP_URL';
    throw e;
  }
  const protocol = parsed.protocol.replace(/:$/, '');
  const secure = protocol === 'smtps';
  const port = Number(parsed.port) || (secure ? 465 : 587);
  return {
    host: parsed.hostname,
    port,
    secure: secure || port === 465,
    user: decodeURIComponent(parsed.username || ''),
    pass: decodeURIComponent(parsed.password || ''),
  };
}

export function smtpFromEnv(env = process.env) {
  const from = String(env.KAYROS_MAIL_FROM || DEFAULT_FROM).trim() || DEFAULT_FROM;
  const url = String(env.KAYROS_SMTP_URL || '').trim();
  const user = String(env.KAYROS_SMTP_USER || '').trim();
  const pass = cleanPass(env.KAYROS_SMTP_PASS || env.KAYROS_SMTP_PASSWORD);
  const hostOverride = String(env.KAYROS_SMTP_HOST || '').trim();
  const portOverride = Number(env.KAYROS_SMTP_PORT || 0);

  let host = '';
  let port = 0;
  let secure = truthy(env.KAYROS_SMTP_SECURE);
  let authUser = user;
  let authPass = pass;

  if (url) {
    const parsed = parseSmtpUrl(url);
    host = parsed.host;
    port = parsed.port;
    secure = parsed.secure;
    authUser = authUser || parsed.user;
    authPass = authPass || cleanPass(parsed.pass);
  } else if (authPass) {
    host = hostOverride || GMAIL_HOST;
    authUser = authUser || DEFAULT_USER;
  }

  if (hostOverride) host = hostOverride;
  if (portOverride) port = portOverride;
  if (!port) port = host === GMAIL_HOST || secure ? 465 : 587;
  if (port === 465) secure = true;
  if (truthy(env.KAYROS_SMTP_SECURE)) secure = true;

  const enabled = Boolean(host && authUser && authPass);
  const options = enabled
    ? {
        host,
        port,
        secure: secure || port === 465,
        auth: { user: authUser, pass: authPass },
      }
    : null;

  const scheme = (options?.secure || port === 465) ? 'submissions' : 'submission';
  return {
    enabled,
    from,
    host: enabled ? host : null,
    port: enabled ? port : null,
    user: enabled ? authUser : null,
    options,
    authelia: enabled
      ? {
          address: `${scheme}://${host}:${port}`,
          username: authUser,
          password: authPass,
          sender: from,
        }
      : null,
  };
}

export async function createSmtpTransport(smtp, { nodemailerImport } = {}) {
  if (!smtp?.enabled || !smtp.options) return null;
  const { createTransport } = nodemailerImport
    || await import('nodemailer');
  return createTransport(smtp.options);
}

export function autheliaNotifierYaml(smtp) {
  if (!smtp?.enabled || !smtp.authelia) {
    return [
      'notifier:',
      '  filesystem:',
      '    filename: /config/notification.txt',
      '',
    ].join('\n');
  }
  const { address, username, password, sender } = smtp.authelia;
  return [
    'notifier:',
    '  smtp:',
    `    address: ${yamlQuote(address)}`,
    `    username: ${yamlQuote(username)}`,
    `    password: ${yamlQuote(password)}`,
    `    sender: ${yamlQuote(sender)}`,
    "    subject: '[KayrosLab] {title}'",
    '',
  ].join('\n');
}

const FILESYSTEM_NOTIFIER = `notifier:
  filesystem:
    filename: /config/notification.txt`;

export function patchAutheliaConfig(yamlText, smtp) {
  const next = autheliaNotifierYaml(smtp).trimEnd();
  if (yamlText.includes(FILESYSTEM_NOTIFIER)) {
    return yamlText.replace(FILESYSTEM_NOTIFIER, next);
  }
  if (/^notifier:\n/m.test(yamlText)) {
    return yamlText.replace(/notifier:\n(?: {2}.*\n)*/m, `${next}\n`);
  }
  return `${yamlText.trimEnd()}\n${next}\n`;
}

export function parseEnvFile(text, base = {}) {
  const env = { ...base };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

export { GMAIL_HOST, DEFAULT_FROM, DEFAULT_USER };
