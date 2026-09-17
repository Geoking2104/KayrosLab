// KayrosLab — Impersonator agents.
//
// An impersonator agent is a hybrid agent whose persona is reconstructed from clues
// about a real stakeholder (LinkedIn profile, Crystal Knows report, an authorised
// export, or manual clues). It is used to stress-test an idea by simulating how that
// stakeholder would likely react — never to speak in their name.
//
// Design rules:
//  - explicit consent is mandatory before any profile clue is attached;
//  - the persona is a *simulation*, always labelled as such in the output;
//  - no private fact that is not in the supplied clues may be invented;
//  - the agent may never be used for a materially impactful decision about the person.

import { buildPersonalityContext, normalizeHumanProfile } from './personality.mjs';

export const IMPERSONATOR_SOURCES = Object.freeze(['linkedin', 'crystalknows', 'export', 'manual']);
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
  if (input.consent_confirmed !== true) throw new Error('impersonator: consentement explicite requis');
  return {
    persona_name,
    persona_role: str(input.persona_role) || null,
    persona_company: str(input.persona_company) || null,
    source,
    source_url: str(input.source_url) || null,
    purpose,
    consent_confirmed: true,
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
    `Consentement : confirmé${impersonator.consent_reference ? ` (réf. ${impersonator.consent_reference})` : ''}`,
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
  return base ? `${lines.join('\n')}\n\n${base}` : lines.join('\n');
}

/** Build the impersonator agent definition from a request + an imported profile. */
export function impersonatorAgentDefinition({ agent_id, display_name, role_name, department, seniority = 'executive', mission, impersonator, human_profile, veto_power = true } = {}) {
  const i = normalizeImpersonator(impersonator);
  const profile = normalizeHumanProfile({ ...(human_profile || {}), consent_confirmed: true, assigned_name: (human_profile || {}).assigned_name || i.persona_name });
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
