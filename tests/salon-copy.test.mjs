import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url);

async function read(rel) {
  return readFile(new URL(rel, root), 'utf8');
}

test('version EN : plus de copie française dans le chrome ni le spécimen', async () => {
  const html = await read('salon/index.html');
  const published = await read('backend/web/public/salon/index.html');
  const i18n = await read('salon/src/lib/salon/i18n.ts');
  const foyer = await read('salon/src/components/salon/Foyer.tsx');
  const chrome = await read('salon/src/components/salon/Chrome.tsx');
  for (const page of [html, published]) {
    const start = page.indexOf('\n      en: {');
    const end = page.indexOf('\n    };', start);
    assert.ok(start > 0 && end > start, 'bloc I18N.en');
    const en = page.slice(start, end);
    assert.match(en, /"hero.title": "They put on the skin of a book."/);
    assert.match(en, /"spec.host": "@voltaire is optimism/);
    assert.match(en, /"circle.lumieres": "Enlightenment"/);
    assert.match(en, /"auth.enter": "Enter"/);
    assert.match(en, /"auth.out": "Leave"/);
    assert.doesNotMatch(en, /Ils prennent la peau/);
    assert.doesNotMatch(en, /Que reste-t-il de la liberté/);
    assert.doesNotMatch(en, /"circle.lumieres": "Lumières"/);
    assert.doesNotMatch(en, /politesse faite au malheur/);
    assert.doesNotMatch(en, /cultiver son jardin/);
    assert.match(page, /id="salon-auth"/);
    assert.match(page, /\/v1\/salon\/state/);
    assert.match(page, /kayros-salon-token/);
    assert.match(page, /data-i18n="spec.host"/);
    assert.match(page, /data-author-blurb="voltaire"/);
  }
  const enTs = i18n.slice(i18n.indexOf('const en:'));
  assert.match(enTs, /They put on the skin of a book/);
  assert.match(enTs, /"auth.enter": "Enter"/);
  assert.doesNotMatch(enTs, /Ils prennent la peau/);
  assert.doesNotMatch(enTs, /Que reste-t-il de la liberté/);
  assert.doesNotMatch(enTs, /"circle.lumieres": "Lumières"/);
  assert.doesNotMatch(foyer, /defaultValue="Lumières"/);
  assert.match(foyer, /t\("circle.lumieres"\)/);
  assert.match(chrome, /startSalonSso/);
  assert.match(chrome, /t\("auth.enter"\)/);
});

test('pied de Salon : mentions, cookies c15t, CGU, contact', async () => {
  const html = await read('salon/index.html');
  const published = await read('backend/web/public/salon/index.html');
  const legal = await read('legal/index.html');
  const consent = await read('legal/c15t-consent.js');
  for (const page of [html, published]) {
    assert.match(page, /id="contact"/);
    assert.match(page, /id="contact-letter"/);
    assert.match(page, /id="contact-bug"/);
    assert.match(page, /type="file"/);
    assert.match(page, /\/legal\/#mentions/);
    assert.match(page, /\/legal\/#cookies/);
    assert.match(page, /\/legal\/#cgu/);
    assert.match(page, /id="c15t-banner"/);
    assert.match(page, /\/legal\/c15t-consent\.js/);
    assert.match(page, /36, rue de l’abbé Groult/);
    assert.match(page, /contact@kayroslab.com/);
  }
  assert.match(legal, /SASU KayrosLab/);
  assert.match(legal, /Geoffroy de La Tournelle/);
  assert.match(legal, /00 33 6 69 28 29 16/);
  assert.match(legal, /OVH SAS/);
  assert.match(legal, /github.com\/c15t\/c15t/);
  assert.match(consent, /github.com\/c15t\/c15t/);
  assert.match(consent, /getOrCreateConsentRuntime/);
  assert.match(consent, /GTM-TXNT5J6M|applyGtmConsent/);
  const ga4 = await read('legal/ga4.js');
  assert.match(ga4, /kayrosTrack/);
  assert.match(ga4, /demo_start/);
  assert.match(html, /kayrosTrack\("generate_lead"/);
  const home = await read('index.html');
  assert.match(home, /kayrosTrack\('generate_lead'/);
  const gtm = JSON.parse(await read('legal/gtm-ga4-conversions.json'));
  assert.equal(gtm.containerVersion.container.publicId, 'GTM-TXNT5J6M');
  const tagNames = gtm.containerVersion.tag.map((t) => t.name).join(' ');
  assert.match(tagNames, /generate_lead/);
  assert.match(tagNames, /demo_start/);
  for (const page of [html, published, legal]) {
    assert.match(page, /GTM-TXNT5J6M/);
    assert.match(page, /googletagmanager.com\/gtm.js/);
    assert.match(page, /googletagmanager.com\/ns.html/);
  }
});

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
    assert.match(page, /"agents\.fiches": "The authors"/);
    assert.match(page, /"kind\.philosophe": "Philosopher"/);
    assert.match(page, /"send": "Send"/);
    assert.match(page, /"hero.title": "They put on the skin of a book."/);
    assert.match(page, /\/salon\/#agents/);
    assert.match(page, /"circle\.lumieres": "Enlightenment"/);
    assert.match(page, /"nameEn": "Aristotle"/);
    assert.match(page, /id="agent-list"/);
    assert.match(page, /"agents\.h1": "Configure the personality."/);
    assert.match(page, /card-body/);
    assert.match(page, /n-works/);
    assert.match(page, /loading=\\"lazy\\"/);
    assert.equal((page.match(/"nameEn":/g) || []).length, 54);
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
    const author = catalog.authors.find((a) => a.id === id);
    assert.match(author.avatar, /\.jpg$/);
  }
  for (const id of ['christianisme', 'judaisme', 'islam', 'hindouisme', 'bouddhisme', 'taoisme']) {
    const author = catalog.authors.find((a) => a.id === id);
    assert.ok(author, id);
    assert.equal(author.kind, 'tradition');
    assert.match(author.avatar, /\.svg$/);
    assert.ok(author.works.length >= 1, id);
    assert.ok(author.nameEn);
    assert.ok(author.blurbEn);
  }
  assert.ok(catalog.authors.find((a) => a.id === 'christianisme').works.length >= 4);
  assert.ok(catalog.authors.find((a) => a.id === 'judaisme').works.length >= 4);
  assert.ok(catalog.authors.find((a) => a.id === 'hindouisme').works.length >= 4);
});

test('chaque œuvre du catalogue est un texte de l’auteur, sans doublon ni parasite', async () => {
  const catalog = JSON.parse(await read('salon/src/lib/salon/catalog.json'));
  const forbidden =
    /expositor.?s bible|baird lecture|imitation of christ|gospel of buddha|proclus|montaigne and shakspere|quotes and images|linked index|life and letters of charles darwin/i;
  const byId = Object.fromEntries(catalog.authors.map((a) => [a.id, a]));
  for (const author of catalog.authors) {
    const titles = author.works.map((w) => w.title);
    assert.equal(titles.length, new Set(titles).size, author.id);
    for (const work of author.works) {
      assert.equal(work.ok, true, `${author.id} ${work.title}`);
      assert.match(work.url, /gutenberg\.org/, `${author.id} ${work.title}`);
      assert.doesNotMatch(work.title, forbidden, `${author.id} ${work.title}`);
    }
    assert.ok(author.works.length >= 1, author.id);
  }
  assert.ok(byId.platon.works.every((w) => !/proclus/i.test(w.title)));
  assert.ok(byId.epicure.works.some((w) => /menoeceus/i.test(w.title)));
  assert.ok(byId.diderot.works.length >= 4);
  assert.ok(byId.smith.works.every((w) => /wealth|moral sentiments|essays of adam smith/i.test(w.title)));
  assert.equal(byId.suntzu.works.length, 1);
  assert.equal(byId.marcaurele.works.length, 1);
  assert.equal(byId.islam.works.length, 1);
});

test('#agents ouvre le volet auteurs', async () => {
  const html = await read('salon/index.html');
  const published = await read('backend/web/public/salon/index.html');
  for (const page of [html, published]) {
    const user = page.indexOf('let salonUser = null');
    const apply = page.indexOf('try { applyI18n(); }');
    const show = page.indexOf('show(loc.pane, loc.author)');
    assert.ok(user > 0 && user < apply, 'salonUser déclaré avant applyI18n');
    assert.ok(apply > 0 && apply < show, 'hash lu après i18n');
    assert.match(page, /href="\/salon\/#agents"/);
    assert.match(page, /\.pane:target/);
    assert.match(page, /hash === "agents"/);
    assert.match(page, /id="agents"/);
    assert.match(page, /href="\/salon\/#fiche\//);
    assert.match(page, /data-author="voltaire"/);
    assert.match(page, /href="\/salon\/#academie"/);
    assert.match(page, /href="\/salon\/#pouvoir"/);
    assert.match(page, /mailto:contact@kayroslab.com/);
    assert.match(page, /contact\.err\.smtp/);
    assert.match(page, /role="alert"/);
    assert.match(page, /paintContactStatus/);
  }
});
