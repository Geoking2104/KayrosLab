// KayrosLab — enrichissement d'un profil impersonator à partir de sources autorisées.
//
// Objectif : reconstruire une fiche comparable à une page publique CrystalKnows
// (DISC, archétype, qualités, sections « comment communiquer avec… ») en combinant :
//   1. la page publique CrystalKnows `https://www.crystalknows.com/p/<slug>` (lecture seule, sans session) ;
//   2. l'export officiel LinkedIn « Obtenir une copie de vos données » (Profile.csv, Positions.csv, Skills.csv) ;
//   3. des e-mails écrits par la personne, fournis par l'opérateur (aucun accès à une boîte mail) ;
//   4. des posts X via l'API officielle v2 (jeton serveur) ou l'archive X fournie (tweets.js).
//
// Limites volontaires : pas de scraping LinkedIn ni de x.com, pas de contournement
// d'authentification, pas d'API CrystalKnows inventée. Le DISC estimé à partir du style
// d'écriture est un indice marqué comme tel, jamais une mesure.
import { canonicalDisc, discArchetype, descriptifFromDisc, normalizeDescriptif } from './personality-descriptif.mjs';
import { mergeHumanProfiles, normalizeHumanProfile } from './personality.mjs';

const now = () => new Date().toISOString();
const uniq = (items, max = 12) => [...new Set((items || []).map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, max);
const texts = (list) => (Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? x : x?.text)).filter(Boolean) : []);

// ---------------------------------------------------------------- CrystalKnows (page publique)

export const CRYSTAL_PUBLIC_HOST = 'www.crystalknows.com';

/** Valide une URL ou un slug de page publique et renvoie `{ slug, url }`. */
export function crystalPublicUrl(value) {
  const raw = String(value || '').trim().replace(/^\[[^\]]*\]\((.+)\)$/, '$1');
  if (/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(raw)) return { slug: raw, url: `https://${CRYSTAL_PUBLIC_HOST}/p/${raw}` };
  let url;
  try { url = new URL(raw); } catch { throw new Error('crystalknows: URL de page publique invalide'); }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const m = url.pathname.match(/^\/p\/([a-z0-9][a-z0-9._-]{0,80})\/?$/i);
  if (url.protocol !== 'https:' || host !== 'crystalknows.com' || !m) {
    throw new Error('crystalknows: seule une page publique https://www.crystalknows.com/p/<profil> est acceptée');
  }
  return { slug: m[1], url: `https://${CRYSTAL_PUBLIC_HOST}/p/${m[1]}` };
}

function rscPayload(html) {
  const out = [];
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m;
  while ((m = re.exec(html))) { try { out.push(JSON.parse(`"${m[1]}"`)); } catch { /* fragment illisible ignoré */ } }
  return out.join('');
}

function objectAt(text, start) {
  let depth = 0, inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** Extrait l'objet `profile` d'une page publique CrystalKnows (HTML Next.js ou JSON déjà extrait). */
export function parseCrystalPublicPage(input) {
  if (input && typeof input === 'object') return input.profile || input;
  const html = String(input || '');
  const payload = rscPayload(html) || html;
  for (const source of [payload, html]) {
    let idx = source.indexOf('"profile":{');
    while (idx !== -1) {
      const json = objectAt(source, idx + 10);
      try {
        const obj = json && JSON.parse(json);
        if (obj && (obj.discType || obj.content)) return obj;
      } catch { /* objet suivant */ }
      idx = source.indexOf('"profile":{', idx + 10);
    }
  }
  throw new Error('crystalknows: aucun profil public trouvé dans la page (profil privé ou format modifié)');
}

const CRYSTAL_PUBLIC_SECTIONS = {
  working_together: ['behavior'], energizers: ['energizers'], motivation: ['energizers'], drainers: ['drainers'],
  strengths: ['strengths'], blindspots: ['blindSpots'], building_trust: ['buildingTrust'],
  communication: ['firstImpression'], meetings: ['productDemo'], proposal: ['productDemo', 'pricing'],
  negotiating: ['negotiation', 'pricing'], driving_action: ['driveToAction'], following_up: ['followingUp'],
  emails: ['writingStyle'],
};

/** Convertit un profil public CrystalKnows en human_profile Kayros (DISC, sections, provenance). */
export function profileFromCrystalPublic(input, { imported_by = null, source_url = null } = {}) {
  const pub = parseCrystalPublicPage(input);
  const content = pub.content || {};
  const type = canonicalDisc(pub.discType) || null;
  const template = type ? descriptifFromDisc(type) : null;
  const sections = {};
  for (const [id, keys] of Object.entries(CRYSTAL_PUBLIC_SECTIONS)) {
    const items = uniq(keys.flatMap((k) => texts(content[k])), 10);
    sections[id] = items.length ? items : template?.sections?.[id] || [];
  }
  for (const id of ['do', 'dont']) if (template?.sections?.[id]) sections[id] = template.sections[id];
  const overview = uniq([content.personalityOverview?.text, content.behaviorOverview?.text], 2).join(' ');
  const qualities = uniq(texts(content.personalQualities), 6);
  const name = pub.name || pub.shortName || null;
  const url = source_url || (pub.slug ? `https://${CRYSTAL_PUBLIC_HOST}/p/${pub.slug}` : null);
  const descriptif = normalizeDescriptif({
    disc_type: type, archetype: pub.discArchetype || discArchetype(type) || '',
    disc_intensity: pub.discIntensity ?? null, disc_degrees: pub.discDegrees ?? null,
    overview: overview || template?.overview || '', qualities,
    // La page publique ne publie pas de scores : traits dérivés du modèle DISC.
    traits: template?.traits || {}, sections, source: 'crystalknows_public',
  });
  return normalizeHumanProfile({
    assigned_name: name, avatar_url: pub.photoUrl || null, crystalknows_report_url: url,
    disc_type: type, behavioral_archetype: descriptif?.archetype || null, disc_intensity: pub.discIntensity ?? null,
    behavioral_traits: template?.traits || null, descriptif,
    core_motivators: uniq(texts(content.energizers), 8),
    profile_summary: uniq([content.personalityOverview?.text, content.behaviorOverview?.text]),
    professional_context: { current_role: pub.jobTitle || null, company: pub.companyName || null, qualities },
    communication_style: {
      communication_directives: uniq(texts(content.writingStyle), 10),
      decision_triggers: uniq(texts(content.driveToAction), 10),
      stress_triggers: uniq(texts(content.drainers), 10),
      objection_patterns: uniq(texts(content.negotiation), 10),
    },
    profile_sources: [{
      source: 'crystalknows', source_url: url, import_mode: 'public_profile_page', imported_by,
      fields: ['disc_type', 'archetype', 'qualities', 'sections'], consent_confirmed: true,
      external_profile_id: pub.slug || pub.id || null, verified: typeof pub.isVerified === 'boolean' ? pub.isVerified : null,
    }],
    consent_confirmed: true,
  });
}

/**
 * Lecture d'une page publique CrystalKnows. Une seule URL autorisée (`/p/<slug>`),
 * requête anonyme identifiée, aucun cookie ni jeton : un profil privé renvoie une erreur.
 */
export class CrystalPublicProfileFetcher {
  constructor({ fetchImpl = globalThis.fetch, userAgent = 'KayrosLab-profile-import/1.0 (+consented persona import)', timeoutMs = 10000 } = {}) {
    this.fetchImpl = fetchImpl; this.userAgent = userAgent; this.timeoutMs = timeoutMs;
  }
  async fetch(value) {
    const { url } = crystalPublicUrl(value);
    if (typeof this.fetchImpl !== 'function') throw new Error('crystalknows: fetch indisponible');
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
    try {
      const res = await this.fetchImpl(url, { headers: { 'user-agent': this.userAgent, accept: 'text/html' }, redirect: 'follow', signal: ctrl?.signal });
      if (!res.ok) throw new Error(`crystalknows: page publique indisponible (HTTP ${res.status})`);
      return { url, html: await res.text() };
    } finally { if (timer) clearTimeout(timer); }
  }
}

// ---------------------------------------------------------------- LinkedIn (export officiel)

/** Parseur CSV minimal (guillemets, virgules et retours à la ligne échappés). */
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter((r) => r.some((x) => x.trim()));
  // LinkedIn préfixe parfois des notes avant l'en-tête : on prend la première ligne à plusieurs colonnes.
  if (!clean.length) return [];
  const width = Math.max(...clean.map((r) => r.length));
  const start = Math.max(0, clean.findIndex((r) => r.length === width));
  const head = clean[start].map((h) => h.trim());
  return clean.slice(start + 1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function fileByName(files, name) {
  const entry = Object.entries(files || {}).find(([k]) => k.toLowerCase().replace(/^.*\//, '') === name.toLowerCase());
  return entry ? entry[1] : '';
}

/** human_profile depuis l'export de données LinkedIn (fichiers CSV fournis par la personne). */
export function profileFromLinkedInExport(files = {}, { imported_by = null } = {}) {
  const profile = parseCsv(fileByName(files, 'Profile.csv'))[0] || {};
  const positions = parseCsv(fileByName(files, 'Positions.csv'));
  const skills = parseCsv(fileByName(files, 'Skills.csv')).map((r) => r.Name || r.Skill).filter(Boolean);
  const current = positions.find((p) => !p['Finished On']) || positions[0] || {};
  const name = [profile['First Name'], profile['Last Name']].filter(Boolean).join(' ') || null;
  if (!name && !positions.length && !skills.length) throw new Error('linkedin: export vide (Profile.csv, Positions.csv ou Skills.csv attendus)');
  const history = positions.slice(0, 5).map((p) => [p.Title, p['Company Name']].filter(Boolean).join(' — ')).filter(Boolean);
  return normalizeHumanProfile({
    assigned_name: name,
    profile_summary: uniq([profile.Summary, history.length ? `Parcours : ${history.join(' ; ')}` : null]),
    professional_context: {
      headline: profile.Headline || null, current_role: current.Title || null, company: current['Company Name'] || null,
      location: profile['Geo Location'] || profile.Location || null, skills: uniq(skills, 50),
    },
    profile_sources: [{ source: 'linkedin', import_mode: 'data_export', imported_by, fields: ['identity', 'positions', 'skills'], consent_confirmed: true }],
    consent_confirmed: true,
  });
}

// ---------------------------------------------------------------- Style d'écriture (e-mails, X)

const GREETING = /^(bonjour|salut|hello|hi|hey|cher|chère|dear|coucou)\b/i;
const IMPERATIVE = /^(merci de|peux-tu|pouvez-vous|envoie|envoyez|fais|faites|go|let'?s|please|can you|send|check|regarde|valide|validez|on part|on y va)\b/i;
const HEDGE = /\b(peut-être|éventuellement|je pense|il me semble|si possible|perhaps|maybe|i think|might|could you possibly)\b/i;
const WARM = /(merci|thanks|bravo|super|génial|top|great|awesome|😊|🙂|🙏|👍|🚀)/i;

/** Retire citations, historique de réponse et signature d'un e-mail. */
export function cleanEmailBody(body) {
  const lines = String(body || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/^(le .+ a écrit|on .+ wrote)\s*:?\s*$/i.test(line.trim())) break;
    if (/^-{2,}\s*(original|message)|^-- ?$|^envoyé de mon|^sent from my/i.test(line.trim())) break;
    if (/^(de|from)\s*:.+@/i.test(line.trim())) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

/** Indicateurs de style sur un corpus de textes écrits par la personne. */
export function analyseWritingStyle(input = []) {
  const list = input.map((x) => String(x || '').trim()).filter(Boolean);
  const sentences = list.flatMap((t) => t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 1));
  const words = (s) => s.split(/\s+/).filter(Boolean).length;
  const n = Math.max(1, sentences.length), m = Math.max(1, list.length);
  const ratio = (fn) => Math.round((sentences.filter(fn).length / n) * 100) / 100;
  const msgRatio = (fn) => Math.round((list.filter(fn).length / m) * 100) / 100;
  return {
    samples: list.length,
    sentences: sentences.length,
    avg_sentence_words: sentences.length ? Math.round((sentences.reduce((a, s) => a + words(s), 0) / n) * 10) / 10 : 0,
    avg_message_words: list.length ? Math.round(list.reduce((a, t) => a + words(t), 0) / m) : 0,
    question_ratio: ratio((s) => s.endsWith('?')),
    exclamation_ratio: ratio((s) => s.endsWith('!')),
    imperative_ratio: ratio((s) => IMPERATIVE.test(s)),
    hedge_ratio: ratio((s) => HEDGE.test(s)),
    warmth_ratio: ratio((s) => WARM.test(s)),
    bullet_ratio: msgRatio((t) => /^\s*([-*•]|\d+[.)])\s/m.test(t)),
    greeting_ratio: msgRatio((t) => GREETING.test(t)),
  };
}

/**
 * DISC estimé depuis le style. Heuristique simple et explicable : à n'utiliser
 * qu'en l'absence de fiche CrystalKnows, avec la confiance renvoyée.
 */
export function estimateDiscFromStyle(style) {
  if (!style || style.samples < 3) return null;
  const short = style.avg_sentence_words <= 12 ? 1 : style.avg_sentence_words <= 18 ? 0.5 : 0;
  const scores = {
    D: short + style.imperative_ratio * 2 + (1 - style.hedge_ratio) * 0.5 - style.greeting_ratio * 0.3,
    I: style.exclamation_ratio * 2 + style.warmth_ratio * 2 + style.greeting_ratio * 0.5,
    S: style.hedge_ratio * 2 + style.greeting_ratio * 0.8 + style.warmth_ratio * 0.5,
    C: style.bullet_ratio * 1.5 + (style.avg_sentence_words > 18 ? 1 : 0) + style.question_ratio,
  };
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  const type = second[1] >= first[1] * 0.75 ? `${first[0]}${second[0].toLowerCase()}` : first[0];
  const confidence = Math.min(0.6, Math.round((0.15 + Math.min(style.samples, 40) / 100) * 100) / 100);
  return { disc_type: canonicalDisc(type) || first[0], confidence, method: 'writing_style_heuristic', scores };
}

function styleDirectives(style) {
  if (!style?.samples) return [];
  const out = [];
  out.push(style.avg_sentence_words <= 12 ? 'Écrit court : phrases de moins de 12 mots en moyenne' : style.avg_sentence_words > 20 ? 'Écrit long et détaillé' : 'Phrases de longueur moyenne');
  if (style.avg_message_words) out.push(`Messages d’environ ${style.avg_message_words} mots`);
  if (style.imperative_ratio >= 0.15) out.push('Formule des demandes directes');
  if (style.hedge_ratio >= 0.15) out.push('Nuance volontiers ses propos');
  if (style.bullet_ratio >= 0.3) out.push('Structure en listes à puces');
  if (style.question_ratio >= 0.2) out.push('Pose beaucoup de questions');
  if (style.exclamation_ratio >= 0.15 || style.warmth_ratio >= 0.2) out.push('Ton chaleureux et expressif');
  if (style.greeting_ratio < 0.3) out.push('Va droit au but, peu de formules d’ouverture');
  return out;
}

function styleProfile(source, corpus, style, { imported_by, source_url = null, fields }) {
  const estimate = estimateDiscFromStyle(style);
  return normalizeHumanProfile({
    communication_style: {
      tone: style.exclamation_ratio >= 0.15 || style.warmth_ratio >= 0.2 ? 'chaleureux' : style.imperative_ratio >= 0.15 ? 'direct' : null,
      preferred_format: style.bullet_ratio >= 0.3 ? 'listes courtes' : style.avg_message_words && style.avg_message_words < 60 ? 'messages brefs' : null,
      communication_directives: styleDirectives(style),
    },
    profile_sources: [{ source, source_url, import_mode: source === 'x' ? 'official_api_or_archive' : 'operator_supplied', imported_by, fields, consent_confirmed: true }],
    consent_confirmed: true,
  });
}

/** Garde uniquement les messages écrits par la personne (champ `from`), puis analyse le style. */
export function profileFromEmails(messages = [], { author = null, imported_by = null } = {}) {
  const who = String(author || '').trim().toLowerCase();
  const own = (messages || []).filter((msg) => {
    if (typeof msg === 'string') return true;
    if (!who) return true;
    return String(msg?.from || '').toLowerCase().includes(who);
  });
  const corpus = own.map((msg) => cleanEmailBody(typeof msg === 'string' ? msg : msg.body || msg.text || '')).filter(Boolean).slice(0, 200);
  if (!corpus.length) throw new Error('email: aucun message écrit par la personne');
  const style = analyseWritingStyle(corpus);
  return { profile: styleProfile('email', corpus, style, { imported_by, fields: ['writing_style'] }), style, corpus };
}

/** Archive X officielle : `data/tweets.js` (`window.YTD.tweets.part0 = [...]`) ou tableau JSON. */
export function postsFromXArchive(input) {
  let data = input;
  if (typeof input === 'string') {
    const json = input.slice(input.indexOf('['));
    try { data = JSON.parse(json); } catch { throw new Error('x: archive tweets.js illisible'); }
  }
  return (Array.isArray(data) ? data : []).map((t) => t?.tweet || t).filter((t) => t && !t.retweeted && !String(t.full_text || t.text || '').startsWith('RT @'))
    .map((t) => String(t.full_text || t.text || '').replace(/https?:\/\/\S+/g, '').replace(/(^|\s)@\w+/g, ' ').trim()).filter(Boolean);
}

/** Profil X : posts récupérés via l'API officielle ou l'archive, plus la bio publique si fournie. */
export function profileFromXPosts(posts = [], { username = null, bio = null, name = null, imported_by = null } = {}) {
  const corpus = posts.map((p) => String(typeof p === 'string' ? p : p?.text || '').trim()).filter(Boolean).slice(0, 300);
  if (!corpus.length) throw new Error('x: aucun post exploitable');
  const style = analyseWritingStyle(corpus);
  const profile = mergeHumanProfiles(
    styleProfile('x', corpus, style, { imported_by, source_url: username ? `https://x.com/${username}` : null, fields: ['posts', 'writing_style'] }),
    normalizeHumanProfile({ assigned_name: name, profile_summary: bio ? [`Bio X : ${bio}`] : [], consent_confirmed: true }),
  );
  return { profile, style, corpus };
}

/** Client API X v2 officiel (jeton Bearer serveur `X_BEARER_TOKEN`). Aucun scraping de x.com. */
export class XProfileAdapter {
  constructor({ bearerToken = process.env.X_BEARER_TOKEN || '', fetchImpl = globalThis.fetch, baseUrl = 'https://api.x.com/2' } = {}) {
    this.bearerToken = bearerToken; this.fetchImpl = fetchImpl; this.baseUrl = baseUrl;
  }
  get configured() { return Boolean(this.bearerToken); }
  async get(path) {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { headers: { authorization: `Bearer ${this.bearerToken}` } });
    if (!res.ok) throw new Error(`x: API HTTP ${res.status}`);
    return res.json();
  }
  async fetchProfile(username, { max = 100 } = {}) {
    if (!this.configured) throw new Error('x: X_BEARER_TOKEN absent, utilisez l’archive X ou collez des posts');
    const handle = String(username || '').replace(/^@/, '').replace(/^https:\/\/(x|twitter)\.com\//i, '').split(/[/?#]/)[0];
    if (!/^\w{1,15}$/.test(handle)) throw new Error('x: identifiant invalide');
    const user = (await this.get(`/users/by/username/${handle}?user.fields=description,name`)).data;
    if (!user?.id) throw new Error('x: compte introuvable');
    const tweets = await this.get(`/users/${user.id}/tweets?max_results=${Math.min(100, Math.max(5, max))}&exclude=retweets,replies&tweet.fields=text`);
    return { username: handle, name: user.name, bio: user.description, posts: (tweets.data || []).map((t) => t.text) };
  }
}

// ---------------------------------------------------------------- Assemblage

/**
 * Fusionne les sources dans l'ordre LinkedIn → e-mails → X → CrystalKnows (la fiche
 * Crystal prime pour le DISC et les sections). Sans Crystal, un DISC estimé depuis le style
 * préremplit le descriptif, avec la confiance indiquée dans `evidence`.
 */
export function buildEnrichedProfile({ assigned_name = null, crystal = null, linkedin = null, email = null, x = null } = {}) {
  const evidence = [];
  const parts = [];
  if (linkedin) { parts.push(linkedin); evidence.push({ source: 'linkedin', mode: 'data_export', fields: linkedin.profile_sources?.[0]?.fields || [] }); }
  const corpus = [];
  if (email) { parts.push(email.profile); corpus.push(...email.corpus); evidence.push({ source: 'email', mode: 'operator_supplied', samples: email.style.samples }); }
  if (x) { parts.push(x.profile); corpus.push(...x.corpus); evidence.push({ source: 'x', mode: 'official_api_or_archive', samples: x.style.samples }); }
  const style = corpus.length ? analyseWritingStyle(corpus) : null;
  let estimate = null;
  if (crystal) {
    parts.push(crystal);
    evidence.push({ source: 'crystalknows', mode: 'public_profile_page', disc_type: crystal.disc_type || null, url: crystal.crystalknows_report_url || null });
  } else if (style) {
    estimate = estimateDiscFromStyle(style);
    if (estimate) {
      const d = descriptifFromDisc(estimate.disc_type);
      parts.push(normalizeHumanProfile({
        disc_type: estimate.disc_type, behavioral_archetype: d?.archetype || null, behavioral_traits: d?.traits || null,
        descriptif: d ? { ...d, source: 'enriched', confidence: estimate.confidence, overview: `${d.overview} (Estimation depuis le style d’écriture, confiance ${Math.round(estimate.confidence * 100)} %.)` } : null,
        consent_confirmed: true,
      }));
      evidence.push({ source: 'estimate', mode: estimate.method, disc_type: estimate.disc_type, confidence: estimate.confidence });
    }
  }
  if (!parts.length) throw new Error('enrichissement: aucune source exploitable');
  if (assigned_name) parts.push(normalizeHumanProfile({ assigned_name, consent_confirmed: true }));
  const profile = mergeHumanProfiles(...parts);
  // Les consignes d'écriture observées complètent la section « e-mails » du descriptif.
  if (style && profile.descriptif) {
    const observed = styleDirectives(style).map((s) => `Observé : ${s}`);
    profile.descriptif = normalizeDescriptif({ ...profile.descriptif, sections: { ...profile.descriptif.sections, emails: uniq([...(profile.descriptif.sections?.emails || []), ...observed], 12) } });
  }
  return { profile, evidence, style, estimate, generated_at: now() };
}

export const ENRICHMENT_LIMITS = Object.freeze([
  'LinkedIn : aucun scraping. Seul l’export officiel « Obtenir une copie de vos données » (CSV) ou l’API /v2/me de la personne connectée est lu.',
  'CrystalKnows : seule la page publique /p/<profil> est lue, sans session ni cookie. Un profil privé n’est pas récupérable ; utilisez alors l’export JSON ou l’API v4 avec jeton.',
  'E-mails : aucun accès à une boîte. Les messages sont collés ou fournis par l’opérateur ; seuls ceux écrits par la personne sont analysés.',
  'X : API officielle v2 avec X_BEARER_TOKEN, ou archive X fournie par la personne. x.com n’est pas scrapé.',
  'Le DISC estimé depuis le style est une heuristique (confiance ≤ 60 %), jamais une évaluation.',
]);
