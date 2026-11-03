// KayrosLab — Skills des personas (P5).
//
// `personas/skills.yaml` déclare un catalogue de skills ; une persona référence des skills par id
// (`skills: [...]`). Le skill est instantané dans metadata.skills (contexte effectif, cf.
// core/swarm.mjs#skillsContext). Les outils d'un skill ne sont jamais accordés par le skill seul :
// outils effectifs = outils du skill ∩ allowlist de l'agent, chaque outil passant assertToolAllowed
// (core/workflow-permissions.mjs : allowlist, wildcard interdit pour l'écriture, porte humaine).

import { readFile } from 'node:fs/promises';
import { assertToolAllowed } from './workflow-permissions.mjs';

const SKILL_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const SKILLS_FILE = 'skills.yaml';
function str(v) { return String(v ?? '').trim(); }
function strings(v) { return Array.isArray(v) ? [...new Set(v.map(str).filter(Boolean))] : []; }

/** Valide le catalogue `{ skills: [{ id, name, instructions, tools }] }`. */
export function normalizeSkillCatalog(input = {}) {
  const list = Array.isArray(input) ? input : Array.isArray(input?.skills) ? input.skills : [];
  const seen = new Set();
  return list.map((s, i) => {
    const id = str(s?.id);
    if (!SKILL_ID.test(id)) throw new Error(`skills : id invalide à l'entrée ${i} (${id || 'vide'})`);
    if (seen.has(id)) throw new Error(`skills : id en double « ${id} »`);
    seen.add(id);
    return { id, name: str(s.name) || id, instructions: str(s.instructions).slice(0, 2000) || null, tools: strings(s.tools).slice(0, 20) };
  });
}

/** Lit personas/skills.yaml (absent = catalogue vide). */
export async function loadSkillCatalog(file, { parse } = {}) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const doParse = parse || (async (t) => (await import('yaml')).parse(t));
  return normalizeSkillCatalog(await doParse(text));
}

/** Résout des ids de skills en instantanés ; un id inconnu est une erreur. */
export function resolveSkills(ids = [], catalog = []) {
  const byId = new Map(catalog.map((s) => [s.id, s]));
  return strings(ids).map((id) => {
    const skill = byId.get(id);
    if (!skill) throw new Error(`skills : skill inconnu « ${id} »`);
    return { ...skill, tools: [...skill.tools] };
  });
}

/** Nœud de permission d'un agent : allowlist = agent.tools (jamais de wildcard). */
export function agentPermissionNode(agent) {
  return { id: agent?.agent_id || 'agent', permissions: { tools: strings(agent?.tools), writes: [] } };
}

/** Outils effectifs des skills d'un agent : skill ∩ assertToolAllowed(agent). */
export function effectiveSkillTools(agent, { registry = null, gateApproved = false } = {}) {
  const skills = Array.isArray(agent?.metadata?.skills) ? agent.metadata.skills : [];
  const node = agentPermissionNode(agent);
  const granted = []; const denied = [];
  for (const tool of [...new Set(skills.flatMap((s) => strings(s.tools)))]) {
    const def = registry?.get?.(tool) || { name: tool, sideEffect: 'write' };
    try { assertToolAllowed(node, def, { gateApproved }); granted.push(tool); } catch (error) { denied.push({ tool, reason: error.message }); }
  }
  return { granted, denied };
}

/** Lève sauf si l'outil est porté par un skill de l'agent ET autorisé par assertToolAllowed. */
export function assertSkillToolAllowed(agent, toolDef, options = {}) {
  const skills = Array.isArray(agent?.metadata?.skills) ? agent.metadata.skills : [];
  if (!skills.some((s) => strings(s.tools).includes(toolDef?.name))) {
    throw new Error(`Workflow permissions: tool ${toolDef?.name} is not provided by any skill of ${agent?.agent_id || 'agent'}`);
  }
  return assertToolAllowed(agentPermissionNode(agent), toolDef, options);
}
