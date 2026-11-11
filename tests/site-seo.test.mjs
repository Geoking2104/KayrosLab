import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const PAGES = ['index', 'integrations', 'personas', 'sales-oracle', 'security-governance', 'developers', 'demo'];

test('aucune icône SVG ne pointe vers un document entier (<use href> sans ancre)', async () => {
  for (const name of PAGES.flatMap((p) => [`${p}.html`, `${p}.fr.html`])) {
    const html = await read(name);
    assert.doesNotMatch(html, /<use href="(?!#)[^"]*"/, `${name} : <use href> doit viser un #symbole`);
    for (const [, id] of html.matchAll(/<use href="#([^"]+)"/g)) {
      assert.match(html, new RegExp(`<symbol id="${id}"`), `${name} : symbole #${id} absent`);
    }
  }
});

test('robots.txt autorise le site, exclut la console et annonce le sitemap', async () => {
  const robots = await read('robots.txt');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Disallow: \/console\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/www\.kayroslab\.com\/sitemap\.xml$/m);
});

test('sitemap.xml liste chaque page FR/EN avec son canonical et ses hreflang', async () => {
  const sitemap = await read('sitemap.xml');
  for (const p of PAGES) {
    for (const file of [`${p}.html`, `${p}.fr.html`]) {
      const html = await read(file);
      const canonical = html.match(/rel="canonical" href="([^"]+)"/)?.[1];
      assert.ok(canonical, `${file} sans canonical`);
      assert.ok(sitemap.includes(`<loc>${canonical}</loc>`), `${canonical} absent du sitemap`);
    }
  }
  assert.equal((sitemap.match(/hreflang="x-default"/g) || []).length, PAGES.length * 2);
});

test('le déploiement GitHub Pages publie robots.txt et sitemap.xml', async () => {
  const wf = await read('.github/workflows/deploy-positionning-pages.yml');
  assert.match(wf, /404\.html robots\.txt sitemap\.xml; do/);
});

test('les déploiements Vercel de ce dépôt ne sont pas indexés', async () => {
  const vercel = JSON.parse(await read('vercel.json'));
  const header = vercel.headers?.find((h) => h.source === '/(.*)')?.headers?.find((h) => h.key === 'X-Robots-Tag');
  assert.equal(header?.value, 'noindex, nofollow');
});
