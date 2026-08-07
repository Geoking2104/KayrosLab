// KayrosLab — Adaptive compute + residual-risk portfolio + decision debt (P4).
// Allocates effort based on frame / epistemic / novelty pressure.
// Tracks residual risk across survivors and emits revisit / debt signals.
// Zero-dependency.

import { tagEpistemic } from './epistemic.mjs';

/** Compute a 0–1 "pressure" score that drives how much work we should do. */
export function computePressure({
  frameQuality = 0.5,
  epistemicRank = 2, // 0–4
  noveltyMedian = 0.5,
  stakes = 'medium',
  criticalAssumptions = 0,
  survivingCount = 0,
} = {}) {
  const stakeW = stakes === 'high' ? 0.35 : stakes === 'low' ? 0.1 : 0.22;
  const frameGap = 1 - clamp01(frameQuality);
  const epiGap = 1 - (epistemicRank / 4);
  const noveltyGap = 1 - clamp01(noveltyMedian);
  const assumptionLoad = Math.min(1, criticalAssumptions / 4);

  // Higher pressure → more compute / stricter gates
  const pressure = clamp01(
    0.25 * frameGap +
    0.25 * epiGap +
    0.15 * noveltyGap +
    0.2 * stakeW +
    0.15 * assumptionLoad,
  );

  return {
    pressure: Math.round(pressure * 100) / 100,
    components: {
      frameGap: round2(frameGap),
      epiGap: round2(epiGap),
      noveltyGap: round2(noveltyGap),
      stakeW: round2(stakeW),
      assumptionLoad: round2(assumptionLoad),
    },
  };
}

/** Suggest compute budget (agent steps, dialectic depth, novelty rounds). */
export function allocateCompute(pressureObj, opts = {}) {
  const p = typeof pressureObj === 'number' ? pressureObj : pressureObj?.pressure ?? 0.4;
  const baseSteps = opts.baseMaxSteps ?? 12;
  const baseDialectic = opts.baseDialecticMax ?? 3;
  const baseNoveltyRounds = opts.baseNoveltyRounds ?? 1;

  // Low pressure → cheaper run; high pressure → deeper
  const factor = 0.6 + p * 0.9; // 0.6 … 1.5
  return {
    maxSteps: Math.max(4, Math.round(baseSteps * factor)),
    dialecticMaxOptions: Math.max(1, Math.round(baseDialectic * (0.7 + p))),
    noveltyMaxRounds: p > 0.55 ? Math.max(2, baseNoveltyRounds + 1) : baseNoveltyRounds,
    requireFalsifiers: p > 0.4,
    preferHeavyGate: p > 0.65,
    pressure: p,
  };
}

/** Build residual-risk portfolio from surviving / killed options + world assumptions. */
export function buildResidualPortfolio({
  survivingOptions = [],
  killedOptions = [],
  residualRisks = [],
  world = null,
  recommendation = 'unknown',
} = {}) {
  const items = [];

  for (const o of survivingOptions || []) {
    const claim = typeof o === 'string' ? o : (o.claim || o.text || o.id || '');
    const risk = typeof o === 'object' && o.residualSeverity != null
      ? Number(o.residualSeverity)
      : 0.45;
    items.push({
      id: o.id || `surv-${items.length}`,
      kind: 'survivor',
      claim: String(claim).slice(0, 240),
      residualSeverity: clamp01(risk),
      status: 'open',
    });
  }

  for (const r of residualRisks || []) {
    items.push({
      id: `rr-${items.length}`,
      kind: 'explicit',
      claim: String(r).slice(0, 240),
      residualSeverity: 0.55,
      status: 'open',
    });
  }

  // Critical assumptions that remain un-falsified become residual risk
  for (const a of (world?.assumptions || []).filter((x) => x.critical)) {
    items.push({
      id: a.id || `assump-${items.length}`,
      kind: 'assumption',
      claim: a.text,
      residualSeverity: 0.5 + (1 - (a.confidence || 0.4)) * 0.3,
      status: 'open',
      falsifier: a.falsifier || null,
    });
  }

  // Aggregate
  const open = items.filter((i) => i.status === 'open');
  const avg = open.length
    ? open.reduce((s, i) => s + i.residualSeverity, 0) / open.length
    : 0.3;
  const max = open.length ? Math.max(...open.map((i) => i.residualSeverity)) : 0.3;

  const portfolioRisk = clamp01(0.6 * avg + 0.4 * max);

  // Decision debt: Go with high residual → debt; No-Go with high novelty loss → opportunity debt
  let decisionDebt = 0;
  let debtReason = null;
  if (recommendation === 'go' && portfolioRisk > 0.55) {
    decisionDebt = round2(portfolioRisk * 0.8);
    debtReason = 'go_with_elevated_residual';
  } else if (recommendation === 'no-go' && (survivingOptions || []).length === 0 && (killedOptions || []).length > 2) {
    decisionDebt = 0.35;
    debtReason = 'possible_overkill';
  } else if (recommendation === 'revise') {
    decisionDebt = round2(0.25 + portfolioRisk * 0.3);
    debtReason = 'open_revision';
  }

  return {
    items: open.slice(0, 12),
    stats: {
      openCount: open.length,
      avgSeverity: round2(avg),
      maxSeverity: round2(max),
      portfolioRisk: round2(portfolioRisk),
      decisionDebt: round2(decisionDebt),
      debtReason,
    },
    epistemic: tagEpistemic(
      `residual portfolio risk=${round2(portfolioRisk)} debt=${round2(decisionDebt)}`,
      {
        level: portfolioRisk > 0.6 ? 'inferred' : 'hypothesized',
        source: 'system',
        sourceId: 'adaptive',
        kind: 'risk',
        confidence: 0.5,
      },
    ),
  };
}

/** Suggest revisit / monitoring triggers (decision debt paydown). */
export function suggestRevisitTriggers(portfolio, world = null, opts = {}) {
  const triggers = [];
  const risk = portfolio?.stats?.portfolioRisk ?? 0;
  const debt = portfolio?.stats?.decisionDebt ?? 0;

  if (debt > 0.4 || risk > 0.55) {
    triggers.push({
      id: 'pilot-kpi',
      when: 'after_pilot_30d',
      action: 'Re-score residual risks against pilot KPIs; close or escalate open assumptions.',
      priority: 'high',
    });
  }
  if ((world?.assumptions || []).some((a) => a.critical && a.category === 'compliance')) {
    triggers.push({
      id: 'legal-review',
      when: 'before_scale',
      action: 'Mandatory legal / security gate before production rollout.',
      priority: 'high',
    });
  }
  if ((world?.timeHorizon === 'near' || opts.nearTerm) && risk > 0.4) {
    triggers.push({
      id: 'mid-pilot-check',
      when: 'day_15',
      action: 'Lightweight frame + residual check; abort or reframe if leading indicators red.',
      priority: 'medium',
    });
  }
  if (triggers.length === 0 && risk > 0.35) {
    triggers.push({
      id: 'quarterly-review',
      when: 'next_quarter',
      action: 'Portfolio residual review against new market / internal signals.',
      priority: 'low',
    });
  }
  return triggers;
}

/** Full P4 control pass. */
export function runAdaptiveControl({
  frameQuality = 0.5,
  epistemicRank = 2,
  noveltyMedian = 0.5,
  stakes = 'medium',
  criticalAssumptions = 0,
  survivingOptions = [],
  killedOptions = [],
  residualRisks = [],
  world = null,
  recommendation = 'unknown',
  opts = {},
} = {}) {
  const pressure = computePressure({
    frameQuality,
    epistemicRank,
    noveltyMedian,
    stakes,
    criticalAssumptions,
    survivingCount: survivingOptions.length,
  });

  const budget = allocateCompute(pressure, opts);
  const portfolio = buildResidualPortfolio({
    survivingOptions,
    killedOptions,
    residualRisks,
    world,
    recommendation,
  });
  const triggers = suggestRevisitTriggers(portfolio, world, opts);

  const events = [
    {
      type: 'adaptive_pressure',
      pressure: pressure.pressure,
      components: pressure.components,
      budget,
      ts: new Date().toISOString(),
    },
    {
      type: 'residual_portfolio',
      stats: portfolio.stats,
      openCount: portfolio.items.length,
      triggers: triggers.map((t) => t.id),
      ts: new Date().toISOString(),
    },
  ];

  return {
    pressure,
    budget,
    portfolio,
    triggers,
    events,
    packetFields: {
      residualRisks: portfolio.items.map((i) => i.claim),
      decisionDebt: portfolio.stats.decisionDebt,
      debtReason: portfolio.stats.debtReason,
      revisitTriggers: triggers,
      adaptiveBudget: budget,
    },
  };
}

function clamp01(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
