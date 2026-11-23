/* Complète avatars.json pour les auteurs ajoutés après la première collecte.
 * Même méthode : API Wikipedia (fr puis en), image 320 px, crédit conservé.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'backend/web/public/salon';
const catalog = JSON.parse(readFileSync(join(DIR, 'catalog.json'), 'utf8'));
const manifestPath = join(DIR, 'avatars.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { authors: {} };
const outDir = join(DIR, 'avatars');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const missing = catalog.authors.filter((a) => !(manifest.authors[a.id] && manifest.authors[a.id].file));
console.log('à compléter :', missing.length);

const titleFrom = (author) => {
  const raw = String(author.wikipedia || '').trim();
  const m = raw.match(/\/wiki\/([^#?]+)/);
  if (m) return decodeURIComponent(m[1]).replace(/_/g, ' ');
  return author.name;
};

async function summary(lang, title) {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'KayrosLab-Salon/1.0 (portraits)' } });
  if (!res.ok) return null;
  return res.json();
}

let done = 0;
for (const author of missing) {
  const title = titleFrom(author);
  let data = null;
  let lang = 'fr';
  for (const l of ['fr', 'en']) {
    data = await summary(l, title).catch(() => null);
    if (data && (data.thumbnail?.source || data.originalimage?.source)) { lang = l; break; }
    data = null;
  }
  if (!data) { console.log(`  ✗ ${author.id} (${title}) : pas d'image`); continue; }
  const src = data.thumbnail?.source || data.originalimage?.source;
  try {
    const img = await fetch(src, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'KayrosLab-Salon/1.0 (portraits)' } });
    if (!img.ok) throw new Error(`HTTP ${img.status}`);
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.length < 8000) throw new Error(`trop petit (${buf.length})`);
    const file = join(outDir, `${author.id}.jpg`);
    writeFileSync(file, buf);
    if (statSync(file).size < 8000) throw new Error('fichier invalide');
    manifest.authors[author.id] = {
      file: `avatars/${author.id}.jpg`,
      page: data.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      credit: data.description ? String(data.description).slice(0, 120) : 'Wikimedia Commons',
      license: 'voir la page',
    };
    done += 1;
    console.log(`  ✓ ${author.id} (${lang}) ${Math.round(buf.length / 1024)} Ko`);
  } catch (e) {
    console.log(`  ✗ ${author.id} : ${e.message}`);
  }
}

manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1), 'utf8');
console.log(`portraits ajoutés : ${done} | total manifeste : ${Object.keys(manifest.authors).length}`);
