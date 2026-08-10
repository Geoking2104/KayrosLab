// KayrosLab — Etape 2 "Cartographier" (EF-03 / EF-04).
// Reseau de tendances (noeuds = tendances/clusters, aretes typees LLM),
// centralite, zones de tension et PONTS de bisociation entre clusters
// distants. La nouveaute d'un pont est calculee de facon deterministe depuis
// la structure reelle (distance de clusters) ; la plausibilite est importee
// du LLM/humain — sans elle, le score reste null (jamais invente).

export const HORIZONS = Object.freeze(['court', 'moyen', 'long']);
export const TYPES_ARETES = Object.freeze(['correlation', 'causalite', 'opposition']);
export const PLAUSIBILITE_PAR_DEFAUT = 55;

const clamp = (x) => Math.max(0, Math.min(100, Number(x) || 0));

/** Id stable d'une tendance (dedupe par nom). */
export function idTendance(nom) {
  let h = 11;
  const s = String(nom ?? '');
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return `tend-${h.toString(16)}`;
}

/** Normalise une tendance : `{ id, nom, description?, horizon?, tags[], source? }`. */
export function normalizeTendance(t = {}, { index = 0 } = {}) {
  const nom = String(t.nom ?? t.name ?? '').trim();
  if (!nom) throw new Error('cartographier: nom de tendance requis');
  const horizon = t.horizon ?? null;
  if (horizon && !HORIZONS.includes(horizon)) throw new Error('cartographier: horizon invalide (court|moyen|long)');
  const tags = [...new Set([...(t.tags ?? []), ...(t.clusters ?? [])].map((x) => String(x).trim()).filter(Boolean))];
  return {
    id: t.id ?? idTendance(nom),
    nom,
    description: t.description ?? null,
    horizon,
    tags,
    source: t.source ?? null,
    index,
  };
}

/** Construit le reseau : noeuds normalises + aretes typees validees/dedupliquees. */
export function buildReseau(tendances = [], aretes = []) {
  const noeuds = tendances.map((t, i) => normalizeTendance(t, { index: i }));
  const ids = new Set(noeuds.map((n) => n.id));
  const edges = [];
  for (const a of aretes ?? []) {
    if (!a || !ids.has(a.de) || !ids.has(a.vers) || a.de === a.vers) continue;
    const type = TYPES_ARETES.includes(a.type) ? a.type : 'correlation';
    const id = `${a.de}|${type}|${a.vers}`;
    if (!edges.some((e) => e.id === id)) edges.push({ id, type, de: a.de, vers: a.vers });
  }
  return { noeuds, aretes: edges };
}

/** Centralite de degre (F3) : pivots = noeuds au plus grand pouvoir structurant. */
export function centralite(reseau) {
  const degres = {};
  for (const n of reseau.noeuds) degres[n.id] = 0;
  for (const a of reseau.aretes) {
    degres[a.de] = (degres[a.de] ?? 0) + 1;
    degres[a.vers] = (degres[a.vers] ?? 0) + 1;
  }
  const classement = Object.entries(degres).map(([id, degre]) => ({ id, degre })).sort((x, y) => y.degre - x.degre);
  const max = classement.length ? classement[0].degre : 0;
  return { degres, pivots: classement.filter((x) => x.degre > 0 && x.degre === max).map((x) => x.id) };
}

/** Zones de tension (F4) : aretes d'opposition → zones fertiles pour l'ideation. */
export function zonesTension(reseau) {
  return reseau.aretes.filter((a) => a.type === 'opposition')
    .map((a) => ({ id: `tension-${a.id}`, de: a.de, vers: a.vers, type: 'opposition' }));
}

/** Horizon effectif (F5) : renseigne, sinon derive d'une date, sinon null. */
export function horizonEffectif(noeud, { now = () => new Date() } = {}) {
  if (noeud.horizon) return noeud.horizon;
  const d = noeud.date ? new Date(noeud.date) : null;
  if (d && !Number.isNaN(d.getTime())) {
    const mois = (new Date(now()).getTime() - d.getTime()) / (30 * 86400000);
    if (mois <= 12) return 'court';
    if (mois <= 36) return 'moyen';
    return 'long';
  }
  return null;
}

export function etiqueterHorizons(noeuds, opts) {
  return noeuds.map((n) => ({ ...n, horizonEffectif: horizonEffectif(n, opts) }));
}

/**
 * Distance entre deux clusters (tags) : partage de tags → proximite ;
 * aucun tag commun → distance forte. Deterministe depuis les donnees reelles.
 */
export function distanceClusters(tendances, c1, c2) {
  const tags1 = new Set(tendances.filter((t) => t.tags.includes(c1)).flatMap((t) => t.tags));
  const tags2 = new Set(tendances.filter((t) => t.tags.includes(c2)).flatMap((t) => t.tags));
  const inter = [...tags1].filter((t) => tags2.has(t));
  const union = new Set([...tags1, ...tags2]);
  const taille = tendances.filter((t) => t.tags.includes(c1) || t.tags.includes(c2)).length;
  return {
    taille,
    partages: inter.length,
    union: union.size,
    distance: union.size ? Math.round(100 * (1 - inter.length / union.size)) : 0,
  };
}

/** Vrai si un pont existe deja entre deux clusters (via une arete existante). */
export function dejaLie(reseau, c1, c2) {
  const n1 = new Set(reseau.noeuds.filter((t) => t.tags.includes(c1)).map((t) => t.id));
  const n2 = new Set(reseau.noeuds.filter((t) => t.tags.includes(c2)).map((t) => t.id));
  return reseau.aretes.some((a) => (n1.has(a.de) && n2.has(a.vers)) || (n1.has(a.vers) && n2.has(a.de)));
}

/**
 * Suggestion automatique de ponts de bisociation (EF-04) : ponts non evidents
 * entre clusters DISTANTS (distance >= plancher), non deja relies. La nouveaute
 * est derivee de la structure ; la plausibilite doit etre fournie pour scorer.
 */
export function suggestPonts(tendances = [], { reseau = null, plancher = 100, plausibilite = PLAUSIBILITE_PAR_DEFAUT } = {}) {
  const clusters = [...new Set(tendances.flatMap((t) => t.tags))];
  const ponts = [];
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const c1 = clusters[i], c2 = clusters[j];
      if (reseau && dejaLie(reseau, c1, c2)) continue;
      const d = distanceClusters(tendances, c1, c2);
      if (d.distance < plancher) continue;
      const noeuds = tendances.filter((t) => t.tags.includes(c1) || t.tags.includes(c2)).map((t) => t.id);
      const pont = {
        id: `pont-${c1}--${c2}`,
        de: c1,
        vers: c2,
        distance: d.distance,
        nouveaute: d.distance,
        noeuds,
        justification: `Clusters « ${c1} » et « ${c2} » : ${d.partages} tag(s) commun(s) sur ${d.union} — pont non évident entre domaines distants.`,
      };
      ponts.push(scorePont(pont, { plausibilite }));
    }
  }
  return ponts.sort((a, b) => (b.score ?? b.nouveaute) - (a.score ?? a.nouveaute));
}

/** Score d'un pont : nouveaute x plausibilite / 100 (null si plausibilite absente). */
export function scorePont(pont, { plausibilite = null } = {}) {
  const pl = plausibilite != null ? clamp(plausibilite) : (pont.plausibilite ?? null);
  return {
    ...pont,
    plausibilite: pl,
    score: pl != null ? Math.round((pont.nouveaute * pl) / 100) : null,
  };
}

/** Payload structure vers Construire (F6) : selection de noeuds/ponts. */
export function sendNetworkSelectionToScenario({ noeuds = [], ponts = [], ts = null } = {}) {
  return { payload: { destination: 'construire', noeuds, ponts, ts: ts ?? new Date().toISOString() } };
}

/** Synthese Cartographier : reseau + centralite + tensions + ponts. */
export function rapportCartographie(reseau, { ponts = [] } = {}) {
  const avecHorizons = etiqueterHorizons(reseau.noeuds);
  return {
    reseau: { noeuds: avecHorizons, aretes: reseau.aretes },
    centralite: centralite(reseau),
    zonesTension: zonesTension(reseau),
    ponts,
    totalNoeuds: avecHorizons.length,
    totalAretes: reseau.aretes.length,
  };
}
