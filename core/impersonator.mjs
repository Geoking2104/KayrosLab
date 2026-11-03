// KayrosLab — Impersonator agents.
//
// An impersonator agent is a hybrid agent whose persona is reconstructed from clues
// about a real stakeholder (LinkedIn profile, Crystal Knows report, an authorised
// export, or manual clues). It is used to stress-test an idea by simulating how that
// stakeholder would likely react — never to speak in their name.
//
// Design rules:
//  - a persona is consented BY DEFAULT (consent_confirmed defaults to true); only an explicit
//    refusal (consent_confirmed: false) blocks it — except for the 'public' source, whose legal
//    basis is public data and which requires a non-empty list of public URLs (public_sources);
//  - public_sources are recorded on the persona and VISITED server-side (core/public-sources.mjs,
//    SSRF-guarded); the visit trace is kept in public_evidence (status, title, excerpt, date, hash);
//  - the persona is a *simulation*, always labelled as such in the output;
//  - no private fact that is not in the supplied clues may be invented;
//  - the agent may never be used for a materially impactful decision about the person.

import { voiceContext } from './impersonator-voice.mjs';
import { buildPersonalityContext, normalizeHumanProfile } from './personality.mjs';
import { assertPublicUrl, normalizePublicEvidence } from './public-sources.mjs';

export const IMPERSONATOR_SOURCES = Object.freeze(['linkedin', 'crystalknows', 'export', 'manual', 'enriched', 'public']);
/** Sources exemptées de consentement explicite (données publiques uniquement, sources tracées). */
export const CONSENT_EXEMPT_SOURCES = Object.freeze(['public']);
export const IMPERSONATOR_PURPOSES = Object.freeze(['idea_test', 'objection_rehearsal', 'pitch_review']);

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function str(value) { return String(value ?? '').trim(); }
function strings(value) { return Array.isArray(value) ? [...new Set(value.map((x) => str(x)).filter(Boolean))] : []; }
function slug(value) {
  return str(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

/** Normalise and validate the impersonator descriptor carried by an agent. */
export function normalizeImpersonator(input = {}) {
  const persona_name = str(input.persona_name || input.name);
  if (!persona_name) throw new Error('impersonator: persona_name requis');
  const source = str(input.source || 'manual').toLowerCase();
  if (!IMPERSONATOR_SOURCES.includes(source)) throw new Error(`impersonator: source inconnue ${source}`);
  const purpose = str(input.purpose || 'idea_test').toLowerCase();
  if (!IMPERSONATOR_PURPOSES.includes(purpose)) throw new Error(`impersonator: purpose inconnu ${purpose}`);
  const public_sources = strings(input.public_sources);
  const consentExempt = CONSENT_EXEMPT_SOURCES.includes(source);
  if (consentExempt && !public_sources.length) throw new Error('impersonator: public_sources (liste d\'URLs publiques) requis pour la source public');
  for (const u of public_sources) {
    if (!/^https?:\/\/\S+$/i.test(u)) throw new Error(`impersonator: public_sources doit contenir des URLs http(s) (${u})`);
    try { assertPublicUrl(u); } catch (error) { throw new Error(`impersonator: ${error.message}`); }
  }
  // Consentement par défaut : seul un refus explicite bloque (hors source public, base légale = données publiques).
  if (!consentExempt && input.consent_confirmed === false) throw new Error('impersonator: consentement refusé (consent_confirmed: false)');
  const portrait_url = str(input.portrait_url) || null;
  if (portrait_url && !/^https:\/\//i.test(portrait_url) && !/^data:image\//i.test(portrait_url)) {
    throw new Error('impersonator: portrait_url doit être une URL https ou une image en data-URI');
  }
  return {
    persona_name,
    portrait_url,
    persona_role: str(input.persona_role) || null,
    persona_company: str(input.persona_company) || null,
    source,
    source_url: str(input.source_url) || null,
    purpose,
    consent_confirmed: input.consent_confirmed !== false,
    legal_basis: consentExempt ? 'public_data' : 'consent',
    public_sources,
    public_evidence: normalizePublicEvidence(input.public_evidence),
    consent_reference: str(input.consent_reference) || null,
    clues: strings(input.clues),
    notes: str(input.notes) || null,
    created_at: input.created_at || new Date().toISOString(),
  };
}

export function isImpersonator(agent) {
  return !!agent?.metadata?.impersonator;
}

export function impersonatorOf(agent) {
  const raw = agent?.metadata?.impersonator;
  if (!raw) return null;
  try { return normalizeImpersonator(raw); } catch { return null; }
}

/** A compact digest of the profile clues actually supplied (no inference beyond them). */
export function personaClues(profile) {
  const p = normalizeHumanProfile(profile || {});
  const style = p.communication_style || {};
  const ctx = p.professional_context || {};
  return {
    display: p.assigned_name || null,
    portrait_url: p.avatar_url || null,
    role: ctx.current_role || null,
    company: ctx.company || null,
    disc: p.disc_type || null,
    enneagram: p.enneagram_type || null,
    archetype: p.behavioral_archetype || null,
    motivators: p.core_motivators || [],
    skepticism: p.skepticism_factor || null,
    tone: style.tone || null,
    preferred_format: style.preferred_format || null,
    decision_triggers: style.decision_triggers || [],
    stress_triggers: style.stress_triggers || [],
    objection_patterns: style.objection_patterns || [],
    directives: style.communication_directives || [],
    summary: p.profile_summary || [],
  };
}

/** Mandatory guardrails injected as effective decision rules. */
export function impersonatorGuardrails(impersonator) {
  const i = normalizeImpersonator(impersonator);
  const who = [i.persona_name, i.persona_role, i.persona_company].filter(Boolean).join(' — ');
  return [
    { rule_id: 'IMP_01_LABEL', rule_text: `Toute contribution est une SIMULATION de ${who} : préfixer la sortie par « Simulation ».` },
    { rule_id: 'IMP_02_NEVER_SPEAK_FOR', rule_text: `Ne jamais affirmer être ${i.persona_name}, ni parler, écrire ou décider en son nom.` },
    { rule_id: 'IMP_03_CLUES_ONLY', rule_text: 'Ne s\'appuyer que sur les indices de profil fournis ; ne jamais inventer de fait privé ; signaler explicitement toute lacune.' },
    { rule_id: 'IMP_04_IDEA_TEST', rule_text: `Usage prévu : ${i.purpose.replaceAll('_', ' ')} — éprouver l'idée soumise, pas établir un fait sur la personne.` },
    { rule_id: 'IMP_05_NO_MATERIAL_DECISION', rule_text: 'Ne jamais contribuer à une décision à effet matériel sur la personne (embauche, crédit, assurance, santé, logement).' },
  ];
}

/** Extraits des sources publiques visitées (indices bruts, jamais des faits établis). */
export function publicEvidenceLines(impersonator) {
  const visited = (impersonator?.public_evidence || []).filter((r) => !r.error && (r.title || r.excerpt));
  if (!visited.length) return [];
  return [
    `Sources publiques visitées (${visited.length}/${(impersonator.public_evidence || []).length}) — extraits à traiter comme indices :`,
    ...visited.slice(0, 8).map((r) => `- ${r.final_url || r.url}${r.title ? ` « ${r.title} »` : ''} [${r.fetched_at || '?'}, sha256 ${String(r.sha256 || '').slice(0, 12)}]${r.excerpt ? ` : ${r.excerpt.slice(0, 400)}` : ''}`),
  ];
}

/** Persona + clues context block compiled into the agent's effective context. */
export function impersonatorContext(agent) {
  const impersonator = impersonatorOf(agent);
  if (!impersonator) return '';
  const profile = agent?.human_profile || {};
  const clues = personaClues(profile);
  const lines = [
    'PERSONA SIMULATION — aide à l\'épreuve d\'idée, jamais une déclaration d\'identité.',
    `Persona simulée : ${[impersonator.persona_name, impersonator.persona_role, impersonator.persona_company].filter(Boolean).join(' — ')}`,
    `Source des indices : ${impersonator.source}${impersonator.source_url ? ` (${impersonator.source_url})` : ''}`,
    impersonator.legal_basis === 'public_data'
      ? `Base : données publiques uniquement (${impersonator.public_sources.join(', ')})`
      : `Consentement : confirmé${impersonator.consent_reference ? ` (réf. ${impersonator.consent_reference})` : ''}`,
    ...publicEvidenceLines(impersonator),
    clues.disc ? `DISC : ${clues.disc}` : null,
    clues.archetype ? `Archétype : ${clues.archetype}` : null,
    clues.skepticism ? `Scepticisme : ${clues.skepticism}` : null,
    clues.motivators.length ? `Motivateurs : ${clues.motivators.join('; ')}` : null,
    clues.tone ? `Ton : ${clues.tone}` : null,
    clues.preferred_format ? `Format préféré : ${clues.preferred_format}` : null,
    clues.decision_triggers.length ? `Déclencheurs de décision : ${clues.decision_triggers.join('; ')}` : null,
    clues.stress_triggers.length ? `Facteurs de tension : ${clues.stress_triggers.join('; ')}` : null,
    clues.objection_patterns.length ? `Schémas d\'objection : ${clues.objection_patterns.join('; ')}` : null,
    clues.directives.length ? `Directives de communication : ${clues.directives.join('; ')}` : null,
    impersonator.clues.length ? `Indices complémentaires : ${impersonator.clues.join('; ')}` : null,
    'Attendu : réaction probable de la persona face à l\'idée soumise (accord, objections, conditions), étiquetée « Simulation ».',
  ].filter(Boolean);
  const base = buildPersonalityContext(profile);
  const voice = voiceContext(profile);
  return [lines.join('\n'), voice, base].filter(Boolean).join('\n\n');
}

/** Build the impersonator agent definition from a request + an imported profile. */
export function impersonatorAgentDefinition({ agent_id, display_name, role_name, department, seniority = 'executive', mission, impersonator, human_profile, veto_power = true } = {}) {
  const i = normalizeImpersonator(impersonator);
  const profile = normalizeHumanProfile({ ...(human_profile || {}), consent_confirmed: true, assigned_name: (human_profile || {}).assigned_name || i.persona_name, avatar_url: (human_profile || {}).avatar_url || i.portrait_url || null });
  const id = slug(agent_id || `imposteur_${i.persona_name}`);
  const role = str(role_name) || [i.persona_role, i.persona_company].filter(Boolean).join(' · ') || `Persona ${i.persona_name}`;
  const focus = str(mission) || `Simuler la partie prenante « ${i.persona_name} » pour éprouver une idée (objections, conditions, déclencheurs).`;
  return {
    agent_id: id,
    display_name: str(display_name) || `Simulation — ${i.persona_name}`,
    role_name: role,
    department: str(department) || 'Épreuve d\'idée · persona simulée',
    seniority,
    primary_focus: focus,
    mission: focus,
    instructions: 'Réagir à l\'idée soumise en adoptant la persona simulée ; expliciter accord, objections et conditions ; ne jamais parler au nom de la personne réelle.',
    constraints: [
      'Sortie étiquetée « Simulation ».',
      'Aucun fait privé non présent dans les indices fournis.',
      'Usage limité à l\'épreuve d\'idée, jamais une décision à effet matériel.',
    ],
    tools: [],
    connectors: ['console'],
    enabled: true,
    veto_power: veto_power === true,
    metadata: { impersonator: i, persona_clues: personaClues(profile) },
    human_profile: profile,
  };
}

export { clone as cloneImpersonator };
