// KayrosLab — sources de l'agent personnifié passées par la politique de collecte.
//
// Toute ingestion d'une source de persona appelle `assertPersonaCollection`
// (finalité `person_profiling`, core/source-policy.mjs) AVANT toute requête
// réseau ou tout parsing. Chaque élément collecté porte sa provenance :
// { source, mode, scope, collected_at, terms_version, policy_version }.
//
// Persona sources routed through the collection policy (purpose
// `person_profiling`). Every ingestion is checked before any fetch or parse and
// every collected item carries its provenance.

import { createHash } from 'node:crypto';
import { robotsTrace } from './robots-txt.mjs';
import { SOURCE_POLICY_VERSION, SourcePolicyError, assertCollectionAllowed, evaluateCollection, getSourcePolicy, termsVersionOf } from './source-policy.mjs';

export const PERSONA_PURPOSE = 'person_profiling';

/** Vérifie une collecte persona ; lève SourcePolicyError (code de politique) en cas de refus. */
export function assertPersonaCollection({ source, mode, scope, env = process.env } = {}) {
  return assertCollectionAllowed({ source, mode, scope, purpose: PERSONA_PURPOSE, env });
}

/** Variante sans exception : `{ allowed: false, code, error, details }` en cas de refus. */
export function evaluatePersonaCollection({ source, mode, scope, env = process.env } = {}) {
  return evaluateCollection({ source, mode, scope, purpose: PERSONA_PURPOSE, env });
}

/** Corps de réponse 403 d'un refus de politique (aucun secret, aucune donnée collectée). */
export function policyRefusalBody(refusal) {
  const details = refusal?.details || {};
  return {
    error: refusal?.error || refusal?.message || 'collecte refusée par la politique de collecte',
    code: refusal?.code || 'collection_refused',
    source: details.source ?? null,
    mode: details.mode ?? null,
    scope: details.scope ?? null,
    purpose: PERSONA_PURPOSE,
    policy_version: SOURCE_POLICY_VERSION,
  };
}

/** Provenance à recopier sur l'élément collecté. */
export function collectionProvenance(decision, collectedAt = new Date().toISOString()) {
  return {
    source: decision.source, mode: decision.mode, scope: decision.scope ?? null,
    collected_at: collectedAt, terms_version: decision.termsVersion, policy_version: decision.policyVersion,
  };
}

/** Provenance normalisée (persistée) : champs connus seulement, chaînes bornées. */
export function normalizeProvenance(input) {
  if (!input || typeof input !== 'object' || !input.source || !input.mode) return null;
  const str = (v, n = 80) => (v == null || v === '' ? null : String(v).slice(0, n));
  return {
    source: str(input.source, 40), mode: str(input.mode, 40), scope: str(input.scope, 40),
    collected_at: str(input.collected_at, 40), terms_version: str(input.terms_version), policy_version: str(input.policy_version, 40),
  };
}

// ------------------------------------------------------------ Imports de profil
/**
 * Source/mode/périmètre d'un import de profil (ProfileImportService) :
 * `profile_data` = export fourni ; sinon connecteur API.
 */
export function classifyProfileImport(item = {}) {
  const source = String(item.source || '').toLowerCase();
  if (item.profile_data) return { source, mode: 'import', scope: 'profile_data' };
  if (source === 'linkedin') return { source, mode: 'api', scope: 'profile' };
  if (source === 'crystalknows') return { source, mode: 'api', scope: 'profile' };
  return { source, mode: 'api', scope: null };
}

/** Vérifie une liste d'imports ; renvoie les décisions (lève au premier refus). */
export function assertProfileImportsAllowed(imports = [], { env = process.env } = {}) {
  return (imports || []).map((item) => assertPersonaCollection({ ...classifyProfileImport(item), env }));
}

// ------------------------------------------------------- URLs de sources publiques
const PLATFORM_HOSTS = [
  [/(^|\.)(x\.com|twitter\.com)$/i, 'x'],
  [/(^|\.)linkedin\.com$/i, 'linkedin'],
  [/(^|\.)(reddit\.com|redd\.it)$/i, 'reddit'],
  [/(^|\.)(discord\.com|discord\.gg|discordapp\.com)$/i, 'discord'],
  [/(^|\.)crystalknows\.com$/i, 'crystalknows'],
];
const GITHUB_HOST = /^(www\.)?github\.com$/i;
const GITHUB_RESERVED = new Set(['orgs', 'settings', 'search', 'topics', 'marketplace', 'explore', 'login', 'about', 'features', 'pricing', 'enterprise', 'sponsors', 'apps', 'site', 'contact']);
const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const GITHUB_REPO = /^[\w.-]{1,100}$/;

/** `github.com/<login>[/<repo>]` → { login, repo } ; null sinon. */
export function parseGitHubPersonaUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { return null; }
  if (!GITHUB_HOST.test(url.hostname)) return null;
  const [login, repo] = url.pathname.split('/').filter(Boolean);
  if (!login || GITHUB_RESERVED.has(login.toLowerCase()) || !GITHUB_LOGIN.test(login)) return null;
  if (repo && !GITHUB_REPO.test(repo)) return null;
  return { login, repo: repo ? repo.replace(/\.git$/i, '') : null };
}

/**
 * Classe une URL de `public_sources` : plateforme → sa propre entrée de la politique.
 * GitHub passe par l'API REST (jamais la page) ; CrystalKnows par la page publique ;
 * X, LinkedIn, Reddit, Discord : visite de page refusée ; le reste : page web publique.
 * Une URL illisible reste classée `web` (la validation SSRF existante la refuse ensuite).
 */
export function classifyPersonaUrl(value) {
  let host = '';
  try { host = new URL(String(value || '').trim()).hostname.toLowerCase(); } catch { /* validé plus loin */ }
  if (GITHUB_HOST.test(host)) {
    const gh = parseGitHubPersonaUrl(value);
    return gh ? { source: 'github', mode: 'api', scope: gh.repo ? 'readme' : 'profile', github: gh } : { source: 'github', mode: 'public_visit', scope: null };
  }
  for (const [re, source] of PLATFORM_HOSTS) {
    if (re.test(host)) return { source, mode: 'public_visit', scope: source === 'crystalknows' ? 'public_profile' : null };
  }
  return { source: 'web', mode: 'public_visit', scope: 'professional_page' };
}

/** Sépare les URLs autorisées et refusées (sans réseau). */
export function planPersonaUrls(urls = [], { env = process.env } = {}) {
  const allowed = []; const refused = [];
  for (const url of [...new Set((urls || []).map((u) => String(u || '').trim()).filter(Boolean))]) {
    const target = classifyPersonaUrl(url);
    const decision = evaluatePersonaCollection({ source: target.source, mode: target.mode, scope: target.scope, env });
    if (decision.allowed) allowed.push({ url, ...target, decision });
    else refused.push({ url, source: target.source, mode: target.mode, code: decision.code, error: decision.error });
  }
  return { allowed, refused };
}

function refusedRecord(r, now) {
  return { url: r.url, final_url: null, status: null, content_type: null, title: null, excerpt: null, sha256: null, bytes: 0, truncated: false,
    fetched_at: now().toISOString(), error: `politique de collecte : ${r.code} (${r.source}/${r.mode})${r.reason ? ` — ${r.reason}` : ''}`, policy_code: r.code,
    ...(r.robots ? { robots: r.robots } : {}) };
}

/**
 * robots.txt (RFC 9309) des URLs `public_visit` autorisées par la politique
 * (exigence `requiresRobotsCompliance`). `robots` = RobotsGuard (null : non vérifié).
 * Renvoie `{ allowed, refused }` ; un refus porte `code: 'robots_disallowed'` et sa trace.
 */
export async function checkPersonaRobots(urls = [], { robots = null, env = process.env } = {}) {
  const plan = planPersonaUrls(urls, { env });
  if (!robots) return plan;
  const allowed = []; const refused = [...plan.refused];
  for (const a of plan.allowed) {
    if (a.mode !== 'public_visit' || a.decision?.conditions?.requiresRobotsCompliance !== true) { allowed.push(a); continue; }
    const decision = await robots.check(a.url);
    if (decision.allowed) allowed.push({ ...a, robots: robotsTrace(decision) });
    else refused.push({ url: a.url, source: a.source, mode: a.mode, code: decision.code || 'robots_disallowed', error: decision.reason, reason: decision.reason, robots: robotsTrace(decision) });
  }
  return { allowed, refused };
}

// ---------------------------------------------------------------- GitHub (API REST)
const GITHUB_API = 'https://api.github.com';
const EXCERPT = 1200;

async function githubJson(fetchImpl, path, token, accept = 'application/vnd.github+json') {
  const headers = { accept, 'user-agent': 'KayrosLab-persona/1.0', 'x-github-api-version': '2022-11-28' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(`${GITHUB_API}${path}`, { method: 'GET', headers });
  const text = await res.text();
  if (!res.ok) { const err = new Error(`GitHub API HTTP ${res.status}`); err.status = res.status; throw err; }
  return { status: res.status, text, json: accept === 'application/vnd.github+json' && text ? JSON.parse(text) : null };
}

/**
 * Trace de « visite » d'une URL GitHub de persona par l'API REST officielle :
 * profil public, 5 dépôts publics récents, README du dépôt cité. Chaque appel est
 * vérifié par la politique (github/api, périmètres profile, repos, readme).
 */
export async function collectGitHubPersonaEvidence(url, { fetchImpl = globalThis.fetch, token = '', env = process.env, now = () => new Date() } = {}) {
  const gh = parseGitHubPersonaUrl(url);
  const fetchedAt = now().toISOString();
  const record = { url, final_url: null, status: null, content_type: 'application/json', title: null, excerpt: null, sha256: null, bytes: 0, truncated: false, fetched_at: fetchedAt, error: null };
  try {
    if (!gh) throw new SourcePolicyError('scope_not_allowed', 'GitHub : seules les URLs github.com/<compte>[/<dépôt>] sont lues (API).', { source: 'github', mode: 'api' });
    if (typeof fetchImpl !== 'function') throw new Error('GitHub : fetch indisponible');
    const login = encodeURIComponent(gh.login);
    const profileDecision = assertPersonaCollection({ source: 'github', mode: 'api', scope: 'profile', env });
    const user = await githubJson(fetchImpl, `/users/${login}`, token);
    const parts = []; const raw = [user.text];
    const u = user.json || {};
    record.title = [u.name || u.login || gh.login, u.company, u.location].filter(Boolean).join(' · ').slice(0, 300) || gh.login;
    if (u.bio) parts.push(String(u.bio));
    assertPersonaCollection({ source: 'github', mode: 'api', scope: 'repos', env });
    const repos = await githubJson(fetchImpl, `/users/${login}/repos?type=owner&sort=pushed&per_page=5`, token);
    raw.push(repos.text);
    const repoLines = (Array.isArray(repos.json) ? repos.json : []).filter((r) => r && !r.fork).slice(0, 5)
      .map((r) => `${r.name}${r.language ? ` (${r.language})` : ''}${r.description ? ` : ${r.description}` : ''}`);
    if (repoLines.length) parts.push(`Dépôts publics : ${repoLines.join(' ; ')}`);
    if (gh.repo) {
      assertPersonaCollection({ source: 'github', mode: 'api', scope: 'readme', env });
      const readme = await githubJson(fetchImpl, `/repos/${login}/${encodeURIComponent(gh.repo)}/readme`, token, 'application/vnd.github.raw+json');
      raw.push(readme.text);
      parts.push(`README ${gh.repo} : ${String(readme.text || '').replace(/\s+/g, ' ').trim()}`);
    }
    const body = raw.join('\n');
    record.status = user.status;
    record.final_url = `${GITHUB_API}/users/${login}`;
    record.bytes = Buffer.byteLength(body);
    record.sha256 = createHash('sha256').update(body).digest('hex');
    const excerpt = parts.join(' — ');
    record.truncated = excerpt.length > EXCERPT;
    record.excerpt = excerpt ? excerpt.slice(0, EXCERPT) : null;
    record.collection = collectionProvenance({ ...profileDecision, scope: gh.repo ? 'readme' : 'profile' }, fetchedAt);
    return record;
  } catch (error) {
    if (error instanceof SourcePolicyError) { record.policy_code = error.code; record.error = `politique de collecte : ${error.code}`; }
    else { record.status = Number.isInteger(error?.status) ? error.status : null; record.error = String(error?.message || error).slice(0, 300); }
    return record;
  }
}

/**
 * Visite les `public_sources` d'une persona sous la politique : URLs refusées → trace
 * d'erreur avec `policy_code` (rien n'est demandé) ; GitHub → API ; pages autorisées →
 * `visit(urls)` (core/public-sources.mjs ou visiteur injecté). Ordre d'entrée conservé.
 */
export async function visitPersonaUrls(urls = [], { visit, env = process.env, githubFetch = globalThis.fetch, githubToken = '', now = () => new Date(), robots = null } = {}) {
  const { allowed, refused } = await checkPersonaRobots(urls, { env, robots });
  const byUrl = new Map();
  for (const r of refused) byUrl.set(r.url, refusedRecord(r, now));
  const pages = allowed.filter((a) => a.mode === 'public_visit');
  if (pages.length && typeof visit === 'function') {
    const records = await visit(pages.map((p) => p.url));
    for (const rec of records || []) {
      const plan = pages.find((p) => p.url === rec?.url) || pages.find((p) => { try { return new URL(p.url).href === rec?.url; } catch { return false; } });
      byUrl.set(plan?.url || rec.url, plan ? { ...rec, collection: collectionProvenance(plan.decision, rec.fetched_at || now().toISOString()) } : rec);
    }
  }
  for (const a of allowed.filter((x) => x.source === 'github' && x.mode === 'api')) {
    byUrl.set(a.url, await collectGitHubPersonaEvidence(a.url, { fetchImpl: githubFetch, token: githubToken, env, now }));
  }
  const order = [...new Set((urls || []).map((u) => String(u || '').trim()).filter(Boolean))];
  return order.map((u) => byUrl.get(u)).filter(Boolean);
}

// ------------------------------------------------------- Provenance des profils
const PROFILE_SOURCE_MAP = {
  linkedin: (mode) => (['official_api'].includes(mode) ? { source: 'linkedin', mode: 'api', scope: 'profile' } : { source: 'linkedin', mode: 'import', scope: mode === 'reference_only' ? 'reference_url' : mode === 'data_export' ? 'data_export' : 'profile_data' }),
  crystalknows: (mode) => (mode === 'official_api' ? { source: 'crystalknows', mode: 'api', scope: 'profile' }
    : mode === 'public_profile_page' ? { source: 'crystalknows', mode: 'public_visit', scope: 'public_profile' }
      : { source: 'crystalknows', mode: 'import', scope: mode === 'json_export' ? 'json_export' : 'profile_data' }),
  email: () => ({ source: 'user_text', mode: 'import', scope: 'emails' }),
  x: () => ({ source: 'x', mode: 'api', scope: 'posts' }),
  manual: (mode) => ({ source: 'manual', mode: 'import', scope: mode === 'disc_type' ? 'disc_type' : 'manual_profile' }),
  public: () => ({ source: 'web', mode: 'public_visit', scope: 'professional_page' }),
};

/**
 * Provenance d'une entrée `human_profile.profile_sources` : celle enregistrée à la
 * collecte (`collected_via`) si présente, sinon déduite du type et du mode d'import
 * (`inferred: true`, version des conditions actuelle).
 */
export function provenanceOfProfileSource(s = {}) {
  const stored = Array.isArray(s.collected_via) ? s.collected_via.map(normalizeProvenance).filter(Boolean) : [];
  if (stored.length) return stored;
  const map = PROFILE_SOURCE_MAP[String(s.source || '').toLowerCase()];
  if (!map) return [];
  const target = map(String(s.import_mode || ''));
  let policy;
  try { policy = getSourcePolicy(target.source); } catch { return []; }
  return [{ ...target, collected_at: s.imported_at || null, terms_version: termsVersionOf(policy), policy_version: SOURCE_POLICY_VERSION, inferred: true }];
}
