#!/usr/bin/env node
/**
 * publish_pages.mjs — copie la page Salon et les packs publiés dans le dossier
 * racine `salon/`, servi par GitHub Pages sur https://www.kayroslab.com/salon/.
 *
 * Source de vérité : backend/web/public/salon (packs validés par publish_gate).
 * Ne copie que ce dont la page a besoin (pas corpus.json ni formulas.json,
 * qui restent dans le miroir backend et les packs).
 *
 * Usage : node salon/scripts/publish_pages.mjs [--dry-run]
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, parseArgs } from './openkb_common.mjs';

const args = parseArgs();
const SRC = join(REPO, 'backend', 'web', 'public', 'salon');
const DEST = join(REPO, 'salon');
const FILES = ['index.html', 'app.js', 'style.css', 'catalog.json', 'doctrine.json', 'kb-manifest.json'];

if (!existsSync(join(SRC, 'index.html'))) {
  console.error(`✗ ${SRC}/index.html absent — lancer publish_gate d'abord.`);
  process.exit(1);
}
if (!existsSync(join(SRC, 'kb-manifest.json'))) {
  console.error(`✗ ${SRC}/kb-manifest.json absent — lancer publish_gate d'abord.`);
  process.exit(1);
}

if (!args['dry-run']) {
  mkdirSync(DEST, { recursive: true });
  for (const f of FILES) {
    if (existsSync(join(SRC, f))) cpSync(join(SRC, f), join(DEST, f));
  }
  // Les packs : copie complète, remplacement atomique du dossier.
  rmSync(join(DEST, 'kb'), { recursive: true, force: true });
  cpSync(join(SRC, 'kb'), join(DEST, 'kb'), { recursive: true });
}

const manifest = JSON.parse(readFileSync(join(SRC, 'kb-manifest.json'), 'utf8'));
const size = (p) => {
  try {
    const s = statSync(p);
    if (s.isFile()) return s.size;
    return readdirSync(p).reduce((n, f) => n + size(join(p, f)), 0);
  } catch { return 0; }
};

console.log(`✓ page Salon publiée dans ${DEST}`);
console.log(`  ${manifest.totals.authors} auteurs · ${manifest.totals.sentences} phrases · ${manifest.totals.formulas} formules`);
console.log(`  fichiers : ${FILES.join(', ')} · kb/`);
