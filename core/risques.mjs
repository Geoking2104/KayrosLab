// KayrosLab — Matrice de risques probabilises (EF-42).
// Probabilite x impact -> score deterministe, classe en niveau (faible..critique),
// matrice 5x5 et declencheurs de re-arbitrage. Le LLM fournit prob/impact ;
// l'outil calcule, aucun chiffre n'est invente.

export const SEUILS_NIVEAU = { critique: 0.7, eleve: 0.4, moyen: 0.2 };
export const SEUIL_REARBITRAGE = 0.7;
export const STATUTS_RISQUE = ['actif', 'traite', 'accepte'];

const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0));
const nowIso = () => new Date().toISOString();

/** Niveau de risque a partir d'un score probabilite x impact. */
export function niveauRisque(probabilite = 0, impact = 0) {
  const score = round2(clamp01(probabilite) * clamp01(impact));
  if (score >= SEUILS_NIVEAU.critique) return { score, niveau: 'critique' };
  if (score >= SEUILS_NIVEAU.eleve) return { score, niveau: 'eleve' };
  if (score >= SEUILS_NIVEAU.moyen) return { score, niveau: 'moyen' };
  return { score, niveau: 'faible' };
}

/** Classe 0..1 en niveau de grille 1..5 pour la matrice. */
const cell = (v) => 1 + Math.min(4, Math.round(clamp01(v) * 4));

/** Enrichit un risque brut : score, niveau, id, date. */
export function enrichirRisque(r, { index = 0 } = {}) {
  if (!r || typeof r !== 'object') throw new Error('risque objet requis');
  if (!r.probabilite && r.probabilite !== 0) throw new Error('probabilite numerique requise');
  if (!r.impact && r.impact !== 0) throw new Error('impact numerique requis');
  const { score, niveau } = niveauRisque(r.probabilite, r.impact);
  return {
    id: r.id ?? `r${index + 1}`,
    libelle: r.libelle ?? `Risque ${index + 1}`,
    probabilite: round2(clamp01(r.probabilite)),
    impact: round2(clamp01(r.impact)),
    score, niveau,
    statut: r.statut ?? 'actif',
    trigger: r.trigger ?? null,
    createdAt: r.createdAt ?? nowIso(),
  };
}

/** Ajoute un risque a la liste (idempotent par id si fourni). */
export function addRisque(risques = [], risque, { index = risques.length } = {}) {
  const enriched = enrichirRisque(risque, { index });
  const i = risques.findIndex((x) => x.id === enriched.id);
  if (i >= 0) { const out = [...risques]; out[i] = enriched; return out; }
  return [...risques, enriched];
}

/** Met a jour un risque (patch probabilite/impact/libelle/statut/trigger) et recalcule. */
export function updateRisque(risques = [], id, patch = {}) {
  const i = risques.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`updateRisque: risque inconnu "${id}"`);
  const merged = { ...risques[i], ...patch };
  if (patch.statut && !STATUTS_RISQUE.includes(patch.statut)) throw new Error(`statut de risque invalide "${patch.statut}"`);
  const enriched = enrichirRisque({ ...merged, id, createdAt: risques[i].createdAt }, { index: i });
  const out = [...risques]; out[i] = enriched;
  return out;
}

/** Retire un risque de la liste. */
export function removeRisque(risques = [], id) {
  return risques.filter((x) => x.id !== id);
}

/**
 * Matrice 5x5 probabilite x impact + distribution par niveau.
 * @returns {{grille:Object, distribution:Object, total:number}}
 */
export function matriceRisques(risques = []) {
  const grille = {};
  const distribution = { critique: 0, eleve: 0, moyen: 0, faible: 0 };
  for (const r of risques) {
    const p = cell(r.probabilite), im = cell(r.impact);
    const key = `${p}x${im}`;
    grille[key] = (grille[key] ?? 0) + 1;
    distribution[r.niveau] = (distribution[r.niveau] ?? 0) + 1;
  }
  return { grille, distribution, total: risques.length };
}

/**
 * Declencheurs de re-arbitrage : risques actifs dont le score depasse le seuil.
 * @returns {{declenchements:Object[], necessaire:boolean, raisons:string[]}}
 */
export function detectDeclencheurs(risques = [], { seuil = SEUIL_REARBITRAGE } = {}) {
  const declenchements = risques.filter((r) => r.statut !== 'traite' && r.score >= seuil)
    .map((r) => ({ id: r.id, libelle: r.libelle, score: r.score, niveau: r.niveau, trigger: r.trigger ?? null }));
  return {
    declenchements,
    necessaire: declenchements.length > 0,
    raisons: declenchements.map((d) => `${d.libelle} (score ${d.score})`),
  };
}

/** Synthese complete pour l'API : matrice + declencheurs (les risques sont enrichis). */
export function rapportRisques(risques = [], opts = {}) {
  const enriched = risques.map((r, i) => enrichirRisque(r, { index: i }));
  return {
    risques: enriched,
    matrice: matriceRisques(enriched),
    declencheurs: detectDeclencheurs(enriched, opts),
  };
}
