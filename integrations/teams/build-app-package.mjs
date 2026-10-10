#!/usr/bin/env node
// Construit le paquet d'application Teams (manifest.json + icônes) à
// téléverser dans Teams (Applications → Gérer vos applications → Charger une
// application) ou dans le Teams Admin Center.
//
//   TEAMS_APP_ID=<ID d'application Microsoft (bot Azure)> \
//   [TEAMS_MANIFEST_ID=<GUID, défaut TEAMS_APP_ID>] [APP_VERSION=1.0.0] \
//   [KAYROS_PUBLIC_API_URL=https://api.kayroslab.com] \
//   node integrations/teams/build-app-package.mjs [sortie.zip]
//
// Aucun secret n'entre dans le paquet : seul l'ID public de l'application y figure.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function renderManifest(env = process.env) {
  const appId = String(env.TEAMS_APP_ID || '').trim();
  if (!GUID.test(appId)) throw new Error('TEAMS_APP_ID requis (GUID de l’application Microsoft du bot Azure)');
  const manifestId = String(env.TEAMS_MANIFEST_ID || appId).trim();
  if (!GUID.test(manifestId)) throw new Error('TEAMS_MANIFEST_ID doit être un GUID');
  const version = String(env.APP_VERSION || '1.0.0').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('APP_VERSION doit être de la forme 1.0.0');
  const apiHost = new URL(String(env.KAYROS_PUBLIC_API_URL || 'https://api.kayroslab.com')).hostname;
  const template = readFileSync(join(here, 'app-package', 'manifest.template.json'), 'utf8');
  const rendered = template
    .replaceAll('{{TEAMS_APP_ID}}', appId)
    .replaceAll('{{TEAMS_MANIFEST_ID}}', manifestId)
    .replaceAll('{{APP_VERSION}}', version)
    .replaceAll('{{API_HOST}}', apiHost);
  const manifest = JSON.parse(rendered);
  if (/\{\{/.test(rendered)) throw new Error('variable de gabarit non remplacée');
  return manifest;
}

// --- ZIP minimal (deflate, sans dépendance) ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function zip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0x00210000, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10); central.writeUInt32LE(0x00210000, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function buildPackage(env = process.env) {
  const manifest = renderManifest(env);
  return zip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: 'color.png', data: readFileSync(join(here, 'app-package', 'color.png')) },
    { name: 'outline.png', data: readFileSync(join(here, 'app-package', 'outline.png')) },
  ]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output = resolve(process.argv[2] || join(here, 'dist', 'kayroslab-teams.zip'));
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, buildPackage());
    console.log(`Paquet Teams écrit : ${output}`);
  } catch (error) {
    console.error(`Échec : ${error.message}`);
    process.exit(1);
  }
}
