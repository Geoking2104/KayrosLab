/**
 * Transport SMTP KayrosLab.
 *
 * Le domaine kayroslab.com est chez IONOS (MX mx00.ionos.fr, SPF _spf-eu.ionos.com).
 * On n’ouvre pas de relais sur le VPS : nodemailer et Authelia s’authentifient
 * auprès de smtp.ionos.fr, ce que le SPF autorise déjà.
 *
 * Deux formes :
 *   KAYROS_SMTP_URL=smtps://user:pass@smtp.ionos.fr:465
 *   KAYROS_SMTP_USER + KAYROS_SMTP_PASS  (hôte IONOS par défaut)
 */

const IONOS_HOST = 'smtp.ionos.fr';
const DEFAULT_FROM = 'KayrosLab <contact@kayroslab.com>';
const DEFAULT_USER = 'contact@kayroslab.com';

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function yamlQuote(value) {
  return `'${String(value ?? '').replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
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
  const pass = String(env.KAYROS_SMTP_PASS || env.KAYROS_SMTP_PASSWORD || '').trim();
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
    authPass = authPass || parsed.pass;
  } else if (authUser && authPass) {
    host = hostOverride || IONOS_HOST;
  } else if (authPass) {
    host = hostOverride || IONOS_HOST;
    authUser = DEFAULT_USER;
  }

  if (hostOverride) host = hostOverride;
  if (portOverride) port = portOverride;
  if (!port) port = secure || host === IONOS_HOST ? 465 : 587;
  if (!url && (port === 465 || host === IONOS_HOST)) secure = true;
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

export { IONOS_HOST, DEFAULT_FROM, DEFAULT_USER };
