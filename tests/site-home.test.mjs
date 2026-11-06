import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const words = (html) => html.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
const PAGES = ['integrations', 'sales-oracle', 'personas', 'security-governance', 'developers', 'demo'];

test('accueil : récit en quatre temps, accès console explicite, démo en lien secondaire', () => {
  for (const [file, lang, cta] of [['index.fr.html', 'fr', 'Demander un accès à la console'], ['index.html', 'en', 'Request console access']]) {
    const html = read(file);
    for (const id of ['decisions', 'debate', 'verdict', 'tools', 'start', 'example', 'try', 'faq']) assert.match(html, new RegExp(`<section[^>]*\\sid="${id}"`), `${file}: #${id}`);
    const order = ['decisions', 'debate', 'example', 'verdict', 'tools', 'start', 'try', 'faq'].map((id) => html.indexOf(`id="${id}"`));
    assert.ok(order.every((position, i) => i === 0 || position > order[i - 1]), `${file}: récit dans le bon ordre`);
    // FR validé (double pilier + personnifié) : 1134 mots mesurés après intégration (932 avant).
    // Plafond FR 1400 = marge pour le récit approuvé sans forcer un raccourci arbitraire ; EN reste à 1100.
    const limit = file.includes('.fr.') ? 1400 : 1100;
    assert.ok(words(html) < limit, `${file}: ${words(html)} mots, trop long (limite ${limit})`);
    // Tous les boutons d'action ouvrent le formulaire de contact (demande d'accès console, sélection manuelle).
    for (const [, href] of html.matchAll(/class="btn[^"]*"\s+href="([^"]+)"/g)) assert.equal(href, "#contact");
    assert.ok(html.includes(cta));
    const demo = `demo${lang === 'fr' ? '.fr' : ''}.html`;
    assert.ok(html.includes(`href="/${demo}"`) || html.includes(`href="${demo}"`));
    assert.match(html, /assets\/home\.js/);
    assert.match(html, /role="tablist"/);
    assert.match(html, /id="h-sticky"/);
    assert.doesNotMatch(html, /class="h-mock"|data-type=/);
  }
});

test('preuves : captures produit localisées et démonstrations fictives signalées', () => {
  assert.match(read('index.html'), /assets\/console-project-graph\.webp/);
  assert.match(read('index.html'), /assets\/console-company\.webp/);
  assert.match(read('index.fr.html'), /assets\/console-overview\.webp/);
  assert.match(read('index.fr.html'), /assets\/console-dossier\.webp/);
  assert.ok(read('index.html').includes('og:image" content="https://www.kayroslab.com/assets/console-project-graph.webp'));
  assert.ok(read('index.fr.html').includes('og:image" content="https://www.kayroslab.com/assets/console-overview.webp'));
  assert.match(read('index.fr.html'), /Espace de démonstration fictif/);
  assert.match(read('index.html'), /Fictional demonstration workspace/);
  for (const file of ['index.html', 'index.fr.html']) assert.doesNotMatch(read(file), /<blockquote|testimonial-card|class="h-mock"/);
});

test('bilingue et mobile : langue déclarée, liens croisés et règles étroites', () => {
  const en = read('index.html');
  const fr = read('index.fr.html');
  assert.match(en, /<html lang="en">/);
  assert.match(fr, /<html lang="fr">/);
  assert.match(en, /href="\/index\.fr\.html" hreflang="fr"/);
  assert.match(fr, /href="\/" hreflang="en"/);
  assert.match(en, /Rehearse the decision <em>before you defend it\./);
  assert.match(fr, /Éprouvez la décision\. <em>Répétez sa défense\./);
  const css = read('marketing.css');
  assert.match(css, /@media\s*\(max-width:620px\)/);
  assert.match(css, /\.h-stage-grid,\.h-tools-in\{grid-template-columns:1fr/);
  assert.match(css, /\.h-tablist\{flex-wrap:nowrap[^}]*overflow-x:auto/);
  assert.match(css, /@media\(max-width:340px\)[\s\S]*?\.home \.nav-right>\.btn\{display:none\}/);
  for (const html of [en, fr]) assert.equal((html.match(/class="logo-chip"/g) || []).length, 6);
});

test('le détail déplacé reste publié sur les pages secondaires (FR + EN), liées depuis le menu', () => {
  const where = {
    integrations: ['id="integrations"', 'id="chats"', 'Proposal/Price Quote'],
    'sales-oracle': ['id="oracle"'],
    personas: ['id="personify"', 'CrystalKnows'],
    'security-governance': ['id="trust"', 'id="approach"', 'id="outcomes"', 'id="platform"'],
    developers: ['id="builders"'],
    demo: ['id="demo-form"', 'id="cases"', 'id="how"', 'id="faq"'],
  };
  for (const [slug, needles] of Object.entries(where)) {
    for (const [file, home] of [[`${slug}.html`, 'index.html'], [`${slug}.fr.html`, 'index.fr.html']]) {
      const html = read(file);
      for (const n of needles) assert.ok(html.includes(n), `${file}: ${n}`);
      assert.match(html, /marketing\.css/);
      const landing = read(home);
      assert.ok(landing.includes(`href="/${file}"`) || landing.includes(`href="${file}"`), `${home} → ${file}`);
    }
  }
});

test('home.js : onglets au clavier, mouvement réduit respecté', () => {
  const js = read('assets/home.js');
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /ArrowRight/);
  const css = read('marketing.css');
  assert.match(css, /\.h-panel\[hidden\]\{display:none\}/);
  // Le défilement des logos a été retiré (f861e98) ; s'il revient, il doit respecter le mouvement réduit.
  if (/\.h-track\{[^}]*animation:h-scroll/.test(css)) assert.match(css, /prefers-reduced-motion:reduce\)\{[\s\S]*\.h-track\{animation:none/);
});

test('les pages secondaires sont assemblées pour www et GitHub Pages', () => {
  const www = read('deploy/ovh-vps/assemble-www.sh');
  const pages = read('.github/workflows/deploy-positionning-pages.yml');
  for (const slug of PAGES) for (const f of [`${slug}.html`, `${slug}.fr.html`]) {
    assert.ok(www.includes(f), `assemble-www: ${f}`);
    assert.ok(pages.includes(f), `pages: ${f}`);
  }
});


const attrContent = (html, needle) => {
  const re = new RegExp(`${needle}" content="([^"]*)"`);
  const m = html.match(re);
  return m ? m[1] : null;
};
const pageTitle = (html) => (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.trim() || null;

test('accueil FR : agent personnifié tôt, liens personas/oracle, consentement et non-prédiction', () => {
  const html = read('index.fr.html');
  const personifyBlock = html.indexOf('id="personify-home-title"');
  const example = html.indexOf('id="example"');
  const debate = html.indexOf('id="debate"');
  assert.ok(personifyBlock > -1, 'bloc agent personnifié présent');
  assert.ok(personifyBlock > debate && personifyBlock < example, 'bloc personnifié entre #debate et #example');
  assert.match(html, /Les réactions personnifiées sont des simulations/);
  assert.doesNotMatch(html, /réactions personnifiés[^e]/);
  assert.match(html, /pas des propos réels ni des prédictions sur la personne/);
  assert.match(html, /profil autorisé/);
  assert.match(html, /consentement/);
  assert.ok(html.includes('href="/personas.fr.html#personify"'));
  assert.ok(html.includes('href="/sales-oracle.fr.html#oracle"'));
  assert.match(read('personas.fr.html'), /\sid="personify"/);
  assert.match(read('sales-oracle.fr.html'), /\sid="oracle"/);
  assert.ok(html.includes('Demander un accès à la console'));
  assert.ok(html.includes('Voir un exemple de dossier'));
  assert.match(html, /href="#example"/);
  for (const [, href] of html.matchAll(/class="btn[^"]*"\s+href="([^"]+)"/g)) assert.equal(href, '#contact');
});

test('meta FR : title, description, og et twitter alignés (accueil, personas, sales-oracle)', () => {
  const pages = [
    ['index.fr.html', 'KayrosLab — Éprouvez la décision. Répétez sa défense.', 'Confrontez votre décision aux objections métier et préparez sa défense avec des agents personnifiés. Dossier consultatif, simulations explicites, arbitrage humain.'],
    ['personas.fr.html', 'Agents personnifiés : préparez vos échanges | KayrosLab', 'Associez un rôle métier à un profil autorisé pour répéter une discussion. Explorez les objections possibles, sans prédire la pensée ni la décision d’une personne.'],
    ['sales-oracle.fr.html', 'Sales Oracle : préparez vos soutenances | KayrosLab', 'Éprouvez votre proposition commerciale et répétez la soutenance avec des mandats métier et des parties prenantes simulées à partir de profils autorisés.'],
  ];
  for (const [file, title, description] of pages) {
    const html = read(file);
    assert.equal(pageTitle(html), title, `${file}: <title>`);
    assert.equal(attrContent(html, 'og:title'), title, `${file}: og:title`);
    assert.equal(attrContent(html, 'twitter:title'), title, `${file}: twitter:title`);
    assert.equal(attrContent(html, 'name="description'), description, `${file}: description`);
    assert.equal(attrContent(html, 'og:description'), description, `${file}: og:description`);
    assert.equal(attrContent(html, 'twitter:description'), description, `${file}: twitter:description`);
  }
});
