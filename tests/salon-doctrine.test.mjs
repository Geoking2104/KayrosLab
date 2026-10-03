import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Lot 2 : cohérence des données de doctrine (ancres, langues, œuvres).
const source = JSON.parse(readFileSync(new URL('../salon/src/lib/salon/doctrine.json', import.meta.url), 'utf8'));
const published = JSON.parse(readFileSync(new URL('../backend/web/public/salon/doctrine.json', import.meta.url), 'utf8'));
const corpus = JSON.parse(readFileSync(new URL('../backend/web/public/salon/corpus.json', import.meta.url), 'utf8'));
const catalog = JSON.parse(readFileSync(new URL('../salon/src/lib/salon/catalog.json', import.meta.url), 'utf8'));

test('doctrine : source et copie publiée identiques ; couverture minimale des convives', () => {
  assert.deepEqual(source, published, 'doctrine.json (source) == doctrine.json (publié)');
  for (const id of ['voltaire', 'rousseau', 'montaigne', 'kant', 'epicure']) {
    assert.ok(source[id], 'doctrine présente pour ' + id);
    assert.ok(Array.isArray(source[id].concepts) && source[id].concepts.length > 0, id + ': concepts non vides');
  }
});

test('doctrine : fr et en obligatoires, ancres résolues dans le corpus, œuvres du catalogue', () => {
  for (const id of Object.keys(source)) {
    const d = source[id];
    const cat = catalog.authors.find((a) => a.id === id);
    assert.ok(cat, id + ' est au catalogue');
    const titles = new Set((cat.works || []).map((w) => w.title));
    const checkAnchors = (t, where) => {
      assert.ok(t && t.fr && t.en, id + '/' + where + ': fr+en requis');
      assert.ok(Array.isArray(t.anchors) && t.anchors.length, id + '/' + where + ': au moins une ancre');
      for (const a of t.anchors) {
        assert.ok(titles.has(a.work), id + '/' + where + ': œuvre hors catalogue — ' + a.work);
        const hit = (corpus[id] || []).some((e) => e.w === a.work && e.s.indexOf(a.startsWith) === 0);
        assert.ok(hit, id + '/' + where + ': ancre non résolue — ' + a.work + ' :: ' + a.startsWith);
      }
    };
    for (const dom of Object.keys(d.theses || {})) {
      for (const dem of Object.keys(d.theses[dom])) checkAnchors(d.theses[dom][dem], dom + '.' + dem);
    }
    for (const w of Object.keys(d.works || {})) {
      const ws = d.works[w];
      assert.ok(ws.summary && ws.summary.fr && ws.summary.en, id + '/' + w + ': résumé fr+en');
      assert.ok(titles.has(w), id + '/' + w + ': œuvre du résumé hors catalogue');
    }
  }
});
