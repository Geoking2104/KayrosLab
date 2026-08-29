import { readFileSync } from 'node:fs';

export function parseEnvFile(contents = '') {
  const values = {};
  for (const rawLine of String(contents).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

/** Charge seulement les variables absentes ou vides; l'environnement explicite reste prioritaire. */
export function applyEnvFileDefaults({ path = '.env', env = process.env, read = readFileSync } = {}) {
  let parsed;
  try { parsed = parseEnvFile(read(path, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  for (const [name, value] of Object.entries(parsed)) {
    if (!env[name]) env[name] = value;
  }
  return true;
}
