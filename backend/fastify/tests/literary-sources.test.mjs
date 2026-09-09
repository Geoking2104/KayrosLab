import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { SOURCES_DIRECTORY, htmlToText, workTextFromUrl } from '../lib/literary-sources.mjs';

test('l’annuaire des sources couvre les références demandées', () => {
  const ids = SOURCES_DIRECTORY.map((source) => source.id);
  for (const expected of ['bookatomy', 'noslivres', 'efele', 'elg', 'beq', 'bnr', 'ruslave', 'gutenberg_fr', 'wikisource_fr']) {
    assert.ok(ids.includes(expected), `source manquante: ${expected}`);
  }
  for (const source of SOURCES_DIRECTORY) {
    assert.ok(source.name && source.note, `description manquante: ${source.id}`);
    assert.match(source.url, /^https?:\/\//, `URL invalide: ${source.id}`);
  }
});

test('htmlToText retire les balises et restitue les entités', () => {
  const html = '<html><head><style>p{color:red}</style></head><body><h1>Chapitre&nbsp;I</h1><p>Jean &amp; Cosette — <b>l\'école</b>.</p><script>evil()</script></body></html>';
  const text = htmlToText(html);
  assert.match(text, /Chapitre I/);
  assert.match(text, /Jean & Cosette — l'école\./);
  assert.doesNotMatch(text, /evil\(\)/);
  assert.doesNotMatch(text, /<[^>]+>/);
});

test('workTextFromUrl extrait le texte d’un EPUB', async () => {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile('OEBPS/chapitre-01.xhtml', Buffer.from('<html><body><p>« Le rouge et le noir » — Julien gravit la colline de Verrières au soir tombant, les mains dans les poches, l’esprit plein d’ambitions tenaces et de rancunes secrètes contre la société des riches qui l’attend en bas.</p></body></html>'));
  zip.addFile('OEBPS/chapitre-02.xhtml', Buffer.from('<html><body><p>La ville s’étendait, grise et laborieuse, sous le ciel de Franche-Comté ; les murs du conservatoire, les toits des maisons, tout semblait calculé pour rendre l’ascension difficile à un jeune homme sans fortune et sans appui.</p></body></html>'));
  const buffer = zip.toBuffer();

  // fetch est mocké pour éviter le réseau : un serveur réel renvoie application/epub+zip.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, headers: new Map([['content-type', 'application/epub+zip']]), arrayBuffer: async () => buffer });
  try {
    const { text, kind } = await workTextFromUrl('https://example.org/livre.epub');
    assert.equal(kind, 'epub');
    assert.match(text, /Julien gravit la colline de Verrières/);
    assert.match(text, /grise et laborieuse/);
    assert.doesNotMatch(text, /<[^>]+>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
