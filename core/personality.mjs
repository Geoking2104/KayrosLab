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
    linkedin_url: linkedin,
    crystalknows_report_url: crystal,
    disc_type: String(input.disc_type || '').trim() || null,
    enneagram_type: String(input.enneagram_type || '').trim() || null,
    myers_briggs_type: String(input.myers_briggs_type || '').trim() || null,
    behavioral_archetype: String(input.behavioral_archetype || '').trim() || null,
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

function phrases(content, key, leaf = 'phrase') { return strings(content?.[key]?.[leaf]); }

export function profileFromCrystalData(response = {}, meta = {}) {
  const data = response.data || response;
  const personalities = data.personalities || {};
  const content = data.content || {};
  const assigned_name = [data.first_name, data.last_name].filter(Boolean).join(' ') || data.name || null;
  const profile = normalizeHumanProfile({
    assigned_name,
    linkedin_url: meta.linkedin_url || data.linkedin_url || null,
    crystalknows_report_url: data.url || meta.profile_url || null,
    disc_type: personalities.disc_type || data.disc_type || null,
    enneagram_type: personalities.enneagram_type || null,
    myers_briggs_type: personalities.myers_briggs_type || null,
    behavioral_archetype: personalities.archetype || data.archetype || null,
    core_motivators: phrases(content, 'motivation'),
    profile_summary: strings(content.profile?.overview),
    professional_context: { qualities: data.qualities || [] },
    communication_style: {
      decision_triggers: phrases(content, 'motivation'),
      stress_triggers: phrases(content, 'drainer'),
      objection_patterns: strings(content.recommendations?.dont),
      communication_directives: [...phrases(content, 'communication'), ...strings(content.recommendations?.do)],
    },
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

export class CrystalKnowsProfileAdapter {
  constructor({ apiToken, fetchImpl = globalThis.fetch, endpoint = 'https://api.crystalknows.com/v1/profiles' } = {}) {
    this.apiToken = apiToken || ''; this.fetchImpl = fetchImpl; this.endpoint = endpoint;
  }
  async importProfile({ linkedin_url = null, email = null, imported_by = null } = {}) {
    if (!this.apiToken) throw new Error('crystalknows: API token serveur non configuré');
    if (!linkedin_url && !email) throw new Error('crystalknows: linkedin_url ou email requis');
    const url = new URL(this.endpoint);
    if (linkedin_url) url.searchParams.set('linkedin_url', normalizeProfileUrl('linkedin', linkedin_url));
    if (email) url.searchParams.set('email', String(email));
    const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${this.apiToken}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(`crystalknows profile API HTTP ${res.status}`);
    return profileFromCrystalData(data, { linkedin_url, imported_by });
  }
}

export class ProfileImportService {
  constructor({ linkedinAdapter = null, crystalKnowsAdapter = null } = {}) {
    this.adapters = { linkedin: linkedinAdapter, crystalknows: crystalKnowsAdapter };
  }
  async importProfile({ source, profile_url = null, linkedin_url = null, email = null, profile_data = null, consent_confirmed = false, imported_by = null } = {}) {
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
    return adapter.importProfile({ profile_url, linkedin_url, email, imported_by });
  }
}
