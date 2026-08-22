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

test('source template exposes both governed rehearsal tracks', () => {
  const template = read('backend/web/views/index.ejs');

  assert.match(template, /id="sales-oracle"/);
  assert.match(template, /assets\/hybrid-agent-sales-oracle\.png/);
  assert.match(template, /sales_oracle_comex_title/);
  assert.match(template, /sales_oracle_rfp_title/);
  assert.match(template, /sales_oracle_safeguard/);
  assert.match(template, /prefers-reduced-motion/);
});

test('generated static pages contain the Sales Oracle and its illustration', () => {
  for (const file of ['index.html', 'index.fr.html']) {
    const html = read(file);
    assert.match(html, /id="sales-oracle"/);
    assert.match(html, /assets\/hybrid-agent-sales-oracle\.png/);
    assert.doesNotMatch(html, /sales_oracle_[a-z_]+/);
  }
});

test('editorial illustration and Pages asset packaging are protected', () => {
  const asset = new URL('../backend/web/public/assets/hybrid-agent-sales-oracle.png', import.meta.url);
  assert.ok(statSync(asset).size > 100_000, 'illustration looks missing or truncated');

  const workflow = read('.github/workflows/deploy-positionning-pages.yml');
  assert.match(workflow, /backend\/web\/public\/assets/);
  assert.match(workflow, /deploy\/assets/);
});
