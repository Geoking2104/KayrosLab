// KayrosLab — Outils autorisés d'une persona (allowlist réglable depuis la console).
//
// Politique : seuls les outils du ToolRegistry, sans effet d'écriture (une persona simule une
// partie prenante, jamais une décision à effet matériel), éventuellement restreints par la
// politique d'espace KAYROS_PERSONA_TOOL_POLICY (liste séparée par des virgules). Un outil à porte
// humaine (`gate`) peut être allowlisté mais reste soumis à l'approbation à l'appel
// (assertToolAllowed). Rien ne peut élargir au-delà de cette politique.

import { normalizePermissions, assertToolAllowed } from './workflow-permissions.mjs';

export function personaToolPolicy(registry, env = process.env) {
  const restrict = String(env?.KAYROS_PERSONA_TOOL_POLICY || '').split(',').map((s) => s.trim()).filter(Boolean);
  return (registry?.list?.() || []).map((tool) => {
    const sideEffect = tool.sideEffect || 'none';
    const reason = sideEffect === 'write' ? 'écriture interdite aux personas'
      : restrict.length && !restrict.includes(tool.name) ? 'hors politique de l’espace' : null;
    return { name: tool.name, description: tool.description || '', sideEffect, gate: tool.gate === true, assignable: !reason, reason };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** Valide une allowlist ; renvoie la liste normalisée ou lève. */
export function validatePersonaTools(tools, { registry, agentId = 'persona', env } = {}) {
  const perms = normalizePermissions({ tools: Array.isArray(tools) ? [...new Set(tools.map((t) => String(t).trim()))] : tools });
  if (perms.tools === '*') throw new Error('outils persona : le joker * est interdit, listez les outils');
  if (perms.tools.length > 20) throw new Error('outils persona : 20 au maximum');
  const policy = new Map(personaToolPolicy(registry, env).map((p) => [p.name, p]));
  const node = { id: agentId, permissions: { tools: perms.tools, writes: [] } };
  for (const name of perms.tools) {
    const p = policy.get(name);
    if (!p) throw new Error(`outils persona : ${name} absent du registre d’outils`);
    if (!p.assignable) throw new Error(`outils persona : ${name} refusé (${p.reason})`);
    assertToolAllowed(node, registry.get(name), { gateApproved: true });
  }
  return [...perms.tools];
}
