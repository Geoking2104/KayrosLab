import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('landing presents the Salesforce connector and the integrated chats in both languages', () => {
  for (const file of ['index.html', 'index.fr.html']) {
    const html = read(file);
    assert.match(html, /<section id="integrations"/);
    assert.match(html, /<section id="chats"/);
    assert.match(html, /href="#integrations"/); // nav entry
    assert.match(html, /href="#chats"/);        // footer entry
    assert.match(html, /Proposal\/Price Quote/);
    assert.match(html, /integrations\/n8n\/README\.md/);
    assert.match(html, /https:\/\/api\.kayroslab\.com\/docs/);
    for (const platform of ['Slack', 'Microsoft Teams', 'Discord', '/kayros', 'Ed25519', 'Zapier']) {
      assert.ok(html.includes(platform), `${file}: missing ${platform}`);
    }
    // The new sections sit before the Sales Oracle spotlight, each id only once.
    assert.ok(html.indexOf('id="integrations"') < html.indexOf('id="oracle"'));
    assert.equal(html.match(/id="integrations"/g).length, 1);
    assert.equal(html.match(/id="chats"/g).length, 1);
  }
  assert.match(read('index.fr.html'), /Connecteur Salesforce/);
  assert.match(read('index.html'), /Salesforce connector/);
});

test('every in-page anchor of the landing resolves to an element', () => {
  for (const file of ['index.html', 'index.fr.html']) {
    const html = read(file);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) {
      assert.ok(ids.has(target), `${file}: #${target} has no target`);
    }
  }
});
