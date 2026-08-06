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
  const epistemicStatus = aggregateEpistemic(taggedClaims);
  const uncertainty = explainUncertainty(epistemicStatus, { recommendation, maxFalsifiers: falsifiers });

  return {
    version: 'p0.1',
    ideaId, goal, frame, recommendation, recommendationTag,
    survivingOptions, killedOptions,
    criticalAssumptions: input.criticalAssumptions || structured.assumptions || [],
    residualRisks, falsifiers,
    evidenceIndex: buildEvidenceIndex(taggedClaims),
    claims: taggedClaims, world,
    synthesis: synthesis ? { output: synthesis.output, structured, degraded: synthesis.degraded || null } : null,
    epistemicStatus, uncertainty,
    quant: input.quant || null,
    suggestedNextStage: input.suggestedNextStage || stageForRecommendation(recommendation),
    compiledAt: new Date().toISOString(),
  };
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
      const s = line.replace(/^\s*[-*•\d.]+\s*/, '').trim();
      if (s.length > 20 && s.length < 240) risks.push(s);
    }
  }
  return risks.slice(0, 12);
}

function extractOptions(agentOutputs) {
  const opts = [];
  for (const o of agentOutputs || []) {
    if (!/bisoci|builder|scenario/i.test(o.agent || '')) continue;
    opts.push({
      agent: o.agent,
      summary: String(o.output || '').slice(0, 280),
      epistemic: tagAgentOutput(o.agent, o.output, { degraded: o.degraded }),
    });
  }
  return opts;
}

function defaultFalsifiers(recommendation, goal) {
  const g = goal || 'the proposal';
  const base = [
    `Evidence shows a dominant competitor already owns the core value of ${g}`,
    `Regulatory or compliance barrier makes ${g} non-viable in target market`,
    `Key technical assumption fails a limited pilot`,
  ];
  if (recommendation === 'go') {
    base.push('Early KPI trajectory diverges negatively beyond agreed drift threshold');
  }
  return base;
}

function stageForRecommendation(rec) {
  switch (rec) {
    case 'go': return 'projeter';
    case 'no-go': return null;
    case 'revise': return 'eprouver';
    case 'wait': return 'ecouter';
    default: return 'arbitrer';
  }
}

function buildEvidenceIndex(claims) {
  const idx = [];
  for (const c of claims || []) {
    for (const e of c.evidence || []) idx.push({ ref: e, claimLevel: c.level, sourceId: c.sourceId });
    if (c.sourceId) idx.push({ ref: `source:${c.sourceId}`, claimLevel: c.level, sourceId: c.sourceId });
  }
  const seen = new Set();
  return idx.filter((x) => { if (seen.has(x.ref)) return false; seen.add(x.ref); return true; }).slice(0, 40);
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

export function assertGateable(packet, opts = {}) {
  const level = opts.level || 'supervise';
  const blockers = [];
  const warnings = [];
  if (!packet || typeof packet !== 'object') {
    return { gateable: false, blockers: ['packet_incomplete'], warnings: [], severity: 'block' };
  }
  const rec = normalizeRecommendation(packet.recommendation);
  const epi = packet.epistemicStatus || aggregateEpistemic(packet.claims || []);
  const conf = epi.confidence ?? 0;

  if (rec === 'unknown' || !packet.recommendation) blockers.push('empty_recommendation');
  if (opts.requireFalsifiers !== false) {
    const falsifiers = packet.falsifiers || [];
    if (rec === 'go' && falsifiers.length === 0) blockers.push('missing_falsifiers');
    else if (falsifiers.length === 0) warnings.push('missing_falsifiers');
  }
  if (epi.criticalHoles?.includes('no_grounded_evidence')) {
    if (rec === 'go') blockers.push('no_grounded_evidence');
    else warnings.push('no_grounded_evidence');
  }
  if (epi.criticalHoles?.includes('majority_degraded')) {
    if (rec === 'go') blockers.push('majority_degraded');
    else warnings.push('majority_degraded');
  }
  if (packet.recommendationTag?.degraded || normalizeLevel(packet.recommendationTag?.level) === 'degraded') {
    if (rec === 'go' && opts.allowDegradedGo !== true) blockers.push('degraded_recommendation');
    else warnings.push('degraded_recommendation');
  }
  if (rec === 'go' && conf < (opts.minConfidence ?? 0.4)) blockers.push('insufficient_evidence_for_go');
  if (rec === 'go' && packet.world?.degraded) warnings.push('positioning_degraded');

  if (level === 'strict' && blockers.length === 0 && warnings.length > 0) {
    for (const w of ['majority_degraded', 'no_grounded_evidence', 'positioning_degraded']) {
      if (warnings.includes(w)) blockers.push(w);
    }
  }

  const severity = blockers.length ? 'block' : warnings.length ? 'warn' : 'none';
  return {
    gateable: level === 'auto' ? blockers.length === 0 : blockers.length === 0 || rec !== 'go',
    blockers: distinctStrings(blockers),
    warnings: distinctStrings(warnings),
    severity,
    recommendation: rec,
    confidence: conf,
    level: epi.level,
  };
}

export function applyEpistemicPolicy(packet, opts = {}) {
  const assertion = assertGateable(packet, opts);
  let changed = false;
  let next = packet;
  if (packet.recommendation === 'go' && assertion.blockers.length > 0) {
    next = {
      ...packet,
      recommendation: 'revise',
      recommendationTag: tagEpistemic('revise', {
        ...(packet.recommendationTag || {}),
        value: 'revise', level: 'inferred', kind: 'recommendation',
        evidence: [...(packet.recommendationTag?.evidence || []), `epistemic_blockers:${assertion.blockers.join(',')}`],
        falsifiers: packet.falsifiers,
        extra: { ...(packet.recommendationTag?.extra || {}), downgradedFrom: 'go', blockers: assertion.blockers },
      }),
      epistemicPolicy: { downgradedFrom: 'go', blockers: assertion.blockers, warnings: assertion.warnings },
      suggestedNextStage: 'eprouver',
    };
    changed = true;
  } else if (assertion.warnings.length || assertion.blockers.length) {
    next = { ...packet, epistemicPolicy: { blockers: assertion.blockers, warnings: assertion.warnings } };
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
