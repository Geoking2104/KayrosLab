// KayrosLab — respect de robots.txt (RFC 9309) avant toute visite de page publique.
//
// - Jeton produit dédié « KayrosLabBot », puis le groupe « * » ; groupes d'un même
//   agent fusionnés ; règle la plus longue gagnante, égalité → Allow ; jokers * et $.
// - robots.txt : 2xx → règles ; 4xx (sauf 429) → tout autorisé ; 429, 5xx, erreur
//   réseau, délai dépassé, trop de redirections, hôte refusé → tout refusé (fail closed).
// - Mêmes protections SSRF que les pages (core/public-sources.mjs), délai court,
//   taille plafonnée (500 Kio, minimum RFC), cache par origine (24 h ; échecs 10 min).
// - Crawl-delay (non normalisé, courant) : délai minimal entre deux requêtes vers la
//   même origine ; au-delà de `maxCrawlDelayMs`, la visite est refusée (robots_crawl_delay).
//
// robots.txt compliance (RFC 9309) before visiting any public page.

import { lookup as dnsLookup } from 'node:dns/promises';

export const KAYROS_BOT_TOKEN = 'KayrosLabBot';
export const KAYROS_BOT_USER_AGENT = 'KayrosLabBot/1.0 (+https://www.kayroslab.com/)';
export const ROBOTS_LIMITS = Object.freeze({
  timeoutMs: 4000, maxBytes: 500 * 1024, maxRedirects: 5,
  ttlMs: 24 * 60 * 60 * 1000, errorTtlMs: 10 * 60 * 1000, maxCrawlDelayMs: 10_000, maxEntries: 500,
});

// ------------------------------------------------------------------ Parsing
/** Analyse un robots.txt : `{ groups: [{ agents, rules: [{ allow, path }], crawlDelay }] }`. */
export function parseRobotsTxt(text) {
  const groups = [];
  let current = null; let lastWasAgent = false;
  for (const rawLine of String(text || '').replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [], crawlDelay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue; // règle hors groupe : ignorée
    if (key === 'allow' || key === 'disallow') {
      if (key === 'disallow' && value === '') continue; // « Disallow: » vide = rien d'interdit
      if (value === '') continue;
      current.rules.push({ allow: key === 'allow', path: value });
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = Math.max(current.crawlDelay ?? 0, n);
    }
  }
  return { groups };
}

/** Groupe applicable : jeton produit (insensible à la casse), sinon « * » ; groupes fusionnés. */
export function selectRobotsGroup(parsed, token = KAYROS_BOT_TOKEN) {
  const t = String(token).toLowerCase();
  const agentToken = (a) => a.split('/')[0].trim();
  const pick = (pred) => {
    const matched = (parsed?.groups || []).filter((g) => g.agents.some(pred));
    if (!matched.length) return null;
    const delays = matched.map((g) => g.crawlDelay).filter((d) => d != null);
    return { agent: null, rules: matched.flatMap((g) => g.rules), crawlDelay: delays.length ? Math.max(...delays) : null };
  };
  const specific = pick((a) => agentToken(a) === t);
  if (specific) return { ...specific, agent: token };
  const star = pick((a) => a === '*');
  return star ? { ...star, agent: '*' } : null;
}

const UNRESERVED = /[A-Za-z0-9\-._~]/;
/** Normalise l'encodage pourcent (caractères non réservés décodés, hex en majuscules). */
function normalizePercent(value) {
  return String(value).replace(/%([0-9a-fA-F]{2})/g, (m, hex) => {
    const ch = String.fromCharCode(parseInt(hex, 16));
    return UNRESERVED.test(ch) ? ch : `%${hex.toUpperCase()}`;
  }).replace(/[^\x21-\x7e]/gu, (c) => encodeURIComponent(c));
}

function ruleRegex(path) {
  const p = normalizePercent(path);
  const anchored = p.endsWith('$');
  const body = (anchored ? p.slice(0, -1) : p).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Décision pour un chemin (`pathname + search`) : `{ allowed, rule }`. */
export function robotsAllows(parsed, pathAndQuery, token = KAYROS_BOT_TOKEN) {
  const path = normalizePercent(pathAndQuery || '/');
  if (path === '/robots.txt') return { allowed: true, rule: null, group: null, crawlDelay: null };
  const group = selectRobotsGroup(parsed, token);
  if (!group) return { allowed: true, rule: null, group: null, crawlDelay: null };
  let best = null;
  for (const rule of group.rules) {
    if (!ruleRegex(rule.path).test(path)) continue;
    const len = normalizePercent(rule.path).length;
    if (!best || len > best.len || (len === best.len && rule.allow && !best.rule.allow)) best = { len, rule };
  }
  return { allowed: best ? best.rule.allow : true, rule: best ? `${best.rule.allow ? 'Allow' : 'Disallow'}: ${best.rule.path}` : null, group: group.agent, crawlDelay: group.crawlDelay };
}

// ------------------------------------------------------------------ Fetch + cache
async function readCapped(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.text());
    return buf.subarray(0, maxBytes).toString('utf8');
  }
  const reader = res.body.getReader(); const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    if (size + chunk.length > maxBytes) { chunks.push(chunk.subarray(0, maxBytes - size)); await reader.cancel().catch(() => {}); break; }
    chunks.push(chunk); size += chunk.length;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Garde robots.txt partagée : cache par origine, Crawl-delay par origine.
 * `check(url)` → décision ; `acquire(url, decision)` → attend le Crawl-delay ou refuse.
 */
export class RobotsGuard {
  constructor({ fetchImpl = (...a) => globalThis.fetch(...a), lookup = dnsLookup, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), limits = {}, token = KAYROS_BOT_TOKEN, userAgent = KAYROS_BOT_USER_AGENT } = {}) {
    this.fetchImpl = fetchImpl; this.lookup = lookup; this.now = now; this.sleep = sleep;
    this.limits = { ...ROBOTS_LIMITS, ...limits }; this.token = token; this.userAgent = userAgent;
    this.cache = new Map(); this.lastRequest = new Map();
  }

  clear() { this.cache.clear(); this.lastRequest.clear(); }

  async fetchRobots(origin, { fetchImpl = this.fetchImpl, lookup = this.lookup } = {}) {
    // Import différé : public-sources importe ce module (pas de cycle au chargement).
    const { assertPublicUrl, assertPublicHost } = await import('./public-sources.mjs');
    const fetchedAt = new Date(this.now()).toISOString();
    let url;
    try {
      url = assertPublicUrl(`${origin}/robots.txt`);
      for (let hop = 0; ; hop += 1) {
        await assertPublicHost(url, { lookup });
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.limits.timeoutMs);
        try {
          const res = await fetchImpl(url.href, { method: 'GET', redirect: 'manual', signal: ctrl.signal, credentials: 'omit', headers: { 'user-agent': this.userAgent, accept: 'text/plain,*/*;q=0.5' } });
          if (res.status >= 300 && res.status < 400 && res.headers?.get?.('location')) {
            if (hop >= this.limits.maxRedirects) return { kind: 'unreachable', status: res.status, reason: 'trop de redirections', fetched_at: fetchedAt, robots_url: `${origin}/robots.txt` };
            url = assertPublicUrl(new URL(res.headers.get('location'), url).href);
            continue;
          }
          if (res.status >= 200 && res.status < 300) {
            const text = await Promise.race([readCapped(res, this.limits.maxBytes), new Promise((_, rej) => { ctrl.signal.addEventListener('abort', () => rej(Object.assign(new Error('timeout'), { name: 'AbortError' }))); })]);
            return { kind: 'rules', status: res.status, parsed: parseRobotsTxt(text), fetched_at: fetchedAt, robots_url: `${origin}/robots.txt` };
          }
          if (res.status >= 400 && res.status < 500 && res.status !== 429) return { kind: 'unavailable', status: res.status, fetched_at: fetchedAt, robots_url: `${origin}/robots.txt` };
          return { kind: 'unreachable', status: res.status, reason: `HTTP ${res.status}`, fetched_at: fetchedAt, robots_url: `${origin}/robots.txt` };
        } finally { clearTimeout(timer); }
      }
    } catch (error) {
      return { kind: 'unreachable', status: null, reason: error?.name === 'AbortError' ? 'délai dépassé' : String(error?.message || error).slice(0, 200), fetched_at: fetchedAt, robots_url: `${origin}/robots.txt` };
    }
  }

  /** Décision robots pour une URL (jamais d'exception). */
  async check(value, options = {}) {
    let url;
    try { url = new URL(String(value)); } catch { return { allowed: false, code: 'robots_disallowed', reason: 'URL invalide', status: null }; }
    const origin = url.origin;
    const nowMs = this.now();
    let entry = this.cache.get(origin);
    let cached = true;
    if (!entry || entry.expiresAt <= nowMs) {
      cached = false;
      const result = await this.fetchRobots(origin, options);
      entry = { result, expiresAt: nowMs + (result.kind === 'unreachable' ? this.limits.errorTtlMs : this.limits.ttlMs) };
      this.cache.set(origin, entry);
      if (this.cache.size > this.limits.maxEntries) this.cache.delete(this.cache.keys().next().value);
    }
    const r = entry.result;
    const base = { robots_url: r.robots_url, status: r.status, fetched_at: r.fetched_at, cached, user_agent: this.token };
    if (r.kind === 'unreachable') return { ...base, allowed: false, code: 'robots_disallowed', reason: `robots.txt injoignable (${r.reason}) : refus par défaut`, rule: null, crawl_delay_s: null };
    if (r.kind === 'unavailable') return { ...base, allowed: true, code: null, reason: `robots.txt absent (HTTP ${r.status})`, rule: null, crawl_delay_s: null };
    const d = robotsAllows(r.parsed, `${url.pathname}${url.search}`, this.token);
    return { ...base, allowed: d.allowed, code: d.allowed ? null : 'robots_disallowed', reason: d.allowed ? null : `robots.txt (${d.group}) : ${d.rule}`, rule: d.rule, group: d.group, crawl_delay_s: d.crawlDelay };
  }

  /** Respecte le Crawl-delay de l'origine : attend, ou refuse si l'attente dépasse le plafond. */
  async acquire(value, decision = {}) {
    let origin;
    try { origin = new URL(String(value)).origin; } catch { return { ok: false, code: 'robots_disallowed', waited_ms: 0 }; }
    const delayMs = Math.round((decision.crawl_delay_s || 0) * 1000);
    const last = this.lastRequest.get(origin);
    let waited = 0;
    if (delayMs > 0 && last != null) {
      const wait = last + delayMs - this.now();
      if (wait > this.limits.maxCrawlDelayMs) return { ok: false, code: 'robots_crawl_delay', waited_ms: 0, wait_ms: wait };
      if (wait > 0) { await this.sleep(wait); waited = wait; }
    }
    this.lastRequest.set(origin, this.now());
    return { ok: true, code: null, waited_ms: waited };
  }
}

/** Garde partagée par le processus (cache mémoire 24 h). */
export const defaultRobotsGuard = new RobotsGuard();

/** Trace robots compacte, persistée avec la visite. */
export function robotsTrace(decision) {
  if (!decision) return null;
  return {
    checked: true, allowed: decision.allowed === true, code: decision.code || null, robots_url: decision.robots_url || null,
    status: Number.isInteger(decision.status) ? decision.status : null, rule: decision.rule || null, group: decision.group || null,
    crawl_delay_s: decision.crawl_delay_s ?? null, fetched_at: decision.fetched_at || null, user_agent: decision.user_agent || KAYROS_BOT_TOKEN,
    reason: decision.reason ? String(decision.reason).slice(0, 300) : null,
  };
}
