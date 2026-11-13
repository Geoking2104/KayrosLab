// KayrosLab — politique de collecte par source (refus par défaut).
//
// Chaque source de signaux déclare ici, une fois pour toutes :
//   - les modes de collecte autorisés : 'api' | 'scrape' | 'public_visit' | 'import' | 'none' ;
//   - ses limites de débit et le plafond de requêtes par décision ;
//   - l'URL de ses conditions d'utilisation et la date à laquelle on les a lues ;
//   - si elle peut servir au profilage d'une personne ou seulement à des
//     signaux de sujet (topic-level).
//
// Tout ce qui n'est pas déclaré est refusé : source inconnue, mode non listé,
// source désactivée (clé API absente, accord commercial non signé), finalité
// ou périmètre non autorisés. Un connecteur DOIT appeler `assertCollectionAllowed`
// avant toute requête réseau et recopier `termsVersion` dans la provenance du
// signal.
//
// Per-source collection policy (default deny). Every signal source declares
// its allowed collection modes, rate limits, terms URL, terms verification date
// and whether it may be used for person profiling or topic-level signals only.
//
// Finalité `person_profiling` (agent personnifié, cahier v4 + décision du
// 11 nov. 2026 sur Gmail/Outlook) : une collecte n'est autorisée que si la
// source a `personProfiling: true`, que le mode liste `person_profiling` dans
// `purposes` et que le périmètre figure dans `scopesByPurpose.person_profiling`
// (périmètre obligatoire). Reddit, Discord et tout mode `scrape` sont refusés ;
// LinkedIn n'est accepté que sous forme d'export ou de profil fourni.
// `public_visit` = visite unitaire d'une URL désignée par un humain (pas de
// parcours de liens, garde SSRF, taille et délai bornés) : distincte du `scrape`.

export const SOURCE_POLICY_VERSION = '2026-11-13';
export const COLLECTION_MODES = Object.freeze(['api', 'scrape', 'public_visit', 'import', 'none']);
export const COLLECTION_PURPOSES = Object.freeze(['topic_signal', 'person_profiling']);

const TRUTHY = new Set(['1', 'true', 'on', 'yes', 'signed']);
const isOn = (value) => TRUTHY.has(String(value ?? '').trim().toLowerCase());
const hasValue = (value) => String(value ?? '').trim().length > 0;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * Registre figé. `enabledWhen(env)` décide si la source est utilisable dans
 * l'environnement courant ; `disabledReason` explique pourquoi elle ne l'est pas.
 */
export const SOURCE_POLICIES = deepFreeze({
  github: {
    id: 'github',
    label: 'GitHub',
    termsUrl: 'https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies',
    termsVerifiedAt: '2026-11-12',
    // Profilage : API REST officielle seulement (profil public, dépôts, README de la cible).
    personProfiling: true,
    topicSignals: true,
    preferredMode: 'api',
    modes: {
      api: {
        allowed: true,
        scopes: ['repositories', 'issues', 'topics'],
        purposes: ['topic_signal', 'person_profiling'],
        scopesByPurpose: { person_profiling: ['profile', 'repos', 'readme'] },
        rateLimit: {
          // REST search API : 10 req/min sans jeton, 30 req/min avec jeton.
          searchRequestsPerMinute: { unauthenticated: 10, authenticated: 30 },
          maxRequestsPerDecision: 10,
          honorHeaders: ['x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after'],
        },
        tokenEnv: 'GITHUB_TOKEN',
      },
      scrape: {
        // Toléré uniquement pour des signaux publics, agrégés, au niveau du
        // sujet (dépôts, issues, topics), en respectant robots.txt et un
        // rythme lent. Jamais pour profiler une personne ni revendre des
        // données personnelles. Aucun scraper n'est implémenté à ce jour.
        allowed: true,
        scopes: ['repositories', 'issues', 'topics'],
        purposes: ['topic_signal'],
        conditions: {
          publicOnly: true,
          aggregatedOnly: true,
          respectRobotsTxt: true,
          noPersonalDataResale: true,
          minDelayMs: 10_000,
        },
        rateLimit: { maxRequestsPerDecision: 5, minDelayMs: 10_000 },
      },
      public_visit: { allowed: false },
      import: { allowed: false },
      none: { allowed: true },
    },
    disabledReason: null,
  },
  x: {
    id: 'x',
    label: 'X (Twitter)',
    termsUrl: 'https://x.com/en/tos',
    termsVerifiedAt: '2026-11-12',
    // Profilage : API v2 seulement (« User Protection »), filtre art. 9 appliqué par l'appelant.
    personProfiling: true,
    topicSignals: true,
    preferredMode: 'api',
    modes: {
      api: {
        allowed: true,
        scopes: ['posts', 'topics'],
        purposes: ['topic_signal', 'person_profiling'],
        scopesByPurpose: { person_profiling: ['profile', 'posts'] },
        rateLimit: { perPlan: true, maxRequestsPerDecision: 10, honorHeaders: ['x-rate-limit-remaining', 'x-rate-limit-reset'] },
        // X_BEARER_TOKEN : nom historique lu par XProfileAdapter (enrichissement persona).
        tokenEnv: 'X_API_BEARER_TOKEN',
      },
      scrape: { allowed: false },
      public_visit: { allowed: false },
      import: { allowed: false },
      none: { allowed: true },
    },
    envKeys: ['X_API_BEARER_TOKEN', 'X_BEARER_TOKEN'],
    disabledReason: 'X : API officielle uniquement, désactivée tant que X_API_BEARER_TOKEN (ou X_BEARER_TOKEN) n\'est pas défini',
  },
  reddit: {
    id: 'reddit',
    label: 'Reddit',
    termsUrl: 'https://redditinc.com/policies/user-agreement',
    termsVerifiedAt: '2026-11-12',
    personProfiling: false,
    topicSignals: true,
    preferredMode: 'api',
    modes: {
      api: {
        allowed: true,
        scopes: ['posts', 'subreddits', 'topics'],
        purposes: ['topic_signal'],
        rateLimit: { requestsPerMinute: 100, maxRequestsPerDecision: 10, note: 'à confirmer dans l\'accord commercial' },
      },
      scrape: { allowed: false },
      public_visit: { allowed: false },
      import: { allowed: false },
      none: { allowed: true },
    },
    envKeys: ['KAYROS_REDDIT_COMMERCIAL_AGREEMENT'],
    disabledReason: 'Reddit : API uniquement, désactivée tant que KAYROS_REDDIT_COMMERCIAL_AGREEMENT n\'atteste pas un accord commercial signé',
  },
  import: {
    id: 'import',
    label: 'Import JSON/CSV fourni par le client',
    termsUrl: null,
    termsVerifiedAt: '2026-11-12',
    personProfiling: false,
    topicSignals: true,
    preferredMode: 'import',
    modes: {
      api: { allowed: false },
      scrape: { allowed: false },
      public_visit: { allowed: false },
      import: { allowed: true, formats: ['json', 'csv'], scopes: ['signals'], purposes: ['topic_signal'], rateLimit: { maxRequestsPerDecision: null } },
      none: { allowed: true },
    },
    disabledReason: null,
  },

  // ----------------------------------------------------------- Agent personnifié
  // Sources propres au profilage d'une personne (persona). Aucune n'alimente les
  // signaux de sujet. Les conditions d'utilisation tierces sont « à vérifier » par
  // un avocat (cahier v4, points résiduels). `termsVerifiedAt` = date à laquelle
  // l'URL des conditions a été contrôlée (accessible) ; ce n'est pas un avis juridique.
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    termsUrl: 'https://www.linkedin.com/legal/user-agreement',
    termsVerifiedAt: '2026-11-13',
    // Accepté seulement sous forme d'export de données ou de profil fourni (cahier v4 §5).
    // Pas d'extension, pas de scraping (User Agreement §8.2), pas d'API membre pour un tiers.
    personProfiling: true,
    topicSignals: false,
    preferredMode: 'import',
    modes: {
      api: { allowed: false, note: 'L\'API standard ne lit que le membre authentifié : refusée pour profiler un tiers.' },
      scrape: { allowed: false },
      public_visit: { allowed: false },
      import: {
        allowed: true,
        purposes: ['person_profiling'],
        scopesByPurpose: { person_profiling: ['data_export', 'profile_data', 'reference_url'] },
        conditions: { providedByUser: true, noExtension: true },
      },
      none: { allowed: true },
    },
    disabledReason: null,
  },
  crystalknows: {
    id: 'crystalknows',
    label: 'CrystalKnows',
    termsUrl: 'https://www.crystalknows.com/tos',
    termsVerifiedAt: '2026-11-13',
    personProfiling: true,
    topicSignals: false,
    preferredMode: 'import',
    modes: {
      // API v4 du compte client (CRYSTALKNOWS_API_TOKEN ; 503 côté route si absent).
      api: { allowed: true, purposes: ['person_profiling'], scopesByPurpose: { person_profiling: ['profile'] }, tokenEnv: 'CRYSTALKNOWS_API_TOKEN' },
      scrape: { allowed: false },
      // Page publique de profil, une URL crystalknows.com/p/<slug> à la fois.
      public_visit: { allowed: true, purposes: ['person_profiling'], scopesByPurpose: { person_profiling: ['public_profile'] }, conditions: { singleUrl: true, hostAllowlist: ['www.crystalknows.com'] } },
      import: { allowed: true, purposes: ['person_profiling'], scopesByPurpose: { person_profiling: ['json_export', 'public_page_html', 'profile_data'] }, conditions: { providedByUser: true } },
      none: { allowed: true },
    },
    disabledReason: null,
  },
  gmail: {
    id: 'gmail',
    label: 'Gmail (API officielle)',
    termsUrl: 'https://developers.google.com/terms/api-services-user-data-policy',
    termsVerifiedAt: '2026-11-13',
    // Échanges entre l'utilisateur KayrosLab et la cible : actif par défaut (décision
    // utilisateur du 11 nov. 2026), coupé par KAYROS_MAILBOX_ENRICH=off.
    personProfiling: true,
    topicSignals: false,
    preferredMode: 'api',
    modes: {
      api: { allowed: true, purposes: ['person_profiling'], scopesByPurpose: { person_profiling: ['messages'] }, conditions: { oauthTokenPerRequest: true, tokenNeverStored: true, betweenUserAndTarget: true } },
      scrape: { allowed: false },
      public_visit: { allowed: false },
      import: { allowed: false },
      none: { allowed: true },
    },
    envKeys: ['KAYROS_MAILBOX_ENRICH'],
    disabledReason: 'Lecture des boîtes mail désactivée (KAYROS_MAILBOX_ENRICH=off).',
  },
  outlook: {
    id: 'outlook',
    label: 'Outlook (Microsoft Graph)',
    termsUrl: 'https://learn.microsoft.com/en-us/legal/microsoft-apis/terms-of-use',
    termsVerifiedAt: '2026-11-13',
    personProfiling: true,
    topicSignals: false,
    preferredMode: 'api',
    modes: {
      api: { allowed: true, purposes: ['person_profiling'], scopesByPurpose: { person_profiling: ['messages'] }, conditions: { oauthTokenPerRequest: true, tokenNeverStored: true, betweenUserAndTarget: true } },
      scrape: { allowed: false },
      public_visit: { allowed: false },
      import: { allowed: false },
      none: { allowed: true },
    },
    envKeys: ['KAYROS_MAILBOX_ENRICH'],
    disabledReason: 'Lecture des boîtes mail désactivée (KAYROS_MAILBOX_ENRICH=off).',
  },
  user_text: {
    id: 'user_text',
    label: 'Texte fourni par l\'utilisateur',
    termsUrl: null,
    termsVerifiedAt: '2026-11-13',
    // Échantillons collés ou téléversés (e-mails reçus, posts X, archive X) ; analysés, non conservés bruts.
    personProfiling: true,
    topicSignals: false,
    preferredMode: 'import',
    modes: {
      api: { allowed: false },
      scrape: { allowed: false },
      public_visit: { allowed: false },
      import: { allowed: true, purposes: ['person_profiling'], scopesByPurpose: { person_profiling: ['emails', 'x_posts', 'x_archive'] }, conditions: { providedByUser: true } },
      none: { allowed: true },
    },
    disabledReason: null,
  },
  manual: {
    id: 'manual',
    label: 'Saisie manuelle',
    termsUrl: null,
    termsVerifiedAt: '2026-11-13',
    personProfiling: true,
    topicSignals: false,
    preferredMode: 'import',
    modes: {
      api: { allowed: false },
      scrape: { allowed: false },
      public_visit: { allowed: false },
      import: { allowed: true, purposes: ['person_profiling'], scopesByPurpose: { person_profiling: ['manual_profile', 'disc_type', 'clues', 'enriched_profile'] } },
      none: { allowed: true },
    },
    disabledReason: null,
  },
  web: {
    id: 'web',
    label: 'Pages web publiques professionnelles',
    termsUrl: null,
    termsVerifiedAt: '2026-11-13',
    // Cahier v4 §5 : retenu via core/public-sources.mjs. Les domaines de plateformes
    // (X, LinkedIn, Reddit, Discord, GitHub) sont routés vers leur propre entrée.
    personProfiling: true,
    topicSignals: false,
    preferredMode: 'public_visit',
    modes: {
      api: { allowed: false },
      scrape: { allowed: false },
      public_visit: {
        allowed: true,
        purposes: ['person_profiling'],
        scopesByPurpose: { person_profiling: ['professional_page'] },
        conditions: { designatedByHuman: true, noCrawl: true, ssrfGuard: true, maxBytes: 512 * 1024, timeoutMs: 8000, respectRobotsTxt: 'à durcir (cahier v4)' },
        rateLimit: { maxRequestsPerDecision: 30, domainFailureThreshold: 2 },
      },
      import: { allowed: false },
      none: { allowed: true },
    },
    disabledReason: null,
  },
  discord: {
    id: 'discord',
    label: 'Discord',
    termsUrl: 'https://discord.com/terms',
    termsVerifiedAt: '2026-11-13',
    personProfiling: false,
    topicSignals: false,
    preferredMode: 'none',
    modes: {
      api: { allowed: false },
      scrape: { allowed: false },
      public_visit: { allowed: false },
      import: { allowed: false },
      none: { allowed: true },
    },
    disabledReason: 'Discord : exclu (cahier v4).',
  },
});

const ENABLED = Object.freeze({
  github: () => true,
  x: (env) => hasValue(env.X_API_BEARER_TOKEN) || hasValue(env.X_BEARER_TOKEN),
  reddit: (env) => isOn(env.KAYROS_REDDIT_COMMERCIAL_AGREEMENT),
  import: () => true,
  linkedin: () => true,
  crystalknows: () => true,
  // Même sémantique que mailboxEnrichEnabled (core/persona-compliance.mjs) : actif sauf « off ».
  gmail: (env) => String(env.KAYROS_MAILBOX_ENRICH ?? '').trim().toLowerCase() !== 'off',
  outlook: (env) => String(env.KAYROS_MAILBOX_ENRICH ?? '').trim().toLowerCase() !== 'off',
  user_text: () => true,
  manual: () => true,
  web: () => true,
  discord: () => false,
});

export class SourcePolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SourcePolicyError';
    this.code = code;
    this.details = details;
  }
}

/** Liste des sources déclarées. */
export function listSources() {
  return Object.keys(SOURCE_POLICIES);
}

/** Politique d'une source ; refuse une source inconnue. */
export function getSourcePolicy(source) {
  const id = String(source ?? '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(SOURCE_POLICIES, id)) {
    throw new SourcePolicyError('unknown_source', `Source « ${source} » non déclarée dans la politique de collecte : refusée par défaut.`, { source });
  }
  return SOURCE_POLICIES[id];
}

/** Version des conditions appliquées, à recopier dans la provenance. */
export function termsVersionOf(policy) {
  return `${policy.id}@${policy.termsVerifiedAt}`;
}

/** Source utilisable dans cet environnement ? */
export function isSourceEnabled(source, env = process.env) {
  const policy = getSourcePolicy(source);
  return Boolean(ENABLED[policy.id]?.(env || {}));
}

/**
 * Vérifie une collecte sans lever d'exception.
 * @returns {{ allowed: true, source, mode, purpose, scope, termsUrl, termsVersion, rateLimit, conditions }
 *          | { allowed: false, code, error, details }}
 */
export function evaluateCollection({ source, mode, purpose = 'topic_signal', scope = null, env = process.env } = {}) {
  try {
    return assertCollectionAllowed({ source, mode, purpose, scope, env });
  } catch (error) {
    if (error instanceof SourcePolicyError) return { allowed: false, code: error.code, error: error.message, details: error.details };
    throw error;
  }
}

/** Vérifie une collecte ; lève une SourcePolicyError explicite en cas de refus. */
export function assertCollectionAllowed({ source, mode, purpose = 'topic_signal', scope = null, env = process.env } = {}) {
  const policy = getSourcePolicy(source);
  if (!COLLECTION_MODES.includes(mode)) {
    throw new SourcePolicyError('unknown_mode', `Mode de collecte « ${mode} » inconnu (attendus : ${COLLECTION_MODES.join(', ')}).`, { source: policy.id, mode });
  }
  if (mode === 'none') {
    throw new SourcePolicyError('mode_not_allowed', `Mode « none » : aucune collecte n'est effectuée pour ${policy.label}.`, { source: policy.id, mode });
  }
  const rule = policy.modes[mode];
  if (!rule?.allowed) {
    throw new SourcePolicyError('mode_not_allowed', `${policy.label} : mode « ${mode} » non autorisé par la politique de collecte.`, { source: policy.id, mode });
  }
  // Finalité vérifiée avant l'activation : un refus de principe (profilage interdit)
  // prime sur une clé absente, pour que la réponse dise la vraie raison.
  if (!COLLECTION_PURPOSES.includes(purpose)) {
    throw new SourcePolicyError('unknown_purpose', `Finalité « ${purpose} » inconnue.`, { source: policy.id, purpose });
  }
  if (purpose === 'person_profiling' && !policy.personProfiling) {
    throw new SourcePolicyError('purpose_not_allowed', `${policy.label} : le profilage de personnes est interdit pour cette source ; seuls des signaux de sujet sont autorisés.`, { source: policy.id, mode, purpose });
  }
  if (purpose === 'topic_signal' && policy.topicSignals === false) {
    throw new SourcePolicyError('purpose_not_allowed', `${policy.label} : source réservée au profilage encadré d'une persona, pas aux signaux de sujet.`, { source: policy.id, mode, purpose });
  }
  if (Array.isArray(rule.purposes) && !rule.purposes.includes(purpose)) {
    throw new SourcePolicyError('purpose_not_allowed', `${policy.label} : finalité « ${purpose} » non autorisée en mode « ${mode} ».`, { source: policy.id, mode, purpose });
  }
  if (!isSourceEnabled(policy.id, env)) {
    throw new SourcePolicyError('source_disabled', policy.disabledReason || `${policy.label} : source désactivée.`, { source: policy.id, mode });
  }
  const scopes = rule.scopesByPurpose?.[purpose] ?? rule.scopes;
  // Profilage : le périmètre est obligatoire dès qu'une liste est déclarée.
  if (purpose === 'person_profiling' && scope == null && Array.isArray(scopes)) {
    throw new SourcePolicyError('scope_not_allowed', `${policy.label} : périmètre requis pour le profilage (autorisés : ${scopes.join(', ')}).`, { source: policy.id, mode, scope });
  }
  if (scope != null && Array.isArray(scopes) && !scopes.includes(scope)) {
    throw new SourcePolicyError('scope_not_allowed', `${policy.label} : périmètre « ${scope} » non autorisé en mode « ${mode} » (autorisés : ${scopes.join(', ')}).`, { source: policy.id, mode, scope });
  }
  return Object.freeze({
    allowed: true,
    source: policy.id,
    mode,
    purpose,
    scope,
    termsUrl: policy.termsUrl,
    termsVerifiedAt: policy.termsVerifiedAt,
    termsVersion: termsVersionOf(policy),
    policyVersion: SOURCE_POLICY_VERSION,
    rateLimit: rule.rateLimit ?? null,
    conditions: rule.conditions ?? null,
  });
}
