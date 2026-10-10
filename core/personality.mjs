import { descriptifFromCrystal, descriptifFromDisc, normalizeDescriptif } from './personality-descriptif.mjs';
// KayrosLab — consent-aware stakeholder personality profiles.
// LinkedIn is identity/professional context only. Behavioral attributes come
// from explicit manual input or an authorized Crystal profile import.

export const PROFILE_SOURCES = Object.freeze(['linkedin', 'crystalknows', 'manual']);

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function now() { return new Date().toISOString(); }
function strings(value) {
  return Array.isArray(value) ? [...new Set(value.map((x) => String(x ?? '').trim()).filter(Boolean))] : [];
}
function compact(value) {
  if (Array.isArray(value)) return value.map(compact).filter((x) => x != null && x !== '');
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, compact(v)]).filter(([, v]) => v != null && v !== '' && (!Array.isArray(v) || v.length)));
}

/** Accept plain URLs and the Markdown-link form used by the supplied specs. */
export function unwrapProfileUrl(value) {
  const raw = String(value || '').trim();
  const markdown = raw.match(/^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/i);
  return markdown ? markdown[1] : raw;
}

export function normalizeProfileUrl(source, value) {
  if (!PROFILE_SOURCES.includes(source) || source === 'manual') throw new Error(`profile source URL invalide: ${source}`);
  const raw = unwrapProfileUrl(value);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${source}: URL de profil invalide`); }
  if (url.protocol !== 'https:') throw new Error(`${source}: HTTPS requis`);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (source === 'linkedin' && host !== 'linkedin.com') throw new Error('linkedin: domaine linkedin.com requis');
  if (source === 'crystalknows' && host !== 'crystalknows.com' && !host.endsWith('.crystalknows.com')) {
    throw new Error('crystalknows: domaine crystalknows.com requis');
  }
  if (source === 'linkedin') { url.hostname = 'www.linkedin.com'; url.search = ''; }
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

/** Traits comportementaux Crystal v4 (`personalities.behavioral_traits`), scores 0–100. */
export const BEHAVIORAL_TRAITS = Object.freeze(['dominance', 'expressiveness', 'leniency', 'pace', 'pragmatism', 'risk_aversion', 'skepticism', 'social']);
function boundedScore(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}
// L'API réelle renvoie des clés capitalisées (« Dominance », « Risk-Aversion ») ;
// le Swagger les documente en snake_case. Les deux formes sont acceptées.
function traitKey(key) { return String(key || '').trim().toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, ''); }
function normalizeBehavioralTraits(value) {
  if (!value || typeof value !== 'object') return null;
  const byKey = Object.fromEntries(Object.entries(value).map(([key, score]) => [traitKey(key), score]));
  const traits = Object.fromEntries(BEHAVIORAL_TRAITS.map((key) => [key, boundedScore(byKey[key])]).filter(([, v]) => v != null));
  return Object.keys(traits).length ? traits : null;
}

function normalizeCommunicationStyle(value = {}) {
  return compact({
    tone: String(value.tone || '').trim() || null,
    preferred_format: String(value.preferred_format || '').trim() || null,
    decision_triggers: strings(value.decision_triggers),
    stress_triggers: strings(value.stress_triggers),
    objection_patterns: strings(value.objection_patterns),
    communication_directives: strings(value.communication_directives),
  });
}

export function normalizeHumanProfile(input = {}) {
  const linkedin = input.linkedin_url ? normalizeProfileUrl('linkedin', input.linkedin_url) : null;
  const crystal = input.crystalknows_report_url ? normalizeProfileUrl('crystalknows', input.crystalknows_report_url) : null;
  const sources = Array.isArray(input.profile_sources) ? input.profile_sources.map((s) => {
    const source = String(s?.source || '').toLowerCase();
    if (!PROFILE_SOURCES.includes(source)) throw new Error(`profile source inconnue: ${source}`);
    const source_url = source === 'manual' || !s.source_url ? null : normalizeProfileUrl(source, s.source_url);
    return compact({
      source, source_url, import_mode: String(s.import_mode || 'authorized_export'),
      imported_at: s.imported_at || now(), imported_by: s.imported_by || null,
      fields: strings(s.fields), consent_confirmed: s.consent_confirmed === true,
      external_profile_id: s.external_profile_id ? String(s.external_profile_id) : null,
      verified: typeof s.verified === 'boolean' ? s.verified : null,
    });
  }) : [];
  return compact({
    assigned_name: String(input.assigned_name || '').trim() || null,
    avatar_url: String(input.avatar_url || '').trim() || null,
    linkedin_url: linkedin,
    crystalknows_report_url: crystal,
    disc_type: String(input.disc_type || '').trim() || null,
    enneagram_type: String(input.enneagram_type || '').trim() || null,
    myers_briggs_type: String(input.myers_briggs_type || '').trim() || null,
    behavioral_archetype: String(input.behavioral_archetype || '').trim() || null,
    disc_intensity: boundedScore(input.disc_intensity),
    behavioral_traits: normalizeBehavioralTraits(input.behavioral_traits),
    core_motivators: strings(input.core_motivators),
    skepticism_factor: String(input.skepticism_factor || '').trim() || null,
    profile_summary: strings(input.profile_summary),
    professional_context: compact({
      headline: String(input.professional_context?.headline || '').trim() || null,
      current_role: String(input.professional_context?.current_role || '').trim() || null,
      company: String(input.professional_context?.company || '').trim() || null,
      location: String(input.professional_context?.location || '').trim() || null,
      skills: strings(input.professional_context?.skills),
      qualities: strings(input.professional_context?.qualities),
    }),
    communication_style: normalizeCommunicationStyle(input.communication_style),
    descriptif: normalizeDescriptif(input.descriptif),
    profile_sources: sources,
    consent_confirmed: input.consent_confirmed === true || (sources.length > 0 && sources.every((s) => s.consent_confirmed === true)),
  });
}

export function mergeHumanProfiles(...profiles) {
  const normalized = profiles.filter(Boolean).map(normalizeHumanProfile);
  const merged = {};
  const arrayFields = ['core_motivators', 'profile_summary', 'profile_sources'];
  for (const p of normalized) {
    for (const [key, value] of Object.entries(p)) {
      if (arrayFields.includes(key)) merged[key] = [...(merged[key] || []), ...value];
      else if (key === 'communication_style' || key === 'professional_context') {
        merged[key] = { ...(merged[key] || {}), ...value };
        for (const [subkey, subvalue] of Object.entries(value || {})) {
          if (Array.isArray(subvalue)) merged[key][subkey] = [...new Set([...(merged[key][subkey] || []), ...subvalue])];
        }
      } else if (value != null && value !== '') merged[key] = value;
    }
  }
  if (merged.profile_sources) {
    const seen = new Set();
    merged.profile_sources = merged.profile_sources.filter((s) => {
      const key = `${s.source}:${s.source_url || ''}:${s.external_profile_id || ''}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    });
  }
  merged.consent_confirmed = normalized.length > 0 && normalized.every((p) => p.consent_confirmed === true);
  return normalizeHumanProfile(merged);
}

export function profileFromAgentOverride(patch = {}) {
  const explicit = patch.human_profile || {};
  const assigned_name = explicit.assigned_name || patch.assigned_human || null;
  const linkedin_url = explicit.linkedin_url || patch.linkedin_profile || patch.linkedin_url || null;
  const crystalknows_report_url = explicit.crystalknows_report_url || patch.crystalknows_url || patch.crystalknows_report_url || null;
  const disc_type = explicit.disc_type || patch.disc_type || null;
  if (!assigned_name && !linkedin_url && !crystalknows_report_url && !disc_type && !Object.keys(explicit).length) return null;
  const consent_confirmed = explicit.consent_confirmed === true || patch.consent_confirmed === true;
  const profile_sources = explicit.profile_sources || [
    linkedin_url ? { source: 'linkedin', source_url: linkedin_url, import_mode: 'reference_only', fields: ['linkedin_url'], consent_confirmed } : null,
    crystalknows_report_url ? { source: 'crystalknows', source_url: crystalknows_report_url, import_mode: 'reference_only', fields: ['crystalknows_report_url'], consent_confirmed } : null,
    (assigned_name || disc_type) ? { source: 'manual', import_mode: 'configuration_override', fields: ['assigned_name', 'disc_type'], consent_confirmed } : null,
  ].filter(Boolean);
  return normalizeHumanProfile({
    ...explicit, assigned_name, linkedin_url, crystalknows_report_url, disc_type,
    profile_sources, consent_confirmed,
  });
}

export function buildPersonalityContext(profile) {
  const p = normalizeHumanProfile(profile);
  if (!p.assigned_name && !p.disc_type && !p.behavioral_archetype) return '';
  const style = p.communication_style || {};
  const lines = [
    'STAKEHOLDER PERSONA SIMULATION — scenario aid, not a factual identity claim.',
    'Never invent private facts or present simulated feedback as a real quotation.',
    p.assigned_name ? `Assigned stakeholder: ${p.assigned_name}` : null,
    p.disc_type ? `DISC: ${p.disc_type}` : null,
    p.enneagram_type ? `Enneagram: ${p.enneagram_type}` : null,
    p.behavioral_archetype ? `Behavioral archetype: ${p.behavioral_archetype}` : null,
    p.skepticism_factor ? `Skepticism: ${p.skepticism_factor}` : null,
    p.behavioral_traits ? `Behavioral traits (0-100): ${Object.entries(p.behavioral_traits).map(([k, v]) => `${k} ${v}`).join(', ')}` : null,
    p.core_motivators?.length ? `Core motivators: ${p.core_motivators.join('; ')}` : null,
    style.tone ? `Tone: ${style.tone}` : null,
    style.preferred_format ? `Preferred format: ${style.preferred_format}` : null,
    style.decision_triggers?.length ? `Decision triggers: ${style.decision_triggers.join('; ')}` : null,
    style.stress_triggers?.length ? `Stress triggers: ${style.stress_triggers.join('; ')}` : null,
    style.objection_patterns?.length ? `Objection patterns: ${style.objection_patterns.join('; ')}` : null,
    style.communication_directives?.length ? `Communication directives: ${style.communication_directives.join('; ')}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

function importedFields(profile) {
  return Object.keys(profile).filter((k) => !['profile_sources', 'consent_confirmed'].includes(k));
}

export function profileFromLinkedInData(data = {}, meta = {}) {
  const first = data.localizedFirstName || data.first_name || data.firstName?.localized?.[data.firstName?.preferredLocale ? `${data.firstName.preferredLocale.language}_${data.firstName.preferredLocale.country}` : ''];
  const last = data.localizedLastName || data.last_name || data.lastName?.localized?.[data.lastName?.preferredLocale ? `${data.lastName.preferredLocale.language}_${data.lastName.preferredLocale.country}` : ''];
  const assigned_name = data.name || [first, last].filter(Boolean).join(' ') || null;
  const vanity = data.vanityName || data.vanity_name || null;
  const linkedin_url = meta.profile_url || data.linkedin_url || (vanity ? `https://www.linkedin.com/in/${vanity}` : null);
  const profile = normalizeHumanProfile({
    assigned_name, linkedin_url,
    avatar_url: meta.avatar_url || data.picture || data.avatar_url || data.profile_picture
      || (() => { const display = data.profilePicture?.display || data.profilePicture || {}; for (const value of Object.values(display)) { const url = value?.elements?.[0]?.identifiers?.[0]?.identifier; if (url) return url; } return null; })(),
    professional_context: {
      headline: data.localizedHeadline || data.headline || null,
      current_role: data.current_role || data.role || null,
      company: data.company || null,
      location: data.location || null,
      skills: data.skills || [],
    },
    consent_confirmed: true,
  });
  profile.profile_sources = [{
    source: 'linkedin', source_url: profile.linkedin_url || null,
    import_mode: meta.import_mode || 'official_api', imported_at: now(), imported_by: meta.imported_by || null,
    fields: importedFields(profile), consent_confirmed: true,
    external_profile_id: data.id ? String(data.id) : null,
  }];
  return normalizeHumanProfile(profile);
}

// Le contenu Crystal existe sous deux formes : l'API Data v4 (documentée sur
// https://api.crystalknows.com/v4/swagger : `motivation` = tableau de
// `{ phrases }`, `recommendations` = tableau de `{ dos, dont }`, traits
// chiffrés dans `personalities.behavioral_traits`) et les anciens exports
// (`{ phrase: [] }`, `{ do, dont }`). Les deux sont acceptés.
function phraseList(node) {
  if (node == null) return [];
  if (typeof node === 'string') return strings([node]);
  if (Array.isArray(node)) return node.flatMap((item) => (typeof item === 'string' ? strings([item]) : phraseList(item)));
  if (typeof node === 'object') return strings([...(node.phrases || []), ...(node.phrase || []), ...(node.overview || [])].flat());
  return [];
}
function recommendationList(node, keys) {
  const items = Array.isArray(node) ? node : node ? [node] : [];
  return strings(items.flatMap((item) => keys.flatMap((key) => (Array.isArray(item?.[key]) ? item[key] : []))));
}
function traitLevel(score) { return score >= 67 ? 'élevé' : score <= 33 ? 'faible' : 'modéré'; }

export function profileFromCrystalData(response = {}, meta = {}) {
  const data = response.data || response.profile || response;
  const personalities = data.personalities || {};
  const content = data.content || response.content || {};
  const traits = normalizeBehavioralTraits(personalities.behavioral_traits || data.behavioral_traits);
  const assigned_name = [data.first_name, data.last_name].filter(Boolean).join(' ') || data.name || meta.full_name || null;
  const overview = [
    ...phraseList(content.profile), ...(personalities.overview ? strings([personalities.overview]) : []),
    ...phraseList(content.blindspots).map((item) => `Angle mort : ${item}`),
  ];
  const enneagram = personalities.enneagram_type ?? data.enneagram_type;
  const profile = normalizeHumanProfile({
    assigned_name,
    avatar_url: meta.avatar_url || data.photo_url || data.picture || data.avatar || data.profile_picture || data.image || null,
    linkedin_url: meta.linkedin_url || data.linkedin_url || null,
    crystalknows_report_url: data.url || meta.profile_url || null,
    disc_type: personalities.disc_type || data.disc_type || null,
    disc_intensity: personalities.disc_intensity ?? data.disc_intensity,
    enneagram_type: enneagram != null ? String(enneagram) : null,
    myers_briggs_type: personalities.myers_briggs_type || data.myers_briggs_type || null,
    behavioral_archetype: personalities.archetype || data.archetype || null,
    behavioral_traits: traits,
    skepticism_factor: traits?.skepticism != null ? `${traitLevel(traits.skepticism)} (${traits.skepticism}/100)` : null,
    core_motivators: phraseList(content.motivation),
    profile_summary: overview,
    professional_context: { current_role: meta.job_title || null, company: meta.company_name || null, qualities: strings(content.qualities || data.qualities || []) },
    communication_style: {
      preferred_format: phraseList(content.meeting)[0] || null,
      decision_triggers: [...phraseList(content.motivation), ...phraseList(content.building_trust), ...recommendationList(content.drive_action, ['dos']), ...phraseList(content.driving_action)],
      stress_triggers: phraseList(content.drainer),
      objection_patterns: recommendationList(content.recommendations, ['dont', 'donts']),
      communication_directives: [
        ...phraseList(content.communication), ...phraseList(content.working_together),
        ...recommendationList(content.recommendations, ['do', 'dos']),
      ],
    },
    descriptif: descriptifFromCrystal(response),
    consent_confirmed: true,
  });
  profile.profile_sources = [{
    source: 'crystalknows', source_url: profile.crystalknows_report_url || null,
    import_mode: meta.import_mode || 'official_api', imported_at: now(), imported_by: meta.imported_by || null,
    fields: importedFields(profile), consent_confirmed: true,
    external_profile_id: data.id || null, verified: typeof data.verified === 'boolean' ? data.verified : null,
  }];
  return normalizeHumanProfile(profile);
}

// --- Saisie DISC manuelle ----------------------------------------------------
// Repli sans API : un type DISC (D, I, S, C et leurs combinaisons « Di », « Sc »…)
// donne un style de communication de départ, modifiable avant import. Ce sont
// des tendances génériques du modèle DISC, pas des données Crystal.
export const DISC_STYLES = Object.freeze({
  D: { label: 'Dominance', tone: 'direct et orienté résultats', preferred_format: 'synthèse courte, options et décision attendue',
    decision_triggers: ['Résultats mesurables', 'Rapidité d’exécution', 'Contrôle et autonomie'],
    stress_triggers: ['Lenteur et détails superflus', 'Perte de contrôle'],
    objection_patterns: ['Conteste les hypothèses qui ralentissent', 'Rejette les propositions sans impact clair'],
    communication_directives: ['Aller droit au but', 'Présenter le résultat avant la méthode'] },
  I: { label: 'Influence', tone: 'enthousiaste et relationnel', preferred_format: 'échange oral, récit et vision',
    decision_triggers: ['Reconnaissance et visibilité', 'Adhésion de l’équipe', 'Nouveauté'],
    stress_triggers: ['Isolement', 'Excès de procédures'],
    objection_patterns: ['Craint l’impact sur l’image ou la relation', 'Se désengage face à un discours trop technique'],
    communication_directives: ['Partager la vision', 'Laisser place à l’échange'] },
  S: { label: 'Stabilité', tone: 'calme, patient et bienveillant', preferred_format: 'plan étape par étape avec les impacts sur l’équipe',
    decision_triggers: ['Sécurité et continuité', 'Consensus', 'Soutien concret'],
    stress_triggers: ['Changements brusques', 'Conflits ouverts'],
    objection_patterns: ['Demande du temps pour absorber le changement', 'Questionne la charge pour l’équipe'],
    communication_directives: ['Expliquer le pourquoi et le calendrier', 'Rassurer sur l’accompagnement'] },
  C: { label: 'Conformité', tone: 'précis, factuel et prudent', preferred_format: 'document écrit structuré avec données et sources',
    decision_triggers: ['Preuves et données vérifiables', 'Qualité et conformité', 'Maîtrise des risques'],
    stress_triggers: ['Approximations', 'Décisions sans analyse'],
    objection_patterns: ['Exige des chiffres et des sources', 'Identifie les risques et les exceptions'],
    communication_directives: ['Fournir les données avant la conclusion', 'Laisser le temps d’analyser'] },
});

/** Normalise un type DISC saisi (« d/c », « Di », « SC ») ; null si invalide. */
export function normalizeDiscType(value) {
  const letters = String(value || '').replace(/[^dDiIsScC]/g, '');
  if (!letters || letters.length > 3) return null;
  return letters[0].toUpperCase() + letters.slice(1).toLowerCase();
}

/** Profil de départ dérivé d'un type DISC (style dominant puis secondaire). */
export function profileFromDiscType(discType, { assigned_name = null, imported_by = null } = {}) {
  const disc = normalizeDiscType(discType);
  if (!disc) throw new Error(`profil DISC invalide: ${discType}`);
  const [primary, secondary] = [...disc.toUpperCase()].map((letter) => DISC_STYLES[letter]);
  const merge = (key) => strings([...(primary[key] || []), ...((secondary || {})[key] || []).slice(0, 1)]);
  const profile = normalizeHumanProfile({
    assigned_name, disc_type: disc,
    behavioral_archetype: secondary ? `${primary.label} / ${secondary.label}` : primary.label,
    communication_style: {
      tone: primary.tone, preferred_format: primary.preferred_format,
      decision_triggers: merge('decision_triggers'), stress_triggers: merge('stress_triggers'),
      objection_patterns: merge('objection_patterns'), communication_directives: merge('communication_directives'),
    },
    core_motivators: merge('decision_triggers'),
    descriptif: descriptifFromDisc(disc),
    consent_confirmed: true,
  });
  profile.profile_sources = [{ source: 'manual', import_mode: 'disc_type', imported_at: now(), imported_by, fields: importedFields(profile), consent_confirmed: true }];
  return normalizeHumanProfile(profile);
}

export class LinkedInSelfProfileAdapter {
  constructor({ accessToken, fetchImpl = globalThis.fetch, endpoint = 'https://api.linkedin.com/v2/me' } = {}) {
    this.accessToken = accessToken || ''; this.fetchImpl = fetchImpl; this.endpoint = endpoint;
  }
  async importProfile({ profile_url = null, imported_by = null } = {}) {
    if (!this.accessToken) throw new Error('linkedin: access token serveur non configuré');
    const res = await this.fetchImpl(this.endpoint, {
      headers: { Authorization: `Bearer ${this.accessToken}`, 'X-RestLi-Protocol-Version': '2.0.0' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`linkedin profile API HTTP ${res.status}`);
    const profile = profileFromLinkedInData(data, { imported_by });
    if (profile_url && normalizeProfileUrl('linkedin', profile_url) !== profile.linkedin_url) {
      throw new Error('linkedin: l’API standard ne peut importer que le membre authentifié');
    }
    return profile;
  }
}

/** Erreur Crystal lisible côté console (codes documentés : 400, 401, 402, 404, 429). */
function crystalError(status, body, retryAfter) {
  const detail = body && typeof body.error === 'string' ? ` — ${body.error}` : '';
  const messages = {
    400: 'requête invalide (identifiant manquant ou mal formé)',
    401: 'jeton API refusé : vérifiez CRYSTALKNOWS_API_TOKEN',
    402: 'crédits API épuisés sur le compte Crystal',
    404: 'aucun profil Crystal ne correspond à ces identifiants',
    429: `limite de débit atteinte${retryAfter ? `, réessayer dans ${retryAfter} s` : ''}`,
  };
  // Jeton valide mais organisation sans l'option « API Access » : seuls les profils
  // de test publics (pjones@, drew@, bkim@crystalknows.com) répondent alors.
  if (status === 401 && /API Access feature/i.test(body?.error || '')) {
    const error = new Error('crystalknows: le jeton est valide mais l’organisation Crystal n’a pas l’option « API Access » (seuls les profils de test répondent) — activez-la auprès de Crystal ou utilisez l’import JSON / DISC');
    error.status = 401;
    error.code = 'crystal_api_access_missing';
    return error;
  }
  const error = new Error(`crystalknows: ${messages[status] || `HTTP ${status}`}${detail}`);
  error.status = status;
  return error;
}

/**
 * Client de l'API Crystal (Data API v4, https://api.crystalknows.com).
 * Endpoints utilisés, tous documentés (https://data.crystalknows.com/llms-full.txt) :
 * - GET  /v4/profile?email|linkedin_url|full_name|company_name|job_title  (1 crédit sur un résultat, dédupliqué)
 * - GET  /v4/content/profile/:id   (gratuit, si le profil arrive sans contenu)
 * - POST /v4/predictions + GET /v4/predictions/:job_id  (création asynchrone, opt-in : 1 crédit si trouvé)
 * `apiVersion: 'v1'` conserve l'ancien endpoint Entreprise GET /v1/profiles.
 * Le jeton reste côté serveur (CRYSTALKNOWS_API_TOKEN) et n'est jamais renvoyé au client.
 */
export class CrystalKnowsProfileAdapter {
  constructor({
    apiToken, fetchImpl = globalThis.fetch, baseUrl = 'https://api.crystalknows.com', apiVersion = 'v4',
    endpoint = null, allowPredictions = false, pollIntervalMs = 3000, pollAttempts = 10, sleep = null,
  } = {}) {
    this.apiToken = apiToken || ''; this.fetchImpl = fetchImpl;
    this.baseUrl = String(baseUrl || 'https://api.crystalknows.com').replace(/\/+$/, '');
    this.apiVersion = apiVersion === 'v1' ? 'v1' : 'v4';
    this.endpoint = endpoint || `${this.baseUrl}${this.apiVersion === 'v1' ? '/v1/profiles' : '/v4/profile'}`;
    this.allowPredictions = allowPredictions === true;
    this.pollIntervalMs = pollIntervalMs; this.pollAttempts = pollAttempts;
    this.sleep = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  _headers(extra = {}) { return { Authorization: `Bearer ${this.apiToken}`, Accept: 'application/json', ...extra }; }

  async _json(url, options = {}) {
    const res = await this.fetchImpl(url, { ...options, headers: this._headers(options.headers) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw crystalError(res.status, body, res.headers?.get?.('retry-after'));
    return body;
  }

  _query({ linkedin_url, email, full_name, company_name, job_title }) {
    const query = {};
    if (linkedin_url) query.linkedin_url = normalizeProfileUrl('linkedin', linkedin_url);
    if (email) query.email = String(email).trim();
    if (full_name) query.full_name = String(full_name).trim();
    if (company_name) query.company_name = String(company_name).trim();
    if (job_title) query.job_title = String(job_title).trim();
    return query;
  }

  async _predict(query) {
    const { full_name, ...rest } = query;
    const submitted = await this._json(`${this.baseUrl}/v4/predictions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: { ...rest, ...(full_name ? { name: full_name } : {}) }, record_id: `kayros_${JSON.stringify(query)}`.slice(0, 200) }),
    });
    for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
      await this.sleep(this.pollIntervalMs);
      const job = await this._json(`${this.baseUrl}/v4/predictions/${encodeURIComponent(submitted.job_id)}`);
      if (job.status === 'failed') throw new Error('crystalknows: la prédiction a échoué côté Crystal');
      if (job.status === 'completed') {
        if (job.result?.state === 'found' && job.result.profile) return job.result.profile;
        if (job.result?.state === 'failure') throw new Error(`crystalknows: prédiction impossible — ${job.result.error || 'erreur inconnue'}`);
        throw crystalError(404);
      }
    }
    throw new Error('crystalknows: prédiction toujours en cours, réessayez dans quelques instants');
  }

  async importProfile({ linkedin_url = null, email = null, full_name = null, company_name = null, job_title = null, imported_by = null } = {}) {
    if (!this.apiToken) throw new Error('crystalknows: API token serveur non configuré');
    const query = this._query({ linkedin_url, email, full_name, company_name, job_title });
    if (!query.linkedin_url && !query.email && !query.full_name) throw new Error('crystalknows: e-mail, URL LinkedIn ou nom complet requis');
    if (this.apiVersion === 'v1') {
      if (!query.linkedin_url && !query.email) throw new Error('crystalknows: linkedin_url ou email requis (API v1)');
      const url = new URL(this.endpoint);
      if (query.linkedin_url) url.searchParams.set('linkedin_url', query.linkedin_url);
      if (query.email) url.searchParams.set('email', query.email);
      const data = await this._json(url);
      return profileFromCrystalData(data, { linkedin_url, imported_by });
    }
    const url = new URL(this.endpoint);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let profile;
    try { profile = (await this._json(url)).data; }
    catch (error) {
      if (error.status !== 404 || !this.allowPredictions) throw error;
      profile = await this._predict(query);
    }
    if (profile?.id && !profile.content) {
      try { profile = { ...profile, content: await this._json(`${this.baseUrl}/v4/content/profile/${encodeURIComponent(profile.id)}`) }; }
      catch { /* le profil reste exploitable sans contenu détaillé */ }
    }
    return profileFromCrystalData({ data: profile }, { linkedin_url, imported_by, job_title, company_name, full_name });
  }
}

export class ProfileImportService {
  constructor({ linkedinAdapter = null, crystalKnowsAdapter = null } = {}) {
    this.adapters = { linkedin: linkedinAdapter, crystalknows: crystalKnowsAdapter };
  }
  async importProfile({ source, profile_url = null, linkedin_url = null, email = null, full_name = null, company_name = null, job_title = null, profile_data = null, consent_confirmed = false, imported_by = null } = {}) {
    const normalizedSource = String(source || '').toLowerCase();
    if (!['linkedin', 'crystalknows'].includes(normalizedSource)) throw new Error(`profile source inconnue: ${source}`);
    if (consent_confirmed !== true) throw new Error('profile import: consentement explicite requis');
    if (profile_data) {
      return normalizedSource === 'linkedin'
        ? profileFromLinkedInData(clone(profile_data), { profile_url, imported_by, import_mode: 'authorized_export' })
        : profileFromCrystalData(clone(profile_data), { profile_url, linkedin_url, imported_by, import_mode: 'authorized_export' });
    }
    const adapter = this.adapters[normalizedSource];
    if (!adapter) throw new Error(`${normalizedSource}: connecteur non configuré; fournir un export structuré autorisé`);
    return adapter.importProfile({ profile_url, linkedin_url, email, full_name, company_name, job_title, imported_by });
  }
}

/**
 * Propose les attributs d'un agent à partir d'un profil humain importé
 * (Crystal / DISC / export) : identité, mission et profil comportemental.
 * Le résultat est un brouillon que l'utilisateur relit et modifie avant usage.
 */
export function agentAttributesFromProfile(profile = {}, { role = null, company = null, department = null } = {}) {
  const p = normalizeHumanProfile(profile);
  const name = p.assigned_name || 'Profil importé';
  const currentRole = role || p.professional_context?.current_role || null;
  const org = company || p.professional_context?.company || null;
  const style = p.communication_style || {};
  const traits = p.behavioral_traits || {};
  const risk = traits.risk_aversion != null ? (traits.risk_aversion >= 67 ? 'prudent' : traits.risk_aversion <= 33 ? 'audacieux' : 'équilibré') : null;
  const decision = traits.pace != null && traits.skepticism != null
    ? (traits.skepticism >= 60 ? 'analytique, exige des preuves' : traits.pace >= 60 ? 'rapide et pragmatique' : 'réfléchi, recherche le consensus')
    : null;
  return compact({
    display_name: name,
    role_name: currentRole || `Partie prenante${p.disc_type ? ` (DISC ${p.disc_type})` : ''}`,
    department: department || org || 'Partie prenante externe',
    seniority: /chief|ceo|cfo|cto|coo|vp|vice|président|directeur|directrice|head|dg\b/i.test(String(currentRole || '')) ? 'executive' : 'senior',
    mission: `Réagir comme ${name}${currentRole ? `, ${currentRole}` : ''}${org ? ` chez ${org}` : ''} : éprouver la proposition selon ses priorités, ses objections probables et son style de décision.`,
    behavioral_profile: compact({
      disc_type: p.disc_type || null,
      archetype: p.behavioral_archetype || null,
      tone: style.tone || null,
      decision_style: decision,
      risk_appetite: risk,
      motivators: (p.core_motivators || []).slice(0, 5),
      communication_directives: (style.communication_directives || []).slice(0, 5),
      // Descriptif éditable : celui du profil importé, sinon le modèle du type DISC.
      descriptif: p.descriptif || descriptifFromDisc(p.disc_type, { traits: p.behavioral_traits }) || null,
    }),
  });
}
