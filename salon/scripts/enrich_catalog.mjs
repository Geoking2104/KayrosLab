#!/usr/bin/env node
/**
 * enrich_catalog.mjs — augmente le catalogue du Salon :
 *   1. œuvres supplémentaires pour les auteurs existants (GUTINDEX.ALL) ;
 *   2. nouveaux écrivains du domaine public (registre seed ci-dessous).
 *
 * Chaque candidat est vérifié par le RDF Gutenberg (titre, auteur, langue,
 * droits) avant d'être retenu. Aucune œuvre inventée : si le RDF ne confirme
 * pas, l'entrée est écartée et journalisée.
 *
 * Usage :
 *   node salon/scripts/enrich_catalog.mjs --dry-run          # rapport seul
 *   node salon/scripts/enrich_catalog.mjs --max-new-works 8  # écrit le catalogue
 *   node salon/scripts/enrich_catalog.mjs --author voltaire --max-new-works 12
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG_FILE, REPO, parseArgs, readJSON, writeJSON, nowIso } from './openkb_common.mjs';
import { slugify } from './textlib.mjs';

const GUTINDEX = join(REPO, 'gutindex.all.txt');
const GUTINDEX_URL = 'https://gutenberg.pglaf.org/GUTINDEX.ALL';
const REPORT = join(REPO, 'salon', 'scripts', 'reports', `catalog-enrich-${nowIso().slice(0, 10)}.json`);

/* ------------------------------------------------------------- nouveaux */

export const NEW_AUTHORS = [
  {
    id: 'moliere', name: 'Molière', kind: 'dramaturge', lang: 'fr',
    era: '1622–1673 · comédie classique', wikipedia: 'Molière', monogram: 'M',
    blurb: "Le rire comme scalpel : ridicules, hypocrisies et masques sociaux mis en scène jusqu'à la crise.",
    blurbEn: 'Laughter as a scalpel: absurdity, hypocrisy and social masks staged to the point of crisis.',
    match: ['Molière', 'Moliere', 'Jean-Baptiste Poquelin'],
  },
  {
    id: 'racine', name: 'Jean Racine', kind: 'dramaturge', lang: 'fr',
    era: '1639–1699 · tragédie classique', wikipedia: 'Jean Racine', monogram: 'JR',
    blurb: 'La passion comme fatalité : peu de mots, une pression continue, des êtres qui se perdent en se connaissant.',
    blurbEn: 'Passion as fate: few words, relentless pressure, characters undone by self-knowledge.',
    match: ['Racine', 'Jean Racine'],
  },
  {
    id: 'lafontaine', name: 'Jean de La Fontaine', kind: 'poète', lang: 'fr',
    era: '1621–1695 · classicisme', wikipedia: 'Jean de La Fontaine', monogram: 'LF',
    blurb: 'La fable comme pensée politique : animaux, morale légère, vérités qui passent par le récit.',
    blurbEn: 'The fable as political thought: animals, light morals, truths smuggled through narrative.',
    match: ['La Fontaine', 'Jean de La Fontaine', 'La Fontaine, Jean'],
  },
  {
    id: 'montesquieu', name: 'Montesquieu', kind: 'philosophe', lang: 'fr',
    era: '1689–1755 · Lumières', wikipedia: 'Montesquieu', monogram: 'M',
    blurb: 'Les institutions comparées : la liberté naît des contre-pouvoirs, non des intentions vertueuses.',
    blurbEn: 'Comparative institutions: liberty arises from checks, not from virtuous intentions.',
    match: ['Montesquieu', 'Charles de Secondat'],
  },
  {
    id: 'flaubert', name: 'Gustave Flaubert', kind: 'écrivain', lang: 'fr',
    era: '1821–1880 · réalisme', wikipedia: 'Gustave Flaubert', monogram: 'GF',
    blurb: 'Le mot juste et la bêtise : désirs médiocres, phrases exactes, ironie froide du détail.',
    blurbEn: 'The exact word and human stupidity: mediocre desires, precise sentences, cold irony of detail.',
    match: ['Flaubert', 'Gustave Flaubert'],
  },
  {
    id: 'maupassant', name: 'Guy de Maupassant', kind: 'écrivain', lang: 'fr',
    era: '1850–1893 · naturalisme', wikipedia: 'Guy de Maupassant', monogram: 'GM',
    blurb: 'La nouvelle comme couteau : une scène, une chute, la violence sociale saisie sans commentaire.',
    blurbEn: 'The short story as a blade: one scene, one turn, social violence caught without commentary.',
    match: ['Maupassant', 'Guy de Maupassant'],
  },
  {
    id: 'baudelaire', name: 'Charles Baudelaire', kind: 'poète', lang: 'fr',
    era: '1821–1867 · symbolisme', wikipedia: 'Charles Baudelaire', monogram: 'CB',
    blurb: "L'ennui, la ville, la beauté moderne : le mal comme expérience esthétique et morale.",
    blurbEn: 'Ennui, the city, modern beauty: evil as an aesthetic and moral experience.',
    match: ['Baudelaire', 'Charles Baudelaire'],
  },
  {
    id: 'dickens', name: 'Charles Dickens', kind: 'écrivain', lang: 'en',
    era: '1812–1870 · roman social', wikipedia: 'Charles Dickens', monogram: 'CD',
    blurb: 'La ville industrielle, l’enfance volée, la comédie humaine des institutions.',
    blurbEn: 'The industrial city, stolen childhood, the human comedy of institutions.',
    match: ['Dickens', 'Charles Dickens'],
  },
  {
    id: 'melville', name: 'Herman Melville', kind: 'écrivain', lang: 'en',
    era: '1819–1891 · roman américain', wikipedia: 'Herman Melville', monogram: 'HM',
    blurb: 'L’obsession et l’océan : le monde comme énigme morale, le travail comme destin.',
    blurbEn: 'Obsession and the sea: the world as moral enigma, labour as fate.',
    match: ['Melville', 'Herman Melville'],
  },
  {
    id: 'twain', name: 'Mark Twain', kind: 'écrivain', lang: 'en',
    era: '1835–1910 · humour américain', wikipedia: 'Mark Twain', monogram: 'MT',
    blurb: 'L’Amérique vue du fleuve : humour, imposture, innocence et violence ordinaire.',
    blurbEn: 'America seen from the river: humour, imposture, innocence and ordinary violence.',
    match: ['Twain', 'Mark Twain', 'Samuel Clemens'],
  },
  {
    id: 'whitman', name: 'Walt Whitman', kind: 'poète', lang: 'en',
    era: '1819–1892 · poésie américaine', wikipedia: 'Walt Whitman', monogram: 'WW',
    blurb: 'Le catalogue du monde : le corps, la démocratie, la multitude accueillie sans hiérarchie.',
    blurbEn: 'A catalogue of the world: the body, democracy, the multitude welcomed without hierarchy.',
    match: ['Whitman', 'Walt Whitman'],
  },
  {
    id: 'bronte', name: 'Emily Brontë', kind: 'écrivain', lang: 'en',
    era: '1818–1848 · romantisme anglais', wikipedia: 'Emily Brontë', monogram: 'EB',
    blurb: 'La lande et la passion : amour, cruauté et nécessité, sans consolation.',
    blurbEn: 'Moorland and passion: love, cruelty and necessity, without consolation.',
    match: ['Brontë', 'Emily Brontë', 'Brontë, Emily'],
  },
  {
    id: 'hardy', name: 'Thomas Hardy', kind: 'écrivain', lang: 'en',
    era: '1840–1928 · roman victorien', wikipedia: 'Thomas Hardy', monogram: 'TH',
    blurb: 'Le destin rural : désirs contrariés par la classe, la terre et le hasard.',
    blurbEn: 'Rural fate: desires thwarted by class, land and chance.',
    match: ['Hardy', 'Thomas Hardy'],
  },
  {
    id: 'tchekhov', name: 'Anton Tchekhov', kind: 'dramaturge', lang: 'ru',
    era: '1860–1904 · réalisme russe', wikipedia: 'Anton Tchekhov', monogram: 'AT',
    blurb: 'La vie sans événement : conversations, malentendus, dignité fragile des gens ordinaires.',
    blurbEn: 'Life without event: conversation, misunderstanding, the fragile dignity of ordinary people.',
    match: ['Chekhov', 'Tchekhov', 'Anton Chekhov', 'Чехов'],
  },
  {
    id: 'goethe', name: 'Johann Wolfgang von Goethe', kind: 'poète', lang: 'de',
    era: '1749–1832 · classicisme allemand', wikipedia: 'Johann Wolfgang von Goethe', monogram: 'JG',
    blurb: 'Le Faust et la forme : désir infini, Bildung, classicisme contre romantisme.',
    blurbEn: 'Faust and form: infinite desire, Bildung, classicism against romanticism.',
    match: ['Goethe', 'Johann Wolfgang von Goethe'],
  },
  {
    id: 'dante', name: 'Dante Alighieri', kind: 'poète', lang: 'it',
    era: '1265–1321 · Moyen Âge italien', wikipedia: 'Dante Alighieri', monogram: 'DA',
    blurb: 'L’ordre cosmique et la cité : amour, justice, exil, langue vulgaire élevée au rang d’art.',
    blurbEn: 'Cosmic order and the city: love, justice, exile, vernacular raised to art.',
    match: ['Dante', 'Dante Alighieri', 'Alighieri'],
  },
];

/* ------------------------------------------------------------- parsing */

const NOISE_TITLE = /^(the\s+)?(life|letters?|memoir|biography|study|criticism|essays? (on|about)|introduction|analysis|summary|guide|companion|reader'?s guide|handbook|dictionary of|history of (the )?(life|work)|bibliograph|index|catalogue|appendix)\b/i;

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Blocs séparés par une ligne vide ; le premier segment porte l'ID. */
export function parseGutindex(text) {
  const out = [];
  const blocks = String(text || '').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) continue;
    let id = null;
    let head = '';
    const meta = [];
    for (const line of lines) {
      const m = line.match(/^(.*?)\s{2,}(\d{1,7})\s*$/);
      if (!id && m && /,\s*by\s+/i.test(m[1])) {
        id = m[2];
        head = m[1].trim();
        continue;
      }
      if (id && /^\s*\[/.test(line)) meta.push(line.trim());
      else if (id && !head.endsWith(']')) head += ' ' + line.trim();
    }
    if (!id || !head) continue;
    const cut = head.lastIndexOf(', by ');
    if (cut < 0) continue;
    const title = head.slice(0, cut).replace(/\s+/g, ' ').trim();
    let author = head.slice(cut + 5).replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
    author = author.replace(/^(by|par)\s+/i, '').replace(/[;,.]$/, '').trim();
    const langMatch = meta.join(' ').match(/\[Languages?:\s*([^\]]+)\]/i);
    const lang = langMatch ? langMatch[1].trim().toLowerCase() : '';
    if (!id || !title || !author) continue;
    if (NOISE_TITLE.test(title)) continue;
    if (/\b(and|et)\b/i.test(author) && author.split(/\b(and|et)\b/i).length > 2) {
      // multi-auteurs : on garde le premier nom, mais on marque l'entrée
    }
    out.push({ id, title, author, lang, meta: meta.join(' ') });
  }
  return out;
}

function familyKeys(author) {
  const keys = new Set();
  const names = [author.name, author.nameEn].filter(Boolean);
  for (const n of names) {
    const parts = String(n).split(/[\s’'-]+/).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.length >= 4) keys.add(norm(last).replace(/\s/g, ''));
  }
  for (const m of author.match || []) {
    const parts = String(m).split(/[\s’'-]+/).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) keys.add(norm(last).replace(/\s/g, ''));
  }
  return [...keys].filter(Boolean);
}

function givenKeys(author) {
  const names = [author.name, author.nameEn].filter(Boolean);
  const out = [];
  for (const n of names) {
    const parts = String(n).split(/[\s’'-]+/).filter(Boolean);
    if (parts.length >= 2) out.push(norm(parts[0]));
  }
  return out.filter((x) => x.length >= 3);
}

function matchesAuthor(entryAuthor, author) {
  const hay = norm(entryAuthor);
  const full = norm(author.name);
  const families = familyKeys(author);
  const givens = givenKeys(author);
  if (full && hay.includes(full)) return true;
  // Nom courant (« Smith », « James », « Mill ») : exiger prénom + nom adjacents.
  if (families.some((f) => f.length <= 6) && givens.length) {
    for (const g of givens) {
      for (const f of families) {
        if (new RegExp(`\\b${g}\\s+${f}\\b`).test(hay)) return true;
        if (new RegExp(`\\b${f}\\s+${g}\\b`).test(hay)) return true;
      }
    }
    return false;
  }
  return families.some((f) => hay.includes(f));
}

function langOk(entryLang, authorLang) {
  if (!entryLang) return true;
  const l = entryLang.toLowerCase();
  if (authorLang === 'fr') return /\bfrench\b|\bfrançais\b|\bfrancais\b/.test(l);
  if (authorLang === 'en') return /\benglish\b|\banglais\b/.test(l);
  if (authorLang === 'de') return /\bgerman\b|\ballemand\b|\bdeutsch\b/.test(l);
  if (authorLang === 'it') return /\bitalian\b|\bitalien\b|\bitaliano\b/.test(l);
  if (authorLang === 'ru') return /\brussian\b|\brusse\b/.test(l);
  return true;
}

/** Langue confirmée par le RDF (liste de codes ISO 639-1/3). */
function rdfLangOk(langs, authorLang) {
  if (!Array.isArray(langs) || !langs.length) return true;
  const codes = langs.map((x) => String(x).toLowerCase().trim());
  const map = { fr: ['fr', 'fre', 'fra'], en: ['en', 'eng'], de: ['de', 'ger', 'deu'], it: ['it', 'ita'], ru: ['ru', 'rus'], es: ['es', 'spa'], la: ['la', 'lat'] };
  const wanted = map[authorLang];
  if (!wanted) return true;
  return codes.some((c) => wanted.includes(c) || wanted.includes(c.slice(0, 2)));
}

const OMNIBUS = /(tome|volume|vol\.|partie|part)\s+[ivxlcdm\d]+/i;

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

/** Clé de déduplication : titre principal avant sous-titre/édition. */
function titleKey(s) {
  return norm(decodeEntities(s).split(/[:;]/)[0]).slice(0, 80);
}

/** Préférence éditoriale : œuvre singulière et courte avant omnibus/traduction. */
function workScore(entry, author) {
  let score = 50;
  const t = entry.title || '';
  if (OMNIBUS.test(t)) score -= 35;
  if (/\b(works|œuvres complètes|oeuvres completes|complete works|collected)\b/i.test(t)) score -= 30;
  if (/\b(selections?|anthology|choix|extraits|letters?|correspondance)\b/i.test(t)) score -= 20;
  if (t.length <= 70) score += 8;
  if (t.length > 110) score -= 8;
  if (entry.lang && langOk(entry.lang, author.lang)) score += 20;
  return score;
}

/* ---------------------------------------------------------------- RDF */

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim() : '';
}

export async function rdfMeta(id, { timeoutMs = 20000 } = {}) {
  const s = String(id);
  const url = `https://gutenberg.pglaf.org/cache/epub/${s}/pg${s}.rdf`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'KayrosLab-Salon/1.0' } });
    if (!res.ok) return null;
    const xml = await res.text();
    const title = xmlTag(xml, 'dcterms:title');
    const rights = xmlTag(xml, 'dcterms:rights');
    const langs = [...xml.matchAll(/<dcterms:language[\s\S]*?<rdf:value[^>]*>([^<]+)<\/rdf:value>/gi)].map((m) => m[1].trim());
    const agents = [...xml.matchAll(/<pgterms:agent[\s\S]*?<pgterms:name>([^<]+)<\/pgterms:name>/gi)].map((m) => m[1].trim());
    const died = (xml.match(/<pgterms:deathdate[^>]*>(\d{4})/) || [])[1];
    return { title, rights, langs, agents, died };
  } catch {
    return null;
  }
}

function publicDomain(meta) {
  if (!meta) return false;
  const r = (meta.rights || '').toLowerCase();
  return !r || r.includes('public domain');
}

/* --------------------------------------------------------------- main */

async function loadGutindex() {
  if (existsSync(GUTINDEX)) return readFileSync(GUTINDEX, 'utf8');
  process.stderr.write('Téléchargement de GUTINDEX.ALL (9 Mo)…\n');
  const res = await fetch(GUTINDEX_URL, { signal: AbortSignal.timeout(300000), headers: { 'user-agent': 'KayrosLab-Salon/1.0' } });
  if (!res.ok) throw new Error(`GUTINDEX ${res.status}`);
  const text = await res.text();
  writeFileSync(GUTINDEX, text, 'utf8');
  return text;
}

function workFromEntry(entry, meta) {
  const title = (meta && meta.title && meta.title.length > 2) ? meta.title : entry.title;
  return {
    title: title.replace(/\s+/g, ' ').trim(),
    url: `https://www.gutenberg.org/cache/epub/${entry.id}/pg${entry.id}.txt`,
    source: 'gutenberg',
    ok: true,
    gutenbergId: Number(entry.id),
    lang: (meta && meta.langs && meta.langs[0]) || (entry.lang || '').split(',')[0] || undefined,
  };
}

async function main() {
  const args = parseArgs();
  const maxNew = args['max-new-works'] ? Number(args['max-new-works']) : 8;
  const onlyAuthor = args.author ? String(args.author) : null;
  const addAuthors = args['no-new-authors'] ? [] : NEW_AUTHORS.filter((a) => !onlyAuthor || a.id === onlyAuthor);
  const catalog = readJSON(CATALOG_FILE);
  if (!catalog || !Array.isArray(catalog.authors)) throw new Error('catalog illisible');

  const index = parseGutindex(await loadGutindex());
  process.stderr.write(`GUTINDEX : ${index.length} entrées\n`);

  const report = { at: nowIso(), maxNew, added: {}, newAuthors: [], rejected: [], pruned: [], totalsBefore: {}, totalsAfter: {} };
  report.totalsBefore = {
    authors: catalog.authors.length,
    works: catalog.authors.reduce((s, a) => s + (a.works || []).length, 0),
  };

  const byId = new Map(catalog.authors.map((a) => [a.id, a]));
  const targets = [];

  // 1. Auteurs existants : œuvres supplémentaires.
  for (const author of catalog.authors) {
    if (onlyAuthor && author.id !== onlyAuthor) continue;
    targets.push({ author, isNew: false });
  }
  // 2. Nouveaux auteurs.
  for (const seed of addAuthors) {
    if (byId.has(seed.id)) continue;
    targets.push({ author: { ...seed, works: [] }, isNew: true });
  }

  for (const { author, isNew } of targets) {
    const existingIds = new Set((author.works || []).map((w) => w.gutenbergId || Number((String(w.url).match(/(\d+)\/pg\d+\.txt/) || [])[1])));
    const existingTitles = new Set((author.works || []).map((w) => norm(w.title)));
    const existingKeys = new Set((author.works || []).map((w) => titleKey(w.title)));
    const candidates = index
      .filter((e) => !existingIds.has(Number(e.id)))
      .filter((e) => matchesAuthor(e.author, author))
      .filter((e) => langOk(e.lang, author.lang))
      .filter((e) => !existingTitles.has(norm(e.title)))
      .filter((e) => !existingKeys.has(titleKey(e.title)))
      .map((e) => ({ ...e, score: workScore(e, author) }))
      .sort((a, b) => (b.score - a.score) || (Number(a.id) - Number(b.id)))
      .slice(0, Math.max(maxNew * 10, 60));

    const accepted = [];
    const acceptedTitles = new Set();
    const acceptedKeys = new Set();
    const rejected = [];
    for (const c of candidates) {
      if (accepted.length >= maxNew) break;
      const meta = await rdfMeta(c.id);
      if (!meta) { rejected.push({ id: c.id, title: c.title, why: 'rdf indisponible' }); continue; }
      if (!publicDomain(meta)) { rejected.push({ id: c.id, title: c.title, why: 'droits non domaine public' }); continue; }
      const finalTitle = decodeEntities((meta.title && meta.title.length > 2) ? meta.title : c.title);
      if (existingTitles.has(norm(finalTitle)) || acceptedTitles.has(norm(finalTitle))
        || existingKeys.has(titleKey(finalTitle)) || acceptedKeys.has(titleKey(finalTitle))) {
        rejected.push({ id: c.id, title: finalTitle, why: 'doublon de titre' });
        continue;
      }
      if (!rdfLangOk(meta.langs, author.lang)) {
        rejected.push({ id: c.id, title: finalTitle, why: `langue RDF ${meta.langs.join(',')} ≠ ${author.lang}` });
        continue;
      }
      if (meta.agents && meta.agents.length) {
        if (!matchesAuthor(meta.agents.join('; '), author)) {
          rejected.push({ id: c.id, title: finalTitle, why: `auteur RDF différent (${meta.agents.join('; ')})` });
          continue;
        }
      }
      acceptedTitles.add(norm(finalTitle));
      acceptedKeys.add(titleKey(finalTitle));
      accepted.push(workFromEntry(c, meta));
    }

    if (!accepted.length && isNew) {
      report.newAuthors.push({ id: author.id, name: author.name, works: 0, status: 'rejeté (aucune œuvre vérifiée)' });
      continue;
    }
    if (!accepted.length) {
      report.rejected.push({ authorId: author.id, rejected: rejected.slice(0, 5) });
      continue;
    }

    author.works = [...(author.works || []), ...accepted];
    author.works_count = author.works.filter((w) => w.ok !== false).length;
    if (isNew) {
      author.works = accepted;
      author.works_count = accepted.length;
      author.stats = author.stats || { words: 0, distinct: 0 };
      author.terms = author.terms || [];
      author.sample = author.sample || '';
      author.avatar = author.avatar || null;
      catalog.authors.push(author);
      byId.set(author.id, author);
      report.newAuthors.push({ id: author.id, name: author.name, works: accepted.length, status: 'ajouté' });
    }
    report.added[author.id] = accepted.map((w) => ({ id: w.gutenbergId, title: w.title }));
    process.stderr.write(`${author.id}: +${accepted.length} œuvres (${rejected.length} rejetées)\n`);
  }

  report.totalsAfter = {
    authors: catalog.authors.length,
    works: catalog.authors.reduce((s, a) => s + (a.works || []).length, 0),
  };

  // Purge : les œuvres ajoutées par enrichissement (gutenbergId présent) sont
  // re-vérifiées par RDF. Une attribution erronée est retirée, jamais conservée.
  if (!args['no-prune']) {
    for (const author of catalog.authors) {
      const keep = [];
      for (const w of (author.works || [])) {
        if (!w.gutenbergId) { keep.push(w); continue; }
        const meta = await rdfMeta(w.gutenbergId);
        if (!meta) { keep.push(w); continue; }
        if (!publicDomain(meta)) { report.pruned.push({ author: author.id, title: w.title, why: 'droits' }); continue; }
        if (meta.agents && meta.agents.length && !matchesAuthor(meta.agents.join('; '), author)) {
          report.pruned.push({ author: author.id, title: w.title, why: `auteur RDF (${meta.agents.join('; ')})` });
          continue;
        }
        keep.push(w);
      }
      author.works = keep;
      author.works_count = keep.length;
    }
    catalog.authors = catalog.authors.filter((a) => (a.works || []).length > 0);
    report.totalsAfter = {
      authors: catalog.authors.length,
      works: catalog.authors.reduce((s, a) => s + (a.works || []).length, 0),
    };
  }

  if (!args['dry-run']) {
    copyFileSync(CATALOG_FILE, CATALOG_FILE + '.bak');
    writeJSON(CATALOG_FILE, catalog);
    writeJSON(REPORT, report);
    console.log(`✓ catalogue : ${report.totalsAfter.authors} auteurs, ${report.totalsAfter.works} œuvres (+${report.totalsAfter.works - report.totalsBefore.works}, ${report.pruned.length} purgées).`);
    console.log(`  rapport : ${REPORT}`);
  } else {
    console.log(JSON.stringify({
      totalsBefore: report.totalsBefore,
      totalsAfter: report.totalsAfter,
      newAuthors: report.newAuthors,
      added: Object.fromEntries(Object.entries(report.added).map(([k, v]) => [k, v.length])),
      addedTitles: Object.fromEntries(Object.entries(report.added).map(([k, v]) => [k, v.map((w) => w.title)])),
      rejectedSample: report.rejected.slice(0, 8),
    }, null, 2));
  }
}

if (process.argv[1] && process.argv[1].endsWith('enrich_catalog.mjs')) {
  main().catch((e) => { console.error('ERREUR:', e.message); process.exit(1); });
}
