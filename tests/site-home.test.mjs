import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const words = (html) => html.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
const PAGES = ['integrations', 'sales-oracle', 'personas', 'security-governance', 'developers', 'demo'];

test('accueil court : 7 sections + FAQ, un seul CTA principal vers l’essai, démo en lien secondaire', () => {
  for (const [file, lang, cta] of [['index.fr.html', 'fr', 'Tester sur ma décision — gratuit'], ['index.html', 'en', 'Test it on my decision — free']]) {
    const html = read(file);
    for (const id of ['decisions', 'debate', 'verdict', 'tools', 'start', 'example', 'try', 'faq']) assert.match(html, new RegExp(`<section[^>]*\\sid="${id}"`), `${file}: #${id}`);
    assert.ok(words(html) < 1100, `${file}: ${words(html)} mots, trop long`);
    // Tous les boutons d'action ouvrent le formulaire de contact (demande d'accès console, sélection manuelle).
    for (const [, href] of html.matchAll(/class="btn[^"]*"\s+href="([^"]+)"/g)) assert.equal(href, "#contact");
    assert.ok(html.includes(cta));
    assert.match(html, new RegExp(`href="demo${lang === 'fr' ? '.fr' : ''}.html"`));
    assert.match(html, /assets\/home\.js/);
    assert.match(html, /role="tablist"/);
    assert.match(html, /id="h-sticky"/);
  }
});

test('preuves : exemple anonymisé explicitement marqué, aucun témoignage ni chiffre client inventé', () => {
  assert.match(read('index.fr.html'), /Exemple anonymisé et illustratif — pas un témoignage client/);
  assert.match(read('index.html'), /Anonymised, illustrative example — not a customer testimonial/);
  for (const file of ['index.html', 'index.fr.html']) {
    const html = read(file);
    assert.doesNotMatch(html, /<blockquote|testimonial-card|\d[\d\s,.]*\+?\s*(clients|customers|utilisateurs|users) (nous font confiance|trust)/i);
  }
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
      assert.ok(read(home).includes(`href="${file}"`), `${home} → ${file}`);
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
