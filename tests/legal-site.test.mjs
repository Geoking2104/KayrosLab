// Pages légales et suivi : assertions conservées de l'ancien tests/salon-copy.test.mjs
// (le Salon a été supprimé ; /legal/ décrit désormais le seul service KayrosLab).
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url);
const read = (rel) => readFile(new URL(rel, root), 'utf8');

test('légal : mentions, cookies c15t, CGU et GTM, sans Salon', async () => {
  const legal = await read('legal/index.html');
  const consent = await read('legal/c15t-consent.js');
  assert.match(legal, /SASU KayrosLab/);
  assert.match(legal, /Geoffroy de La Tournelle/);
  assert.match(legal, /00 33 6 69 28 29 16/);
  assert.match(legal, /OVH SAS/);
  assert.match(legal, /github.com\/c15t\/c15t/);
  assert.match(legal, /atelier de décision gouverné/);
  assert.match(legal, /governed decision workshop/);
  assert.doesNotMatch(legal, /salon/i);
  assert.doesNotMatch(legal, /href="\/salon/);
  assert.match(consent, /github.com\/c15t\/c15t/);
  assert.match(consent, /getOrCreateConsentRuntime/);
  assert.match(consent, /GTM-TXNT5J6M|applyGtmConsent/);
  const ga4 = await read('legal/ga4.js');
  assert.match(ga4, /kayrosTrack/);
  assert.match(ga4, /demo_start/);
  const gtm = JSON.parse(await read('legal/gtm-ga4-conversions.json'));
  assert.equal(gtm.containerVersion.container.publicId, 'GTM-TXNT5J6M');
  const tagNames = gtm.containerVersion.tag.map((t) => t.name).join(' ');
  assert.match(tagNames, /generate_lead/);
  assert.match(tagNames, /demo_start/);
  assert.match(legal, /GTM-TXNT5J6M/);
  assert.match(legal, /googletagmanager.com\/gtm.js/);
  assert.match(legal, /googletagmanager.com\/ns.html/);
});

test('accueil : conversion generate_lead', { todo: 'index.html racine sans GTM/GA4 depuis aaf2e10 et e7912b8 : décision du propriétaire (réintégrer le suivi ou retirer ce test)' }, async () => {
  const home = await read('index.html');
  assert.match(home, /kayrosTrack\('generate_lead'/);
});
