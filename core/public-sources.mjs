// KayrosLab — Base de données publiques d'une persona : enregistrement et visite des URLs.
//
// Chaque URL de `public_sources` est visitée côté serveur, avec une protection SSRF :
//  - http(s) uniquement, ports 80/443 (ou port explicite non privilégié refusé hors liste) ;
//  - refus de localhost, des IP privées, loopback, link-local, CGNAT, multicast, ULA IPv6 —
//    vérifié sur l'IP littérale ET sur chaque adresse résolue par DNS, à chaque redirection ;
//  - redirections suivies manuellement (max 3), délai max, taille max lue (troncature) ;
//  - aucun cookie ni jeton envoyé.
// Chaque visite produit une trace : statut HTTP, titre, extrait texte, date, empreinte SHA-256.
// Les extraits n'alimentent la persona que par le pipeline existant (profile-enrichment →
// normalizeImpersonator → impersonatorContext → harness) : rien n'est injecté en contournement.

import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const PUBLIC_SOURCE_LIMITS = Object.freeze({ timeoutMs: 8000, maxBytes: 512 * 1024, maxRedirects: 3, excerptChars: 1200, maxSources: 30, domainFailureThreshold: 2 });
const BLOCKED_HOSTS = /^(localhost|localhost\.localdomain|ip6-localhost|ip6-loopback|metadata\.google\.internal)$|\.(localhost|local|internal|lan|home|corp)$/i;

function ipv4ToInt(ip) { return ip.split('.').reduce((acc, p) => (acc * 256) + Number(p), 0); }
function inV4(ip, cidr) { const [base, bits] = cidr.split('/'); const mask = bits === '0' ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0; return ((ipv4ToInt(ip) & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0); }
const PRIVATE_V4 = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'];

/** Vrai si l'adresse IP (v4 ou v6) n'est pas routable publiquement. */
export function isPrivateAddress(address) {
  const ip = String(address || '').replace(/^\[|\]$/g, '').toLowerCase();
  const kind = isIP(ip);
  if (kind === 4) return PRIVATE_V4.some((c) => inV4(ip, c));
  if (kind === 6) {
    if (ip === '::' || ip === '::1') return true;
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(ip) || ip.startsWith('2001:db8') || ip.startsWith('64:ff9b');
  }
  return true; // non IP : traité comme non sûr
}

/** Valide une URL publique (syntaxe + hôte) ; renvoie l'objet URL normalisé. */
export function assertPublicUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error(`source publique : URL invalide (${value})`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`source publique : http(s) uniquement (${url.protocol})`);
  if (url.username || url.password) throw new Error('source publique : identifiants dans l\'URL interdits');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error(`source publique : port ${url.port} refusé`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || BLOCKED_HOSTS.test(host)) throw new Error(`source publique : hôte refusé (${host})`);
  if (isIP(host) && isPrivateAddress(host)) throw new Error(`source publique : adresse privée refusée (${host})`);
  url.hash = '';
  return url;
}

/** Résout l'hôte et refuse si UNE des adresses est privée (anti DNS-rebinding basique). */
export async function assertPublicHost(url, { lookup = dnsLookup } = {}) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return [host];
  const records = await lookup(host, { all: true, verbatim: true });
  const addresses = (Array.isArray(records) ? records : [records]).map((r) => (typeof r === 'string' ? r : r.address));
  if (!addresses.length) throw new Error(`source publique : hôte introuvable (${host})`);
  const bad = addresses.find(isPrivateAddress);
  if (bad) throw new Error(`source publique : ${host} résout vers une adresse privée (${bad})`);
  return addresses;
}

function decodeEntities(text) {
  return text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) % 0x110000));
}
/** Titre + texte lisible d'une page HTML (ou texte brut). */
export function extractPageText(body, contentType = '') {
  const raw = String(body || '');
  if (!/html|xml/i.test(contentType) && !/<html|<body|<title/i.test(raw)) {
    return { title: null, text: raw.replace(/\s+/g, ' ').trim() };
  }
  const title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || raw.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] || '').trim();
  const description = raw.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] || '';
  const text = raw.replace(/<(head|script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return { title: decodeEntities(title).replace(/\s+/g, ' ').trim() || null, text: decodeEntities(`${description} ${text}`).replace(/\s+/g, ' ').trim() };
}

async function readLimited(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const t = await res.text(); const buf = Buffer.from(t);
    return { buffer: buf.subarray(0, maxBytes), truncated: buf.length > maxBytes };
  }
  const reader = res.body.getReader(); const chunks = []; let size = 0; let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    if (size + chunk.length > maxBytes) { chunks.push(chunk.subarray(0, maxBytes - size)); size = maxBytes; truncated = true; await reader.cancel().catch(() => {}); break; }
    chunks.push(chunk); size += chunk.length;
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

/** Visite une URL publique et renvoie sa trace (jamais d'exception : `error` renseigné). */
export async function visitPublicSource(value, { fetchImpl = globalThis.fetch, lookup = dnsLookup, limits = {}, now = () => new Date() } = {}) {
  const L = { ...PUBLIC_SOURCE_LIMITS, ...limits };
  const record = { url: String(value || '').trim(), final_url: null, status: null, content_type: null, title: null, excerpt: null, sha256: null, bytes: 0, truncated: false, fetched_at: now().toISOString(), error: null };
  try {
    let url = assertPublicUrl(record.url);
    record.url = url.href;
    if (typeof fetchImpl !== 'function') throw new Error('source publique : fetch indisponible');
    for (let hop = 0; ; hop += 1) {
      await assertPublicHost(url, { lookup });
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), L.timeoutMs);
      let res;
      try {
        res = await fetchImpl(url.href, { method: 'GET', redirect: 'manual', signal: ctrl.signal, credentials: 'omit', headers: { 'user-agent': 'KayrosLab-public-persona/1.0 (+public data only)', accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' } });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          if (hop >= L.maxRedirects) throw new Error('source publique : trop de redirections');
          url = assertPublicUrl(new URL(res.headers.get('location'), url).href);
          continue;
        }
        record.status = res.status;
        record.final_url = url.href;
        record.content_type = res.headers.get('content-type') || null;
        const { buffer, truncated } = await readLimited(res, L.maxBytes);
        record.bytes = buffer.length; record.truncated = truncated;
        record.sha256 = createHash('sha256').update(buffer).digest('hex');
        if (!res.ok) { record.error = `HTTP ${res.status}`; return record; }
        const { title, text } = extractPageText(buffer.toString('utf8'), record.content_type || '');
        record.title = title ? title.slice(0, 300) : null;
        record.excerpt = text ? text.slice(0, L.excerptChars) : null;
        return record;
      } finally { clearTimeout(timer); }
    }
  } catch (error) {
    record.error = error?.name === 'AbortError' ? 'source publique : délai dépassé' : String(error?.message || error);
    return record;
  }
}

/** Échec imputable au domaine (réseau, délai, refus d'accès, saturation, erreur serveur) — pas une URL refusée par la politique. */
function isDomainFailure(record) {
  if (!record?.error) return false;
  if (Number.isInteger(record.status)) return [401, 403, 407, 429].includes(record.status) || record.status >= 500;
  return !/^source publique : (URL invalide|http\(s\)|identifiants|port|hôte refusé|adresse privée|trop de redirections)/.test(record.error);
}
function domainOf(value) {
  try { return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '') || null; } catch { return null; }
}

/**
 * Disjoncteur par domaine, limité à UNE visite de liste : après `threshold` échecs consécutifs
 * sur un domaine, ses URLs restantes ne sont plus demandées et leur trace l'indique (`skipped`).
 * Un succès remet le compteur à zéro. Rien n'est mémorisé d'une visite à l'autre.
 */
export class DomainBreaker {
  constructor(threshold = PUBLIC_SOURCE_LIMITS.domainFailureThreshold) { this.threshold = Math.max(1, Number(threshold) || 1); this.failures = new Map(); }
  isOpen(domain) { return Boolean(domain) && (this.failures.get(domain) || 0) >= this.threshold; }
  record(domain, failed) { if (domain) this.failures.set(domain, failed ? (this.failures.get(domain) || 0) + 1 : 0); }
}

/** Visite séquentiellement une liste d'URLs (dédoublonnées, plafonnées), avec disjoncteur par domaine. */
export async function visitPublicSources(urls = [], options = {}) {
  const list = [...new Set((urls || []).map((u) => String(u || '').trim()).filter(Boolean))].slice(0, PUBLIC_SOURCE_LIMITS.maxSources);
  const breaker = new DomainBreaker(options.limits?.domainFailureThreshold ?? PUBLIC_SOURCE_LIMITS.domainFailureThreshold);
  const now = options.now || (() => new Date());
  const out = [];
  for (const url of list) {
    const domain = domainOf(url);
    if (breaker.isOpen(domain)) {
      out.push({ url, final_url: null, status: null, content_type: null, title: null, excerpt: null, sha256: null, bytes: 0, truncated: false,
        fetched_at: now().toISOString(), skipped: true,
        error: `source publique : domaine ${domain} fermé pour cette visite (${breaker.threshold} échecs consécutifs), non demandé` });
      continue;
    }
    const record = await visitPublicSource(url, options);
    breaker.record(domain, isDomainFailure(record));
    out.push(record);
  }
  return out;
}

/** Trace compacte persistée dans metadata.impersonator.public_evidence. */
export function normalizePublicEvidence(input = []) {
  return (Array.isArray(input) ? input : []).filter((r) => r && typeof r === 'object' && r.url).slice(0, PUBLIC_SOURCE_LIMITS.maxSources).map((r) => ({
    url: String(r.url), final_url: r.final_url ? String(r.final_url) : null,
    status: Number.isInteger(r.status) ? r.status : null, content_type: r.content_type ? String(r.content_type).slice(0, 120) : null,
    title: r.title ? String(r.title).slice(0, 300) : null, excerpt: r.excerpt ? String(r.excerpt).slice(0, PUBLIC_SOURCE_LIMITS.excerptChars) : null,
    sha256: /^[a-f0-9]{64}$/.test(String(r.sha256 || '')) ? r.sha256 : null, bytes: Number(r.bytes) || 0, truncated: r.truncated === true,
    fetched_at: r.fetched_at ? String(r.fetched_at) : null, error: r.error ? String(r.error).slice(0, 300) : null,
    ...(r.skipped === true ? { skipped: true } : {}),
  }));
}
