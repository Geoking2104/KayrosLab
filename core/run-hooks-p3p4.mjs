// P3 + P4 hooks for Orchestrator.run
// P3: world model + multi-resolution gate
// P4: adaptive compute pressure + residual portfolio + decision debt

import { runWorldModelControl } from './world-model.mjs';
import { runAdaptiveControl } from './adaptive.mjs';

/**
 * Run after agents / P1, before final packet.
 * Mutates useful fields onto the returned object for packet compilation.
 */
export async function runP3P4Hooks({
  plan,
  opts = {},
  agentOutputs = [],
  contextBlock = '',
  survivingOptions = null,
  killedOptions = null,
  residualRisks = null,
  frameAssessment = null,
  synthesis = null,
} = {}) {
  const events = [];
  const ideaId = plan?.ideaId || opts.ideaId || null;
  const goal = plan?.goal || opts.goal || '';

  let world = null;
  let gateResolution = null;
  let packetFields = {};
  let adaptive = null;

  // --- P3: World model (opt-in, default soft-on when frameControl or explicit) ---
  const wantWorld = opts.worldModel === true
    || opts.worldModel === 'llm'
    || opts.p3 === true
    || opts.frameControl; // natural continuum after frame

  if (wantWorld) {
    try {
      const wm = await runWorldModelControl({
        goal,
        contextBlock,
        positionning: opts._lastPositionning || null,
        opts: {
          ideaId,
          worldModel: opts.worldModel,
          enrichWorld: opts.enrichWorld || opts.worldModel === 'llm',
          llm: opts.llm || null,
          provider: opts.provider,
          sovereignty: opts.sovereignty,
          frameQuality: frameAssessment?.quality ?? opts.frameQuality ?? 0.5,
          epistemicRank: opts.epistemicRank ?? 2,
          recommendation: opts.recommendation
            || synthesis?.structured?.decision
            || synthesis?.structured?.recommendation
            || 'unknown',
          forceGateLevel: opts.forceGateLevel || null,
          degraded: opts.degraded || false,
        },
      });
      world = wm.world;
      gateResolution = wm.gateResolution;
      packetFields = { ...packetFields, ...wm.packetFields };
      for (const ev of wm.events || []) events.push(ev);
    } catch { /* soft */ }
  }

  // --- P4: Adaptive + residual portfolio (opt-in) ---
  const wantAdaptive = opts.adaptive === true
    || opts.p4 === true
    || opts.residualPortfolio === true
    || wantWorld; // continuum

  if (wantAdaptive) {
    try {
      const novMedian = opts.noveltyMedian
        ?? opts._lastNoveltyStats?.median
        ?? 0.5;
      const epiRank = opts.epistemicRank
        ?? (frameAssessment?.quality > 0.6 ? 3 : 2);

      adaptive = runAdaptiveControl({
        frameQuality: frameAssessment?.quality ?? 0.5,
        epistemicRank: epiRank,
        noveltyMedian: novMedian,
        stakes: world?.stakes || opts.stakes || 'medium',
        criticalAssumptions: world?.stats?.criticalAssumptions ?? 0,
        survivingOptions: survivingOptions || opts.survivingOptions || [],
        killedOptions: killedOptions || opts.killedOptions || [],
        residualRisks: residualRisks || opts.residualRisks || [],
        world,
        recommendation: opts.recommendation
          || synthesis?.structured?.decision
          || 'unknown',
        opts: {
          baseMaxSteps: opts.maxSteps,
          baseDialecticMax: opts.dialecticMaxOptions,
          baseNoveltyRounds: opts.noveltyMaxRounds,
        },
      });

      packetFields = { ...packetFields, ...adaptive.packetFields };
      for (const ev of adaptive.events || []) events.push(ev);
    } catch { /* soft */ }
  }

  return {
    events,
    world,
    gateResolution,
    adaptive,
    packetFields,
    // convenience for packet / policy
    criticalAssumptions: packetFields.criticalAssumptions || null,
    falsifiers: packetFields.falsifiers || null,
    residualRisks: packetFields.residualRisks || residualRisks,
    decisionDebt: packetFields.decisionDebt ?? null,
    revisitTriggers: packetFields.revisitTriggers || null,
    preferredGateLevel: gateResolution?.level || null,
    adaptiveBudget: adaptive?.budget || null,
  };
}
