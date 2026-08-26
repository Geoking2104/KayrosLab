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

test('homepage follows the six-block decision-rehearsal path', () => {
  const template = read('backend/web/views/homepage.ejs');

  assert.match(template, /simple_hero_title/);
  assert.match(template, /id="use-cases"/);
  assert.match(template, /id="how-it-works"/);
  assert.match(template, /id="sample-dossier"/);
  assert.match(template, /id="trust"/);
  assert.match(template, /assets\/hybrid-agent-sales-oracle\.png/);
  assert.match(template, /simple_step_1_title/);
  assert.doesNotMatch(template, /id="modele"/);
  assert.doesNotMatch(template, /id="offre"/);
  assert.match(template, /prefers-reduced-motion/);
});

test('preview server exposes the homepage design tokens', () => {
  const template = read('backend/web/views/homepage.ejs');
  const server = read('backend/web/server.mjs');

  assert.match(template, /href="\.\/tokens\.css"/);
  assert.match(server, /app\.get\('\/tokens\.css'/);
  assert.match(server, /res\.sendFile\(path\.join\(__dirname, '\.\.', '\.\.', 'tokens\.css'\)\)/);
});

test('secure customer workspace is available without dominating the public explanation', () => {
  const template = read('backend/web/views/homepage.ejs');

  assert.match(template, /<details id="secure-workspace" class="workspace">/);
  assert.match(template, /sales_oracle_workspace_title/);
  assert.match(template, /data-sales-oracle-tool/);
});

test('generated static pages contain the Sales Oracle and its illustration', () => {
  for (const file of ['index.html', 'index.fr.html']) {
    const html = read(file);
    assert.match(html, /id="secure-workspace"/);
    assert.match(html, /assets\/hybrid-agent-sales-oracle\.png/);
    assert.match(html, /Split Studio/);
    assert.doesNotMatch(html, /sales_oracle_[a-z_]+/);
  }
});

test('simplified homepage translations stay aligned', () => {
  const enKeys = Object.keys(en).filter((key) => key.startsWith('simple_')).sort();
  const frKeys = Object.keys(fr).filter((key) => key.startsWith('simple_')).sort();

  assert.deepEqual(frKeys, enKeys);
  assert.ok(enKeys.length >= 50, 'expected a complete bilingual commercial path');
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
});
