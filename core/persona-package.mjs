// KayrosLab — Personas déclaratives : un fichier YAML (ou JSON) par persona impersonator.
//
// Chaque fichier de `personas/` (hors sous-dossiers, donc hors `personas/catalog/`) décrit UNE
// persona. Le chargeur ne crée jamais un agent directement : chaque entrée passe par
// `normalizeImpersonator` puis `impersonatorAgentDefinition` (core/impersonator.mjs), donc par les
// mêmes garde-fous IMP_*, le même veto par défaut et la même règle de consentement que
// `POST /v1/console/impersonators` (source `public` : URLs publiques exigées, consentement non requis ;
// toute autre source : consent_confirmed: true exigé). Un fichier invalide est rejeté et rapporté,
// jamais accepté silencieusement. La synchronisation est idempotente : un agent déjà présent n'est
// ni écrasé ni modifié (les éditions faites dans la console priment).

import { readdir, readFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { normalizeImpersonator, impersonatorAgentDefinition, personaClues } from './impersonator.mjs';
import { mergeHumanProfiles } from './personality.mjs';
import { profileFromPublicSources } from './profile-enrichment.mjs';
import { loadSkillCatalog, resolveSkills, SKILLS_FILE } from './persona-skills.mjs';

export const PERSONA_EXTENSIONS = Object.freeze(['.yaml', '.yml', '.json']);
const FILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

async function defaultParser(text, ext) {
  if (ext === '.json') return JSON.parse(text);
  // `core/` n'a pas de dépendance : le backend injecte `parse` (paquet `yaml`). Repli : import dynamique.
  let mod;
  try { mod = await import('yaml'); } catch { throw new Error('persona : parseur YAML indisponible (injecter `parse` ou utiliser .json)'); }
  return mod.parse(text);
}

/** Convertit une entrée de fichier en descripteur impersonator + options de définition. */
export function personaFromEntry(entry, { file = null, skillCatalog = [] } = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('persona : objet attendu');
  const name = String(entry.name ?? '').trim();
  const fallbackId = file ? basename(file, extname(file)) : '';
  const agent_id = String(entry.id ?? entry.agent_id ?? fallbackId).trim();
  if (agent_id && !FILE_ID.test(agent_id)) throw new Error(`persona : id invalide « ${agent_id} »`);
  const impersonator = normalizeImpersonator({
    persona_name: name,
    persona_role: entry.role,
    persona_company: entry.company,
    source: entry.source,
    source_url: entry.source_url,
    purpose: entry.purpose,
    consent_confirmed: entry.consent_confirmed,
    consent_reference: entry.consent_reference,
    public_sources: entry.public_sources,
    clues: entry.clues,
    notes: entry.notes,
    portrait_url: entry.portrait_url,
  });
  const skills = resolveSkills(entry.skills, skillCatalog);
  return {
    agent_id: agent_id || undefined,
    impersonator,
    skills,
    tools: Array.isArray(entry.tools) ? entry.tools.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : [],
    veto_power: entry.veto_power !== false,
    mission: entry.mission,
    human_profile: {
      assigned_name: impersonator.persona_name,
      avatar_url: impersonator.portrait_url,
      professional_context: { current_role: impersonator.persona_role, company: impersonator.persona_company },
    },
  };
}

/** Définition d'agent prête pour `swarm.createAgent`, issue du constructeur impersonator gouverné. */
export function personaAgentDefinition(entry, opts) {
  const p = personaFromEntry(entry, opts);
  const d = impersonatorAgentDefinition(p);
  // Skills (instantanés) et allowlist explicite : les outils effectifs restent skill ∩ assertToolAllowed.
  if (p.skills.length) d.metadata = { ...d.metadata, skills: p.skills };
  if (p.tools.length) d.tools = p.tools;
  return d;
}

/**
 * Lit un dossier de personas. Renvoie `{ personas: [{file, definition}], errors: [{file, error}] }`.
 * Un dossier absent n'est pas une erreur (aucune persona déclarée).
 */
export async function loadPersonaPackage(directory, { parse = defaultParser, skillCatalog = null } = {}) {
  let catalog = skillCatalog || []; let catalogError = null;
  if (!skillCatalog) {
    try { catalog = await loadSkillCatalog(join(directory, SKILLS_FILE), { parse: (t) => parse(t, '.yaml') }); } catch (error) { catalogError = error; }
  }
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const personas = []; const errors = catalogError ? [{ file: SKILLS_FILE, error: catalogError.message }] : []; const seen = new Set();
  for (const dirent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!dirent.isFile()) continue;
    const ext = extname(dirent.name).toLowerCase();
    if (!PERSONA_EXTENSIONS.includes(ext) || dirent.name.startsWith('.') || dirent.name === SKILLS_FILE) continue;
    const file = join(directory, dirent.name);
    try {
      const raw = await parse(await readFile(file, 'utf8'), ext);
      const definition = personaAgentDefinition(raw, { file: dirent.name, skillCatalog: catalog });
      if (seen.has(definition.agent_id)) throw new Error(`persona : id en double « ${definition.agent_id} »`);
      seen.add(definition.agent_id);
      personas.push({ file: dirent.name, definition });
    } catch (error) {
      errors.push({ file: dirent.name, error: error.message });
    }
  }
  return { personas, errors };
}

/**
 * Enregistre les personas absentes du registre du tenant (idempotent, jamais d'écrasement).
 * Renvoie `{ created, skipped, errors }`.
 */
/**
 * Visite les public_sources d'une persona (via `visit`, ex. visitPublicSources) et lie la trace
 * (metadata.impersonator.public_evidence) ; les extraits passent par profileFromPublicSources.
 */
export async function attachPersonaPublicEvidence(swarm, agent, visit, { tenantId = null, by = 'persona-package' } = {}) {
  const urls = agent?.metadata?.impersonator?.public_sources || [];
  if (!urls.length || typeof visit !== 'function') return agent;
  const evidence = await visit(urls);
  const impersonator = normalizeImpersonator({ ...agent.metadata.impersonator, public_evidence: evidence });
  let next = swarm.updateAgent(agent.agent_id, { metadata: { ...(agent.metadata || {}), impersonator } }, { tenantId, by });
  const fragment = profileFromPublicSources(impersonator.public_evidence, { imported_by: by });
  if (fragment) next = swarm.assignPersonality(next.agent_id, mergeHumanProfiles(next.human_profile, fragment), { tenantId, by });
  return next;
}

export async function synchronizePersonaPackage(swarm, directory, { tenantId = null, by = 'persona-package', parse, visit = null } = {}) {
  const { personas, errors } = await loadPersonaPackage(directory, { parse });
  const created = []; const skipped = []; const visited = [];
  await swarm.hydrateTenant?.(tenantId);
  for (const { file, definition } of personas) {
    const existing = swarm.registry?.get?.(definition.agent_id, { tenantId });
    if (existing) {
      skipped.push(definition.agent_id);
      // Persona existante jamais visitée : la trace est ajoutée (rien d'autre n'est modifié).
      if (visit && existing.metadata?.impersonator?.public_sources?.length && !existing.metadata.impersonator.public_evidence?.length) {
        try { await attachPersonaPublicEvidence(swarm, existing, visit, { tenantId, by }); visited.push(definition.agent_id); } catch (error) { errors.push({ file, error: error.message }); }
      }
      continue;
    }
    try {
      let agent = swarm.createAgent(definition, { tenantId, by });
      if (visit) { agent = await attachPersonaPublicEvidence(swarm, agent, visit, { tenantId, by }); visited.push(agent.agent_id); }
      try {
        swarm.updateAgent?.(agent.agent_id, { metadata: { ...(agent.metadata || {}), persona_clues: personaClues(agent.human_profile), persona_file: file } }, { tenantId, by });
      } catch { /* la persona de base reste valide */ }
      created.push(agent.agent_id);
    } catch (error) {
      if (/existant/.test(error.message)) skipped.push(definition.agent_id);
      else errors.push({ file, error: error.message });
    }
  }
  await swarm.flush?.();
  return { created, skipped, visited, errors };
}
