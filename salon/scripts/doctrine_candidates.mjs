#!/usr/bin/env node
/**
 * doctrine_candidates.mjs — outil de travail (non déployé, lot 2 du plan v2).
 *
 * Liste des phrases candidates pour une ancre de doctrine, extraites du TEXTE
 * ENTIER des œuvres lues (mêmes règles de découpe que la récolte, sans la
 * coupe 10–97 %), filtrées de la troisième personne (authorNameRe), classées
 * par pertinence pour le domaine (E.relevance sur les clés FR+EN du domaine).
 *
 * Sortie : salon/doctrine-review/<id>.md — sert à la relecture humaine ;
 * le choix final (thèse + ancre) est recopié à la main dans doctrine.json.
 *
 * Usage : node salon/scripts/doctrine_candidates.mjs --author platon --domain justice,vertu [--top 15] [--works 5]
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repo, E, cutGutenberg, authorNameRe, sentences, fetchText } from './corpus_lib.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : dflt;
};
const AUTHOR = arg('author', '');
const DOMAINS = String(arg('domain', '')).split(',').map((s) => s.trim()).filter(Boolean);
const TOP = Number(arg('top', 15)) || 15;
const WORKS = Number(arg('works', 5)) || 5;

if (!AUTHOR || !DOMAINS.length) {
  console.error('usage : node salon/scripts/doctrine_candidates.mjs --author <id> --domain <d1,d2> [--top 15] [--works 5]');
  process.exit(1);
}

const Q = {
  liberte: 'Que reste-t-il de la liberté une fois qu’on a tout expliqué ?',
  pouvoir: 'Le pouvoir peut-il être légitime ?',
  justice: 'Faut-il obéir à une loi injuste ?',
  verite: 'La vérité se décrète-t-elle ?',
  conscience: 'Une machine peut-elle avoir une conscience ?',
  vertu: 'La vertu s’apprend-elle ?',
  bonheur: 'Qu’est-ce que le bonheur ?',
  education: 'Que doit-on apprendre à un enfant ?',
  travail: 'Le travail rend-il libre ?',
  nature: 'La nature a-t-elle des droits ?',
  religion: 'Faut-il croire en Dieu ?',
  amour: 'L’amour est-il un choix ?',
  art: 'À quoi sert l’art ?',
  guerre: 'La guerre peut-elle être juste ?',
  temps: 'Faut-il avoir peur de la mort ?',
};

const catalog = JSON.parse(readFileSync(join(repo, 'salon/src/lib/salon/catalog.json'), 'utf8'));
const author = catalog.authors.find((a) => a.id === AUTHOR);
if (!author) { console.error('auteur inconnu : ' + AUTHOR); process.exit(1); }

const works = (author.works || []).filter((w) => w && w.url && /gutenberg\.org/.test(w.url)).slice(0, WORKS);
const nameRe = authorNameRe(author);

const sources = [];
for (const w of works) {
  const raw = await fetchText(w.url);
  if (!raw) { console.error('fetch KO : ' + w.title); continue; }
  const list = sentences(cutGutenberg(raw, w, { window: false })).filter((s) => !nameRe || !nameRe.test(s));
  sources.push({ title: w.title, list });
  console.error(`${w.title}: ${list.length} phrases (texte entier)`);
}

const outDir = join(repo, 'salon', 'doctrine-review');
mkdirSync(outDir, { recursive: true });

const sections = [];
const stamp = new Date().toISOString().slice(0, 10);
sections.push(`# Candidats d'ancres — ${author.name} (${author.id})`);
sections.push('');
sections.push(`Généré le ${stamp} · outil \`salon/scripts/doctrine_candidates.mjs\` · texte entier des ${works.length} œuvres lues (sans la coupe 10–97 %).`);
sections.push('Le choix final est humain : recopier le début exact de la phrase (`startsWith`) dans `doctrine.json`.');
sections.push('');

for (const dom of DOMAINS) {
  const q = Q[dom] || dom;
  const sc = E.scope(q);
  const query = [sc.keysRaw, sc.labelEn || ''].join(' ');
  const scored = [];
  for (const src of sources) {
    src.list.forEach((s, i) => {
      const score = E.relevance(query, s);
      const pct = src.list.length ? Math.round((i / src.list.length) * 100) : 0;
      scored.push({ work: src.title, s, score, pct });
    });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.pct - b.pct));
  const top = scored.slice(0, TOP);
  sections.push(`## ${dom} — « ${q} »`);
  sections.push('');
  sections.push('| score | œuvre | % | phrase |');
  sections.push('|---|---|---|---|');
  for (const t of top) sections.push(`| ${t.score.toFixed(3)} | ${t.work} | ${t.pct}% | ${t.s.replace(/\|/g, '\\|')} |`);
  sections.push('');
}

const file = join(outDir, `${author.id}.md`);
writeFileSync(file, sections.join('\n'));
console.log('écrit ' + file);
