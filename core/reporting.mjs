// KayrosLab — Reporting portefeuille (EF-84 a EF-87, + EF-79 ROI agrege).
// Tout se calcule a partir de l'HISTORIQUE des idees : aucune donnee inventee,
// et une idee sans historique n'est jamais comptee comme ayant franchi une etape.

import { STAGES, STATUSES, TERMINAL_STATUSES } from './model.mjs';
import { totals } from './impact.mjs';

const r2 = (x) => Math.round(x * 100) / 100;
const idx = (stage) => STAGES.indexOf(stage);

/** Une idee a-t-elle ATTEINT une etape (aujourd'hui ou par le passe) ? */
function aAtteint(idea, stage) {
  if (idx(idea.stage) >= idx(stage)) return true;             // position courante
  return (idea.history ?? []).some((h) => h.type === 'stage' && h.to === stage);
}

/**
 * Entonnoir de conversion (EF-85).
 * `atteintes` = idees passees par l'etape ; `conversion` = passage vers l'etape suivante.
 */
export function funnel(ideas = []) {
  const etapes = STAGES.map((stage) => {
    const atteintes = ideas.filter((i) => aAtteint(i, stage));
    const abandons = atteintes.filter((i) => TERMINAL_STATUSES.includes(i.status) && i.stage === stage);
    return { stage, atteintes: atteintes.length, presentes: ideas.filter((i) => i.stage === stage).length, abandons: abandons.length };
  });
  for (let k = 0; k < etapes.length; k++) {
    const suivant = etapes[k + 1];
    etapes[k].conversion = suivant && etapes[k].atteintes > 0 ? r2(suivant.atteintes / etapes[k].atteintes) : null;
  }
  return { etapes, total: ideas.length };
}

/**
 * Temps moyen passe par etape (EF-86), en jours, deduit des transitions.
 * Une etape encore en cours compte jusqu'a `now` (sejour non termine signale).
 */
export function tempsParEtape(ideas = [], { now = () => new Date() } = {}) {
  const acc = Object.fromEntries(STAGES.map((s) => [s, { totalJours: 0, sejours: 0, enCours: 0 }]));
  const d = now();
  for (const idea of ideas) {
    const trans = (idea.history ?? []).filter((h) => h.type === 'stage' && h.ts);
    let etape = (idea.history ?? [])[0]?.stage ?? 'recueillir';
    let depuis = new Date(idea.createdAt ?? (idea.history ?? [])[0]?.ts ?? d);
    for (const t of trans) {
      const q = acc[t.from ?? etape];
      if (q) { q.totalJours += (new Date(t.ts) - depuis) / 86400000; q.sejours++; }
      etape = t.to; depuis = new Date(t.ts);
    }
    const q = acc[idea.stage];
    if (q) { q.totalJours += (d - depuis) / 86400000; q.enCours++; }   // sejour non termine
  }
  return STAGES.map((stage) => {
    const q = acc[stage];
    const n = q.sejours + q.enCours;
    return { stage, moyenneJours: n ? r2(q.totalJours / n) : null, sejoursTermines: q.sejours, enCours: q.enCours };
  });
}

/**
 * Tableau de bord portefeuille (EF-84) + ROI agrege (EF-79).
 * Le ROI agrege ne porte QUE sur les idees ayant un impact constate : agreger
 * des idees sans donnee financiere fausserait le ratio.
 */
export function dashboard(ideas = []) {
  const parEtape = Object.fromEntries(STAGES.map((s) => [s, 0]));
  const parStatut = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let sommeKi = 0, nKi = 0, investi = 0, beneficie = 0, avecImpact = 0;

  for (const i of ideas) {
    if (parEtape[i.stage] !== undefined) parEtape[i.stage]++;
    if (parStatut[i.status] !== undefined) parStatut[i.status]++;
    if (typeof i.ki === 'number') { sommeKi += i.ki; nKi++; }
    if (i.impact) {
      const t = totals(i.impact);
      if (t.investi || t.beneficie) { investi += t.investi; beneficie += t.beneficie; avecImpact++; }
    }
  }
  const actives = ideas.filter((i) => !TERMINAL_STATUSES.includes(i.status)).length;
  const abandonnees = parStatut.non_poursuivi ?? 0;
  return {
    total: ideas.length, actives, abandonnees,
    tauxAbandon: ideas.length ? r2(abandonnees / ideas.length) : null,
    kiMoyen: nKi ? r2(sommeKi / nKi) : null, idesNotees: nKi,
    parEtape, parStatut,
    portefeuilleFinancier: {
      idesAvecImpact: avecImpact,
      investi: r2(investi), beneficie: r2(beneficie), net: r2(beneficie - investi),
      roiAgrege: investi > 0 ? r2((beneficie - investi) / investi) : null,
    },
  };
}

/**
 * Leaderboard temps reel (hackathon / classement).
 * Classe les idees selon un critere avec possibilite de filtrer par campagne.
 */
export function leaderboard(ideas = [], { critere = 'ki', sens = 'desc', top = 20, campagneId = null, now = new Date() } = {}) {
  const filtered = campagneId ? ideas.filter((i) => i.campagneId === campagneId) : ideas;
  const withScore = [];
  for (const i of filtered) {
    const votesMoy = i.votes?.length ? Math.round(i.votes.reduce((a, v) => a + v.score, 0) / i.votes.length * 10) / 10 : null;
    const t = i.impact ? totals(i.impact) : { net: 0, investi: 0, beneficie: 0 };
    const avancement = STAGES.indexOf(i.stage) / (STAGES.length - 1);
    const age = i.createdAt ? Math.max(1, Math.round((now - new Date(i.createdAt)) / 86400000)) : 1;
    const scoreKi = typeof i.ki === 'number' ? i.ki : 0;
    const scoreVotes = votesMoy ?? 0;
    const scoreImpact = t.net > 0 ? Math.min(100, t.net / 1000) : 0;
    const scoreAvancement = avancement * 100;
    const score = Math.round(
      critere === 'ki'         ? scoreKi :
      critere === 'votes'      ? scoreVotes :
      critere === 'impact'     ? scoreImpact :
      critere === 'avancement' ? scoreAvancement :
      critere === 'age'        ? (100 / age) :
      (scoreKi * 0.4 + scoreVotes * 0.2 + scoreImpact * 0.2 + scoreAvancement * 0.2)
    );
    withScore.push({
      id: i.id, titre: i.title, auteur: i.author, categorie: i.category, campagneId: i.campagneId,
      etape: i.stage, statut: i.status, score,
      ki: scoreKi, votesMoy: votesMoy, nbVotes: i.votes?.length ?? 0,
      impactNet: t.net, age
    });
  }
  const tri = sens === 'asc' ? (a, b) => a.score - b.score : (a, b) => b.score - a.score;
  withScore.sort(tri);
  const items = top ? withScore.slice(0, top) : withScore;
  const meilleur = items.length ? items.reduce((a, b) => a.score >= b.score ? a : b) : null;
  return { items, total: filtered.length, critere, sens, meilleur: meilleur ? { id: meilleur.id, score: meilleur.score } : null };
}

/** Echappement CSV : une valeur contenant separateur, guillemet ou saut de ligne est citee. */
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Export du portefeuille au format CSV (EF-87). */
export function exportCsv(ideas = []) {
  const cols = ['id', 'titre', 'etape', 'statut', 'auteur', 'categorie', 'ki', 'votes', 'investi', 'beneficie', 'net', 'creeLe', 'majLe'];
  const lignes = ideas.map((i) => {
    const t = i.impact ? totals(i.impact) : { investi: '', beneficie: '', net: '' };
    return [i.id, i.title, i.stage, i.status, i.author, i.category, i.ki ?? '',
      (i.votes ?? []).length, t.investi, t.beneficie, t.net, i.createdAt, i.updatedAt].map(csvCell).join(',');
  });
  return [cols.join(','), ...lignes].join('\n');
}

/** Critères comparables entre idées (EF-54). */
export const CRITERES_COMPARAISON = [
  { id: 'ki', label: 'KI', sens: 'max' },
  { id: 'votesMoyenne', label: 'Vote moyen', sens: 'max' },
  { id: 'votesCount', label: 'Évaluateurs', sens: 'max' },
  { id: 'net', label: 'Net réalisé (€)', sens: 'max' },
  { id: 'roiReel', label: 'ROI réel', sens: 'max' },
  { id: 'ageJours', label: 'Ancienneté (j)', sens: 'min' },
];

function mesures(idea, now) {
  const votes = idea.votes ?? [];
  const t = idea.impact ? totals(idea.impact) : { net: null, roiReel: null };
  return {
    ki: typeof idea.ki === 'number' ? idea.ki : null,
    votesMoyenne: votes.length ? r2(votes.reduce((a, v) => a + v.score, 0) / votes.length) : null,
    votesCount: votes.length,
    net: t.net, roiReel: t.roiReel,
    ageJours: idea.createdAt ? r2((now - new Date(idea.createdAt)) / 86400000) : null,
  };
}

/**
 * Comparaison côte à côte (EF-54). Pour chaque critère, la meilleure idée est
 * signalée — mais SEULEMENT si la donnée existe : une idée non notée n'est jamais
 * declaree "meilleure" par defaut d'information.
 */
export function compare(ideas = [], { now = () => new Date() } = {}) {
  const d = now();
  const lignes = ideas.map((i) => ({
    id: i.id, titre: i.title, etape: i.stage, statut: i.status, mesures: mesures(i, d),
  }));
  const meilleurs = {};
  for (const c of CRITERES_COMPARAISON) {
    const dispo = lignes.filter((l) => typeof l.mesures[c.id] === 'number');
    if (!dispo.length) { meilleurs[c.id] = null; continue; }
    const best = dispo.reduce((a, b) =>
      (c.sens === 'max' ? b.mesures[c.id] > a.mesures[c.id] : b.mesures[c.id] < a.mesures[c.id]) ? b : a);
    // Egalite parfaite : pas de gagnant designe.
    const exaequo = dispo.filter((l) => l.mesures[c.id] === best.mesures[c.id]).length > 1;
    meilleurs[c.id] = exaequo ? null : best.id;
    if (!exaequo) continue;
  }
  return { criteres: CRITERES_COMPARAISON, lignes, meilleurs, nonRenseignes: lignes.filter((l) => l.mesures.ki === null).map((l) => l.id) };
}
