import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('integrations page presents the Salesforce connector and the integrated chats in both languages', () => {
  for (const [home, file] of [['index.html', 'integrations.html'], ['index.fr.html', 'integrations.fr.html']]) {
    const landing = read(home);
    assert.ok(landing.includes(`href="${file}"`), `${home}: nav/footer link to ${file}`);
    const html = read(file);
    assert.match(html, /<section id="integrations"/);
    assert.match(html, /<section id="chats"/);
    assert.match(html, /Proposal\/Price Quote/);
    assert.match(html, /integrations\/n8n\/README\.md/);
    assert.match(html, /https:\/\/api\.kayroslab\.com\/docs/);
    for (const platform of ['Slack', 'Microsoft Teams', 'Discord', '/kayros', 'Ed25519', 'Zapier']) {
      assert.ok(html.includes(platform), `${file}: missing ${platform}`);
    }
    assert.equal(html.match(/id="integrations"/g).length, 1);
    assert.equal(html.match(/id="chats"/g).length, 1);
  }
  assert.match(read('integrations.fr.html'), /Connecteur Salesforce/);
  assert.match(read('integrations.html'), /Salesforce connector/);
});

const SITE = ['index', 'integrations', 'sales-oracle', 'personas', 'security-governance', 'developers', 'demo']
  .flatMap((p) => [`${p}.html`, `${p}.fr.html`]);

test('every anchor of the site pages resolves (same page or sibling page)', () => {
  const idsOf = (file) => new Set([...read(file).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const file of SITE) {
    const html = read(file);
    for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) {
      assert.ok(idsOf(file).has(target), `${file}: #${target} has no target`);
    }
    for (const [, page, target] of html.matchAll(/href="([a-z.-]+\.html)(?:#([^"]+))?"/g)) {
      if (!SITE.includes(page)) continue;
      if (target) assert.ok(idsOf(page).has(target), `${file}: ${page}#${target} has no target`);
    }
  }
});

test('integration logos are local (inline sprite + assets/logos), never hotlinked', () => {
  const logos = ['salesforce', 'slack', 'microsoft-teams', 'discord', 'n8n', 'zapier'];
  for (const file of ['index.html', 'index.fr.html']) {
    const html = read(file);
    for (const logo of logos) assert.match(html, new RegExp(`<use href="#logo-${logo}"/>`), `${file}: logo ${logo} unused`);
    assert.doesNotMatch(html, /simpleicons|cdn\.jsdelivr|unpkg\.com/);
  }
  for (const file of ['integrations.html', 'integrations.fr.html']) {
    const html = read(file);
    for (const logo of logos) {
      assert.match(html, new RegExp(`<symbol id="logo-${logo}"`), `${file}: missing symbol ${logo}`);
    }
    assert.doesNotMatch(html, /simpleicons|cdn\.jsdelivr|unpkg\.com/);
    assert.doesNotMatch(html, /panel hl reveal/);
    // Mock chat visuals show the three arbitration actions, as illustrations only.
    assert.equal((html.match(/class="gb ok"/g) || []).length, 3);
    assert.equal((html.match(/class="gb no"/g) || []).length, 3);
    assert.match(html, /class="sf-mock/);
  }
  for (const logo of logos) {
    for (const dir of ['assets/logos']) {
      assert.match(read(`${dir}/${logo}.svg`), /^<svg[^>]+viewBox="0 0 24 24"/);
    }
  }
});

test('landing motion respects prefers-reduced-motion', () => {
  const css = read('marketing.css');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*\.js \.reveal\{opacity:1;transform:none;transition:none\}/);
});
