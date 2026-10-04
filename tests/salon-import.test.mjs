import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Import d'auteur (domaine public) : la recherche passe par l'OPDS Gutenberg
// (CORS ouvert), avec hypothèses de nom, six œuvres requises, relais texte
// côté backend (les .txt de gutenberg.org n'ont pas d'en-tête CORS).
const root = new URL('..', import.meta.url);
const code = readFileSync(new URL('backend/web/public/salon/agents-import.js', root), 'utf8');
const html = readFileSync(new URL('backend/web/public/salon/index.html', root), 'utf8');
const mirror = readFileSync(new URL('salon/index.html', root), 'utf8');

test('import : plus de dépendance à gutendex, recherche via OPDS', () => {
  assert.ok(!/gutendex/i.test(code), 'gutendex (hors service) retiré');
  assert.match(code, /search\.opds/, 'recherche OPDS');
  assert.match(code, /ebooks\/author\//, 'œuvres par auteur (flux OPDS)');
});

test('import : hypothèses de nom (requêtes relâchées + distance d’édition)', () => {
  assert.match(code, /queryVariants/, 'variantes de requête');
  assert.match(code, /levDist/, 'distance d’édition');
  assert.match(code, /scoreName/, 'score de proximité');
  assert.match(code, /hypothèses les plus proches/i, 'libellé d’hypothèses');
});

test('import : six œuvres requises + fichiers locaux', () => {
  assert.match(code, /REQUIRED_WORKS = 6/, 'six œuvres');
  assert.match(code, /six œuvres/i, 'copie : six œuvres');
  assert.ok(code.includes('type=\\"file\\"'), 'ajout de fichiers .txt');
  assert.match(code, /f\.text\(\)/, 'lecture locale des fichiers');
});

test('import : relais texte backend + replis', () => {
  assert.match(code, /\/v1\/salon\/gutenberg\/text/, 'relais api.kayroslab.com');
  assert.match(code, /cache\/epub\//, 'URL directe Gutenberg en repli');
});

test('import : note d’aperçu hébergé', () => {
  assert.match(code, /autoclawai/, 'détection de l’aperçu géré');
  assert.match(code, /import-preview-note/, 'note visible dans l’aperçu');
});

test('import : les deux index.html servent la nouvelle version du module', () => {
  assert.equal(html, mirror, 'copies identiques');
  assert.match(html, /agents-import\.js\?v=20261005b/);
  assert.match(html, /six œuvres libres/, 'promesse du site alignée (six œuvres)');
});
