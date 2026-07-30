// KayrosLab — Canvas : synthese visuelle.
// EF-239 : generation d'un visuel indicatif (moodboard) pour un concept
// abstrait, MARQUE COMME ILLUSTRATIF, jamais presente comme une maquette validee.
//
// POURQUOI PAS UN MODELE D'IMAGE. Appeler une API de generation d'images
// romprait la souverainete du palier P1 (l'image sort, le concept avec elle),
// ajouterait une dependance et un cout par clic. Le moodboard est ici DERIVE du
// vecteur semantique du noeud : meme concept, meme visuel, sans reseau et sans
// alea. Ce n'est pas une illustration « creative » — c'est une empreinte
// visuelle stable, ce qui est exactement l'usage : reconnaitre un cluster d'un
// coup d'oeil, pas produire une image de marque.

import { mulberry32 } from '../projection.mjs';
import { nodeText } from './model.mjs';

/** Mention portee par TOUT visuel produit. Non desactivable. */
export const MENTION = 'ILLUSTRATIF — non validé';

/** Empreinte numerique stable d'un texte (pas de crypto : usage decoratif). */
function empreinte(texte) {
  let h = 2166136261;
  for (let i = 0; i < texte.length; i++) { h ^= texte.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Palette derivee du vecteur semantique.
 * Deux concepts proches donnent des palettes proches : la couleur porte du
 * SENS, elle n'est pas decorative. Sans vecteur, on retombe sur l'empreinte
 * du texte — deterministe aussi, mais sans parente semantique.
 */
export function palette(vecteur, texte = '') {
  let teinte;
  let saturation = 62;
  let ecart = 38;

  if (Array.isArray(vecteur) && vecteur.length) {
    // Projection du vecteur sur le cercle chromatique : deux composantes
    // suffisent a donner un angle stable et continu.
    const x = vecteur[0] ?? 0;
    const y = vecteur[1 % vecteur.length] ?? 0;
    teinte = Math.round(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * 360);
    const norme = Math.hypot(...vecteur.slice(0, 4));
    saturation = Math.round(48 + Math.min(norme, 1) * 30);
    ecart = Math.round(24 + Math.min(norme, 1) * 30);
  } else {
    teinte = empreinte(texte) % 360;
  }

  const h = (n) => (teinte + n + 360) % 360;
  return {
    teinte,
    fond: `hsl(${h(0)} ${Math.round(saturation * 0.25)}% 96%)`,
    primaire: `hsl(${h(0)} ${saturation}% 46%)`,
    secondaire: `hsl(${h(ecart)} ${saturation}% 58%)`,
    tertiaire: `hsl(${h(-ecart)} ${Math.round(saturation * 0.8)}% 66%)`,
    encre: `hsl(${h(0)} 30% 18%)`,
  };
}

const echapper = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Decoupe un titre en lignes tenant dans la largeur donnee. */
function lignes(texte, maxCar = 26, maxLignes = 3) {
  const mots = String(texte ?? '').split(/\s+/).filter(Boolean);
  const out = []; let courante = '';
  for (const m of mots) {
    if ((`${courante} ${m}`).trim().length > maxCar && courante) { out.push(courante); courante = m; }
    else courante = (`${courante} ${m}`).trim();
    if (out.length === maxLignes) break;
  }
  if (courante && out.length < maxLignes) out.push(courante);
  const reste = mots.join(' ').length > out.join(' ').length;
  if (reste && out.length) out[out.length - 1] = `${out.at(-1).slice(0, maxCar - 1)}…`;
  return out;
}

/**
 * Genere un moodboard SVG pour un noeud.
 *
 * @param {object} noeud
 * @param {{vecteur?:number[], largeur?:number, hauteur?:number, seed?:number}} [opts]
 * @returns {{svg:string, palette:object, illustratif:true, seed:number}}
 */
export function moodboard(noeud, { vecteur = null, largeur = 480, hauteur = 300, seed = null } = {}) {
  if (!noeud?.titre) throw new Error('moodboard: noeud avec titre requis');

  const texte = nodeText(noeud);
  const graine = seed ?? empreinte(texte);
  const rnd = mulberry32(graine);
  const p = palette(vecteur, texte);

  const formes = [];
  const n = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const cx = Math.round(rnd() * largeur);
    const cy = Math.round(rnd() * hauteur * 0.72);
    const r = Math.round(28 + rnd() * 96);
    const couleur = [p.primaire, p.secondaire, p.tertiaire][i % 3];
    const opacite = (0.14 + rnd() * 0.24).toFixed(2);
    formes.push(rnd() > 0.45
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${couleur}" opacity="${opacite}"/>`
      : `<rect x="${cx - r / 2}" y="${cy - r / 2}" width="${r}" height="${r}" rx="${Math.round(r / 6)}" fill="${couleur}" opacity="${opacite}" transform="rotate(${Math.round(rnd() * 40 - 20)} ${cx} ${cy})"/>`);
  }

  const titre = lignes(noeud.titre);
  const y0 = hauteur - 74 - (titre.length - 1) * 22;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largeur} ${hauteur}" width="${largeur}" height="${hauteur}" role="img" aria-label="Moodboard illustratif — ${echapper(noeud.titre)}">`,
    `<title>${echapper(noeud.titre)} — ${MENTION}</title>`,
    `<rect width="${largeur}" height="${hauteur}" fill="${p.fond}"/>`,
    `<g>${formes.join('')}</g>`,
    // Voile de lisibilite sous le texte.
    `<rect x="0" y="${y0 - 30}" width="${largeur}" height="${hauteur - y0 + 30}" fill="${p.fond}" opacity="0.82"/>`,
    ...titre.map((l, i) => `<text x="28" y="${y0 + i * 22}" font-family="system-ui,sans-serif" font-size="19" font-weight="600" fill="${p.encre}">${echapper(l)}</text>`),
    // EF-239 : la mention fait partie de l'image. Elle ne peut pas etre
    // perdue en la copiant, contrairement a une legende affichee a cote.
    `<text x="28" y="${hauteur - 22}" font-family="system-ui,sans-serif" font-size="11" letter-spacing="1.4" fill="${p.primaire}" opacity="0.85">${MENTION}</text>`,
    `<rect x="0" y="0" width="${largeur}" height="${hauteur}" fill="none" stroke="${p.primaire}" stroke-width="2" stroke-dasharray="7 5" opacity="0.5"/>`,
    '</svg>',
  ].join('');

  return { svg, palette: p, illustratif: true, seed: graine };
}

/**
 * Planche de moodboards pour un cluster : une vignette par noeud, palettes
 * apparentees puisque derivees de vecteurs voisins. C'est l'usage reel —
 * saisir la couleur d'un theme, pas admirer une image.
 */
export function planche(noeuds, { vecteurs = null, colonnes = 3, vignette = 220 } = {}) {
  if (!noeuds?.length) throw new Error('planche: au moins un noeud requis');
  const cartes = noeuds.slice(0, 12).map((n, i) => moodboard(n, {
    vecteur: vecteurs?.[i] ?? null,
    largeur: vignette, hauteur: Math.round(vignette * 0.66),
  }));
  const lignesN = Math.ceil(cartes.length / colonnes);
  const h = Math.round(vignette * 0.66);

  const contenu = cartes.map((c, i) => {
    const x = (i % colonnes) * (vignette + 12);
    const y = Math.floor(i / colonnes) * (h + 12);
    // On imbrique le SVG de chaque vignette : chacune conserve sa mention.
    return `<g transform="translate(${x} ${y})">${c.svg.replace(/^<svg[^>]*>/, '<svg>').replace(/ width="\d+" height="\d+"/, '')}</g>`;
  }).join('');

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${colonnes * (vignette + 12)}" height="${lignesN * (h + 12)}">${contenu}</svg>`,
    cartes, illustratif: true,
  };
}

/** Data URI, directement utilisable dans un `src` d'image. */
export function versDataUri(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
