// KayrosLab — Etape 4 "Eprouver" : Future Proofing multi-agents (EF-08 / F1-F5).
// Timeline horodatee Critic → Devil's Advocate → Red Team. Le moteur structure,
// dedupe et aggrege ; il ne devine jamais un contenu reel : sans apport
// (LLM/humain), les constats sont heuristiques deterministes et marques
// `source: 'heuristique'`. La severite est soit importee, soit calculee depuis
// les donnees reelles du dossier — jamais inventee.

export const AGENTS_EPREUVE = ['critic', 'devil_advocate', 'red_team'];
export const SEUIL_CRITIQUE = 0.8;

const clamp = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
};

/** Id stable d'une attaque (dedupe par agent + position dans la passe). */
export function idAttaque(agent, index) {
  return `att-${agent}-${index}`;
}

/** Niveau de severite deterministe depuis la valeur reelle (jamais invente). */
export function niveauSeverite(v) {
  if (v == null) return null;
  if (v >= SEUIL_CRITIQUE) return 'critique';
  if (v >= 0.5) return 'moyenne';
  return 'faible';
}

/**
 * Normalise une attaque (F5) : `{ id, agent, type, hypothese, argument,
 * preuve, severite, niveau, source }`. L'argument est obligatoire ; la
 * severite est importee (LLM/humain) ou calculee, jamais invente.
 */
export function normalizeAttaque(a = {}, { index = 0 } = {}) {
  const argument = String(a.argument ?? a.text ?? '').trim();
  if (!argument) throw new Error('eprouver: argument requis');
  const agent = AGENTS_EPREUVE.includes(a.agent) ? a.agent : 'red_team';
  const severite = a.severite != null ? clamp(a.severite) : null;
  return {
    id: a.id ?? idAttaque(agent, index),
    agent,
    type: a.type ?? 'defaut',
    hypothese: a.hypothese ?? null,
    argument,
    preuve: a.preuve ?? null,
    severite,
    niveau: niveauSeverite(severite),
    source: a.source ?? 'humain',
    proposant: a.proposant ?? null,
    ts: a.ts ?? null,
    index,
  };
}

/**
 * Contexte d'epreuve depuis l'idee (Construire) : hypotheses explicites des
 * scenarios et des collisions selectionnees, proposition, cible, metriques.
 * Extraites des donnees reelles, jamais devinees.
 */
export function buildContexteEprouver(idea = {}) {
  const scenarios = idea.construire?.scenarios ?? [];
  const selection = idea.construire?.selectionCollisions ?? [];
  const collisions = (idea.construire?.collisions ?? []).filter((c) => !selection.length || selection.includes(c.id));
  const hypotheses = [...new Set([
    ...scenarios.flatMap((s) => s.hypotheses ?? []),
    ...collisions.flatMap((c) => (c.hypotheses ?? []).map((h) => String(h))),
  ])];
  return {
    proposition: scenarios.map((s) => s.proposition).find(Boolean) ?? collisions.map((c) => c.proposition).find(Boolean) ?? null,
    cible: scenarios.map((s) => s.cible).find(Boolean) ?? null,
    metriques: [...new Set(scenarios.flatMap((s) => s.metriques ?? []))],
    hypotheses,
    noeuds: idea.construire?.noeuds ?? [],
    ponts: idea.construire?.ponts ?? [],
    scenarioCount: scenarios.length,
    collisionCount: collisions.length,
  };
}

/** Critic (F2) — repli heuristique deterministe : angles morts, biais, failles. */
export function criticHeuristique(contexte = {}) {
  const c = {
    proposition: contexte.proposition ?? null,
    cible: contexte.cible ?? null,
    hypotheses: contexte.hypotheses ?? [],
    metriques: contexte.metriques ?? [],
    scenarioCount: contexte.scenarioCount ?? 0,
    collisionCount: contexte.collisionCount ?? 0,
  };
  const attaques = [];
  const push = (type, severite, argument, hypothese = null) => attaques.push({ agent: 'critic', type, severite, argument, hypothese });
  if (!c.proposition) push('angle_mort', 0.7, 'La proposition de valeur est absente : rien à challenger en termes de promesse client.');
  if (!c.cible) push('angle_mort', 0.55, 'Aucune cible explicite : les biais d\'échantillonnage du marché ne peuvent pas être évalués.');
  if (!c.hypotheses.length) push('angle_mort', 0.85, 'Aucune hypothèse explicite issue de Construire : le dossier est inéprouvable tel quel.');
  if (!c.metriques.length) push('angle_mort', 0.65, 'Aucune métrique de validation : les failles logiques ne seront pas mesurables.');
  if (!c.scenarioCount && !c.collisionCount) push('faute_logique', 0.8, 'Aucun scénario ni collision sélectionné : rien à éprouver.');
  return attaques.map((a, i) => normalizeAttaque({ ...a, id: idAttaque('critic', i), source: 'heuristique' }, { index: i }));
}

/** Devil's Advocate (F3) — conteste chaque hypothese clee issue de Construire. */
export function devilAdvocateHeuristique(contexte = {}) {
  const attaques = [];
  for (const hyp of contexte.hypotheses.slice(0, 12)) {
    const vague = !/\d/.test(hyp) && hyp.length < 80;
    attaques.push({
      type: 'conteste',
      hypothese: hyp,
      severite: vague ? 0.75 : 0.55,
      argument: vague
        ? `Hypothèse « ${clip(hyp, 90)} » non falsifiable telle quelle : ni seuil ni condition de réfutation.`
        : `Hypothèse « ${clip(hyp, 90)} » à démontrer : le dossier n'apporte pas encore de preuve de son incidence.`,
    });
  }
  if (!attaques.length) {
    attaques.push({
      type: 'absence',
      hypothese: null,
      severite: 0.8,
      argument: 'Aucune hypothèse clé à contester : le scénario ne liste pas ses hypothèses (bloquant pour l\'arbitrage).',
    });
  }
  return attaques.map((a, i) => normalizeAttaque({ ...a, agent: 'devil_advocate', id: idAttaque('devil_advocate', i), source: 'heuristique' }, { index: i }));
}

/** Red Team (F4) — kill shots + scenarios d'echec plausibles (repli deterministe). */
export function redTeamHeuristique(contexte = {}) {
  const attaques = [];
  const push = (type, severite, argument, hypothese = null) => attaques.push({ agent: 'red_team', type, severite, argument, hypothese });
  if (contexte.proposition) push('kill_shot', 0.55, `Le kill shot le plus probable : un acteur établi absorbe la valeur de « ${clip(contexte.proposition, 80)} » avant la mise à l'échelle.`);
  else push('kill_shot', 0.6, 'Kill shot : sans proposition claire, le projet meurt par indifférence du marché.');
  if (contexte.cible) push('echec', 0.5, `Scénario d'échec plausible : la cible « ${clip(contexte.cible, 80)} » se révèle mal adressée (coût d'acquisition > valeur).`);
  else push('echec', 0.55, 'Scénario d\'échec plausible : absence de cible → go-to-market dispersé, aucun segment en traction.');
  if (contexte.metriques.length) push('echec', 0.45, 'Scénario d\'échec : les métriques de succès sont suivies mais aucun jalon de réfutation n\'est défini pour arrêter tôt.');
  return attaques.map((a, i) => normalizeAttaque({ ...a, id: idAttaque('red_team', i), source: 'heuristique' }, { index: i }));
}

function asApport(apport, agent, contexte) {
  if (apport == null) return null;
  if (typeof apport === 'function') return apport;
  const items = Array.isArray(apport) ? apport : (apport.attaques ?? apport[agent] ?? []);
  return items.length ? items : null;
}

/** Un agent du Future Proofing : apport LLM/humain si fourni, sinon repli heuristique. */
export async function runAgent(agent, contexte, opts = {}) {
  const apport = asApport(opts.apport?.[agent] ?? opts.apport, agent, contexte);
  if (typeof apport === 'function') {
    try {
      const res = await apport({ agent, contexte });
      const items = Array.isArray(res) ? res : (res.attaques ?? []);
      if (items.length) return items.map((a, i) => normalizeAttaque({ ...a, agent }, { index: i }));
    } catch { /* repli heuristique */ }
  } else if (Array.isArray(apport)) {
    return apport.map((a, i) => normalizeAttaque({ ...a, agent }, { index: i }));
  }
  const heuristique = agent === 'critic' ? criticHeuristique
    : agent === 'devil_advocate' ? devilAdvocateHeuristique
    : redTeamHeuristique;
  return heuristique(contexte);
}

/**
 * Future Proofing multi-agents (EF-08/F1) : timeline horodatee
 * Critic → Devil's Advocate → Red Team, append-only. Chaque etape porte
 * `{ agent, ts, attaques }`. Les attaques sont normalisees (F5) et l'apport
 * LLM/humain est injecte sans jamais etre invente par le moteur.
 */
export async function runFutureProofing(contexte = {}, opts = {}) {
  const ts = opts.ts ?? new Date().toISOString();
  const steps = [];
  for (const agent of AGENTS_EPREUVE) {
    const attaques = await runAgent(agent, contexte, opts);
    steps.push({ agent, ts: new Date().toISOString(), attaques });
  }
  const attaques = steps.flatMap((s) => s.attaques);
  const critiques = attaques.filter((a) => a.niveau === 'critique');
  return {
    steps,
    attaques,
    totalAttaques: attaques.length,
    critiques: critiques.length,
    ts,
  };
}

/** Ajout d'une passe a la timeline (append-only, dedupe par (agent,index,ts)). */
export function addRun(timeline, run, { by = null, ideaId = null } = {}) {
  const t = timeline ?? [];
  const marquee = {
    ...run,
    steps: run.steps ?? [],
    ts: run.ts ?? new Date().toISOString(),
    declenchePar: { by, ideaId },
  };
  const cle = `${marquee.ts}-${marquee.steps.length}`;
  if (t.some((x) => `${x.ts}-${x.steps.length}` === cle)) throw new Error('eprouver: passe deja presente dans la timeline');
  return { timeline: [...t, marquee], run: marquee };
}

/** Synthese Eprouver (EF-08/F9) : comptages reels, red flags residuels. */
export function rapportEprouver(timeline = []) {
  const attaques = timeline.flatMap((r) => r.attaques ?? []);
  const parAgent = AGENTS_EPREUVE.map((agent) => ({
    agent,
    total: attaques.filter((a) => a.agent === agent).length,
    critiques: attaques.filter((a) => a.agent === agent && a.niveau === 'critique').length,
  }));
  const parNiveau = {
    faible: attaques.filter((a) => a.niveau === 'faible').length,
    moyenne: attaques.filter((a) => a.niveau === 'moyenne').length,
    critique: attaques.filter((a) => a.niveau === 'critique').length,
    nonEvaluee: attaques.filter((a) => a.niveau == null).length,
  };
  const redFlags = attaques
    .filter((a) => a.niveau === 'moyenne' && a.severite < SEUIL_CRITIQUE)
    .map((a) => ({ id: a.id, agent: a.agent, type: a.type, argument: a.argument, hypothese: a.hypothese, niveau: 'moyenne' }))
    .slice(0, 12);
  const bloquantes = attaques
    .filter((a) => a.niveau === 'critique')
    .map((a) => ({ id: a.id, agent: a.agent, type: a.type, argument: a.argument, hypothese: a.hypothese }));
  return {
    timeline,
    totalPassees: timeline.length,
    totalAttaques: attaques.length,
    parAgent,
    parNiveau,
    redFlags,
    bloquantes,
    rendu: `Éprouver : ${timeline.length} passe(s), ${attaques.length} attaque(s) (${parNiveau.critique} critique(s), ${parNiveau.moyenne} moyenne(s), ${parNiveau.faible} faible(s), ${parNiveau.nonEvaluee} non évaluée(s)). ${bloquantes.length ? `⚠ ${bloquantes.length} vulnérabilité(s) critique(s) bloquante(s).` : 'Aucune vulnérabilité critique.'} Red flags résiduels listés pour l\'arbitrage.`,
  };
}
