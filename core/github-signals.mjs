// KayrosLab — connecteur « signaux de sujet » GitHub pour l'étape Écouter
// (agent SignalScanner, preset cycle8).
//
// - API REST officielle uniquement (search/repositories, search/issues) ;
//   GITHUB_TOKEN facultatif ;
// - chaque requête passe d'abord par la politique de collecte
//   (source-policy.mjs : github / api / topic_signal / périmètre) ;
// - requêtes plafonnées par décision ; en-têtes de limite de débit respectés
//   (x-ratelimit-remaining / reset, retry-after) : on s'arrête, on ne relance pas ;
// - signaux au niveau du sujet : aucun champ de personne n'est conservé
//   (pas d'auteur, d'avatar ni de commentateur), et les qualificatifs qui
//   ciblent une personne (author:, user:, involves:…) sont refusés ;
// - chaque signal porte sa provenance : source, URL, collected_at, mode,
//   version des conditions et étiquette platform_fact / machine_extraction ;
// - le réseau est injectable (`fetchImpl`) : les tests n'appellent jamais GitHub.
//
// GitHub topic-signal connector for the "ecouter" step. Official REST API only,
// gated by the source policy, request-capped per decision, rate-limit aware,
// topic-level (no person fields), with per-signal provenance.

import { assertCollectionAllowed, SourcePolicyError } from './source-policy.mjs';
import { idSignal, normalizeSignal } from './ecouter.mjs';
import { canonicalize, sha256Hex } from './evidence-chain.mjs';

export const SIGNAL_LABELS = Object.freeze({
  PLATFORM_FACT: 'platform_fact',
  MACHINE_EXTRACTION: 'machine_extraction',
});

export const GITHUB_SIGNAL_KINDS = Object.freeze({
  repositories: { scope: 'repositories', path: '/search/repositories', sort: 'updated' },
  issues: { scope: 'issues', path: '/search/issues', sort: 'updated' },
});

// Qualificatifs de recherche GitHub qui visent une personne : refusés.
const PERSON_QUALIFIERS = /(^|\s)-?((author|user|involves|mentions|commenter|assignee|reviewed-by|review-requested|committer|followers|fullname):|in:email\b)/i;

export function assertTopicQuery(query) {
  const q = String(query ?? '').trim();
  if (!q) throw new SourcePolicyError('empty_query', 'Requête de signaux vide.', { source: 'github' });
  if (q.length > 256) throw new SourcePolicyError('query_too_long', 'Requête de signaux trop longue (256 caractères max).', { source: 'github' });
  if (PERSON_QUALIFIERS.test(q)) {
    throw new SourcePolicyError('purpose_not_allowed', 'GitHub : les qualificatifs qui ciblent une personne (author:, user:, involves:…) sont interdits ; seuls des signaux de sujet sont autorisés.', { source: 'github', purpose: 'person_profiling' });
  }
  return q;
}

function headerOf(res, name) {
  const h = res?.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(name);
  return h[name] ?? h[name.toLowerCase()] ?? null;
}

/** Lit l'état de la limite de débit dans les en-têtes d'une réponse. */
export function readRateLimit(res) {
  const remaining = headerOf(res, 'x-ratelimit-remaining');
  const reset = headerOf(res, 'x-ratelimit-reset');
  const retryAfter = headerOf(res, 'retry-after');
  return {
    limit: headerOf(res, 'x-ratelimit-limit') != null ? Number(headerOf(res, 'x-ratelimit-limit')) : null,
    remaining: remaining != null ? Number(remaining) : null,
    resetAt: reset != null ? new Date(Number(reset) * 1000).toISOString() : null,
    retryAfterSeconds: retryAfter != null ? Number(retryAfter) : null,
  };
}

function repoFacts(item) {
  return {
    full_name: item.full_name,
    description: item.description || '',
    topics: Array.isArray(item.topics) ? item.topics.slice(0, 20) : [],
    language: item.language || null,
    stars: item.stargazers_count ?? null,
    forks: item.forks_count ?? null,
    open_issues: item.open_issues_count ?? null,
    created_at: item.created_at || null,
    pushed_at: item.pushed_at || null,
    archived: Boolean(item.archived),
  };
}

function issueFacts(item) {
  const repoUrl = String(item.repository_url || '');
  return {
    repository: repoUrl.replace(/^https:\/\/api\.github\.com\/repos\//, '') || null,
    title: item.title || '',
    state: item.state || null,
    is_pull_request: Boolean(item.pull_request),
    comments: item.comments ?? null,
    labels: Array.isArray(item.labels) ? item.labels.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean).slice(0, 20) : [],
    created_at: item.created_at || null,
    updated_at: item.updated_at || null,
  };
}

function toSignal(kind, item, { decision, collectedAt, query }) {
  const facts = kind === 'repositories' ? repoFacts(item) : issueFacts(item);
  const url = item.html_url;
  const contenu = kind === 'repositories'
    ? `Dépôt ${facts.full_name}${facts.description ? ` — ${facts.description}` : ''} (${facts.stars ?? 0}★, mis à jour ${facts.pushed_at || 'n/d'})`
    : `${facts.is_pull_request ? 'PR' : 'Issue'} ${facts.repository} — ${facts.title} (${facts.state}, ${facts.comments ?? 0} commentaires)`;
  const tags = kind === 'repositories' ? facts.topics : facts.labels;
  return {
    id: idSignal({ source: `github:${kind}`, contenu: url }),
    source: 'github',
    kind,
    url,
    date: facts.pushed_at || facts.updated_at || facts.created_at || collectedAt,
    contenu,
    tags: [...new Set(tags)],
    facts,
    label: SIGNAL_LABELS.PLATFORM_FACT,
    provenance: {
      source: 'github',
      url,
      collected_at: collectedAt,
      collection_mode: decision.mode,
      scope: decision.scope,
      query,
      terms_url: decision.termsUrl,
      terms_version: decision.termsVersion,
      policy_version: decision.policyVersion,
      label: SIGNAL_LABELS.PLATFORM_FACT,
      content_hash: sha256Hex(canonicalize(facts)),
    },
  };
}

/** Entrée d'audit pour createSignedChainSink (chaîne de preuves signée). */
export function signalEvidenceEntry(signal, { decisionId = null } = {}) {
  return {
    type: 'signal.collected',
    ...(decisionId ? { runId: String(decisionId) } : {}),
    signalId: signal.id,
    source: signal.source,
    kind: signal.kind,
    url: signal.url,
    label: signal.label,
    collected_at: signal.provenance.collected_at,
    collection_mode: signal.provenance.collection_mode,
    terms_version: signal.provenance.terms_version,
    content_hash: signal.provenance.content_hash,
  };
}

/** Signal normalisé pour l'étape Écouter (core/ecouter.mjs), provenance conservée. */
export function toEcouterSignal(signal, { index = 0 } = {}) {
  const normalized = normalizeSignal({ id: signal.id, source: `github:${signal.kind}`, date: signal.date, contenu: signal.contenu, url: signal.url, tags: signal.tags }, { index });
  return { ...normalized, label: signal.label, provenance: signal.provenance };
}

/**
 * @param {object} [opts]
 * @param {string} [opts.token]              GITHUB_TOKEN (facultatif)
 * @param {Function} [opts.fetchImpl]        fetch injectable (tests)
 * @param {object} [opts.env]                environnement pour la politique
 * @param {number} [opts.maxRequestsPerDecision] plafond (borné par la politique)
 * @param {Function} [opts.now]              horloge injectable
 * @param {object} [opts.evidenceSink]       sink { append } (ex. createSignedChainSink)
 * @param {Function} [opts.extract]          enrichissement facultatif (ex. LLM) :
 *   (signal) => { contenu?, tags? } ; le signal devient `machine_extraction`.
 */
export function createGitHubSignalCollector({
  token = '', fetchImpl = globalThis.fetch, env = process.env, apiBase = 'https://api.github.com',
  maxRequestsPerDecision = null, now = () => new Date().toISOString(), evidenceSink = null, extract = null,
  timeoutMs = 8000,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('github-signals: fetch requis');

  async function collect({ query, kinds = ['repositories', 'issues'], perPage = 10, decisionId = null } = {}) {
    const q = assertTopicQuery(query);
    const wanted = [...new Set([].concat(kinds))];
    for (const kind of wanted) {
      if (!GITHUB_SIGNAL_KINDS[kind]) throw new SourcePolicyError('scope_not_allowed', `GitHub : type de signal « ${kind} » inconnu.`, { source: 'github', scope: kind });
    }
    // La politique est vérifiée pour chaque périmètre AVANT tout appel réseau.
    const decisions = wanted.map((kind) => assertCollectionAllowed({ source: 'github', mode: 'api', purpose: 'topic_signal', scope: GITHUB_SIGNAL_KINDS[kind].scope, env }));
    const policyCap = decisions[0].rateLimit?.maxRequestsPerDecision ?? 10;
    const cap = Math.max(0, Math.min(policyCap, maxRequestsPerDecision ?? policyCap));
    const size = Math.max(1, Math.min(Number(perPage) || 10, 30));

    const signals = [];
    const warnings = [];
    let requests = 0;
    let rateLimit = null;
    let stopped = null;

    for (const [i, kind] of wanted.entries()) {
      if (requests >= cap) { stopped = 'request_cap'; warnings.push(`Plafond de ${cap} requête(s) par décision atteint.`); break; }
      if (rateLimit && rateLimit.remaining === 0) { stopped = 'rate_limited'; warnings.push(`Limite GitHub épuisée jusqu'à ${rateLimit.resetAt || 'n/d'}.`); break; }
      const spec = GITHUB_SIGNAL_KINDS[kind];
      const fullQuery = kind === 'issues' && !/\bis:public\b/.test(q) ? `${q} is:public` : q;
      const url = `${apiBase}${spec.path}?q=${encodeURIComponent(fullQuery)}&sort=${spec.sort}&order=desc&per_page=${size}`;
      const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'KayrosLab-SignalScanner/1.0', 'X-GitHub-Api-Version': '2022-11-28' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      let res;
      try {
        requests += 1;
        res = await fetchImpl(url, { headers, ...(ctrl ? { signal: ctrl.signal } : {}) });
      } catch (error) {
        warnings.push(`GitHub ${kind} : ${error?.name === 'AbortError' ? 'délai dépassé' : (error?.message || 'erreur réseau')}.`);
        continue;
      } finally { if (timer) clearTimeout(timer); }
      rateLimit = readRateLimit(res);
      if (res.status === 403 || res.status === 429) {
        stopped = 'rate_limited';
        warnings.push(`GitHub ${kind} : limite de débit (${res.status})${rateLimit.retryAfterSeconds != null ? `, réessayer dans ${rateLimit.retryAfterSeconds} s` : ''} ; collecte arrêtée.`);
        break;
      }
      if (!res.ok) { warnings.push(`GitHub ${kind} : HTTP ${res.status}.`); continue; }
      const data = await res.json();
      if (data?.incomplete_results) warnings.push(`GitHub ${kind} : résultats incomplets (délai de recherche côté GitHub).`);
      const collectedAt = now();
      for (const item of (data?.items || []).slice(0, size)) {
        if (!item?.html_url) continue;
        if (kind === 'repositories' && item.private) continue;
        let signal = toSignal(kind, item, { decision: decisions[i], collectedAt, query: fullQuery });
        if (typeof extract === 'function') {
          const extra = await extract(signal);
          if (extra && (extra.contenu || extra.tags)) {
            signal = {
              ...signal,
              contenu: extra.contenu ? String(extra.contenu) : signal.contenu,
              tags: extra.tags ? [...new Set([].concat(extra.tags).map(String))] : signal.tags,
              label: SIGNAL_LABELS.MACHINE_EXTRACTION,
              provenance: { ...signal.provenance, label: SIGNAL_LABELS.MACHINE_EXTRACTION, derived_from: SIGNAL_LABELS.PLATFORM_FACT },
            };
          }
        }
        signals.push(signal);
        if (evidenceSink?.append) await evidenceSink.append(signalEvidenceEntry(signal, { decisionId }));
      }
    }

    return {
      source: 'github',
      query: q,
      decisionId,
      requests,
      maxRequests: cap,
      stopped,
      rateLimit,
      warnings,
      terms: { url: decisions[0].termsUrl, version: decisions[0].termsVersion, policyVersion: decisions[0].policyVersion },
      signals,
    };
  }

  return { source: 'github', collect };
}
