// KayrosLab — Problem frame control (P2).
// Cheap assessment + reframing before expensive multi-agent cycles.
// Goal: refuse to burn tokens on a weak / ambiguous / unconstrained frame.

import { tagEpistemic } from './epistemic.mjs';

/** Frame quality dimensions (0–1). Higher is better. */
export function scoreFrameDimensions(goal = '', ctx = {}) {
  const g = String(goal || '').trim();
  const lower = g.toLowerCase();
  const words = g.split(/\s+/).filter(Boolean);
  const len = words.length;

  // Specificity: length + concrete nouns/verbs vs pure abstraction
  let specificity = 0.25;
  if (len >= 6) specificity += 0.2;
  if (len >= 12) specificity += 0.15;
  if (len >= 20) specificity += 0.1;
  if (/\b(client|user|customer|marché|market|segment|b2b|b2c|sme|startup)\b/i.test(g)) specificity += 0.15;
  if (/\b(how|comment|what|quel|pourquoi|why)\b/i.test(lower)) specificity += 0.05;
  if (/^\s*(améliorer|improve|optimiser|optimize|innover|innov)\b/i.test(g) && len < 8) specificity -= 0.2;
  specificity = clamp01(specificity);

  // Constraints: budget, time, regulation, resources, geography
  let constraints = 0.15;
  if (/\b(budget|€|\$|cost|coût|resource|ressource)\b/i.test(g)) constraints += 0.25;
  if (/\b(month|mois|week|semaine|quarter|trimestre|202[6-9]|deadline|délai)\b/i.test(g)) constraints += 0.2;
  if (/\b(gdpr|rgpd|nis2|dora|compliance|réglement|legal|juridique)\b/i.test(g)) constraints += 0.2;
  if (/\b(france|eu|europe|us|apac|paris|remote)\b/i.test(g)) constraints += 0.1;
  if (ctx.hasPositionning) constraints += 0.1;
  constraints = clamp01(constraints);

  // Stakeholders / actors
  let stakeholders = 0.2;
  if (/\b(client|customer|user|utilisateur|employé|team|équipe|partner|partenaire|board|comex)\b/i.test(g)) stakeholders += 0.3;
  if (/\b(diagnostiqueur|agence|agent|investisseur|investor|founder)\b/i.test(g)) stakeholders += 0.2;
  stakeholders = clamp01(stakeholders);

  // Measurability / success criteria
  let measurability = 0.15;
  if (/\b(%|kpi|metric|score|taux|rate|roi|arr|mrr|conversion|nps)\b/i.test(g)) measurability += 0.35;
  if (/\b(augmenter|increase|réduire|reduce|atteindre|reach|x2|double)\b/i.test(g)) measurability += 0.2;
  if (/\b(test|pilot|poc|mvp|experiment)\b/i.test(g)) measurability += 0.15;
  measurability = clamp01(measurability);

  // Time / horizon clarity
  let timeHorizon = 0.25;
  if (/\b(court terme|short.?term|long terme|long.?term|6 mois|12 mois|this year|cette année)\b/i.test(g)) timeHorizon += 0.35;
  if (/\b(immédiat|now|asap|urgent)\b/i.test(g)) timeHorizon += 0.2;
  timeHorizon = clamp01(timeHorizon);

  const quality = clamp01(
    0.28 * specificity +
    0.22 * constraints +
    0.18 * stakeholders +
    0.20 * measurability +
    0.12 * timeHorizon
  );

  return {
    specificity, constraints, stakeholders, measurability, timeHorizon, quality,
  };
}

export function detectFrameIssues(goal = '', dims = null) {
  const d = dims || scoreFrameDimensions(goal);
  const issues = [];
  if (d.specificity < 0.4) issues.push({ code: 'vague', severity: 0.8, text: 'Frame is too abstract or short; lacks concrete object or action.' });
  if (d.constraints < 0.35) issues.push({ code: 'no_constraints', severity: 0.6, text: 'No visible budget, time, regulatory or geographic constraints.' });
  if (d.stakeholders < 0.4) issues.push({ code: 'no_actors', severity: 0.55, text: 'Primary actors / beneficiaries are not named.' });
  if (d.measurability < 0.35) issues.push({ code: 'no_success_metric', severity: 0.7, text: 'No success criterion or measurable outcome stated.' });
  if (d.timeHorizon < 0.35) issues.push({ code: 'no_horizon', severity: 0.4, text: 'Time horizon is undefined.' });
  if (/^\s*(améliorer|improve|optimiser|optimize)\b/i.test(goal) && String(goal).split(/\s+/).length < 10) {
    issues.push({ code: 'generic_improve', severity: 0.75, text: 'Starts with generic "improve/optimise" without target system or metric.' });
  }
  return issues.sort((a, b) => b.severity - a.severity);
}

/** Heuristic reframes — zero LLM, always available. */
export function generateHeuristicReframes(goal = '', max = 4) {
  const g = String(goal || '').trim() || 'the current idea';
  const short = g.length > 90 ? g.slice(0, 87) + '…' : g;
  const reframes = [
    {
      id: 'r-outcome',
      label: 'Outcome-first',
      frame: `What measurable outcome would make "${short}" a clear success within 6–12 months, and for which primary stakeholder?`,
      rationale: 'Forces success metric + actor + horizon.',
      axes: ['measurability', 'stakeholders', 'timeHorizon'],
    },
    {
      id: 'r-constraint',
      label: 'Constraint-first',
      frame: `Given realistic budget, regulatory and time constraints, what is the highest-leverage version of: ${short}`,
      rationale: 'Surfaces hidden constraints early.',
      axes: ['constraints', 'specificity'],
    },
    {
      id: 'r-job',
      label: 'Job-to-be-done',
      frame: `What job is the user / customer trying to get done that "${short}" claims to advance, and how would we know the job is better done?`,
      rationale: 'Re-anchors on user progress, not solution features.',
      axes: ['stakeholders', 'measurability'],
    },
    {
      id: 'r-anti',
      label: 'Anti-goal',
      frame: `What would make "${short}" a waste of effort, and how do we design the smallest test that would falsify the core assumption?`,
      rationale: 'Injects falsifiability and kill criteria.',
      axes: ['measurability', 'specificity'],
    },
    {
      id: 'r-scope',
      label: 'Narrow-scope pilot',
      frame: `What is the smallest coherent pilot (one segment, one channel, one metric) that would de-risk the core of: ${short}`,
      rationale: 'Collapses ambition into a testable first step.',
      axes: ['specificity', 'constraints', 'measurability'],
    },
  ];
  return reframes.slice(0, max);
}

export function assessFrame(goal, opts = {}) {
  const dims = scoreFrameDimensions(goal, opts);
  const issues = detectFrameIssues(goal, dims);
  const maxSeverity = issues.reduce((m, i) => Math.max(m, i.severity || 0), 0);
  const quality = dims.quality;
  const needsReframe = quality < (opts.minQuality ?? 0.45) || maxSeverity >= (opts.severityGate ?? 0.7);
  const epistemic = tagEpistemic(
    { quality, issues: issues.map((i) => i.code) },
    {
      level: quality >= 0.6 ? 'inferred' : quality >= 0.4 ? 'hypothesized' : 'degraded',
      source: 'system',
      sourceId: 'frame-controller',
      confidence: clamp01(0.3 + quality * 0.55),
      kind: 'observation',
      evidence: issues.slice(0, 3).map((i) => i.text),
    },
  );
  return {
    goal: String(goal || ''),
    dimensions: dims,
    quality,
    issues,
    needsReframe,
    maxSeverity,
    epistemic,
    assessedAt: new Date().toISOString(),
  };
}

export function shouldOpenFrameGate(assessment, opts = {}) {
  if (opts.forceFrameGate) return { open: true, reason: 'forced' };
  if (opts.frameGate === false) return { open: false, reason: 'disabled' };
  if (!assessment?.needsReframe) return { open: false, reason: 'frame_ok' };
  if (assessment.quality < (opts.autoReframeBelow ?? 0.32)) {
    return { open: false, reason: 'auto_reframe', auto: true };
  }
  return {
    open: true,
    reason: assessment.issues[0]?.code || 'low_quality',
    severity: assessment.maxSeverity,
  };
}

/**
 * Run frame control: assess → optional reframes → decide gate or auto-pick.
 * Soft, zero-dep by default. Optional light LLM via opts.llm or opts.reframeAgent.
 */
export async function runFrameControl({ goal, opts = {}, llm = null, agents = null } = {}) {
  const assessment = assessFrame(goal, {
    minQuality: opts.minFrameQuality,
    severityGate: opts.frameSeverityGate,
    hasPositionning: !!opts._lastPositionning,
  });
  const events = [];
  events.push({
    type: 'frame_assess',
    ideaId: opts.ideaId || null,
    quality: assessment.quality,
    dimensions: assessment.dimensions,
    issues: assessment.issues,
    needsReframe: assessment.needsReframe,
    ts: new Date().toISOString(),
  });

  let reframes = [];
  let chosen = null;
  let gate = shouldOpenFrameGate(assessment, opts);

  if (assessment.needsReframe || opts.alwaysReframe) {
    reframes = generateHeuristicReframes(goal, opts.maxReframes ?? 4);

    // Optional light LLM enrichment (soft)
    if ((opts.llmReframe === true || opts.frameControl === 'llm') && (llm || agents?.Planner)) {
      try {
        const agent = agents?.Planner || null;
        const prompt = `Propose 2 alternative strategic frames for this goal. Return a JSON array of {label, frame, rationale}.\n\nGOAL: ${goal}`;
        let text = '';
        if (agent && typeof agent.execute === 'function') {
          const res = await agent.execute(prompt, { temperature: 0.4, ...opts });
          text = res.output || res.text || '';
        } else if (llm && typeof llm.complete === 'function') {
          const res = await llm.complete({
            role: 'Planner', temperature: 0.4, think: false,
            messages: [
              { role: 'system', content: 'You produce tight strategic reframes. JSON only.' },
              { role: 'user', content: prompt },
            ],
          }, opts);
          text = res.text || '';
        }
        const extra = parseReframeJson(text);
        if (extra.length) {
          reframes = [...extra.map((r, i) => ({
            id: `r-llm-${i}`,
            label: r.label || `LLM-${i + 1}`,
            frame: r.frame,
            rationale: r.rationale || 'LLM reframe',
            axes: ['llm'],
          })), ...reframes].slice(0, opts.maxReframes ?? 5);
        }
      } catch { /* soft — stay heuristic */ }
    }

    events.push({
      type: 'frame_reframes',
      ideaId: opts.ideaId || null,
      count: reframes.length,
      labels: reframes.map((r) => r.label),
      ts: new Date().toISOString(),
    });

    // Auto-pick when quality is very low and gate not forced
    if (gate.auto || (opts.autoPickFrame && !gate.open)) {
      chosen = pickBestReframe(reframes, assessment);
      gate = { open: false, reason: 'auto_picked', auto: true };
      events.push({
        type: 'frame_auto_pick',
        ideaId: opts.ideaId || null,
        chosenId: chosen?.id,
        label: chosen?.label,
        frame: chosen?.frame?.slice(0, 200),
        ts: new Date().toISOString(),
      });
    }
  }

  return {
    original: goal,
    assessment,
    reframes,
    chosen,
    gate,
    events,
    // Convenience: the frame the rest of the pipeline should use
    effectiveFrame: chosen?.frame || opts.frame || goal,
  };
}

function pickBestReframe(reframes, assessment) {
  if (!reframes?.length) return null;
  // Prefer reframes that cover the weakest dimensions
  const weak = Object.entries(assessment.dimensions || {})
    .filter(([k, v]) => k !== 'quality' && v < 0.4)
    .map(([k]) => k);
  let best = reframes[0];
  let bestScore = -1;
  for (const r of reframes) {
    let s = 0;
    for (const a of r.axes || []) if (weak.includes(a)) s += 1;
    if (r.id?.startsWith('r-outcome') || r.id?.startsWith('r-anti')) s += 0.3;
    if (s > bestScore) { bestScore = s; best = r; }
  }
  return best;
}

function parseReframeJson(text) {
  if (!text) return [];
  try {
    const m = String(text).match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && (x.frame || x.text))
      .map((x) => ({
        label: String(x.label || x.title || 'Reframe').slice(0, 60),
        frame: String(x.frame || x.text || '').slice(0, 400),
        rationale: String(x.rationale || x.why || '').slice(0, 200),
      }));
  } catch {
    return [];
  }
}

function clamp01(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
