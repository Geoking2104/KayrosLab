// Conformité des agents personnifiés — phase 1 du cahier des charges v4
// (« règles alignées sur CrystalKnows ») :
//  - KAYROS_PERSONA_PUBLIC_MODEL (désactivé par défaut) : expose base légale, statut
//    Estimé / Vérifié par la personne et sources de modélisation, et active le filtre art. 9 ;
//  - KAYROS_MAILBOX_ENRICH=off : coupe la lecture des boîtes Gmail / Outlook (410) ;
//  - aucun taux de précision n'est calculé ni exposé : seul le statut estimé / vérifié l'est.
// Tant que les drapeaux ne sont pas posés, le comportement existant est inchangé.

import { classifyPersonaUrl, collectionProvenance, evaluatePersonaCollection, provenanceOfProfileSource } from './persona-sources.mjs';
import { SOURCE_POLICY_VERSION } from './source-policy.mjs';

export const PERSONA_COMPLIANCE_RULES_VERSION = 'v4-2026-11-11';

const ON = new Set(['1', 'true', 'on', 'yes']);

/** Drapeau booléen « allumé » (1, true, on, yes ; insensible à la casse). */
export function flagOn(value) {
  return ON.has(String(value ?? '').trim().toLowerCase());
}

/** Modèle « données publiques » de la v4 : désactivé par défaut. */
export function personaPublicModelEnabled(env = process.env) {
  return flagOn(env?.KAYROS_PERSONA_PUBLIC_MODEL);
}

/** Lecture des boîtes mail (Gmail / Outlook) : active sauf KAYROS_MAILBOX_ENRICH=off. */
export function mailboxEnrichEnabled(env = process.env) {
  return String(env?.KAYROS_MAILBOX_ENRICH ?? '').trim().toLowerCase() !== 'off';
}

export const MAILBOX_ENRICH_DISABLED = Object.freeze({
  code: 'mailbox_enrich_disabled',
  error: 'Lecture des boîtes mail désactivée (KAYROS_MAILBOX_ENRICH=off) : collez ou téléversez les textes à analyser.',
});

// Catégories particulières (RGPD art. 9). Liste volontairement prudente : un faux positif
// bloque l'entrée (l'utilisateur retire le passage), un faux négatif reste possible.
// Frontières de mot Unicode (\b ignore les lettres accentuées : « église », « âgé »…).
const w = (alternation) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'iu');

const SPECIAL_CATEGORY_PATTERNS = {
  health: [
    w(String.raw`maladies?|diagnostiqu[ée]e?s?|cancers?|chimioth[ée]rapie|d[ée]pression|burn-?out|enceinte|grossesse|handicap[ée]e?s?|situation de handicap|vih|s[ée]ropositi(?:f|ve)|hospitalis[ée]e?s?|traitement m[ée]dical|arr[êe]t maladie|psychiatr\w*`),
    w(String.raw`illness|diagnos(?:is|ed)|chemotherapy|pregnan(?:t|cy)|disabilit(?:y|ies)|disabled|hiv|hospitali[sz]ed|medical condition|sick leave|psychiatr\w*|mental health`),
  ],
  religion: [
    w(String.raw`religion|religieu(?:x|se)|musulmane?s?|chr[ée]tiens?|chr[ée]tiennes?|catholiques?|protestante?s?|juive?s?|juifs|bouddhistes?|ath[ée]e?s?|mosqu[ée]es?|[ée]glises?|synagogues?|ramadan|car[êe]me`),
    w(String.raw`religio(?:n|us)|muslims?|christians?|catholics?|protestants?|jewish|jews|buddhists?|atheists?|mosques?|churche?s?|synagogues?`),
  ],
  political_opinion: [
    w(String.raw`parti politique|opinions? politiques?|militante? (?:au|du|de la)|adh[ée]rente? (?:au|du) parti|j'ai vot[ée]|je vote pour`),
    w(String.raw`political (?:party|opinions?|views?)|party member|i voted for`),
  ],
  trade_union: [
    w(String.raw`syndicats?|syndiqu[ée]e?s?|cgt|cfdt|force ouvri[èe]re|d[ée]l[ée]gu[ée]e? syndical`),
    w(String.raw`trade unions?|labou?r unions?|union members?(?:hip)?`),
  ],
  sex_life_orientation: [
    w(String.raw`orientation sexuelle|vie sexuelle|homosexuel(?:le)?s?|lesbiennes?|bisexuel(?:le)?s?|transgenres?|lgbt\w*`),
    w(String.raw`sexual (?:orientation|life)|homosexuals?|gay|lesbians?|bisexuals?|transgender|lgbt\w*`),
  ],
  racial_ethnic_origin: [
    w(String.raw`origine ethnique|origines? raciales?|appartenance ethnique`),
    w(String.raw`ethnic(?:ity| origin)|racial origin`),
  ],
  genetic_biometric: [
    w(String.raw`donn[ée]es? g[ée]n[ée]tiques|tests? (?:g[ée]n[ée]tiques?|adn)|donn[ée]es? biom[ée]triques|empreintes? digitales?`),
    w(String.raw`genetic (?:data|tests?)|dna tests?|biometric data|fingerprints?`),
  ],
};

export const SPECIAL_CATEGORIES = Object.freeze(Object.keys(SPECIAL_CATEGORY_PATTERNS));

/** Catégories art. 9 détectées dans un texte (liste triée, vide si aucune). */
export function detectSpecialCategories(text) {
  const s = String(text ?? '');
  if (!s.trim()) return [];
  return SPECIAL_CATEGORIES.filter((cat) => SPECIAL_CATEGORY_PATTERNS[cat].some((re) => re.test(s)));
}

function textOf(item) {
  if (item == null) return '';
  if (typeof item === 'string') return item;
  if (typeof item === 'object') return [item.from, item.subject, item.body, item.text].filter((v) => typeof v === 'string').join('\n');
  return String(item);
}

/**
 * Analyse des entrées texte (champ → liste ou chaîne).
 * Renvoie { blocked, findings: [{ field, index, categories }] } sans jamais renvoyer le texte.
 */
export function scanTextInputs(fields = {}) {
  const findings = [];
  for (const [field, value] of Object.entries(fields)) {
    if (value == null) continue;
    const items = Array.isArray(value) ? value : (typeof value === 'object' ? Object.values(value) : [value]);
    items.forEach((item, index) => {
      const categories = detectSpecialCategories(textOf(item));
      if (categories.length) findings.push({ field, index, categories });
    });
  }
  return { blocked: findings.length > 0, findings };
}

/** Réponse d'erreur (422) du filtre art. 9 : aucune donnée citée, seulement champ, index, catégories. */
export function specialCategoryError(findings) {
  return {
    code: 'special_category_data',
    error: 'Entrée refusée : elle semble contenir des données sensibles (RGPD art. 9). Retirez les passages signalés puis réessayez.',
    findings,
  };
}

/** Retire les éléments contenant des catégories art. 9 (sources lues par API) ; renvoie { kept, excluded }. */
export function excludeSpecialCategoryItems(items = []) {
  const kept = [];
  let excluded = 0;
  for (const item of items) {
    if (detectSpecialCategories(textOf(item)).length) excluded += 1;
    else kept.push(item);
  }
  return { kept, excluded };
}

const SOURCE_LABELS = {
  crystalknows: 'CrystalKnows',
  linkedin: 'LinkedIn',
  x: 'X',
  email: 'Textes fournis',
  manual: 'Saisie manuelle',
  web: 'Page publique',
};

/**
 * Statut du profil : « verified » seulement si la personne a elle-même rempli un
 * questionnaire ou partagé un profil vérifié (CrystalKnows isVerified) ; sinon « estimated ».
 */
export function verificationStatus(humanProfile) {
  const sources = Array.isArray(humanProfile?.profile_sources) ? humanProfile.profile_sources : [];
  return sources.some((s) => s && (s.verified === true || s.source === 'self_assessment')) ? 'verified' : 'estimated';
}

export function verificationLabel(status) {
  return status === 'verified' ? 'Simulation · Vérifié par la personne' : 'Simulation · Estimé';
}

/** Sources de modélisation affichables (provenance seulement, jamais de contenu). */
// Chaque entrée porte la provenance de la politique de collecte (core/source-policy.mjs) :
// `collection` = { source, mode, scope, collected_at, terms_version, policy_version[, inferred] }.
export function describeProfileSources(agent) {
  const out = [];
  const hp = agent?.human_profile || {};
  for (const s of Array.isArray(hp.profile_sources) ? hp.profile_sources : []) {
    if (!s?.source) continue;
    const collection = provenanceOfProfileSource(s);
    out.push({
      type: s.source,
      label: SOURCE_LABELS[s.source] || s.source,
      url: s.source === 'email' ? null : (s.source_url || null),
      mode: s.import_mode || null,
      imported_at: s.imported_at || null,
      verified: s.verified === true,
      collected_at: collection[0]?.collected_at || s.imported_at || null,
      terms_version: collection[0]?.terms_version || null,
      collection,
    });
  }
  const imp = agent?.metadata?.impersonator || {};
  const evidence = Array.isArray(imp.public_evidence) ? imp.public_evidence : [];
  for (const url of Array.isArray(imp.public_sources) ? imp.public_sources : []) {
    const trace = evidence.find((e) => e?.url === url) || null;
    const collection = trace?.collection ? [trace.collection] : inferredUrlProvenance(url, trace);
    out.push({
      type: collection[0]?.source === 'github' ? 'github' : 'web', label: collection[0]?.source === 'github' ? 'GitHub (API)' : SOURCE_LABELS.web, url,
      mode: collection[0]?.mode || 'public_visit',
      imported_at: trace?.fetched_at || null, verified: false,
      visited: trace ? !trace.error : false,
      ...(trace?.policy_code ? { policy_code: trace.policy_code } : {}),
      collected_at: trace?.collection?.collected_at || trace?.fetched_at || null,
      terms_version: collection[0]?.terms_version || null,
      collection,
    });
  }
  return out;
}

/** Provenance déduite d'une URL non encore visitée sous la politique (version actuelle des conditions). */
function inferredUrlProvenance(url, trace) {
  const target = classifyPersonaUrl(url);
  const decision = evaluatePersonaCollection({ ...target, env: {} });
  if (!decision.allowed) return [{ source: target.source, mode: target.mode, scope: target.scope ?? null, collected_at: trace?.fetched_at || null, terms_version: null, policy_version: SOURCE_POLICY_VERSION, refused: decision.code, inferred: true }];
  return [{ ...collectionProvenance(decision, trace?.fetched_at || null), inferred: true }];
}

/**
 * Vue de conformité d'un agent personnifié (null pour les autres agents).
 * Base légale : intérêt légitime du tenant, responsable de traitement (v4, modèle Crystal).
 */
export function personaComplianceView(agent) {
  if (!agent?.metadata?.impersonator) return null;
  const status = verificationStatus(agent.human_profile);
  return {
    rules_version: PERSONA_COMPLIANCE_RULES_VERSION,
    legal_basis: 'legitimate_interest',
    controller: 'tenant',
    verification_status: status,
    label: verificationLabel(status),
    portrait_url: agent.human_profile?.avatar_url || agent.metadata.impersonator.portrait_url || null,
    profile_sources: describeProfileSources(agent),
  };
}
