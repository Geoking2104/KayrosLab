// KayrosLab — Decision packet + gateability (P0).
// Compile a structured, epistemically tagged packet for human gates.
// assertGateable() blocks high-stakes auto-approval when grounding is weak.

import {
  tagEpistemic,
  tagAgentOutput,
  aggregateEpistemic,
  explainUncertainty,
  normalizeLevel,
} from './epistemic.mjs';

export const RECOMMENDATIONS = Object.freeze(['go', 'no-go', 'revise', 'wait', 'unknown']);

export function normalizeRecommendation(raw) {
  const t = String(raw || '').toLowerCase().trim();
  if (!t) return 'unknown';
  if (/\bno[\s-]?go\b|reject|stop|kill/.test(t)) return 'no-go';
  if (/\brevise|revision|iterate|rework/.test(t)) return 'revise';
  if (/\bwait|defer|hold|pause/.test(t)) return 'wait';
  if (/\bgo\b|approve|accept|proceed|launch/.test(t)) return 'go';
  return 'unknown';
}

export function compilePacket(input = {}) {
  const ideaId = input.ideaId || null;
  const goal = input.goal || '';
  const frame = input.frame || goal;
  const taggedClaims = [];

  for (const o of input.agentOutputs || []) {
    if (!o) continue;
    taggedClaims.push(tagAgentOutput(o.agent || 'agent', o.output, {
      degraded: o.degraded,
      degradedReason: o.degraded?.reason || o.degradedReason,
      evidence: o.evidence,
      falsifiers: o.falsifiers,
    }));
  }
  for (const c of input.claims || []) {
    if (c && c.level != null && 'value' in c) taggedClaims.push(c);
    else if (c) taggedClaims.push(tagEpistemic(c.value ?? c, c));
  }

  let world = null;
  if (input.positionning) {
    const mode = input.positionning.mode || 'unknown';
    const level = mode === 'scanners' || mode === 'provided' ? 'observed'
      : mode.startsWith('heuristic') ? 'degraded' : 'unknown';
    world = {
      mode, level,
      competitorCount: input.positionning.competitorCount ?? input.positionning.facts?.length ?? 0,
      gapCount: input.positionning.gapCount ?? 0,
      degraded: level === 'degraded',
    };
    taggedClaims.push(tagEpistemic(
      `positioning:${mode} competitors=${world.competitorCount}`,
      {
        level, source: 'scanner', sourceId: 'positionning', kind: 'observation',
        degraded: world.degraded,
        degradedReason: world.degraded ? `positioning_${mode}` : null,
        evidence: world.competitorCount ? [`competitors:${world.competitorCount}`] : [],
      },
    ));
  }

  const synthesis = input.synthesis || null;
  const structured = synthesis?.structured || {};
  let recommendation = normalizeRecommendation(
    input.recommendation || structured.decision || structured.recommendation
      || extractRecommendationFromText(synthesis?.output || ''),
  );
  const synthDegraded = !!(synthesis?.degraded);
  if (synthDegraded && recommendation === 'go') recommendation = 'revise';

  const recommendationTag = tagEpistemic(recommendation, {
    level: synthDegraded ? 'degraded' : recommendation === 'unknown' ? 'unknown' : 'inferred',
    source: 'agent', sourceId: 'Synthesizer', kind: 'recommendation',
    degraded: synthDegraded,
    degradedReason: synthesis?.degraded?.reason || (synthDegraded ? 'synthesis_degraded' : null),
    confidence: structured.confidence != null ? Number(structured.confidence) : undefined,
    falsifiers: input.falsifiers || structured.falsifiers || [],
    evidence: structured.evidence || [],
  });
  taggedClaims.push(recommendationTag);

  const residualRisks = distinctStrings([
    ...(input.residualRisks || []),
    ...(structured.risks || []),
    ...extractRisksFromAgents(input.agentOutputs || []),
  ]);
  const falsifiers = distinctStrings([
    ...(input.falsifiers || []),
    ...(structured.falsifiers || []),
    ...taggedClaims.flatMap((c) => c.falsifiers || []),
    ...defaultFalsifiers(recommendation, goal),
  ]);

  const survivingOptions = input.survivingOptions || extractOptions(input.agentOutputs || []);
  const killedOptions = input.killedOptions || [];

  // P2 frame assessment enrichment
  let frameMeta = null;
  if (input.frameAssessment) {
    const fa = input.frameAssessment;
    frameMeta = {
      quality: fa.quality,
      dimensions: fa.dimensions,
      issues: (fa.issues || []).map((i) => i.code || i),
      needsReframe: !!fa.needsReframe,
    };
    if (fa.epistemic) taggedClaims.push(fa.epistemic);
    else {
      taggedClaims.push(tagEpistemic(
        `frame_quality:${fa.quality?.toFixed?.(2) ?? fa.quality}`,
        {
          level: fa.quality >= 0.55 ? 'inferred' : 'degraded',
          source: 'system', sourceId: 'frame-controller', kind: 'observation',
          confidence: clamp01(0.35 + (fa.quality || 0) * 0.5),
          evidence: (fa.issues || []).slice(0, 3).map((i) => i.text || i.code || String(i)),
          degraded: fa.quality < 0.4,
        },
      ));
    }
    if (fa.quality < 0.38 && recommendation === 'go') recommendation = 'revise';
  }

  // P3 world-model enrichment
  if (input.worldModel?.epistemic) {
    taggedClaims.push(input.worldModel.epistemic);
  }

  const epistemicStatus = aggregateEpistemic(taggedClaims);
  const uncertainty = explainUncertainty(epistemicStatus, { recommendation, maxFalsifiers: falsifiers });

  // Soft pressure from decision debt (P4)
  if (input.decisionDebt != null && input.decisionDebt > 0.55 && recommendation === 'go') {
    recommendation = 'revise';
  }

  return {
    version: 'p0.4',
    ideaId, goal, frame, recommendation, recommendationTag,
    survivingOptions, killedOptions,
    criticalAssumptions: input.criticalAssumptions || structured.assumptions || [],
    residualRisks, falsifiers,
    evidenceIndex: buildEvidenceIndex(taggedClaims),
    claims: taggedClaims,
    world,
    worldModel: input.worldModel || null,
    frameMeta: frameMeta ? { text: frame, ...frameMeta } : null,
    frameAssessment: frameMeta,
    frameGate: input.frameGate || null,
    decisionDebt: input.decisionDebt ?? null,
    revisitTriggers: input.revisitTriggers || null,
    adaptiveBudget: input.adaptiveBudget || null,
    preferredGateLevel: input.preferredGateLevel || null,
    synthesis: synthesis ? { output: synthesis.output, structured, degraded: synthesis.degraded || null } : null,
    epistemicStatus, uncertainty,
    quant: input.quant || null,
    suggestedNextStage: input.suggestedNextStage || stageForRecommendation(recommendation),
    compiledAt: new Date().toISOString(),
  };
}

function clamp01(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function extractRecommendationFromText(text) {
  if (!text) return 'unknown';
  const m = String(text).match(/\b(no[\s-]?go|go|revise|wait)\b/i);
  return m ? m[1] : 'unknown';
}

function extractRisksFromAgents(agentOutputs) {
  const risks = [];
  for (const o of agentOutputs || []) {
    if (!/red|critic/i.test(o.agent || '')) continue;
    for (const line of String(o.output || '').split(/\n+/)) {
      const s = line.replace(/^\s*[-*\u2022\d.]+\s*/, '').trim();
      if (s.length > 20 && s.length < 240) risks.push(s);
    }
  }
  return risks;
}

function extractOptions(agentOutputs) {
  const out = [];
  for (const o of agentOutputs || []) {
    if (!/bisoci|builder|scenario/i.test(o.agent || '')) continue;
    const text = String(o.output || '').slice(0, 400);
    if (text.length > 30) out.push({ id: `ao-${out.length}`, claim: text, agent: o.agent });
  }
  return out;
}

function defaultFalsifiers(recommendation, goal) {
  const g = String(goal || '').slice(0, 80);
  if (recommendation === 'go') {
    return [
      `Pilot KPIs for "${g}" miss the agreed threshold within 30–60 days.`,
      'Key assumption fails empirical check before scale.',
    ];
  }
  if (recommendation === 'no-go') {
    return ['New evidence re-opens a previously killed option with stronger unit economics.'];
  }
  return ['A clearer frame or stronger evidence appears within one review cycle.'];
}

function stageForRecommendation(rec) {
  if (rec === 'go') return 'projeter';
  if (rec === 'no-go') return 'arbitrer';
  if (rec === 'revise') return 'eprouver';
  return null;
}

function distinctStrings(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr || []) {
    const s = String(x || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function buildEvidenceIndex(claims) {
  const idx = [];
  for (const c of claims || []) {
    for (const e of c.evidence || []) idx.push({ claim: String(c.value || '').slice(0, 80), evidence: e, level: c.level });
  }
  return idx.slice(0, 20);
}

export function assertGateable(packet, opts = {}) {
  const blockers = [];
  const warnings = [];
  const rec = normalizeRecommendation(packet.recommendation);
  const epi = packet.epistemicStatus || aggregateEpistemic(packet.claims || []);

  if (rec === 'unknown' || !packet.recommendation) blockers.push('empty_recommendation');
  if ((packet.falsifiers || []).length === 0 && opts.requireFalsifiers !== false && rec === 'go') {
    blockers.push('missing_falsifiers');
  }
  if (epi.confidence != null && epi.confidence < (opts.minConfidence ?? 0.4) && rec === 'go') {
    blockers.push('low_confidence');
  }
  if (packet.recommendationTag?.degraded || normalizeLevel(packet.recommendationTag?.level) === 'degraded') {
    if (rec === 'go' && opts.allowDegradedGo !== true) blockers.push('degraded_recommendation');
    else warnings.push('degraded_recommendation');
  }
  if ((packet.criticalAssumptions || []).length === 0 && rec === 'go') {
    warnings.push('no_critical_assumptions');
  }
  if (packet.decisionDebt != null && packet.decisionDebt > 0.6 && rec === 'go') {
    warnings.push('elevated_decision_debt');
  }

  let severity = 'ok';
  if (blockers.length) severity = 'block';
  else if (warnings.length) severity = 'warn';

  return { severity, blockers, warnings, recommendation: rec, epistemic: epi };
}

export function applyEpistemicPolicy(packet, opts = {}) {
  const assertion = assertGateable(packet, opts);
  let changed = false;
  let next = { ...packet, epistemicPolicy: assertion };

  if (packet.recommendation === 'go' && assertion.blockers.length > 0) {
    next = {
      ...next,
      recommendation: 'revise',
      recommendationTag: tagEpistemic('revise', {
        ...(packet.recommendationTag || {}),
        value: 'revise', level: 'inferred', kind: 'recommendation',
        evidence: [...(packet.recommendationTag?.evidence || []), `epistemic_blockers:${assertion.blockers.join(',')}`],
      }),
    };
    changed = true;
  }

  return { packet: next, assertion, changed };
}

export function renderPacketForGate(packet, audience = 'comex') {
  const p = packet || {};
  const assertion = assertGateable(p, { level: 'supervise' });
  const uncertainty = p.uncertainty || explainUncertainty(p.epistemicStatus || {}, {
    recommendation: p.recommendation, maxFalsifiers: p.falsifiers,
  });
  return {
    audience,
    ideaId: p.ideaId,
    goal: p.goal,
    frame: p.frame,
    recommendation: p.recommendation,
    suggestedNextStage: p.suggestedNextStage,
    residualRisks: (p.residualRisks || []).slice(0, 8),
    falsifiers: (p.falsifiers || []).slice(0, 6),
    criticalAssumptions: (p.criticalAssumptions || []).slice(0, 6),
    killedOptions: (p.killedOptions || []).slice(0, 5),
    survivingOptions: (p.survivingOptions || []).slice(0, 5),
    epistemic: {
      level: p.epistemicStatus?.level,
      confidence: p.epistemicStatus?.confidence,
      holes: p.epistemicStatus?.criticalHoles || [],
      summary: uncertainty.summary,
    },
    assertion: { severity: assertion.severity, blockers: assertion.blockers, warnings: assertion.warnings },
    world: p.world,
    worldModel: p.worldModel ? {
      stakes: p.worldModel.stakes,
      timeHorizon: p.worldModel.timeHorizon,
      stats: p.worldModel.stats,
    } : null,
    decisionDebt: p.decisionDebt ?? null,
    revisitTriggers: (p.revisitTriggers || []).slice(0, 4),
    preferredGateLevel: p.preferredGateLevel || null,
    adaptiveBudget: p.adaptiveBudget || null,
    frameAssessment: p.frameAssessment || null,
    policy: p.epistemicPolicy || null,
    compiledAt: p.compiledAt,
  };
}

export function policyForPacket(packet, {
  level = 'supervise',
  sensitive = false,
  GateType = { OUTPUT_CENSOR: 'output_censor', COMEX_ARBITRAGE: 'comex_arbitrage' },
} = {}) {
  if (level === 'auto') return null;
  if (level === 'strict') return GateType.COMEX_ARBITRAGE || 'comex_arbitrage';
  const assertion = assertGateable(packet, { level });
  if (assertion.severity === 'block' || assertion.blockers.length) {
    return GateType.COMEX_ARBITRAGE || 'comex_arbitrage';
  }
  if (sensitive || assertion.severity === 'warn') {
    return GateType.OUTPUT_CENSOR || 'output_censor';
  }
  return null;
}
