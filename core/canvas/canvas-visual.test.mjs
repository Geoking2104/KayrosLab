// KayrosLab — Canvas : synthese visuelle (EF-239).

import test from 'node:test';
import assert from 'node:assert/strict';
import { moodboard, planche, palette, versDataUri, MENTION } from './visual.mjs';
import { createNode } from './model.mjs';

const noeud = createNode({ titre: 'Offre solaire en autoconsommation pour PME', corps: 'abonnement mensuel' });

test('EF-239 le visuel porte la mention illustrative DANS l image', () => {
  const r = moodboard(noeud);
  assert.equal(r.illustratif, true);
  // La mention est un `<text>` du SVG, pas une legende affichee a cote : elle
  // survit a une copie de l'image, ce qui est tout l'objet de l'exigence.
  assert.ok(r.svg.includes(`>${MENTION}<`), 'la mention est un element du SVG');
  assert.ok(r.svg.includes(`<title>`), 'titre accessible present');
  assert.match(r.svg, /role="img"/);
});

test('EF-239 le visuel est deterministe a contenu egal', () => {
  const a = moodboard(noeud, { vecteur: [1, 0.2, 0, 0] });
  const b = moodboard(noeud, { vecteur: [1, 0.2, 0, 0] });
  assert.equal(a.svg, b.svg);
  assert.equal(a.seed, b.seed);
  assert.notEqual(moodboard(createNode({ titre: 'Autre concept' })).svg, a.svg);
  assert.notEqual(moodboard(noeud, { seed: 1 }).svg, moodboard(noeud, { seed: 2 }).svg);
});

test('EF-239 la palette porte du sens : deux concepts proches, deux teintes proches', () => {
  const ecart = (a, b) => { const d = Math.abs(palette(a).teinte - palette(b).teinte); return Math.min(d, 360 - d); };
  const proche = ecart([1, 0.20, 0, 0], [1, 0.25, 0, 0]);
  const eloigne = ecart([1, 0.20, 0, 0], [-1, 0.20, 0, 0]);
  assert.ok(proche < 15, `vecteurs voisins => teintes voisines (${proche}°)`);
  assert.ok(eloigne > proche * 3, `vecteurs opposes => teintes distinctes (${eloigne}°)`);
});

test('EF-239 sans vecteur, le repli reste deterministe', () => {
  const a = palette(null, 'texte stable');
  assert.equal(a.teinte, palette(null, 'texte stable').teinte);
  assert.notEqual(a.teinte, palette(null, 'autre texte').teinte);
  assert.equal(palette([], 'x').teinte, palette(null, 'x').teinte, 'vecteur vide = pas de vecteur');
});

test('EF-239 le contenu est echappe — un titre ne peut pas injecter de balise', () => {
  const piege = createNode({ titre: '<script>alert(1)</script> & "guillemets"' });
  const svg = moodboard(piege).svg;
  assert.ok(!svg.includes('<script>'), 'aucune balise injectee');
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(svg.includes('&amp;'));
});

test('EF-239 un titre long est tronque proprement', () => {
  const long = createNode({ titre: 'Un titre vraiment tres long qui depasse largement la largeur disponible de la vignette et continue encore' });
  const svg = moodboard(long).svg;
  assert.ok(svg.includes('…'), 'troncature signalee');
  assert.ok((svg.match(/<text/g) || []).length <= 5, 'au plus 3 lignes de titre + mention');
});

test('EF-239 la planche conserve la mention sur chaque vignette', () => {
  const p = planche([noeud, createNode({ titre: 'Mobilite douce' })], { vecteurs: [[1, 0.2, 0, 0], [0, 1, 0, 0]] });
  assert.equal(p.cartes.length, 2);
  assert.equal(p.illustratif, true);
  // On compte la mention VISIBLE (element <text>), pas celle du <title>
  // accessible qui la contient aussi legitimement.
  assert.equal(p.svg.split(`>${MENTION}<`).length - 1, 2, 'chaque vignette porte sa mention visible');
});

test('EF-239 la planche est bornee et valide ses entrees', () => {
  assert.throws(() => planche([]), /au moins un noeud/);
  assert.throws(() => moodboard({}), /titre requis/);
  const beaucoup = Array.from({ length: 30 }, (_, i) => createNode({ titre: `Idee ${i}` }));
  assert.equal(planche(beaucoup).cartes.length, 12, 'planche plafonnee a 12 vignettes');
});

test('EF-239 le data URI est directement utilisable', () => {
  const uri = versDataUri(moodboard(noeud).svg);
  assert.ok(uri.startsWith('data:image/svg+xml;charset=utf-8,'));
  assert.ok(!uri.includes('#'), 'les caracteres problematiques sont encodes');
});
