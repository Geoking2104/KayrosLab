// KayrosLab — Bridge orchestrator events → idea stage/status (Phase 4).

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

  if (ev.type === 'final') {
    const st = ev.status;
    if (st === 'pending_review') {
      const out = setStatus(idea, 'en_revue', { by, motif: 'pending_review' });
      return { idea: out, changed: true };
    }
    if (st === 'blocked_veto') {
      const out = setStatus(idea, 'non_poursuivi', { by, motif: ev.message || 'veto' });
      return { idea: out, changed: true };
    }
    if (st === 'revise') {
      let out = setStatus(idea, 'en_revue', { by, motif: ev.message || 'revise' });
      out = setStage(out, 'eprouver', { by, motif: 'revise' });
      return { idea: out, changed: true };
    }
    if (st === 'validated_human' || st === 'auto') {
      let out = idea;
      if (idea.status === 'en_revue' || idea.status === 'nouveau' || idea.status === 'discussion') {
        out = setStatus(out, 'en_developpement', { by, motif: st });
      }
      if (idea.stage !== 'projeter' && idea.stage !== 'realiser') {
        out = setStage(out, 'projeter', { by, motif: st });
      }
      return { idea: out, changed: out !== idea };
    }
  }

  return { idea, changed: false };
}

export { reactivate, setStage, setStatus, applyDecision };
