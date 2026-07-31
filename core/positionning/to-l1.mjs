// Phase 5 — Convert positionning analysis into L1 atomic facts.

/**
 * @param {object} analysis — result of runPositionningAnalysis
 * @param {{ ideaId: string, tenantId?: string, maxCompetitors?: number, maxGaps?: number }} opts
 * @returns {Array<object>} payloads ready for LayeredMemory.addAtomicFact
 */
export function factsFromPositionning(analysis, {
  ideaId,
  tenantId = 'default',
  maxCompetitors = 8,
  maxGaps = 6,
} = {}) {
  if (!ideaId) throw new Error('factsFromPositionning: ideaId requis');
  if (!analysis) return [];

  const facts = [];
  const competitors = Array.isArray(analysis.competitors) ? analysis.competitors : [];
  const gaps = Array.isArray(analysis.gaps) ? analysis.gaps : [];
  const ki = analysis.kayrosIndex;

  if (typeof ki === 'number') {
    facts.push({
      ideaId,
      tenantId,
      content: `Kayros Index concurrentiel estimé : ${ki}/100 (baseline vs ${competitors.length} signaux).`,
      type: 'metric',
      confidence: 0.65,
      actors: ['Positioner'],
      tags: ['positionning', 'kayros-index'],
      sourceRefs: [{ type: 'agent', id: 'Positioner', excerpt: 'kayrosIndex' }],
    });
  }

  for (const c of competitors.slice(0, maxCompetitors)) {
    const name = c.name || c.title || 'Concurrent';
    const score = c.avgScore != null ? ` score≈${c.avgScore}` : '';
    const src = c.source ? ` [${c.source}]` : '';
    const url = c.url ? ` — ${c.url}` : '';
    const snip = c.snippet ? ` ${String(c.snippet).slice(0, 120)}` : '';
    facts.push({
      ideaId,
      tenantId,
      content: `Concurrent : ${name}${score}${src}${url}.${snip}`.trim(),
      type: 'competitor',
      confidence: 0.6,
      actors: ['Positioner'],
      tags: ['positionning', 'competitor', c.source || 'web'].filter(Boolean),
      sourceRefs: c.url
        ? [{ type: 'external', id: c.url, url: c.url, excerpt: String(name).slice(0, 80) }]
        : [{ type: 'agent', id: 'Positioner' }],
    });
  }

  for (const g of gaps.slice(0, maxGaps)) {
    const label = g.entityName || g.entityId || 'axe';
    const diff = g.diff != null ? (g.diff > 0 ? `+${g.diff}` : String(g.diff)) : '';
    const kind = g.type === 'advantage' ? 'avantage' : 'écart défavorable';
    facts.push({
      ideaId,
      tenantId,
      content: `Gap ${kind} sur « ${label} » (${diff} pts vs moyenne concurrente).`,
      type: g.type === 'advantage' ? 'opportunity' : 'risk',
      confidence: 0.55,
      actors: ['Positioner'],
      tags: ['positionning', 'gap', g.entityId].filter(Boolean),
      sourceRefs: [{ type: 'agent', id: 'Positioner', excerpt: label }],
    });
  }

  const top = analysis.summary?.topGaps;
  if (Array.isArray(top) && top.length && !gaps.length) {
    for (const g of top.slice(0, 3)) {
      facts.push({
        ideaId,
        tenantId,
        content: `Écart prioritaire : ${g.entityName || g.entityId} (${g.type}, Δ=${g.diff}).`,
        type: 'risk',
        confidence: 0.5,
        actors: ['Positioner'],
        tags: ['positionning', 'gap'],
        sourceRefs: [{ type: 'agent', id: 'Positioner' }],
      });
    }
  }

  return facts;
}

/** Heuristic-only analysis when scanners / API keys are unavailable. */
export function heuristicPositionning(ideaText) {
  const text = String(ideaText || '').trim();
  const words = text.split(/\s+/).filter((w) => w.length > 3);
  const baselineScore = Math.min(85, 40 + words.length * 2);
  return {
    idea: text,
    baseline: { heuristic: baselineScore },
    competitors: [],
    gaps: [
      {
        entityId: 'coverage',
        entityName: 'Couverture concurrentielle',
        diff: -8,
        type: 'disadvantage',
      },
      {
        entityId: 'differentiation',
        entityName: 'Différenciation',
        diff: 6,
        type: 'advantage',
      },
    ],
    kayrosIndex: Math.round((baselineScore - 50 + 100) / 2),
    summary: {
      totalCompetitors: 0,
      webCount: 0,
      githubCount: 0,
      gitlabCount: 0,
      arxivCount: 0,
      topGaps: [],
      heuristic: true,
    },
  };
}
