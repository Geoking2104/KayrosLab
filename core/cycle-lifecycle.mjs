// KayrosLab — Bridge orchestrator events → idea stage/status (Phase 4).
// Gate resolution (Phase B) maps approve/reject/revise → status + stage.

import { setStage, setStatus, reactivate, applyDecision, isValidStage } from './model.mjs';

/** Map agent role → process stage (8-step recipe). */
export const AGENT_TO_STAGE = {
  Scanner: 'ecouter',
  SignalScanner: 'ecouter',
  Scout: 'ecouter',
  Ecouter: 'ecouter',
  TrendMapper: 'cartographier',
  Mapper: 'cartographier',
  Cartographier: 'cartographier',
  ScenarioGenerator: 'construire',
  Builder: 'construire',
  Construire: 'construire',
  Positioner: 'construire',
  Positionneur: 'construire',
  Critic: 'eprouver',
  RedTeam: 'eprouver',
  Eprouver: 'eprouver',
  Synthesizer: 'arbitrer',
  Arbitrer: 'arbitrer',
  Projection: 'projeter',
  ProjectionAgent: 'projeter',
  Projeter: 'projeter',
  ExecutionTracker: 'realiser',
  Realiser: 'realiser',
  Planner: 'recueillir',
};

export function stageForAgent(agent) {
  if (!agent) return null;
  const key = String(agent).replace(/\s+/g, '');
  return AGENT_TO_STAGE[key] || AGENT_TO_STAGE[agent] || null;
}

/**
 * Map human gate decision → idea status/stage.
 * Accepts: approve | reject | revise | validated_human | blocked_veto
 * @returns {{ idea, changed: boolean }}
 */
export function applyGateResolution(idea, {
  decision,
  by = null,
  reason = '',
} = {}) {
  if (!idea || !decision) return { idea, changed: false };
  const d = String(decision).toLowerCase();
  const motif = reason || d;

  if (d === 'approve' || d === 'validated_human' || d === 'accept') {
    let out = setStatus(idea, 'en_developpement', { by, motif });
    if (out.stage !== 'projeter' && out.stage !== 'realiser') {
      out = setStage(out, 'projeter', { by, motif: 'gate approved' });
    }
    return { idea: out, changed: true };
  }

  if (d === 'reject' || d === 'blocked_veto' || d === 'veto') {
    const out = setStatus(idea, 'non_poursuivi', { by, motif });
    return { idea: out, changed: true };
  }

  if (d === 'revise' || d === 'revision') {
    let out = setStatus(idea, 'en_revue', { by, motif });
    out = setStage(out, 'eprouver', { by, motif: 'gate revise' });
    return { idea: out, changed: true };
  }

  return { idea, changed: false };
}

/**
 * Apply one orchestrator event onto an idea record (immutable return).
 * @returns {{ idea, changed: boolean, event?: object }}
 */
export function applyCycleEvent(idea, ev, { by = 'cycle' } = {}) {
  if (!idea || !ev?.type) return { idea, changed: false };

  if (ev.type === 'start') {
    let out = idea;
    if (idea.status === 'nouveau') {
      out = setStatus(out, 'en_revue', { by, motif: 'cycle.start' });
    }
    if (idea.stage === 'recueillir') {
      out = setStage(out, 'ecouter', { by, motif: 'cycle.start' });
    }
    return { idea: out, changed: out !== idea };
  }

  if (ev.type === 'trace' && ev.agent) {
    const stage = stageForAgent(ev.agent);
    if (stage && stage !== idea.stage && isValidStage(stage)) {
      const out = setStage(idea, stage, { by, motif: `agent:${ev.agent}` });
      return { idea: out, changed: true };
    }
  }

  if (ev.type === 'synthesis' && ev.decision) {
    try {
      const out = applyDecision(idea, ev.decision, { by });
      return { idea: out, changed: true };
    } catch {
      /* soft: decision shape may be free-form */
    }
  }

  if (ev.type === 'gate') {
    const out = setStatus(idea, 'en_revue', { by, motif: `gate:${ev.gateType || 'pending'}` });
    return { idea: out, changed: out.status !== idea.status || out !== idea };
  }

  if (ev.type === 'gate_resolved') {
    return applyGateResolution(idea, {
      decision: ev.decision,
      by: ev.by || by,
      reason: ev.reason || '',
    });
  }

  if (ev.type === 'final') {
    const st = ev.status;
    if (st === 'pending_review') {
      const out = setStatus(idea, 'en_revue', { by, motif: 'pending_review' });
      return { idea: out, changed: true };
    }
    if (st === 'blocked_veto') {
      return applyGateResolution(idea, { decision: 'reject', by, reason: ev.message || 'veto' });
    }
    if (st === 'revise') {
      return applyGateResolution(idea, { decision: 'revise', by, reason: ev.message || 'revise' });
    }
    if (st === 'validated_human' || st === 'auto') {
      return applyGateResolution(idea, {
        decision: st === 'validated_human' ? 'approve' : 'approve',
        by,
        reason: st,
      });
    }
  }

  return { idea, changed: false };
}

export { reactivate, setStage, setStatus, applyDecision };
