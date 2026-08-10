// KayrosLab — Etape 3 "Construire" (EF-05 / F1).
// Canvas de scenario editable : composer/editer un scenario a partir des
// noeuds/ponts selectionnes en Cartographier (selection -> payload F6) ou des
// signaux/tendances. Le moteur valide, dedupe et agrege (deterministe) ; il
// n'invente jamais de contenu : texte/insight/type restent fournis par
// l'utilisateur ou le Synthesizer LLM.

export const TYPES_SCENARIO = Object.freeze(['rupture', 'prudente', 'optimiste']);

/** Id stable d'un scenario (dedupe par nom). */
export function idScenario(nom) {
  let h = 11;
  const s = String(nom ?? '');
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return `scen-${h.toString(16)}`;
}

const uniq = (arr) => [...new Set((arr ?? []).map(String).map((s) => s.trim()).filter(Boolean))];

/**
 * Normalise un scenario : `{ id, nom, type?, description?, probleme?,
 * proposition?, cible?, hypotheses[], metriques[], noeuds[], ponts[], tags[] }`.
 */
export function normalizeScenario(sc = {}, { index = 0 } = {}) {
  const nom = String(sc.nom ?? sc.titre ?? '').trim();
  if (!nom) throw new Error('construire: nom de scenario requis');
  const type = sc.type ?? null;
  if (type && !TYPES_SCENARIO.includes(type)) throw new Error('construire: type invalide (rupture|prudente|optimiste)');
  return {
    id: sc.id ?? idScenario(nom),
    nom,
    type,
    description: sc.description ?? null,
    probleme: sc.probleme ?? null,
    proposition: sc.proposition ?? null,
    cible: sc.cible ?? null,
    hypotheses: uniq(sc.hypotheses),
    metriques: uniq(sc.metriques),
    noeuds: uniq(sc.noeuds),
    ponts: uniq(sc.ponts),
    tags: uniq(sc.tags),
    source: sc.source ?? null,
    index,
  };
}

/**
 * Canvas initial depuis la selection Cartographier (payload F6 :
 * `{ destination, noeuds[], ponts[], ts }`) ou une liste de noeuds/ponts bruts.
 */
export function canvasConstruire(selection = null, { noeuds = [], ponts = [] } = {}) {
  const srcNoeuds = selection?.noeuds ?? noeuds;
  const srcPonts = selection?.ponts ?? ponts;
  return {
    noeuds: srcNoeuds.map((n) => ({ id: String(n.id ?? n), nom: String(n.nom ?? n.id ?? '') })),
    ponts: srcPonts.map((p) => ({ id: String(p.id ?? p), de: p.de ?? null, vers: p.vers ?? null })),
    ts: selection?.ts ?? null,
  };
}

export function scenarioCanvas(canvas = { noeuds: [], ponts: [] }) {
  return { noeuds: canvas.noeuds ?? [], ponts: canvas.ponts ?? [], ts: canvas.ts ?? null };
}

/** Ajout d'un scenario au canvas (immuable, dedupe par id). */
export function addScenario(canvas, sc, { index } = {}) {
  const c = { ...canvas, scenarios: canvas.scenarios ?? [] };
  const s = normalizeScenario(sc, { index: index ?? c.scenarios.length });
  if (c.scenarios.some((x) => x.id === s.id)) throw new Error('construire: scenario deja present');
  return {
    canvas: { ...c, scenarios: [...c.scenarios, s], updatedAt: new Date().toISOString() },
    scenario: s,
  };
}

/** Edition d'un scenario (merge + re-normalisation, id preserve). */
export function updateScenario(canvas, id, patch = {}) {
  const c = { ...canvas, scenarios: canvas.scenarios ?? [] };
  const i = c.scenarios.findIndex((x) => x.id === id);
  if (i < 0) throw new Error('construire: scenario introuvable');
  const base = c.scenarios[i];
  const merged = normalizeScenario({ ...base, ...patch, id }, { index: i });
  const scenarios = c.scenarios.map((x) => (x.id === id ? merged : x));
  return { canvas: { ...c, scenarios, updatedAt: new Date().toISOString() }, scenario: merged };
}

/** Suppression d'un scenario (immuable). */
export function removeScenario(canvas, id) {
  const c = { ...canvas, scenarios: canvas.scenarios ?? [] };
  const scenarios = c.scenarios.filter((x) => x.id !== id);
  if (scenarios.length === c.scenarios.length) throw new Error('construire: scenario introuvable');
  return { canvas: { ...c, scenarios, updatedAt: new Date().toISOString() }, retires: 1 };
}

/** Synthese Construire (EF-05) : comptages reels, jamais de chiffres inventes. */
export function rapportConstruire(canvas = {}) {
  const c = canvasConstruire(canvas);
  const scenarios = canvas.scenarios ?? [];
  return {
    canvas: c,
    scenarios,
    totalScenarios: scenarios.length,
    totalNoeuds: c.noeuds.length,
    totalPonts: c.ponts.length,
    types: TYPES_SCENARIO.map((t) => ({ type: t, count: scenarios.filter((s) => s.type === t).length })),
    rendu: `Canvas : ${c.noeuds.length} noeud(s), ${c.ponts.length} pont(s), ${scenarios.length} scenario(s) composes.`,
  };
}
