import { NEURON_LIST } from '../data/ontology.js';

const WEB_WEIGHT = 0.25;
const GITHUB_WEIGHT = 0.40;
const HEURISTIC_WEIGHT = 0.35;

export function scoreAll(idea, webResults, githubResults) {
  const competitors = buildCompetitorsList(webResults, githubResults);

  const scored = competitors.map((comp) => {
    const neurons = NEURON_LIST.map((neuron) => {
      const webScore = computeWebScore(neuron, comp);
      const gitScore = computeGitHubScore(neuron, comp);
      const heurScore = computeHeuristicScore(neuron, comp, idea);

      const total = Math.round(
        webScore * WEB_WEIGHT +
        gitScore * GITHUB_WEIGHT +
        heurScore * HEURISTIC_WEIGHT
      );

      return {
        neuronId: neuron.id,
        score: Math.min(100, Math.max(0, total)),
        webScore: Math.round(webScore),
        gitScore: Math.round(gitScore),
      };
    });

    const avgScore = Math.round(neurons.reduce((s, n) => s + n.score, 0) / neurons.length);

    return {
      name: comp.name,
      url: comp.url,
      avgScore,
      neurons: Object.fromEntries(neurons.map((n) => [n.neuronId, n.score])),
      raw: { web: comp.web, github: comp.github },
    };
  });

  return scored;
}

export function computeIdeaBaseline(idea) {
  const neurons = {};
  NEURON_LIST.forEach((n) => {
    const w = computeWebScore(n, { web: { snippet: idea, name: 'idée' } });
    const h = computeHeuristicScore(n, { web: { snippet: idea, name: 'idée' } }, idea);
    neurons[n.id] = Math.round(w * 0.3 + h * 0.7);
  });
  return neurons;
}

export function computeGaps(ideaScores, competitorScores) {
  const gaps = [];
  NEURON_LIST.forEach((n) => {
    const ours = ideaScores[n.id] || 50;
    const theirs = competitorScores.length > 0
      ? Math.round(competitorScores.reduce((s, c) => s + (c.neurons[n.id] || 50), 0) / competitorScores.length)
      : 50;
    const diff = ours - theirs;
    if (Math.abs(diff) >= 5) {
      gaps.push({
        neuronId: n.id,
        label: n.label,
        diff,
        type: diff > 0 ? 'advantage' : 'disadvantage',
      });
    }
  });
  gaps.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return gaps;
}

function buildCompetitorsList(webResults, githubResults) {
  const map = {};
  for (const w of webResults) {
    map[w.name] = { name: w.name, url: w.url, web: w, github: null };
  }
  for (const g of githubResults) {
    if (map[g.competitor]) {
      map[g.competitor].github = g.kpi;
    }
  }
  return Object.values(map);
}

function computeWebScore(neuron, comp) {
  const snippet = (comp.web?.snippet || comp.web?.name || '').toLowerCase();
  const name = (comp.web?.name || '').toLowerCase();
  const text = snippet + ' ' + name;

  let matches = 0;
  for (const kw of neuron.keywords) {
    if (text.includes(kw.toLowerCase())) matches++;
  }

  return Math.min(100, matches * 20 + (text.length > 50 ? 10 : 0));
}

function computeGitHubScore(neuron, comp) {
  if (!comp.github) return 30;

  const { topics, description, language } = comp.github;
  const text = (description + ' ' + (topics || []).join(' ') + ' ' + (language || '')).toLowerCase();

  let matches = 0;
  for (const kw of neuron.keywords) {
    if (text.includes(kw.toLowerCase())) matches++;
  }

  const topicBonus = Math.min(100, matches * 15);
  return Math.round((comp.github.composite * 0.6) + (topicBonus * 0.4));
}

function computeHeuristicScore(neuron, comp, idea) {
  const base = 40;
  const text = ((comp.web?.snippet || '') + ' ' + idea).toLowerCase();
  let matches = 0;
  for (const kw of neuron.keywords) {
    if (text.includes(kw.toLowerCase())) matches++;
  }
  return Math.min(100, base + matches * 12);
}
