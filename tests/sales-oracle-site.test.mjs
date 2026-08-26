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

test('generated static pages contain the studio narrative and secure Sales Oracle', () => {
  for (const file of ['index.html', 'index.fr.html']) {
    const html = read(file);
    assert.match(html, /id="secure-workspace"/);
    assert.match(html, /id="timesfm"/);
    assert.match(html, /href="\.\/studio\.css"/);
    assert.doesNotMatch(html, /sales_oracle_[a-z_]+/);
    assert.doesNotMatch(html, /studio_[a-z_]+/);
  }
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
  const asset = new URL('../backend/web/public/assets/hybrid-agent-sales-oracle.png', import.meta.url);
  assert.ok(statSync(asset).size > 100_000, 'illustration looks missing or truncated');

  const workflow = read('.github/workflows/deploy-positionning-pages.yml');
  assert.match(workflow, /backend\/web\/public\/assets/);
  assert.match(workflow, /deploy\/assets/);
  assert.match(workflow, /studio\.css/);
});
