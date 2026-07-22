export const COMPETITOR_COLORS = ['#ef4444', '#f97316', '#8b5cf6', '#06b6d4', '#ec4899'];

export function buildInstances(idea, scoredCompetitors) {
  return scoredCompetitors.map((c, i) => ({
    name: c.name,
    url: c.url,
    avgScore: c.avgScore,
    color: COMPETITOR_COLORS[i % COMPETITOR_COLORS.length],
    scores: c.neurons,
  }));
}

export function computeBaseline(idea, scorer) {
  const scores = {};
  for (const entityId of Object.keys(scorer)) {
    scores[entityId] = Math.round((scorer[entityId]?.web || 50) * 0.3 + (scorer[entityId]?.heuristic || 50) * 0.7);
  }
  return scores;
}
