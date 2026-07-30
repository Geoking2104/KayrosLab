// KayrosLab — Canvas : frameworks de transformation en un clic.
// EF-232 (SCAMPER), EF-233 (Six chapeaux), EF-234 (Premiers principes),
// EF-236 (Pre-mortem IA), EF-237 (cause -> hypothese testable).

import { createNode, addNode, addEdge, getNode } from './model.mjs';
import { parsePersonaOutput } from './personas.mjs';

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

/** EF-232 : les 7 transformations SCAMPER. */
export const SCAMPER = [
  { id: 'substituer', nom: 'Substituer', consigne: 'Quel composant, materiau, acteur ou canal peut etre REMPLACE par un autre ?' },
  { id: 'combiner', nom: 'Combiner', consigne: 'Avec quelle autre offre, fonction ou marche cette idee peut-elle FUSIONNER ?' },
  { id: 'adapter', nom: 'Adapter', consigne: "Quelle solution existante d'un AUTRE secteur peut etre adaptee ici ?" },
  { id: 'modifier', nom: 'Modifier / Magnifier', consigne: 'Que se passe-t-il si on AMPLIFIE ou REDUIT radicalement un parametre cle ?' },
  { id: 'usage', nom: 'Autre usage', consigne: "A quel AUTRE usage ou public cette idee pourrait-elle servir telle quelle ?" },
  { id: 'eliminer', nom: 'Eliminer', consigne: "Qu'est-ce qui peut etre SUPPRIME sans perdre la valeur essentielle ?" },
  { id: 'reorganiser', nom: 'Reorganiser / Inverser', consigne: "Que donne l'INVERSION de l'ordre, du sens ou du modele economique ?" },
];

/** EF-233 : les six chapeaux de Bono. */
export const SIX_CHAPEAUX = [
  { id: 'blanc', nom: 'Blanc — faits', typeSortie: 'preuve', consigne: 'Enonce uniquement les FAITS et les donnees disponibles, et signale explicitement les donnees manquantes.' },
  { id: 'rouge', nom: 'Rouge — ressenti', typeSortie: 'critique', consigne: "Exprime les REACTIONS emotionnelles et intuitives, sans les justifier." },
  { id: 'noir', nom: 'Noir — prudence', typeSortie: 'critique', consigne: 'Identifie les RISQUES, faiblesses et raisons pour lesquelles cela pourrait echouer.' },
  { id: 'jaune', nom: 'Jaune — benefices', typeSortie: 'idee', consigne: 'Identifie les BENEFICES et les raisons pour lesquelles cela pourrait reussir.' },
  { id: 'vert', nom: 'Vert — creativite', typeSortie: 'idee', consigne: 'Propose des ALTERNATIVES et des pistes nouvelles.' },
  { id: 'bleu', nom: 'Bleu — pilotage', typeSortie: 'decision', consigne: "Synthetise le processus : ou en est-on, que faut-il decider, quelle est la prochaine etape ?" },
];

/** EF-234 : axes de decomposition en premiers principes. */
export const PREMIERS_PRINCIPES = [
  { id: 'physique', nom: 'Contraintes physiques', consigne: 'Quelles lois physiques, limites materielles ou de temps sont INCOMPRESSIBLES ici ?' },
  { id: 'economique', nom: 'Contraintes economiques', consigne: 'Quels couts sont irreductibles, et lesquels ne sont que des conventions du secteur ?' },
  { id: 'reglementaire', nom: 'Contraintes reglementaires', consigne: 'Quelles obligations sont reellement imposees, et lesquelles sont des habitudes prises pour des regles ?' },
];

// ---------------------------------------------------------------------------
// Moteur commun
// ---------------------------------------------------------------------------

async function appliquerTransformations(ws, noeudId, transformations, {
  llm, model = null, by = null, relation = 'derive', typeParDefaut = 'idee', libelle,
  temperature = 0.6, maxParTransformation = 3,
}) {
  const cible = getNode(ws, noeudId);
  if (!cible) throw new Error(`${libelle}: noeud introuvable "${noeudId}"`);
  if (!llm?.complete) throw new Error(`${libelle}: llm.complete requis`);

  let out = ws;
  const crees = [];
  const echecs = [];
  let tokensIn = 0; let tokensOut = 0; let coutUsd = 0;

  const resultats = await Promise.all(transformations.map(async (t) => {
    const messages = [
      { role: 'system', content: `Tu animes un atelier d'ideation strategique. Transformation appliquee : ${t.nom}.` },
      {
        role: 'user',
        content: [
          `Idee de depart : « ${cible.titre} »`,
          cible.corps ? `Detail : ${cible.corps}` : '',
          '', t.consigne, '',
          'Reponds par 1 a 3 propositions concretes, une par ligne, commencant par "- ". Pas d introduction.',
        ].filter(Boolean).join('\n'),
      },
    ];
    try {
      const res = await llm.complete({ messages, role: t.nom, model, temperature });
      return { t, points: parsePersonaOutput(res?.text ?? '').points, usage: res?.usage ?? null };
    } catch (e) {
      // Une transformation qui echoue n'annule pas les six autres.
      return { t, points: [], erreur: e.message };
    }
  }));

  for (const r of resultats) {
    if (r.erreur) { echecs.push({ transformation: r.t.nom, erreur: r.erreur }); continue; }
    tokensIn += r.usage?.tokensIn ?? 0; tokensOut += r.usage?.tokensOut ?? 0; coutUsd += r.usage?.costUsd ?? 0;
    // BORNE. La consigne demande « 1 a 3 propositions » mais rien ne l'imposait :
    // un modele bavard noyait le canvas sous des dizaines de noeuds. Une consigne
    // adressee a un LLM n'est pas une contrainte tant qu'elle n'est pas appliquee.
    for (const p of r.points.slice(0, maxParTransformation)) {
      const n = createNode({
        type: r.t.typeSortie ?? typeParDefaut,
        titre: `[${r.t.nom}] ${p.slice(0, 90)}`,
        corps: p,
        authorKind: 'agent', authorId: libelle,
        meta: { framework: libelle, transformation: r.t.id, parent: noeudId },
      });
      out = addNode(out, n);
      out = addEdge(out, { from: n.id, to: noeudId, relation, label: r.t.nom, authorKind: 'agent', authorId: libelle });
      crees.push(n.id);
    }
  }

  const ts = new Date().toISOString();
  return {
    workspace: { ...out, updatedAt: ts, history: [...out.history, { type: 'framework', nom: libelle, cible: noeudId, crees: crees.length, by, ts }] },
    crees, echecs,
    cout: { tokensIn, tokensOut, coutUsd: Math.round(coutUsd * 1e6) / 1e6, appels: transformations.length },
  };
}

/** EF-232 : SCAMPER en un clic. Chaque transformation produit un nœud etiquete. */
export function scamper(ws, noeudId, opts = {}) {
  return appliquerTransformations(ws, noeudId, SCAMPER, { ...opts, libelle: 'SCAMPER', typeParDefaut: 'idee', relation: 'derive' });
}

/** EF-233 : six lectures d'un noeud. Le chapeau noir produit des critiques. */
export function sixChapeaux(ws, noeudId, opts = {}) {
  return appliquerTransformations(ws, noeudId, SIX_CHAPEAUX, { ...opts, libelle: 'Six chapeaux', typeParDefaut: 'idee', relation: 'derive' });
}

/** EF-234 : decomposition en contraintes incompressibles. */
export function premiersPrincipes(ws, noeudId, opts = {}) {
  return appliquerTransformations(ws, noeudId, PREMIERS_PRINCIPES, {
    ...opts, libelle: 'Premiers principes', typeParDefaut: 'hypothese', relation: 'depend', temperature: 0.3,
  });
}

// ---------------------------------------------------------------------------
// Pre-mortem (EF-236 / EF-237)
// ---------------------------------------------------------------------------

const NIVEAUX = { faible: 1, moyenne: 2, moyen: 2, elevee: 3, eleve: 3, forte: 3, fort: 3 };

/** Normalise une mention de probabilite ou de severite en 1..3, sinon null. */
export function niveau(mot) {
  if (typeof mot === 'number') return Math.max(1, Math.min(3, Math.round(mot)));
  const k = String(mot ?? '').toLowerCase().trim();
  return NIVEAUX[k] ?? null;
}

/**
 * Analyse une ligne de pre-mortem au format attendu :
 *   "- <cause> | probabilite: <faible|moyenne|elevee> | severite: <...>"
 * Une ligne mal formee n'est pas jetee : la cause est conservee et ses niveaux
 * restent `null`. Perdre une cause d'echec parce que le modele a mal formate
 * serait le pire resultat possible pour un pre-mortem.
 */
export function parseCause(ligne) {
  const brut = String(ligne ?? '').replace(/^-\s*/, '').trim();
  if (!brut) return null;
  const parts = brut.split('|').map((x) => x.trim());
  const cause = parts[0];
  let probabilite = null; let severite = null;
  for (const p of parts.slice(1)) {
    const m = p.match(/^(probabilite|probabilité|severite|sévérité)\s*:\s*(.+)$/i);
    if (!m) continue;
    const v = niveau(m[2]);
    if (/^prob/i.test(m[1])) probabilite = v; else severite = v;
  }
  return {
    cause, probabilite, severite,
    // Criticite calculable seulement si les DEUX axes sont connus.
    criticite: probabilite && severite ? probabilite * severite : null,
    complet: Boolean(probabilite && severite),
  };
}

/**
 * EF-236 : pre-mortem — « nous sommes en <horizon>, ce projet a echoue, pourquoi ? ».
 * Produit un cluster de causes, chacune notee en probabilite et severite.
 *
 * @returns {Promise<{workspace:object, causes:object[], crees:string[], clusterId:string}>}
 */
export async function preMortem(ws, noeudId, { llm, horizon = '2028', n = 6, model = null, by = null } = {}) {
  const cible = getNode(ws, noeudId);
  if (!cible) throw new Error(`preMortem: noeud introuvable "${noeudId}"`);
  if (!llm?.complete) throw new Error('preMortem: llm.complete requis');

  const messages = [
    { role: 'system', content: "Tu animes un pre-mortem. L'echec est POSTULE : ne discute pas de sa vraisemblance, cherche ses causes." },
    {
      role: 'user',
      content: [
        `Nous sommes en ${horizon}. Le projet suivant a echoue : « ${cible.titre} »`,
        cible.corps ? `Detail : ${cible.corps}` : '',
        '',
        `Enumere les ${n} causes les plus plausibles de cet echec.`,
        'Format strict, une cause par ligne :',
        '- <cause en une phrase> | probabilite: <faible|moyenne|elevee> | severite: <faible|moyenne|elevee>',
      ].filter(Boolean).join('\n'),
    },
  ];
  const res = await llm.complete({ messages, role: 'RedTeam', model, temperature: 0.5 });

  const causes = String(res?.text ?? '').split('\n')
    .filter((l) => l.trim().startsWith('-'))
    .map(parseCause)
    .filter(Boolean)
    .slice(0, n);

  let out = ws;
  const crees = [];
  const clusterId = `c_premortem_${noeudId}`;
  for (const c of causes) {
    const n2 = createNode({
      type: 'critique',
      titre: c.cause.slice(0, 120),
      corps: c.complet ? `Probabilite ${c.probabilite}/3 · Severite ${c.severite}/3 · Criticite ${c.criticite}/9` : 'Niveaux non renseignes par le modele',
      authorKind: 'agent', authorId: 'pre-mortem',
      clusterId,
      meta: { framework: 'pre-mortem', horizon, parent: noeudId, ...c },
    });
    out = addNode(out, n2);
    out = addEdge(out, { from: n2.id, to: noeudId, relation: 'contredit', label: 'cause d echec', authorKind: 'agent', authorId: 'pre-mortem' });
    crees.push(n2.id);
  }

  const ts = new Date().toISOString();
  const complets = causes.filter((c) => c.complet).length;
  return {
    workspace: {
      ...out,
      clusters: [...out.clusters, { id: clusterId, label: `Pre-mortem ${horizon}`, labelSource: 'llm', nodeIds: crees, centroid: null, createdAt: ts }],
      updatedAt: ts,
      history: [...out.history, { type: 'framework', nom: 'pre-mortem', cible: noeudId, crees: crees.length, by, ts }],
    },
    causes, crees, clusterId,
    // On declare la part de causes reellement notees plutot que de laisser
    // croire a un scoring complet (meme discipline que EF-70).
    couverture: causes.length ? Math.round((complets / causes.length) * 100) / 100 : null,
    usage: res?.usage ?? null,
  };
}

/**
 * EF-237 : convertit les causes d'un pre-mortem en HYPOTHESES TESTABLES,
 * rattachees a l'idee promue et versees comme cibles d'attaque d'*Eprouver*.
 *
 * Le format de sortie reprend celui d'`intake.mjs` (`intakeToHypotheses` /
 * `intakeToAttackTargets`) pour etre consommable sans adaptation par le cycle.
 */
export function causesToHypotheses(causes, { prefixe = 'pm' } = {}) {
  const retenues = causes.filter((c) => c?.cause);
  return {
    hypotheses: retenues.map((c, i) => ({
      id: `h-${prefixe}-${i + 1}`,
      source: 'pre-mortem',
      // Formulation REFUTABLE : une hypothese qu'on ne peut pas tester ne sert a rien.
      enonce: `Nous pouvons demontrer que « ${c.cause} » ne se produira pas, ou qu'un dispositif le contient.`,
      critique: (c.criticite ?? 0) >= 6,
      probabilite: c.probabilite, severite: c.severite, criticite: c.criticite,
    })),
    cibles: retenues.map((c, i) => ({
      id: `t-${prefixe}-${i + 1}`,
      origine: 'pre-mortem',
      priorite: (c.criticite ?? 0) >= 6 ? 'haute' : ((c.criticite ?? 0) >= 3 ? 'moyenne' : 'basse'),
      cible: c.cause,
      agent: 'RedTeam',
    })),
    // Les causes non notees restent listees : elles ne disparaissent pas du
    // radar sous pretexte que le modele n'a pas rempli le format.
    nonNotees: retenues.filter((c) => !c.complet).length,
  };
}
