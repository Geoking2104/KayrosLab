// KayrosLab — Types & factories pour la mémoire stratifiée (L0–L3).
// Aucune dépendance externe. Conçu pour rester lisible, auditable et compatible
// avec SharedMemory + MemoryService existants.

import { STAGES } from './model.mjs';

const nowIso = () => new Date().toISOString();
const uid = () => globalThis.crypto?.randomUUID?.() ?? `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

/** @typedef {'message'|'tool'|'file'|'idea'|'l1'|'l2'|'external'|'agent'} SourceType */

/**
 * @typedef {Object} SourceRef
 * @property {SourceType} type
 * @property {string} id
 * @property {string} [excerpt]
 * @property {string} [url]
 */

// ========== L0 – Working / Ephemeral ==========

/**
 * @typedef {Object} L0WorkingItem
 * @property {string} id
 * @property {string} ideaId
 * @property {string} [campaignId]
 * @property {string} step
 * @property {string} [agentRole]
 * @property {'tool_output'|'llm_thought'|'scrape'|'canvas'|'intermediate'|'agent_scratch'} kind
 * @property {string|object} content
 * @property {string} [summary]
 * @property {string} [mermaidNodeId]
 * @property {string} createdAt
 * @property {string} [expiresAt]
 * @property {string} [filePath]     // chemin offloadé
 */

/**
 * Crée un item L0.
 * @param {Partial<L0WorkingItem> & { ideaId: string, step: string, kind: string, content: any }} p
 * @returns {L0WorkingItem}
 */
export function createL0(p) {
  if (!p.ideaId) throw new Error('createL0: ideaId requis');
  if (!p.step) throw new Error('createL0: step requis');
  if (!p.kind) throw new Error('createL0: kind requis');
  if (p.content === undefined) throw new Error('createL0: content requis');
  return {
    id: p.id ?? uid(),
    ideaId: p.ideaId,
    campaignId: p.campaignId ?? null,
    step: p.step,
    agentRole: p.agentRole ?? null,
    kind: p.kind,
    content: p.content,
    summary: p.summary ?? null,
    mermaidNodeId: p.mermaidNodeId ?? null,
    createdAt: p.createdAt ?? nowIso(),
    expiresAt: p.expiresAt ?? null,
    filePath: p.filePath ?? null,
  };
}

// ========== L1 – Atomic Facts ==========

/**
 * @typedef {Object} L1AtomicFact
 * @property {string} id
 * @property {string|null} ideaId
 * @property {string|null} campaignId
 * @property {string} tenantId
 * @property {string} content
 * @property {'observation'|'preference'|'constraint'|'metric'|'competitor'|'decision'|'risk'|'opportunity'|'hypothesis'} type
 * @property {number} confidence
 * @property {string[]} actors
 * @property {SourceRef[]} sourceRefs
 * @property {string[]} tags
 * @property {number[]} [embedding]
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {'active'|'superseded'|'invalidated'} status
 * @property {string|null} supersededBy
 */

/**
 * @param {Partial<L1AtomicFact> & { content: string }} p
 * @returns {L1AtomicFact}
 */
export function createL1(p) {
  if (!p.content || typeof p.content !== 'string') throw new Error('createL1: content (string) requis');
  const t = nowIso();
  return {
    id: p.id ?? uid(),
    ideaId: p.ideaId ?? null,
    campaignId: p.campaignId ?? null,
    tenantId: p.tenantId ?? 'default',
    content: p.content.trim(),
    type: p.type ?? 'observation',
    confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.7,
    actors: Array.isArray(p.actors) ? p.actors : (p.actors ? [p.actors] : []),
    sourceRefs: Array.isArray(p.sourceRefs) ? p.sourceRefs : [],
    tags: Array.isArray(p.tags) ? p.tags : [],
    embedding: p.embedding ?? undefined,
    createdAt: p.createdAt ?? t,
    updatedAt: p.updatedAt ?? t,
    status: p.status ?? 'active',
    supersededBy: p.supersededBy ?? null,
  };
}

// ========== L2 – Scenarios / Insights ==========

/**
 * @typedef {Object} L2Scenario
 * @property {string} id
 * @property {string} title
 * @property {string} content
 * @property {string} summary
 * @property {string[]} ideaIds
 * @property {string[]} campaignIds
 * @property {string[]} relatedL1Ids
 * @property {'success_path'|'failure_mode'|'competitive_gap'|'process'|'insight'|'ontology_update'|'pattern'} patternType
 * @property {string[]} applicableStages
 * @property {string[]} tags
 * @property {number[]} [embedding]
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {number} confidence
 * @property {'draft'|'validated'|'archived'} reviewStatus
 */

/**
 * @param {Partial<L2Scenario> & { title: string, content: string }} p
 * @returns {L2Scenario}
 */
export function createL2(p) {
  if (!p.title) throw new Error('createL2: title requis');
  if (!p.content) throw new Error('createL2: content requis');
  const t = nowIso();
  return {
    id: p.id ?? uid(),
    title: p.title.trim(),
    content: p.content,
    summary: p.summary ?? p.title,
    ideaIds: Array.isArray(p.ideaIds) ? p.ideaIds : [],
    campaignIds: Array.isArray(p.campaignIds) ? p.campaignIds : [],
    relatedL1Ids: Array.isArray(p.relatedL1Ids) ? p.relatedL1Ids : [],
    patternType: p.patternType ?? 'insight',
    applicableStages: Array.isArray(p.applicableStages) ? p.applicableStages.filter(s => STAGES.includes(s)) : [],
    tags: Array.isArray(p.tags) ? p.tags : [],
    embedding: p.embedding ?? undefined,
    createdAt: p.createdAt ?? t,
    updatedAt: p.updatedAt ?? t,
    confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.6,
    reviewStatus: p.reviewStatus ?? 'draft',
  };
}

// ========== L3 – Core / Persona / Skills ==========

/**
 * @typedef {Object} L3CoreMemory
 * @property {string} id
 * @property {'user'|'team'|'organization'|'tenant'} scope
 * @property {string} scopeId
 * @property {'persona'|'preference'|'norm'|'skill'|'ontology_core'|'decision_style'} kind
 * @property {string} title
 * @property {string} content
 * @property {number} version
 * @property {string[]} relatedL2Ids
 * @property {SourceRef[]} sourceRefs
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} [lastUsedAt]
 * @property {string} [trigger]      // pour skill
 * @property {string[]} [steps]      // pour skill
 * @property {string} [successCriteria]
 */

/**
 * @param {Partial<L3CoreMemory> & { scope: string, scopeId: string, kind: string, title: string, content: string }} p
 * @returns {L3CoreMemory}
 */
export function createL3(p) {
  if (!p.scope || !p.scopeId) throw new Error('createL3: scope + scopeId requis');
  if (!p.kind) throw new Error('createL3: kind requis');
  if (!p.title) throw new Error('createL3: title requis');
  if (!p.content) throw new Error('createL3: content requis');
  const t = nowIso();
  const base = {
    id: p.id ?? uid(),
    scope: p.scope,
    scopeId: p.scopeId,
    kind: p.kind,
    title: p.title.trim(),
    content: p.content,
    version: p.version ?? 1,
    relatedL2Ids: Array.isArray(p.relatedL2Ids) ? p.relatedL2Ids : [],
    sourceRefs: Array.isArray(p.sourceRefs) ? p.sourceRefs : [],
    createdAt: p.createdAt ?? t,
    updatedAt: p.updatedAt ?? t,
    lastUsedAt: p.lastUsedAt ?? null,
  };
  if (p.kind === 'skill') {
    return {
      ...base,
      trigger: p.trigger ?? '',
      steps: Array.isArray(p.steps) ? p.steps : [],
      successCriteria: p.successCriteria ?? null,
    };
  }
  return base;
}

// ========== Helpers ==========

export function isValidStage(s) {
  return STAGES.includes(s);
}

export { uid, nowIso };
