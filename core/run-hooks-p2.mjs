// P2 hooks — cheap frame control before (or early in) the expensive cycle.
import { runFrameControl } from './frame.mjs';

/**
 * Opt-in frame control for orchestrator.run.
 * Returns events + possible effectiveFrame override + gate signal.
 */
export async function runP2Hooks({ plan, opts = {}, llm = null, agents = null }) {
  if (opts.frameControl === false) {
    return { events: [], effectiveFrame: opts.frame || plan.goal, gate: { open: false, reason: 'disabled' } };
  }

  // Default: soft on (heuristic only). Explicit 'llm' or true enables more.
  const enabled = opts.frameControl === true
    || opts.frameControl === 'llm'
    || opts.frameControl === 'always'
    || opts.forceFrameGate
    || opts.autoPickFrame;

  if (!enabled && opts.frameControl == null) {
    // Still run a lightweight assessment for packet enrichment when not explicitly disabled
    // but do not block or reframe unless quality is critically low.
  }

  try {
    const result = await runFrameControl({
      goal: opts.frame || plan.goal,
      opts: {
        ...opts,
        ideaId: plan.ideaId,
        alwaysReframe: opts.frameControl === 'always' || opts.alwaysReframe,
        llmReframe: opts.frameControl === 'llm',
        autoPickFrame: opts.autoPickFrame !== false, // default auto-pick when very weak
        minFrameQuality: opts.minFrameQuality,
        frameSeverityGate: opts.frameSeverityGate,
        forceFrameGate: opts.forceFrameGate,
        frameGate: opts.frameGate,
        maxReframes: opts.maxReframes,
      },
      llm,
      agents,
    });

    return {
      events: result.events || [],
      assessment: result.assessment,
      reframes: result.reframes,
      chosen: result.chosen,
      gate: result.gate,
      effectiveFrame: result.effectiveFrame,
      original: result.original,
    };
  } catch {
    return {
      events: [],
      effectiveFrame: opts.frame || plan.goal,
      gate: { open: false, reason: 'error' },
    };
  }
}
