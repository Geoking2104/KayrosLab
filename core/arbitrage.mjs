// KayrosLab — Arbitrage COMEX (EF-14 / F1-F7).
// La synthese d'arbitrage CONSOMME des donnees reelles deja produites (votes,
// risques, projections) et compose un dossier lisible pour l'arbitre. Rien
// n'est invente : aucun nombre ne sort d'un calcul non deterministe.
// recordDecision() ajoute une decision Go/No-Go/Revision a un journal
// APPEND-ONLY porte par l'idee (immuable, horodate, signe par l'auteur).

import { rapportRisques } from './risques.mjs';

export const ARBITRAGE_DECISIONS = Object.freeze(['Go', 'No-Go', 'Révision']);

/** Normalise une decision brute vers l'alphabet Go/No-Go/Revision. */
export function normalizeArbitrageDecision(raw) {
  const t = String(raw ?? '').trim();
  const low = t.toLowerCase();
  if (['go', 'approve', 'accept', 'validated_human'].includes(low)) return 'Go';
  if (['no-go', 'no go', 'reject', 'veto', 'blocked_veto'].includes(low)) return 'No-Go';
  if (['révision', 'revision', 'revise'].includes(low)) return 'Révision';
  return null;
}

/** Horizon de decision COMEX : statut idée correspondant a chaque verdict. */
export const DECISION_MAPPING = Object.freeze({
  Go: { status: 'en_developpement', stage: 'projeter' },
  'No-Go': { status: 'non_poursuivi', stage: null },
  Révision: { status: 'en_revue', stage: 'eprouver' },
});

/**
 * Ajoute une decision au journal immuable de l'idee (append-only).
 * Les enregistrements precedents ne sont jamais modifies.
 * @param {object} idea
 * @param {{decision:string, by:string, role?:string|null, reason?:string, gateId?:string|null, ts?:string|null}} dec
 */
export function recordDecision(idea, { decision, by, role = null, reason = '', gateId = null, ts = null } = {}) {
  const norm = normalizeArbitrageDecision(decision);
  if (!norm) throw new Error(`recordDecision: decision inconnue "${decision}"`);
  if (!by) throw new Error('recordDecision: auteur requis');
  const ledger = Array.isArray(idea.decisions) ? idea.decisions : [];
  const prev = ledger.length ? ledger[ledger.length - 1] : null;
  const record = {
    seq: (prev?.seq ?? 0) + 1,
    decision: norm,
    by: String(by),
    role: role ?? null,
    reason: String(reason ?? ''),
    gateId: gateId ?? null,
    ts: ts ?? new Date().toISOString(),
  };
  return { ...idea, decisions: [...ledger, record] };
}

/** Journal des decisions, du plus recent au plus ancien (copies immuables). */
export function decisionsTimeline(idea) {
  const ledger = Array.isArray(idea?.decisions) ? idea.decisions : [];
  return [...ledger].map((d) => ({ ...d })).sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : (b.seq ?? 0) - (a.seq ?? 0)));
}

/** Derniere decision (ou null si l'idee n'a jamais ete tranchee). */
export function lastDecision(idea) {
  const t = decisionsTimeline(idea);
  return t.length ? t[0] : null;
}

/**
 * Synthese d'arbitrage (F1) : compose un dossier a partir de donnees reelles.
 * - recommandation : agregat des votes (existant) — indicatif, ne tranche pas.
 * - redFlags : risques critiques/eleves issus de la matrice de risques existante.
 * - roi : projections Monte-Carlo deja calculees (deterministe).
 * - gates : gates en attente pour cette idee.
 * - decisions : journal immuable des arbitrages passes.
 * Aucun nombre n'est devine : tout champ absent reste null / [].
 */
export function buildSyntheseArbitrage({
  idea = null,
  wgAggregat = null,
  risques = [],
  projection = null,
  pendingGates = [],
} = {}) {
  const rapport = rapportRisques(Array.isArray(risques) ? risques : []);
  const redFlags = rapport.risques.filter((r) => r.niveau === 'critique' || r.niveau === 'eleve');

  const kpis = [];
  if (Array.isArray(idea?.roadmap?.kpis)) kpis.push(...idea.roadmap.kpis);

  return {
    idée: idea ? {
      id: idea.id, title: idea.title ?? null, description: idea.description ?? null,
      stage: idea.stage ?? null, status: idea.status ?? null, updatedAt: idea.updatedAt ?? null,
    } : null,
    recommandation: wgAggregat ?? null,
    redFlags: redFlags.map((r) => ({ id: r.id, libelle: r.libelle, niveau: r.niveau, probabilite: r.probabilite, impact: r.impact, statut: r.statut })),
    matriceRisques: rapport.matrice ?? null,
    projection: projection ?? null,
    kpis,
    gatesEnAttente: (pendingGates ?? []).map((g) => ({ gateId: g.gateId, type: g.type, requiredRole: g.requiredRole, createdAt: g.createdAt })),
    decisions: decisionsTimeline(idea),
    synthèse: composeSynthèse(idea, wgAggregat, redFlags, pendingGates),
  };
}

/** Resume textuel genere uniquement a partir de champs reels (jamais inventes). */
function composeSynthèse(idea, wgAggregat, redFlags, pendingGates) {
  if (!idea) return '';
  const lignes = [`Idée : ${idea.title ?? '(sans titre)'}`];
  lignes.push(`Étape : ${idea.stage ?? '?'} · Statut : ${idea.status ?? '?'}`);
  if (wgAggregat?.moyennePonderee != null) {
    lignes.push(`Recommandation du groupe de travail : ${wgAggregat.recommandation ?? 'insuffisant'} (score pondéré ${wgAggregat.moyennePonderee}, ${wgAggregat.count} vote(s)).`);
  }
  if (redFlags.length) lignes.push(`Signaux d'alerte : ${redFlags.map((r) => r.libelle).join(' ; ')}.`);
  if (pendingGates.length) {
    lignes.push(`Gate(s) en attente de décision : ${pendingGates.map((g) => g.type).join(', ')}.`);
  } else {
    lignes.push('Aucun gate en attente.');
  }
  const d = lastDecision(idea);
  if (d) lignes.push(`Dernière décision : ${d.decision} par ${d.by} le ${d.ts}${d.reason ? ` — ${d.reason}` : ''}.`);
  return lignes.join('\n');
}
