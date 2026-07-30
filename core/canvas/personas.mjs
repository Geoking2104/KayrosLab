// KayrosLab — Canvas : personas et swarms de sparring.
// EF-225 (expansion d'un noeud), EF-226 (swarm parallele), EF-227 (personas
// standard, prompts exposes), EF-228 (personas personnalisables),
// EF-229 (agents du coeur exposes comme personas), EF-230 (streaming + cout),
// EF-231 (desaccords materialises, jamais lisses).

import { createNode, addEdge, addNode } from './model.mjs';

/**
 * EF-227 : personas standard. Chaque persona expose son prompt ET ses criteres.
 * AUCUNE persona n'est une boite noire : l'utilisateur doit pouvoir juger
 * pourquoi un avis dit ce qu'il dit, sinon le sparring n'est qu'un oracle.
 */
export const PERSONAS_STANDARD = [
  {
    id: 'vc-sceptique', nom: 'VC sceptique', angle: 'financement',
    criteres: ['taille de marche', 'defensibilite', 'traction demontrable', 'equipe'],
    typeSortie: 'critique', poidsVote: 2,
    prompt: "Tu es un investisseur en capital-risque sceptique. Tu as vu cent projets de ce type echouer. Attaque la these d'investissement : marche reellement adressable, barriere a l'entree, preuve de traction, credibilite de l'equipe. Sois precis et chiffre quand tu peux. Ne sois pas poli au detriment de la clarte.",
  },
  {
    id: 'client-cible', nom: 'Client cible', angle: 'desirabilite',
    criteres: ['douleur reelle', 'alternative actuelle', 'cout de changement', 'consentement a payer'],
    typeSortie: 'question', poidsVote: 2,
    prompt: "Tu es le client vise par cette idee. Reagis comme un utilisateur reel, pas comme un expert : quelle est ta douleur actuelle, comment fais-tu aujourd'hui sans ce produit, qu'est-ce qui te ferait changer, et a quel prix. Dis franchement ce qui ne t'interesse pas.",
  },
  {
    id: 'designer-ux', nom: 'Designer UI/UX', angle: 'usage',
    criteres: ['parcours', 'charge cognitive', 'accessibilite', 'premier usage'],
    typeSortie: 'idee', poidsVote: 1,
    prompt: "Tu es concepteur d'experience. Decris le parcours reel de l'utilisateur, identifie les frictions, la charge cognitive et les moments d'abandon. Propose des simplifications concretes. Signale ce qui exclurait des utilisateurs (accessibilite).",
  },
  {
    id: 'optimiseur-budget', nom: 'Optimiseur budget', angle: 'cout',
    criteres: ['cout de construction', 'cout recurrent', 'alternative moins chere', 'point mort'],
    typeSortie: 'critique', poidsVote: 1,
    prompt: "Tu optimises le budget. Estime le cout de construction et le cout recurrent, cherche systematiquement une version 80/20 nettement moins chere, et identifie le point mort. Signale toute depense dont la valeur n'est pas demontree.",
  },
  {
    id: 'juriste-conformite', nom: 'Juriste / conformite', angle: 'risque legal',
    criteres: ['donnees personnelles', 'sectoriel', 'propriete intellectuelle', 'contractuel'],
    typeSortie: 'critique', poidsVote: 2,
    prompt: "Tu es juriste specialise en conformite. Identifie les obligations applicables (protection des donnees, reglementation sectorielle, propriete intellectuelle, engagements contractuels) et les risques concrets. Distingue ce qui est bloquant de ce qui est gerable. Tu n'es pas un avis juridique formel : signale-le.",
  },
  {
    id: 'ingenieur-systeme', nom: 'Ingenieur systemes', angle: 'faisabilite',
    criteres: ['complexite', 'passage a l echelle', 'modes de panne', 'dependances'],
    typeSortie: 'hypothese', poidsVote: 2,
    prompt: "Tu es ingenieur systemes. Evalue la faisabilite technique, la complexite reelle, le comportement a l'echelle, les modes de panne et les dependances externes critiques. Propose l'architecture la plus simple qui tienne. Dis explicitement ce dont tu n'es pas sur.",
  },
];

/**
 * EF-229 : les agents du coeur (Critic, Devil's Advocate, Red Team,
 * Bisociateur, Synthesizer) sont exposes comme personas SANS duplication.
 * Leur prompt reste celui de l'agent : une seule definition fait autorite.
 */
export const AGENTS_COMME_PERSONAS = {
  Critic: { id: 'critic', nom: 'Critic', angle: 'angles morts', typeSortie: 'critique', poidsVote: 2, criteres: ['hypotheses', 'qualite des donnees', 'coherence logique', 'biais'] },
  DevilsAdvocate: { id: 'devils-advocate', nom: "Avocat du diable", angle: 'contradiction', typeSortie: 'critique', poidsVote: 2, criteres: ['these inverse', 'cas defavorable'] },
  RedTeam: { id: 'red-team', nom: 'Red Team', angle: 'attaque', typeSortie: 'critique', poidsVote: 2, criteres: ['kill shots', 'scenario adverse'] },
  Bisociateur: { id: 'bisociateur', nom: 'Bisociateur', angle: 'analogie', typeSortie: 'idee', poidsVote: 1, criteres: ['pont entre domaines'] },
  Synthesizer: { id: 'synthesizer', nom: 'Synthesizer', angle: 'synthese', typeSortie: 'idee', poidsVote: 1, criteres: ['convergence'] },
};

/** Registre de personas, extensible par tenant (EF-228). */
export class PersonaRegistry {
  constructor(personas = PERSONAS_STANDARD) {
    this._m = new Map();
    personas.forEach((p) => this.register(p));
  }
  /** EF-228 : une persona custom exige un angle ET des criteres — pas de boite noire. */
  register(p) {
    if (!p?.id || !p?.nom) throw new Error('PersonaRegistry: id et nom requis');
    if (!p.prompt && !p.agent) throw new Error(`Persona "${p.id}": prompt ou agent requis`);
    if (!Array.isArray(p.criteres) || !p.criteres.length) throw new Error(`Persona "${p.id}": criteres requis (transparence)`);
    this._m.set(p.id, { typeSortie: 'critique', poidsVote: 1, angle: 'general', ...p });
    return this;
  }
  get(id) { return this._m.get(id) ?? null; }
  list() { return [...this._m.values()]; }
  remove(id) { return this._m.delete(id); }

  /** Ajoute les agents du coeur au registre (EF-229). */
  withCoreAgents(agents = {}) {
    for (const [nom, def] of Object.entries(AGENTS_COMME_PERSONAS)) {
      if (agents[nom]) this.register({ ...def, agent: agents[nom] });
    }
    return this;
  }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/** Cout cumule d'un run. Le compteur est expose EN COURS (EF-230). */
class Compteur {
  constructor() { this.tokensIn = 0; this.tokensOut = 0; this.coutUsd = 0; this.appels = 0; }
  ajouter(usage) {
    this.appels++;
    this.tokensIn += usage?.tokensIn ?? 0;
    this.tokensOut += usage?.tokensOut ?? 0;
    this.coutUsd += usage?.costUsd ?? 0;
    return this;
  }
  snapshot() { return { appels: this.appels, tokensIn: this.tokensIn, tokensOut: this.tokensOut, coutUsd: Math.round(this.coutUsd * 1e6) / 1e6 }; }
}

/** Une persona traite un noeud. Renvoie sa sortie brute et son usage. */
async function executerPersona(persona, { noeud, contexte, llm, model, signal }) {
  if (signal?.aborted) return { personaId: persona.id, avorte: true, texte: null, usage: null };

  // EF-229 : si la persona est adossee a un agent du coeur, c'est l'agent qui
  // execute — son prompt systeme et son post-traitement font autorite.
  if (persona.agent?.execute) {
    const r = await persona.agent.execute(
      `Analyse ce noeud d'ideation : « ${noeud.titre} »${noeud.corps ? `\n${noeud.corps}` : ''}`,
      { goal: 'Sparring sur un canvas d ideation', context: contexte, model },
    );
    return { personaId: persona.id, texte: r.output, structured: r.structured ?? null, usage: null };
  }

  const messages = [
    { role: 'system', content: `${persona.prompt}\n\nCriteres a couvrir : ${persona.criteres.join(', ')}.` },
    ...(contexte ? [{ role: 'system', content: `Contexte disponible :\n${contexte}` }] : []),
    {
      role: 'user',
      content: [
        `Noeud a examiner : « ${noeud.titre} »`,
        noeud.corps ? `Detail : ${noeud.corps}` : '',
        '',
        'Produis 2 a 4 points courts, un par ligne, commencant par "- ".',
        "Termine par une ligne \"VERDICT: soutient\" ou \"VERDICT: contredit\" selon ta position d'ensemble.",
      ].filter(Boolean).join('\n'),
    },
  ];
  const res = await llm.complete({ messages, role: persona.nom, model, temperature: 0.4 });
  return { personaId: persona.id, texte: res?.text ?? '', usage: res?.usage ?? null };
}

/** Extrait les points et le verdict d'une sortie de persona. */
export function parsePersonaOutput(texte) {
  const lignes = String(texte ?? '').split('\n').map((l) => l.trim());
  const points = lignes.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim()).filter(Boolean);
  const v = lignes.find((l) => /^VERDICT\s*:/i.test(l));
  const verdict = v ? (/contredit/i.test(v) ? 'contredit' : 'soutient') : null;
  // Repli : sans puce reconnue, on prend les lignes non vides plutot que de
  // renvoyer un resultat vide et de perdre le travail du modele.
  const corps = points.length ? points : lignes.filter((l) => l && !/^VERDICT/i.test(l)).slice(0, 4);
  return { points: corps, verdict };
}

/**
 * EF-226 : swarm — plusieurs personas traitent le MEME noeud en parallele.
 * EF-230 : chaque sortie est emise au fil de l'eau via `onOutput`, le cout est
 * expose en cours, et `signal` permet d'interrompre.
 *
 * @returns {Promise<{runs:object[], cout:object, avorte:boolean}>}
 */
export async function runSwarm({ noeud, personas, llm, contexte = '', model = null, onOutput = null, signal = null }) {
  if (!noeud) throw new Error('runSwarm: noeud requis');
  if (!personas?.length) throw new Error('runSwarm: au moins une persona requise');
  if (!llm?.complete && personas.some((p) => !p.agent)) throw new Error('runSwarm: llm.complete requis');

  const cout = new Compteur();
  const runs = await Promise.all(personas.map(async (p) => {
    try {
      const r = await executerPersona(p, { noeud, contexte, llm, model, signal });
      if (r.avorte) return { ...r, persona: p, ok: false };
      cout.ajouter(r.usage);
      const parsed = parsePersonaOutput(r.texte);
      const sortie = { ...r, ...parsed, persona: p, ok: true, cout: cout.snapshot() };
      if (onOutput) { try { onOutput(sortie); } catch { /* un observateur defaillant n'interrompt pas le swarm */ } }
      return sortie;
    } catch (e) {
      // La panne d'une persona ne fait pas tomber le swarm : les autres avis
      // gardent leur valeur, et l'echec est rendu visible plutot que masque.
      const echec = { personaId: p.id, persona: p, ok: false, erreur: e.message, points: [], verdict: null };
      if (onOutput) { try { onOutput(echec); } catch { /* idem */ } }
      return echec;
    }
  }));

  return { runs, cout: cout.snapshot(), avorte: Boolean(signal?.aborted) };
}

/**
 * Materialise les sorties d'un swarm sur le canvas.
 *
 * EF-231 : le verdict de chaque persona devient une arete TYPEE. Un desaccord
 * produit une arete `contredit` qui reste visible — il n'est ni moyenne ni
 * fondu dans une synthese. Le conflit est le produit du sparring, pas son dechet.
 * EF-242 (anticipe) : chaque noeud produit porte `authorKind: 'agent'`.
 */
export function applySwarm(ws, noeudCibleId, runs, { by = null } = {}) {
  let out = ws;
  const crees = [];

  for (const run of runs) {
    if (!run.ok || !run.points?.length) continue;
    const p = run.persona;
    const noeud = createNode({
      type: p.typeSortie ?? 'critique',
      titre: `[${p.nom}] ${run.points[0].slice(0, 90)}`,
      corps: run.points.join('\n'),
      authorKind: 'agent',
      authorId: p.id,
      meta: { personaId: p.id, angle: p.angle, criteres: p.criteres, verdict: run.verdict },
    });
    out = addNode(out, noeud);
    crees.push(noeud.id);
    out = addEdge(out, {
      from: noeud.id, to: noeudCibleId,
      // Sans verdict explicite, on n'invente pas de position : `soutient` par
      // defaut serait un biais favorable silencieux. On qualifie l'arete de
      // `derive` — le lien existe, la position n'est pas affirmee.
      relation: run.verdict === 'contredit' ? 'contredit' : (run.verdict === 'soutient' ? 'soutient' : 'derive'),
      label: p.nom, authorId: p.id, authorKind: 'agent',
    });
  }

  const ts = new Date().toISOString();
  return {
    workspace: {
      ...out, updatedAt: ts,
      history: [...out.history, { type: 'swarm.apply', cible: noeudCibleId, crees: crees.length, by, ts }],
    },
    crees,
    // Lecture immediate du desaccord, sans avoir a parcourir le graphe.
    desaccords: runs.filter((r) => r.ok && r.verdict === 'contredit').map((r) => r.persona.nom),
    appuis: runs.filter((r) => r.ok && r.verdict === 'soutient').map((r) => r.persona.nom),
    echecs: runs.filter((r) => !r.ok).map((r) => ({ persona: r.persona?.nom, erreur: r.erreur })),
  };
}

/**
 * EF-225 : expansion d'un noeud — N enfants relies par des aretes typees.
 * Distincte du swarm : ici une seule voix produit des variantes, la ou le
 * swarm confronte des points de vue.
 */
export async function expandNode(ws, noeudId, { llm, n = 4, angle = 'variantes', model = null, by = null } = {}) {
  const cible = ws.nodes.find((x) => x.id === noeudId);
  if (!cible) throw new Error(`expandNode: noeud introuvable "${noeudId}"`);
  if (!llm?.complete) throw new Error('expandNode: llm.complete requis');

  const consignes = {
    variantes: 'Propose des VARIANTES distinctes de cette idee.',
    'sous-problemes': 'Decompose cette idee en SOUS-PROBLEMES a resoudre.',
    'contre-exemples': 'Donne des CONTRE-EXEMPLES ou des cas ou cette idee echoue.',
  };
  const messages = [
    { role: 'system', content: "Tu assistes une session d'ideation strategique. Sois concret et evite les generalites." },
    {
      role: 'user',
      content: [
        `Noeud : « ${cible.titre} »`,
        cible.corps ? `Detail : ${cible.corps}` : '',
        '',
        consignes[angle] ?? consignes.variantes,
        `Donne exactement ${n} propositions, une par ligne, commencant par "- ". Pas d'introduction.`,
      ].filter(Boolean).join('\n'),
    },
  ];
  const res = await llm.complete({ messages, role: 'Bisociateur', model, temperature: 0.7 });
  const { points } = parsePersonaOutput(res?.text ?? '');

  let out = ws;
  const crees = [];
  const relation = angle === 'contre-exemples' ? 'contredit' : 'derive';
  for (const p of points.slice(0, n)) {
    const enfant = createNode({
      type: angle === 'sous-problemes' ? 'question' : (angle === 'contre-exemples' ? 'critique' : 'idee'),
      titre: p.slice(0, 120), corps: p.length > 120 ? p : '',
      authorKind: 'agent', authorId: 'expansion',
      meta: { parent: noeudId, angle },
    });
    out = addNode(out, enfant);
    out = addEdge(out, { from: enfant.id, to: noeudId, relation, label: angle, authorKind: 'agent', authorId: 'expansion' });
    crees.push(enfant.id);
  }

  const ts = new Date().toISOString();
  return {
    workspace: { ...out, updatedAt: ts, history: [...out.history, { type: 'node.expand', cible: noeudId, angle, crees: crees.length, by, ts }] },
    crees,
    usage: res?.usage ?? null,
  };
}
