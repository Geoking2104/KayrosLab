// KayrosLab — Lightweight world model + assumption ledger (P3).
// Explicit actors, constraints, resources, uncertainties.
// Feeds multi-resolution gates and targeted falsifiers.
// Zero-dependency; LLM enrichment optional.

import { tagEpistemic } from './epistemic.mjs';

/** Extract a cheap world sketch from goal + optional context / positioning. */
export function sketchWorldModel(goal = '', ctx = {}) {
  const g = String(goal || '').trim();
  const lower = g.toLowerCase();
  const text = [g, ctx.contextBlock || '', ctx.extra || ''].join('\n').toLowerCase();

  const actors = extractActors(g, text, ctx);
  const constraints = extractConstraints(g, text, ctx);
  const resources = extractResources(g, text, ctx);
  const uncertainties = extractUncertainties(g, text, ctx);
  const timeHorizon = inferTimeHorizon(g, text);
  const stakes = inferStakes(g, text, ctx);

  const assumptions = buildAssumptionLedger({
    goal: g, actors, constraints, resources, uncertainties, timeHorizon, stakes, ctx,
  });

  const criticalCount = assumptions.filter((a) => a.critical).length;
  const coverage = Math.min(1, (actors.length * 0.15 + constraints.length * 0.2 + resources.length * 0.1 + (uncertainties.length ? 0.2 : 0) + (timeHorizon ? 0.15 : 0)));

  return {
    goal: g,
    actors,
    constraints,
    resources,
    uncertainties,
    timeHorizon,
    stakes,
    assumptions,
    stats: {
      actorCount: actors.length,
      constraintCount: constraints.length,
      resourceCount: resources.length,
      uncertaintyCount: uncertainties.length,
      criticalAssumptions: criticalCount,
      coverage: Math.round(coverage * 100) / 100,
    },
    epistemic: tagEpistemic(
      `world:actors=${actors.length} constraints=${constraints.length} critical=${criticalCount}`,
      {
        level: ctx.degraded ? 'degraded' : (actors.length + constraints.length >= 3 ? 'inferred' : 'hypothesized'),
        source: 'system',
        sourceId: 'world-model',
        kind: 'observation',
        confidence: 0.35 + coverage * 0.4,
      },
    ),
    sketchedAt: new Date().toISOString(),
  };
}

function extractActors(goal, text, ctx) {
  const found = new Set();
  const patterns = [
    /\b(clients?|customers?|users?|utilisateurs?|prospects?)\b/gi,
    /\b(équipes?|teams?|sales|commercial|marketing|ops|product|engineering)\b/gi,
    /\b(partenaires?|partners?|fournisseurs?|suppliers?|revendeurs?)\b/gi,
    /\b(concurrents?|competitors?|rivals?)\b/gi,
    /\b(régulateurs?|regulators?|autorité|compliance|legal)\b/gi,
    /\b(investisseurs?|investors?|board|comex|direction)\b/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(goal + ' ' + text)) !== null) {
      const t = m[1].toLowerCase();
      if (t.length > 2) found.add(t);
    }
  }
  if (ctx.positionning?.competitors || ctx.positionning?.competitorCount) {
    found.add('competitors');
  }
  if (found.size === 0) {
    if (/\b(b2b|enterprise|sme|pme)\b/i.test(goal)) found.add('b2b-customers');
    else found.add('end-users');
    found.add('internal-team');
  }
  return [...found].slice(0, 8).map((name) => ({
    id: slug(name),
    name,
    role: guessActorRole(name),
  }));
}

function extractConstraints(goal, text) {
  const out = [];
  const blob = `${goal}\n${text}`;
  const checks = [
    { re: /\b(budget|coût|cost|prix|price|capex|opex|limited\s+budget)\b/i, id: 'budget', label: 'Budget / cost constraint' },
    { re: /\b(délai|deadline|timeline|\d+\s*(days?|jours?|weeks?|semaines?|mois|months?)|quarters?|q[1-4]|90\s*days?)\b/i, id: 'time', label: 'Time / deadline constraint' },
    { re: /\b(rgpd|gdpr|nis2|dora|compliance|réglement|regulation|legal)\b/i, id: 'regulatory', label: 'Regulatory / compliance' },
    { re: /\b(données|data|privacy|souverain|sovereign|on-?prem|air-?gap)\b/i, id: 'data-sovereignty', label: 'Data / sovereignty' },
    { re: /\b(équipe|headcount|skills?|compétences?|hiring|capacity|capacités?|limited\s+(sales\s+)?team)\b/i, id: 'capacity', label: 'Team / skill capacity' },
    { re: /\b(marché|market|segment|niches?|sme|pme|b2b)\b/i, id: 'market', label: 'Market / segment focus' },
  ];
  for (const c of checks) {
    if (c.re.test(blob)) out.push({ id: c.id, label: c.label, source: 'text' });
  }
  return out.slice(0, 6);
}

function extractResources(goal, text) {
  const out = [];
  if (/\b(api|llm|model|ai|agent|platform|saas)\b/i.test(goal + text)) {
    out.push({ id: 'tech-stack', label: 'Existing tech / AI stack' });
  }
  if (/\b(données|data|crm|erp|historique)\b/i.test(goal + text)) {
    out.push({ id: 'data-assets', label: 'Data assets / history' });
  }
  if (/\b(marque|brand|réseau|network|clients existants)\b/i.test(goal + text)) {
    out.push({ id: 'brand-reach', label: 'Brand / existing reach' });
  }
  if (out.length === 0) out.push({ id: 'generic-capacity', label: 'Generic delivery capacity (unspecified)' });
  return out.slice(0, 5);
}

function extractUncertainties(goal, text) {
  const out = [];
  if (/\b(inconnu|unknown|incertitude|uncertainty|risque|risk)\b/i.test(goal + text)) {
    out.push({ id: 'explicit-uncertainty', label: 'Explicit uncertainty mentioned' });
  }
  if (/\b(nouveau|new|pilot|mvp|expériment)\b/i.test(goal + text)) {
    out.push({ id: 'novelty-execution', label: 'Novelty of execution path' });
  }
  if (/\b(adoption|churn|conversion|retention)\b/i.test(goal + text)) {
    out.push({ id: 'behavioural', label: 'User / market behaviour' });
  }
  if (out.length === 0) {
    out.push({ id: 'default-market', label: 'Market response unknown' });
    out.push({ id: 'default-execution', label: 'Execution feasibility unproven' });
  }
  return out.slice(0, 6);
}

function inferTimeHorizon(goal, text) {
  if (/\b(30[\s-]?days?|1[\s-]?mois|sprint|pilot)\b/i.test(goal + text)) return 'near';
  if (/\b(quarter|trimestre|90[\s-]?days?|6[\s-]?mois)\b/i.test(goal + text)) return 'medium';
  if (/\b(year|année|roadmap|12[\s-]?mois)\b/i.test(goal + text)) return 'long';
  return 'unspecified';
}

function inferStakes(goal, text, ctx) {
  const blob = `${goal}\n${text}`;
  let score = 0.3;
  if (/\b(stratégique|strategic|core|mission.?critical)\b/i.test(blob)) score += 0.3;
  if (/\b(réglement|compliance|legal|rgpd|gdpr|nis2|dora)\b/i.test(blob)) score += 0.25;
  if (/\b(enterprise|regulated|souverain|sovereign)\b/i.test(blob)) score += 0.15;
  if (ctx.positionning?.competitorCount > 3) score += 0.1;
  if (score >= 0.7) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

function buildAssumptionLedger({ goal, actors, constraints, resources, uncertainties, timeHorizon, stakes, ctx }) {
  const assumptions = [];

  assumptions.push({
    id: 'a-value',
    text: 'Target users will perceive clear incremental value vs status quo.',
    critical: true,
    category: 'value',
    falsifier: 'Pilot shows <15% preference or willingness-to-pay signal.',
    confidence: 0.4,
  });

  assumptions.push({
    id: 'a-reach',
    text: 'We can reach a first relevant cohort within the stated time horizon.',
    critical: timeHorizon === 'near' || timeHorizon === 'unspecified',
    category: 'go-to-market',
    falsifier: 'No qualified pilot users after 30–45 days of outreach.',
    confidence: 0.35,
  });

  if (constraints.some((c) => c.id === 'regulatory' || c.id === 'data-sovereignty')) {
    assumptions.push({
      id: 'a-compliance',
      text: 'Regulatory / data constraints can be satisfied without killing unit economics.',
      critical: true,
      category: 'compliance',
      falsifier: 'Legal or security review blocks production use.',
      confidence: 0.45,
    });
  }

  if (resources.some((r) => r.id === 'generic-capacity')) {
    assumptions.push({
      id: 'a-capacity',
      text: 'Current team capacity is sufficient for a meaningful pilot.',
      critical: true,
      category: 'execution',
      falsifier: 'Pilot requires >1 FTE of unavailable specialist skills.',
      confidence: 0.3,
    });
  }

  for (const u of uncertainties.slice(0, 3)) {
    assumptions.push({
      id: `a-unc-${u.id}`,
      text: `Uncertainty "${u.label}" will not invalidate the core thesis.`,
      critical: u.id.includes('behavioural') || u.id.includes('execution'),
      category: 'uncertainty',
      falsifier: `Evidence appears that ${u.label.toLowerCase()} is adverse.`,
      confidence: 0.3,
    });
  }

  if (ctx.positionning?.gapCount > 0) {
    assumptions.push({
      id: 'a-gap',
      text: 'Identified market/positioning gaps are real and reachable.',
      critical: false,
      category: 'positioning',
      falsifier: 'Deep research shows the gap is already closed or uneconomic.',
      confidence: 0.5,
    });
  }

  return assumptions.map((a) => ({
    ...a,
    epistemic: tagEpistemic(a.text, {
      level: 'hypothesized',
      source: 'system',
      sourceId: 'world-model',
      kind: 'claim',
      confidence: a.confidence,
      falsifiers: [a.falsifier],
    }),
  }));
}

function guessActorRole(name) {
  if (/client|customer|user|prospect|b2b/.test(name)) return 'beneficiary';
  if (/team|sales|product|ops|engineering|internal/.test(name)) return 'executor';
  if (/competitor|rival/.test(name)) return 'adversary';
  if (/regulator|compliance|legal/.test(name)) return 'gatekeeper';
  if (/partner|supplier|revendeur/.test(name)) return 'enabler';
  if (/investor|board|comex|direction/.test(name)) return 'sponsor';
  return 'other';
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
}

/** Decide gate resolution from world model + frame + epistemic signals. */
export function resolveGateLevel({
  frameQuality = 0.5,
  world = null,
  epistemicRank = 2,
  recommendation = 'unknown',
  stakes = null,
  force = null,
} = {}) {
  if (force) return force;

  const s = stakes || world?.stakes || 'medium';
  const critical = world?.stats?.criticalAssumptions ?? 0;
  const coverage = world?.stats?.coverage ?? 0.3;

  let level = 'standard';

  if (frameQuality < 0.35 || coverage < 0.25) level = 'light';
  if (s === 'high' || critical >= 3 || epistemicRank <= 1) level = 'heavy';
  if (recommendation === 'go' && (s === 'high' || critical >= 2)) level = 'heavy';
  if (recommendation === 'no-go' && s !== 'high') level = 'standard';

  return {
    level,
    reasons: [
      `frameQuality=${frameQuality.toFixed(2)}`,
      `stakes=${s}`,
      `criticalAssumptions=${critical}`,
      `coverage=${coverage}`,
      `epistemicRank=${epistemicRank}`,
    ],
    requiredRole: level === 'heavy' ? 'comex' : level === 'standard' ? 'reviewer' : 'author',
    waitRecommended: level === 'heavy',
  };
}

/** Merge world-model assumptions into packet-friendly fields. */
export function packetFieldsFromWorld(world) {
  if (!world) return {};
  return {
    criticalAssumptions: (world.assumptions || [])
      .filter((a) => a.critical)
      .map((a) => a.text),
    falsifiers: (world.assumptions || [])
      .filter((a) => a.falsifier)
      .map((a) => a.falsifier),
    worldModel: {
      actors: world.actors,
      constraints: world.constraints,
      resources: world.resources,
      uncertainties: world.uncertainties,
      timeHorizon: world.timeHorizon,
      stakes: world.stakes,
      stats: world.stats,
    },
  };
}

/** Optional light LLM enrichment of the sketch (soft). */
export async function enrichWorldModel(world, opts = {}) {
  if (!opts.llm || typeof opts.llm.complete !== 'function') return world;
  try {
    const res = await opts.llm.complete({
      role: 'Planner',
      temperature: 0.2,
      think: false,
      messages: [
        {
          role: 'system',
          content: 'You refine a strategic world model. Reply ONLY with a short JSON: { "extraAssumptions": string[], "missingActors": string[], "keyRisk": string }',
        },
        {
          role: 'user',
          content: `Goal: ${world.goal}\nActors: ${(world.actors || []).map((a) => a.name).join(', ')}\nConstraints: ${(world.constraints || []).map((c) => c.label).join('; ')}`,
        },
      ],
    }, { provider: opts.provider, sovereignty: opts.sovereignty });
    const text = res?.text || res?.output || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return world;
    const parsed = JSON.parse(m[0]);
    const extra = Array.isArray(parsed.extraAssumptions) ? parsed.extraAssumptions : [];
    for (const t of extra.slice(0, 3)) {
      world.assumptions.push({
        id: `a-llm-${slug(t).slice(0, 12)}`,
        text: String(t),
        critical: false,
        category: 'llm',
        falsifier: 'LLM-suggested assumption fails empirical check.',
        confidence: 0.35,
        epistemic: tagEpistemic(String(t), { level: 'hypothesized', source: 'agent', sourceId: 'world-enrich', kind: 'claim' }),
      });
    }
    return world;
  } catch {
    return world;
  }
}

/** High-level P3 entry. */
export async function runWorldModelControl({ goal, opts = {}, contextBlock = '', positionning = null }) {
  const events = [];
  let world = sketchWorldModel(goal, {
    contextBlock,
    positionning,
    degraded: opts.degraded || false,
  });

  if (opts.worldModel === 'llm' || opts.enrichWorld) {
    world = await enrichWorldModel(world, {
      llm: opts.llm,
      provider: opts.provider,
      sovereignty: opts.sovereignty,
    });
  }

  events.push({
    type: 'world_model',
    ideaId: opts.ideaId || null,
    stats: world.stats,
    stakes: world.stakes,
    timeHorizon: world.timeHorizon,
    criticalAssumptions: world.assumptions.filter((a) => a.critical).map((a) => a.text),
    ts: new Date().toISOString(),
  });

  const gateResolution = resolveGateLevel({
    frameQuality: opts.frameQuality ?? 0.5,
    world,
    epistemicRank: opts.epistemicRank ?? 2,
    recommendation: opts.recommendation || 'unknown',
    stakes: world.stakes,
    force: opts.forceGateLevel || null,
  });

  events.push({
    type: 'gate_resolution',
    ideaId: opts.ideaId || null,
    ...gateResolution,
    ts: new Date().toISOString(),
  });

  return {
    world,
    gateResolution,
    packetFields: packetFieldsFromWorld(world),
    events,
  };
}
