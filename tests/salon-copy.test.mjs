import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url);

async function read(rel) {
  return readFile(new URL(rel, root), 'utf8');
}

test('Salon i18n : cercle, convier, personnalité, auteurs', async () => {
  const i18n = await read('salon/src/lib/salon/i18n.ts');
  assert.match(i18n, /tout le monde écoute/);
  assert.match(i18n, /everyone listens/);
  assert.match(i18n, /"index\.enter": "Convier"/);
  assert.match(i18n, /"index\.enter": "Invite"/);
  assert.match(i18n, /"index\.seated": "\{n\} invités"/);
  assert.match(i18n, /"index\.seated": "\{n\} guests"/);
  assert.doesNotMatch(i18n, /\{n\}\/6/);
  assert.match(i18n, /Configurer la personnalité/);
  assert.match(i18n, /Configure the personality/);
  assert.doesNotMatch(i18n, /rhétorique ou elenchus/);
  assert.doesNotMatch(i18n, /rhetoric or elenchus/);
  assert.match(i18n, /Ajouter un auteur/);
  assert.match(i18n, /Add an author/);
  assert.match(i18n, /Chacun son style, chacun sa personnalité/);
  assert.match(i18n, /Each has a style, each a personality/);
  assert.doesNotMatch(i18n, /Ils ne votent pas/);
  assert.doesNotMatch(i18n, /They do not vote/);
  assert.match(i18n, /"nav\.agents": "Auteurs"/);
  assert.match(i18n, /"nav\.agents": "Authors"/);
});

test('Salon spécimen HTML suit la même copie', async () => {
  const html = await read('salon/index.html');
  const published = await read('backend/web/public/salon/index.html');
  for (const page of [html, published]) {
    assert.match(page, /Convier/);
    assert.match(page, /tout le monde écoute/);
    assert.match(page, /1 — Nom du cercle/);
    assert.match(page, /3 — Invités/);
    assert.match(page, /Ajouter un auteur|Auteurs/);
    assert.doesNotMatch(page, /Faire entrer/);
    assert.doesNotMatch(page, /personne ne vote/);
    assert.doesNotMatch(page, /3\/6/);
  }
});
