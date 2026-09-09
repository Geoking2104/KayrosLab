// Sources de livres du domaine public pour la création d'agents auteurs.
// Recherche temps réel + téléchargement multi-formats (txt, html, epub).
// Les sources consultables sans moteur de recherche (annuaire) sont listées
// à part : elles restent accessibles depuis la console.

import AdmZip from 'adm-zip';

export const SOURCES_DIRECTORY = Object.freeze([
  { id: 'bookatomy', name: 'Bookatomy — domaine public par année', url: 'https://pubdom.bookatomy.com/publications/', lang: 'fr', note: '75 922 œuvres classées par année de publication originale (index de découverte).' },
  { id: 'noslivres', name: 'NosLivres.net', url: 'https://www.noslivres.net/', lang: 'fr', note: 'Catalogue partagé Ebooks libres et gratuits / efele.net, consultable en table.' },
  { id: 'efele', name: 'Efele.net (ebooks libres)', url: 'http://efele.net/ebooks/', lang: 'fr', note: 'EPUB du domaine public, catalogue machine efele_catalogue_commun.txt.' },
  { id: 'elg', name: 'Ebooks libres et gratuits', url: 'https://www.ebooksgratuits.org/ebooks.php', lang: 'fr', note: 'Catalogue cherchable (auteur, catégorie), formats html/epub/pdf.' },
  { id: 'beq', name: 'Bibliothèque électronique du Québec', url: 'http://beq.ebooksgratuits.com/', lang: 'fr', note: 'Classiques québécois et français en pdf/epub.' },
  { id: 'bnr', name: 'Bibliothèque numérique romande', url: 'http://www.ebooks-bnr.com/', lang: 'fr', note: 'Littérature romande et française libre.' },
  { id: 'ruslave', name: 'La Bibliothèque Russe et Slave', url: 'http://bibliotheque-russe-et-slave.com', lang: 'fr', note: 'Textes russes et slaves en traduction française.' },
  { id: 'gutenberg_fr', name: 'Project Gutenberg (langue française)', url: 'https://www.gutenberg.org/browse/languages/fr', lang: 'fr', note: 'Textes bruts intégraux, ingestables directement.' },
  { id: 'wikisource_fr', name: 'Wikisource (français)', url: 'https://fr.wikisource.org/', lang: 'fr', note: 'Textes établis et relus, API publique.' },
]);

const UA = 'KayrosLab/1.0 (literary personality corpus; +https://www.kayroslab.com)';

async function fetchText(url, { timeoutMs = 20_000, maxBytes = 6_000_000 } = {}) {
  const response = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,text/plain,application/epub+zip,*/*' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new Error(`document trop volumineux (${Math.round(buffer.byteLength / 1024)} Ko)`);
  const charset = (response.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1]?.toLowerCase() || 'utf-8';
  let text;
  try { text = new TextDecoder(charset).decode(buffer); }
  catch { text = new TextDecoder('utf-8').decode(buffer); }
  return { text, buffer, contentType: response.headers.get('content-type') || '' };
}

/** Convertit n'importe quelle source supportée en texte brut « mémoire d'agent ». */
export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?(b|i|em|strong|span|a|small|sup|sub|u|code)(\s[^>]*)?>/gi, '')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'").replace(/&rsquo;/gi, "'").replace(/&mdash;/gi, '—')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function epubToText(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries()
    .filter((entry) => /\.x?html?$/i.test(entry.entryName) && !entry.isDirectory)
    .sort((a, b) => a.entryName.localeCompare(b.entryName, 'en', { numeric: true }));
  const parts = [];
  for (const entry of entries) {
    const html = entry.getData().toString('utf8');
    const text = htmlToText(html);
    if (text.length > 200) parts.push(text);
  }
  return parts.join('\n\n');
}

export async function workTextFromUrl(url) {
  const { text, buffer, contentType } = await fetchText(url);
  const isEpub = /\.epub(\?|$)/i.test(url) || /epub/i.test(contentType);
  const isHtml = /html/i.test(contentType) || /\.x?html?(\?|$)/i.test(url) || /<html|<body|<p[\s>]/i.test(text.slice(0, 2000));
  if (isEpub) return { text: epubToText(buffer), kind: 'epub' };
  if (isHtml) return { text: htmlToText(text), kind: 'html' };
  return { text, kind: 'txt' };
}

// --- recherche temps réel par source ---

async function searchGutenberg(query, limit) {
  // 1re tentative : gutendex (métadonnées propres) ; repli : recherche HTML gutenberg.org
  try {
    const response = await fetch(`https://gutendex.com/books?search=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': UA } });
    if (response.ok) {
      const data = await response.json();
      const results = (data.results || []).slice(0, limit).map((book) => {
        const txt = book.formats?.['text/plain; charset=utf-8'] || book.formats?.['text/plain; charset=us-ascii'] || book.formats?.['text/plain'];
        const authorName = (book.authors || []).map((a) => a.name).join(', ') || 'anonyme';
        return { title: book.title, author: authorName, lang: (book.languages || ['?'])[0], page: `https://www.gutenberg.org/ebooks/${book.id}`, url: txt || null, ingestable: !!txt, source: 'gutenberg' };
      }).filter((item) => item.url);
      if (results.length) return results;
    }
  } catch { /* repli ci-dessous */ }
  const html = (await fetchText(`https://www.gutenberg.org/ebooks/search/?query=${encodeURIComponent(query)}`, { timeoutMs: 15_000 })).text;
  const results = [];
  for (const match of html.matchAll(/<li class="booklink">\s*<a [^>]*href="\/ebooks\/(\d+)"[^>]*>[\s\S]{0,1200}?<span class="title">([^<]+)<\/span>([\s\S]{0,400}?<span class="subtitle">([^<]*)<\/span>)?/g)) {
    const id = match[1];
    const authorName = (match[4] || '').replace(/^by\s+/i, '').trim();
    results.push({ title: match[2].trim(), author: authorName, lang: '?', page: `https://www.gutenberg.org/ebooks/${id}`, url: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`, ingestable: true, source: 'gutenberg' });
    if (results.length >= limit) break;
  }
  return results;
}

async function loadEfeleCatalog() {
  const { text } = await fetchText('http://efele.net/ebooks/efele_catalogue_commun.txt', { timeoutMs: 20_000 });
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const [authorName, title, url] = line.split('\t');
    return { author: (authorName || '').trim(), title: (title || '').trim(), page: (url || '').trim() };
  }).filter((entry) => entry.author && entry.title && entry.page);
}

async function searchEfele(query, limit) {
  const catalog = await loadEfeleCatalog();
  const needle = query.toLowerCase();
  const hits = catalog.filter((entry) => `${entry.author} ${entry.title}`.toLowerCase().includes(needle)).slice(0, limit);
  // résout l'epub réel de chaque page livre (au mieux, en parallèle borné)
  const resolved = await Promise.all(hits.map(async (entry) => {
    try {
      const html = (await fetchText(entry.page, { timeoutMs: 12_000 })).text;
      const epub = html.match(/href="([^"]+\.epub)"/i)?.[1] || null;
      const absolute = epub ? new URL(epub, entry.page).toString() : null;
      return { title: entry.title, author: entry.author, lang: 'fr', page: entry.page, url: absolute, ingestable: !!absolute, source: 'efele' };
    } catch {
      return { title: entry.title, author: entry.author, lang: 'fr', page: entry.page, url: null, ingestable: false, source: 'efele' };
    }
  }));
  return resolved;
}

async function postForm(url, fields) {
  const body = Object.entries(fields).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  const response = await fetch(url, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  const charset = (response.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1]?.toLowerCase() || 'utf-8';
  let text;
  try { text = new TextDecoder(charset).decode(buffer); } catch { text = new TextDecoder('utf-8').decode(buffer); }
  return text;
}

async function searchElg(query, limit) {
  // le site expose une recherche filtrée : GET ebooks.php?auteur=<requête> (résultats parfois larges,
  // on les refiltre côté client sur auteur/titre pour ne garder que les correspondances).
  const needle = query.toLowerCase();
  const html = (await fetchText(`https://www.ebooksgratuits.org/ebooks.php?auteur=${encodeURIComponent(query)}`, { timeoutMs: 20_000 })).text;
  const results = [];
  const blocks = html.split(/<span class="auteur">/i).slice(1);
  for (const block of blocks) {
    const authorName = block.match(/^([^<]{2,80})<\/span>/i)?.[1]?.trim() || '';
    const title = block.match(/<span style="font-weight: bold">([^<]{2,160})<\/span>/i)?.[1]?.trim() || '';
    const id = block.match(/newsendbook\.php\?id=(\d+)&format=html/i)?.[1] || null;
    if (!id || !title) continue;
    if (!`${authorName} ${title}`.toLowerCase().includes(needle)) continue;
    results.push({ title, author: authorName, lang: 'fr', page: `https://www.ebooksgratuits.org/newsendbook.php?id=${id}&format=html`, url: `https://www.ebooksgratuits.org/newsendbook.php?id=${id}&format=html`, ingestable: true, source: 'elg' });
    if (results.length >= limit) break;
  }
  return results;
}

async function searchWikisource(lang, query, limit) {
  const url = `https://${lang}.wikisource.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=0&srlimit=${limit}&format=json&formatversion=2&origin=*`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': UA } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return (data?.query?.search || []).map((hit) => ({
    title: hit.title, author: '', lang, page: `https://${lang}.wikisource.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
    url: `https://${lang}.wikisource.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
    ingestable: true, source: `wikisource_${lang}`,
  }));
}

export async function searchAllSources(query, { limitPerSource = 6 } = {}) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return { query: '', sources: [], annuaire: SOURCES_DIRECTORY };
  const jobs = [
    ['gutenberg', () => searchGutenberg(trimmed, limitPerSource)],
    ['efele (NosLivres)', () => searchEfele(trimmed, limitPerSource)],
    ['ebooksgratuits', () => searchElg(trimmed, limitPerSource)],
    ['wikisource fr', () => searchWikisource('fr', trimmed, limitPerSource)],
    ['wikisource en', () => searchWikisource('en', trimmed, limitPerSource)],
  ];
  const settled = await Promise.allSettled(jobs.map(([, run]) => run()));
  const sources = jobs.map(([name], index) => {
    const entry = settled[index];
    return { source: name, ok: entry.status === 'fulfilled', error: entry.status === 'rejected' ? String(entry.reason?.message || entry.reason) : null, results: entry.status === 'fulfilled' ? entry.value : [] };
  });
  return { query: trimmed, sources, annuaire: SOURCES_DIRECTORY };
}
