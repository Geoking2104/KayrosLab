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
  assert.doesNotMatch(i18n, /Chercher au domaine public/);
  assert.doesNotMatch(i18n, /Search the public domain/);
  assert.match(i18n, /"agents\.fiches": "Les auteurs"/);
  assert.match(i18n, /"agents\.fiches": "The authors"/);
  assert.doesNotMatch(i18n, /Les \{n\} fiches/);
  assert.doesNotMatch(i18n, /The \{n\} profiles/);
});

test('Salon spécimen HTML suit la même copie', async () => {
  const html = await read('salon/index.html');
  const published = await read('backend/web/public/salon/index.html');
  for (const page of [html, published]) {
    assert.match(page, /Convier/);
    assert.match(page, /tout le monde écoute/);
    assert.match(page, /1 — Nom du cercle/);
    assert.match(page, /3 — Invités/);
    assert.match(page, /Auteurs/);
    assert.doesNotMatch(page, /Faire entrer/);
    assert.doesNotMatch(page, /personne ne vote/);
    assert.doesNotMatch(page, /3\/6/);
    assert.match(page, /data-i18n="agents\.fiches"/);
    assert.match(page, /"kind\.philosophe": "Philosopher"/);
    assert.match(page, /"send": "Send"/);
    assert.match(page, /"handle": "Handle @"/);
    assert.doesNotMatch(page, /Les \{n\} fiches|28 fiches/);
  }
});

test('le catalogue élargi tient Shakespeare, vingt philosophes et les traditions', async () => {
  const catalog = JSON.parse(await read('salon/src/lib/salon/catalog.json'));
  const ids = new Set(catalog.authors.map((a) => a.id));
  assert.equal(catalog.authors.length, 54);
  assert.ok(ids.has('shakespeare'));
  for (const id of ['seneca', 'ciceron', 'pascal', 'diderot', 'hume', 'mill']) {
    assert.ok(ids.has(id), id);
  }
  for (const id of ['christianisme', 'judaisme', 'islam', 'hindouisme', 'bouddhisme', 'taoisme']) {
    const author = catalog.authors.find((a) => a.id === id);
    assert.ok(author, id);
    assert.equal(author.kind, 'tradition');
    assert.match(author.avatar, /\.svg$/);
    assert.ok(author.works.length >= 4, id);
  }
});
