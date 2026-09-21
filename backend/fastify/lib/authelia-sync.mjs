import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

function usersPath() {
  return process.env.AUTHELIA_USERS_FILE || '/opt/kayroslab/data/authelia/users.yml';
}

function usernameFromEmail(email) {
  const local = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]+/g, '');
  return local || 'invite';
}

async function argon2Hash(password) {
  const image = process.env.AUTHELIA_IMAGE || 'authelia/authelia:4.39.20';
  const { stdout, stderr } = await execFileAsync('docker', [
    'run', '--rm', image,
    'authelia', 'crypto', 'hash', 'generate', 'argon2', '--password', String(password),
  ], { timeout: 25000 });
  const text = `${stdout}\n${stderr}`;
  const hash = text.match(/\$argon2[id]+\$[^\s]+/);
  if (!hash) throw new Error('hash Authelia introuvable');
  return hash[0];
}

function upsertYaml(yaml, { username, hash, email, name }) {
  const block = [
    `  ${username}:`,
    '    disabled: false',
    `    displayname: ${JSON.stringify(name || username)}`,
    `    password: "${hash}"`,
    `    email: ${JSON.stringify(email)}`,
    '    groups:',
    '      - salon',
  ].join('\n');
  if (!/^users:\s*$/m.test(yaml) && !yaml.includes('\nusers:')) {
    yaml = 'users:\n' + yaml;
  }
  const re = new RegExp(`^  ${username}:\n(?:    .*\n)*`, 'm');
  if (re.test(yaml)) return yaml.replace(re, block + '\n');
  return yaml.replace(/\s*$/, '\n') + block + '\n';
}

export async function syncAutheliaUser({ email, password, name }) {
  if (!email || !password) return { ok: false, skipped: true };
  if (process.env.AUTHELIA_SYNC === 'off') return { ok: false, skipped: true };
  const username = usernameFromEmail(email);
  const hash = await argon2Hash(password);
  const path = usersPath();
  let yaml = '';
  try { yaml = await readFile(path, 'utf8'); } catch { yaml = 'users:\n'; }
  await writeFile(path, upsertYaml(yaml, { username, hash, email, name }), { mode: 0o600 });
  try {
    await execFileAsync('docker', ['kill', '-s', 'HUP', 'kayros-authelia'], { timeout: 8000 });
  } catch { /* file backend relit souvent sans HUP */ }
  return { ok: true, username };
}
