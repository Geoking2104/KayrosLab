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
    assert.ok(words(html) < 1100, `${file}: ${words(html)} mots, trop long`);
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
  assert.match(fr, /Éprouvez la décision <em>avant de la défendre\./);
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
