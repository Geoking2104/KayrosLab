// KayrosLab — Etape 1 "Ecouter" (EF-01 / EF-02).
// Reduction de bruit + promotion de signaux faibles. Le moteur calcule de
// facon DETERMINISTE la fraicheur (decroissance exponentielle), importe les
// dimensions LLM/humaines fournies (pertinence, impact) et n'invente jamais
// un chiffre absent : une dimension non renseignee est simplement exclue du
// calcul (et expliquee comme telle).

export const SEUIL_BRUIT_DEFAUT = 50;
export const DEMI_VIE_FRAICHEUR = 90; // jours
/** Ponderation des dimensions du score EF-02 (somme = 1). */
export const DIMENSION_WEIGHTS = Object.freeze({ pertinence: 0.5, fraicheur: 0.25, impact: 0.25 });

const clamp = (x) => Math.max(0, Math.min(100, Number(x) || 0));
const nowIso = () => new Date().toISOString();

/** Id canonique stable : deduplique un meme (source, contenu). */
export function idSignal({ source = '', contenu = '' } = {}) {
  let h = 7;
  const s = `${String(source ?? '')}|${String(contenu ?? '')}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `sig-${h.toString(16)}`;
}

/** Normalise un signal brut : `{ id, source, date, contenu, url?, tags? }`. */
export function normalizeSignal(signal = {}, { index = 0 } = {}) {
  const contenu = String(signal.contenu ?? '').trim();
  if (!contenu) throw new Error('ecouter: contenu requis');
  const d = new Date(signal.date ?? nowIso());
  if (Number.isNaN(d.getTime())) throw new Error('ecouter: date invalide');
  const tags = Array.isArray(signal.tags)
    ? [...new Set(signal.tags.map((t) => String(t).trim()).filter(Boolean))]
    : [];
  return {
    id: signal.id ?? idSignal({ source: signal.source, contenu }),
    source: String(signal.source ?? 'manuel'),
    date: d.toISOString(),
    contenu,
    url: signal.url ?? null,
    tags,
    index,
    qualifie: false,
    createdAt: nowIso(),
  };
}

/**
 * Score de fraicheur 0..100 (deterministe, fonction de l'age du signal).
 * Decroissance exponentielle, demi-vie `demiVie` jours. Un signal futur ou
 * du jour = 100 ; 90 jours ≈ 37 ; un an ≈ 2.
 */
export function freshnessScore(date, { now = () => new Date(), demiVie = DEMI_VIE_FRAICHEUR } = {}) {
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return null;
  const ageJours = (new Date(now()).getTime() - t) / 86400000;
  if (ageJours <= 0) return { score: 100, ageJours: 0 };
  return { score: Math.round(100 * Math.exp(-ageJours / demiVie)), ageJours: Math.round(ageJours) };
}

/**
 * Score de pertinence explique (EF-02) : note 0..100 = moyenne ponderee des
 * dimensions renseignees (pertinence 50% · fraicheur 25% · impact 25%).
 * @param {{date:string}} signal
 * @param {{pertinence?:number, impact?:number, now?:()=>Date}} [opts]
 */
export function scoreSignal(signal, { pertinence, impact, now } = {}) {
  const dimensions = [];
  if (pertinence != null) {
    dimensions.push({ dimension: 'pertinence', score: clamp(pertinence), poids: DIMENSION_WEIGHTS.pertinence, raison: `Évaluation d'entrée (LLM/humain) : ${clamp(pertinence)}/100` });
  }
  const fraicheur = freshnessScore(signal.date, { now });
  dimensions.push({ dimension: 'fraicheur', score: fraicheur.score, poids: DIMENSION_WEIGHTS.fraicheur, raison: `Âge du signal : ${fraicheur.ageJours} jour(s) — décroissance exponentielle (demi-vie ${DEMI_VIE_FRAICHEUR} j)` });
  if (impact != null) {
    dimensions.push({ dimension: 'impact', score: clamp(impact), poids: DIMENSION_WEIGHTS.impact, raison: `Impact présumé : ${clamp(impact)}/100` });
  }
  const pondere = dimensions.reduce((a, d) => a + d.score * d.poids, 0);
  const poidsTotal = dimensions.reduce((a, d) => a + d.poids, 0);
  const note = poidsTotal > 0 ? Math.round(pondere / poidsTotal) : null;
  return {
    note,
    dimensions,
    explication: note != null
      ? `Note ${note}/100 (${dimensions.map((d) => `${d.dimension} ${d.score}`).join(', ')}).`
      : 'Scoring insuffisant : aucune dimension renseignée.',
  };
}

/**
 * Reduction de bruit (F5) : signaux sous le seuil masqués mais conserves.
 * Reversible : abaisser le seuil les fait reapparaitre. Un signal sans note
 * n'est jamais masque (on ne devine pas).
 */
export function reductionBruit(signals = [], { seuil = SEUIL_BRUIT_DEFAUT } = {}) {
  const masques = signals.filter((s) => s.note != null && s.note < seuil);
  const conserves = signals.filter((s) => s.note == null || s.note >= seuil);
  return {
    seuil,
    conserves,
    masques,
    conservesCount: conserves.length,
    masquesCount: masques.length,
  };
}

/** Rendu lisible de la reduction de bruit (parite avec la spec). */
export function renderNoiseReduction(rep) {
  return `Réduction de bruit (seuil ${rep.seuil}) : ${rep.conservesCount} signal(s) conservé(s), ${rep.masquesCount} masqué(s) — masquage réversible.`;
}

/** Promotion en signal qualifie (EF-01 / F6) : action humaine horodatée. */
export function promoteSignal(signal, { by, ideaId = null, ts = null } = {}) {
  if (!by) throw new Error('ecouter: auteur de promotion requis');
  if (signal.qualifie) throw new Error(`ecouter: signal déjà qualifié (${signal.id})`);
  return { ...signal, qualifie: true, promote: { by, ideaId, ts: ts ?? nowIso() } };
}

/** Clustering (F3) : regroupe les signaux par tag (ou par source). */
export function clusterSignals(signals = [], { by = 'tags' } = {}) {
  const clusters = {};
  for (const s of signals) {
    const keys = by === 'source' ? [String(s.source)] : (s.tags.length ? s.tags : ['non_tagué']);
    for (const k of keys) (clusters[k] ??= []).push(s.id);
  }
  return Object.entries(clusters)
    .map(([tag, ids]) => ({ tag, ids, count: ids.length }))
    .sort((a, b) => b.count - a.count);
}

/** Synthese Ecouter : reduction + clusters + rendu. */
export function rapportEcoute(signals = [], { seuil = SEUIL_BRUIT_DEFAUT, clusterBy = 'tags' } = {}) {
  const reduction = reductionBruit(signals, { seuil });
  return {
    seuil,
    reduction,
    clusters: clusterSignals(signals, { by: clusterBy }),
    qualifiees: signals.filter((s) => s.qualifie).length,
    total: signals.length,
    rendu: renderNoiseReduction(reduction),
  };
}
