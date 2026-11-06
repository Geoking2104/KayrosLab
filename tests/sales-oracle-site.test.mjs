import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const en = JSON.parse(read('backend/web/locales/en.json'));
const fr = JSON.parse(read('backend/web/locales/fr.json'));

test('Sales Oracle translations stay complete and aligned', () => {
  const enKeys = Object.keys(en).filter((key) => key.startsWith('sales_oracle_')).sort();
  const frKeys = Object.keys(fr).filter((key) => key.startsWith('sales_oracle_')).sort();

  assert.deepEqual(frKeys, enKeys);
  assert.ok(enKeys.length >= 30, 'expected a complete bilingual Sales Oracle narrative');
  for (const key of enKeys) {
    assert.ok(en[key].trim(), `empty English translation: ${key}`);
    assert.ok(fr[key].trim(), `empty French translation: ${key}`);
  }
});

test('homepage follows the narrative swarm-to-arbitration workflow', () => {
  const template = read('backend/web/views/homepage-studio.ejs');
  const styles = read('studio.css');

  assert.match(template, /studio_hero_title/);
  assert.match(template, /id="swarm"/);
  assert.match(template, /id="workflow"/);
  assert.match(template, /id="timesfm"/);
  assert.match(template, /id="open-source"/);
  assert.match(template, /studio_agent_cfo/);
  assert.match(template, /studio_agent_timesfm/);
  assert.match(template, /studio_step_4_title/);
  assert.match(template, /studio_simulation_label/);
  assert.doesNotMatch(template, /94\.2%/);
  assert.match(styles, /Narrative Workflow/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.doesNotMatch(styles, /transition:\s*all/);
  assert.doesNotMatch(styles, /background-clip:\s*text/);
});

test('preview server exposes the homepage design tokens', () => {
  const template = read('backend/web/views/homepage-studio.ejs');
  const server = read('backend/web/server.mjs');

  assert.match(template, /href="\.\/tokens\.css"/);
  assert.match(template, /href="\.\/studio\.css"/);
  assert.match(server, /app\.get\('\/tokens\.css'/);
  assert.match(server, /res\.sendFile\(path\.join\(__dirname, '\.\.', '\.\.', 'tokens\.css'\)\)/);
});

test('secure customer workspace is available without dominating the public explanation', () => {
  const template = read('backend/web/views/homepage-studio.ejs');

  assert.match(template, /<details id="secure-workspace" class="workspace">/);
  assert.match(template, /sales_oracle_workspace_title/);
  assert.match(template, /data-sales-oracle-tool/);
});

test('generated static pages keep the sales narrative and leave the Sales Oracle tool to the console', () => {
  for (const [file, oracle, builders] of [['index.html', 'sales-oracle.html', 'developers.html'], ['index.fr.html', 'sales-oracle.fr.html', 'developers.fr.html']]) {
    assert.match(read(oracle), /id="oracle"/);      // Sales Oracle has its own page
    assert.match(read(builders), /id="builders"/);  // technical deep-dive on the developers page
    const html = read(file);
    const linksTo = (page) => html.includes(`href="/${page}"`) || html.includes(`href="${page}"`);
    assert.ok(linksTo(oracle) && linksTo(builders), `${file}: links to secondary pages`);
    assert.match(html, /class="lang-opt"/);   // EN/FR language selector
    assert.match(html, /marketing\.css/);
    assert.doesNotMatch(html, /id="secure-workspace"/);
    assert.doesNotMatch(html, /data-sales-oracle-tool/);
    assert.doesNotMatch(html, /sales-oracle-tool\.js/);
    assert.doesNotMatch(html, /sales_oracle_[a-z_]+/);
    assert.doesNotMatch(html, /studio_[a-z_]+/);
    assert.doesNotMatch(html, /Fastify|createEngine|pm2|Redis/);
  }
});

test('personas page covers personified agents; Salon is no longer embedded', () => {
  for (const [home, file] of [['index.html', 'personas.html'], ['index.fr.html', 'personas.fr.html']]) {
    const landing = read(home);
    assert.ok(landing.includes(`href="/${file}"`) || landing.includes(`href="${file}"`), `${home}: link to ${file}`);
    assert.doesNotMatch(read(home), /id="salon"|class="salon-charter"|btn-salon|href="\/salon\/|href="#salon"/);
    const html = read(file);
    assert.match(html, /id="personify"/);
    assert.match(html, /CrystalKnows/);
    // Section Salon retirée du contenu : plus de section, de bouton ni de lien vers /salon/.
    assert.doesNotMatch(html, /id="salon"|class="salon-charter"|btn-salon|href="\/salon\/|href="#salon"/);
    assert.doesNotMatch(html, /panel hl reveal/);
  }
  const en = read('personas.html');
  const fr = read('personas.fr.html');
  assert.match(en, /role packs/i);
  assert.match(fr, /packs de r[oô]les/i);
  assert.match(en, /mise à l.épreuve|stress-test/i);
  assert.match(fr, /mise à l.épreuve/);
  assert.match(fr, /Agents personnifiés : préparez la discussion/);
  assert.match(fr, /Toujours une simulation/);
  assert.match(fr, /Essayer sur ma décision/);
  assert.equal((fr.match(/<title>([\s\S]*?)<\/title>/)||[])[1]?.trim(), 'Agents personnifiés : préparez vos échanges | KayrosLab');
  assert.match(fr, /og:title" content="Agents personnifiés : préparez vos échanges \| KayrosLab"/);
  assert.match(fr, /twitter:title" content="Agents personnifiés : préparez vos échanges \| KayrosLab"/);
  const sales = read('sales-oracle.fr.html');
  assert.match(sales, /Essayer Sales Oracle/);
  assert.match(sales, /notes manuelles/);
  assert.match(sales, /og:title" content="Sales Oracle : préparez vos soutenances \| KayrosLab"/);

  const css = read('marketing.css');
  assert.doesNotMatch(css, /\.salon-charter/);
  assert.match(css, /\.personify-grid/);
});

test('Sales Oracle reste un outil du site, plus un écran de la console', () => {
  const tool = read('assets/sales-oracle-tool.js');
  assert.match(tool, /SALES_ORACLE_API_BASE/);
  const shell = read('frontend/console-app/src/components/console/Shell.tsx');
  assert.doesNotMatch(shell, /SalesOracleClient/);
});

test('simulation studio translations stay aligned', () => {
  const enKeys = Object.keys(en).filter((key) => key.startsWith('studio_')).sort();
  const frKeys = Object.keys(fr).filter((key) => key.startsWith('studio_')).sort();

  assert.deepEqual(frKeys, enKeys);
  assert.ok(enKeys.length >= 70, 'expected a complete bilingual simulation narrative');
  for (const key of enKeys) {
    assert.ok(en[key].trim(), `empty English translation: ${key}`);
    assert.ok(fr[key].trim(), `empty French translation: ${key}`);
  }
});

test('editorial illustration and Pages asset packaging are protected', () => {
  const asset = new URL('../assets/hybrid-agent-sales-oracle.png', import.meta.url);
  assert.ok(statSync(asset).size > 100_000, 'illustration looks missing or truncated');

  const workflow = read('.github/workflows/deploy-positionning-pages.yml');
  assert.match(workflow, /cp -r assets\/\. deploy\/assets\//, 'Pages copie la source unique assets/');
  assert.doesNotMatch(workflow, /backend\/web\/public\/assets/, 'plus de copie dupliquée des assets');
  assert.match(read('deploy/ovh-vps/assemble-www.sh'), /APP_DIR\}\/assets\/\./, 'OVH copie aussi assets/');
  assert.match(workflow, /deploy\/assets/);
  assert.match(workflow, /studio\.css/);
});
