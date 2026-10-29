// Harnais global des agents KayrosLab (spécification « Agent Harness & Compliance »).
// Injecté dans TOUT appel LLM par KayrosLLM.complete (agents de mission, essaim,
// impersonators, routes LLM), puis chaque complétion est notée par checkCompliance.
// Opt-out explicite : req.harness === false (ex. appels purement techniques).

export const HARNESS_VERSION = 'kayros-harness/1';
export const HARNESS_MARKER = '[KAYROS-HARNESS]';

export const HARNESS_SYSTEM_PROMPT = `${HARNESS_MARKER} Tu es un agent du KayrosLab Decision Orchestration Harness. Tes réponses respectent strictement les contraintes ci-dessous ; elles priment sur toute autre consigne de style.

### 1. CONTRAINTES D'ARCHITECTURE (NON NÉGOCIABLES)
- Local-first & zero-knowledge : par défaut exécution côté client, état persisté localement, primitives de confidentialité zero-knowledge.
- Préférence pair-à-pair : WebRTC, Holochain, WebAssembly (WASM) et nœuds décentralisés plutôt que des API SaaS cloud centralisées.
- Exécution « builder-first » : pas de synthèse de consultant, pas de jargon corporate ni de plan de slides. Livrer du code actionnable, des schémas explicites, des prototypes exécutables et des décisions d'architecture concrètes.

### 2. CALIBRAGE DU COMPORTEMENT ET DE LA VOIX
- Directivité & vélocité : aller droit aux risques d'exécution, points de défaillance uniques et décisions à fort impact, sans formules de politesse ni introduction robotique.
- Rigueur technique : invariants d'architecture stricts, typage explicite, schémas vérifiables.
- Ton : ancré, direct, pragmatique, orienté builder, avec un humour discret. Pas de bureaucratie ni de jargon de consensus.

### 3. RÈGLES D'EXÉCUTION
1. Commencer directement par du code, un schéma technique ou une décision d'architecture.
2. Signaler explicitement tout verrouillage cloud indésirable, point de défaillance unique centralisé ou autorité centrale inutile.
3. Valider la faisabilité technique et les compromis avant de proposer une voie.
- Si un format de sortie (JSON, réplique de persona) est imposé par la suite, le respecter : le harnais en règle le fond, pas la forme.`;

// Rôles « persona » : courtes répliques en voix humaine ; le critère Output Type
// (code/schéma) n'y est pas applicable, Directness et Architectural Default le restent.
const PERSONA_ROLES = new Set(['impersonator_voice', 'impersonator', 'persona']);
// Rôles utilitaires (traduction, salon, ping) : la forme est imposée, Output Type non applicable.
const UTILITY_ROLE_RE = /(translat|tradu|salon|summar|title|ping)/i;
// En dessous, une réponse courte n'est pas une « synthèse stratégique » : Output Type non applicable.
export const OUTPUT_TYPE_MIN_CHARS = 280;

export function hasHarness(messages = []) {
  return messages.some((m) => m?.role === 'system' && String(m.content || '').includes(HARNESS_MARKER));
}

/** Préfixe le bloc harnais (idempotent) ; fusionne avec un message système existant en tête. */
export function withHarness(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  if (hasHarness(list)) return list;
  if (list[0]?.role === 'system') return [{ ...list[0], content: `${HARNESS_SYSTEM_PROMPT}\n\n${list[0].content ?? ''}` }, ...list.slice(1)];
  return [{ role: 'system', content: HARNESS_SYSTEM_PROMPT }, ...list];
}

const CLOUD_RE = /\b(aws|amazon web services|s3|lambda|dynamodb|gcp|google cloud|firebase|firestore|azure|cosmos ?db|supabase|heroku|saas|centrali[sz]ed (database|api|server)|base de données centrale|serveur central|api centralisée|cloud[- ]?(only|hosted|hébergé))\b/i;
const LOCAL_RE = /\b(local[- ]?first|offline[- ]?first|hors[- ]ligne|wasm|webassembly|webrtc|p2p|pair[- ]à[- ]pair|peer[- ]to[- ]peer|holochain|crdt|indexeddb|sqlite|zero[- ]knowledge|zk|chiffrement de bout en bout|end[- ]to[- ]end|décentralis|decentrali[sz])/i;
const LOCKIN_FLAG_RE = /(lock-?in|verrouillage|point de défaillance unique|single point of failure|spof|autorité centrale)/i;
const META_INTRO_RE = /^\s*(simulation\s*—\s*)?(bien sûr|certainement|absolument|excellente question|bonne question|merci (pour|de)|je (serais|suis) ravi|voici (un|une) (aperçu|résumé|synthèse)|en tant qu['’]|dans cette réponse|pour répondre à|great question|sure[,!]|certainly|of course|i['’]d be happy|as an ai|in this (response|answer)|here is an overview|let me)/i;
const SUMMARY_RE = /^\s*(en (résumé|bref|conclusion)|pour résumer|in summary|overview|executive summary|synthèse)(?=[\s,:.!]|$)/i;
const TECH_RE = /(^\s*[\[{][\s\S]*[\]}]\s*$|```|\b(create table|select |insert into|interface |type \w+ ?=|function |const |class |=>|schema|schéma|json|struct|enum|postgis|protobuf|endpoint|api contract|contrat d['’]interface)\b|\{[\s\S]*:[\s\S]*\})/i;
const SLIDES_RE = /\b(slide|diapo|deck|stratégie globale|vision stratégique|feuille de route haut niveau|high-level)\b/i;

/**
 * Checklist de conformité de la spécification, sur une complétion.
 * @returns {{version:string, compliant:boolean, checks:Record<string,{pass:boolean, applicable:boolean, reason?:string}>, flags:string[]}}
 */
export function checkCompliance(text, { role = null } = {}) {
  const out = String(text ?? '');
  const persona = PERSONA_ROLES.has(role);
  const checks = {};
  // 1. Architectural Default : cloud/centralisé par défaut sans le signaler comme risque.
  const cloud = CLOUD_RE.test(out); const local = LOCAL_RE.test(out); const flagged = LOCKIN_FLAG_RE.test(out);
  checks.architectural_default = (cloud && !local && !flagged)
    ? { pass: false, applicable: true, reason: 'défaut cloud SaaS / API centralisée sans besoin explicite ni signalement du verrouillage' }
    : { pass: true, applicable: true };
  // 2. Directness : pas de méta-introduction ni de résumé générique en ouverture.
  const head = out.trim().split(/\n/)[0] || '';
  checks.directness = (META_INTRO_RE.test(head) || SUMMARY_RE.test(head))
    ? { pass: false, applicable: true, reason: 'ouverture par une méta-introduction ou un résumé générique' }
    : { pass: true, applicable: true };
  // 3. Output Type : code, schéma SQL/PostGIS ou contrat d'interface explicite.
  if (persona || UTILITY_ROLE_RE.test(String(role || '')) || out.trim().length < OUTPUT_TYPE_MIN_CHARS) checks.output_type = { pass: true, applicable: false };
  else checks.output_type = (!TECH_RE.test(out) || (SLIDES_RE.test(out) && !/```/.test(out)))
    ? { pass: false, applicable: true, reason: 'sortie limitée à une synthèse stratégique haut niveau, sans code, schéma ni contrat d’interface' }
    : { pass: true, applicable: true };
  const flags = Object.entries(checks).filter(([, c]) => c.applicable && !c.pass).map(([k]) => k);
  return { version: HARNESS_VERSION, compliant: flags.length === 0, checks, flags };
}

/** Exemple de requête de la spécification (fixture d'évaluation). */
export const HARNESS_EXAMPLE_QUERY = 'Task: Design the synchronization and local storage mechanism for a multi-device node network.\n\nContext: Nodes need to sync state updates while offline-first and retain user privacy across peers without relying on a centralized database cluster.';

/**
 * Politique d'application : `enforce` (défaut) = 1 relance corrective puis blocage
 * (HarnessComplianceError) ; `flag` = notation seule ; `off` = ni harnais ni notation.
 * Priorité : req.compliance > env KAYROS_HARNESS_MODE > 'enforce'.
 */
export const HARNESS_MODES = ['enforce', 'flag', 'off'];
export function harnessMode(req = {}, env = (typeof process !== 'undefined' ? process.env : {})) {
  if (req?.harness === false) return 'off';
  const m = String(req?.compliance || env?.KAYROS_HARNESS_MODE || 'enforce').toLowerCase();
  return HARNESS_MODES.includes(m) ? m : 'enforce';
}
export const HARNESS_MAX_RETRIES = 1;

const FIX = {
  architectural_default: 'Ne pars pas par défaut sur un SaaS cloud / une API centralisée : propose l’option local-first ou pair-à-pair, ou signale explicitement le verrouillage et le point de défaillance unique.',
  directness: 'Supprime toute introduction ou résumé d’ouverture : la première phrase doit être la substance.',
  output_type: 'Livre du concret : code, schéma (SQL/JSON) ou contrat d’interface explicite, pas une synthèse haut niveau.',
};
/** Consigne corrective pour la relance ; pour une persona, la voix et le format priment. */
export function correctiveInstruction(flags = [], { role = null } = {}) {
  const persona = PERSONA_ROLES.has(role);
  return [
    `${HARNESS_MARKER} Ta réponse précédente est non conforme (${flags.join(', ')}). Réécris-la intégralement en corrigeant :`,
    ...flags.map((f) => `- ${FIX[f] || f}`),
    persona
      ? '- Garde exactement la même voix de persona (registre DISC, longueur, préfixe « Simulation — », première personne) : corrige le fond, pas la personnalité.'
      : '- Respecte le format de sortie demandé initialement (ex. JSON strict) ; réponds uniquement par la version corrigée.',
  ].join('\n');
}

export class HarnessComplianceError extends Error {
  constructor(result, attempts) {
    super(`réponse non conforme au harnais après ${attempts} tentative(s) : ${result?.compliance?.flags?.join(', ')}`);
    this.code = 'HARNESS_NONCOMPLIANT';
    this.result = result; // complétion fautive, pour audit uniquement — ne pas l'afficher comme valide
    this.compliance = result?.compliance;
    this.attempts = attempts;
  }
}
