import { ENTITY_TYPES, ENTITY_MAP, ALL_ENTITY_IDS } from './ontology.mjs';

export function computeBaseline(ideaText) {
  const words = String(ideaText ?? '').trim().split(/\s+/).filter((w) => w.length > 2);
  const wordCount = words.length;
  const scores = {};
  for (const et of ENTITY_TYPES) {
    const keywordMatches = words.filter((w) => (et.name + ' ' + et.description).toLowerCase().includes(w.toLowerCase())).length;
    const heuristic = 40 + Math.min(wordCount * 2, 40) + keywordMatches * 3;
    scores[et.id] = clamp(10, 100, heuristic);
  }
  return scores;
}

export function computeCompetitorScores(ideaText, webResults) {
  const terms = ideaText.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return webResults.map((r, i) => {
    const text = (r.snippet + ' ' + r.name).toLowerCase();
    const scores = {};
    for (const et of ENTITY_TYPES) {
      let matches = 0;
      for (const kw of terms) {
        if (text.includes(kw)) matches++;
      }
      const base = et.group === 'tech' ? 55 : 45;
      const position = Math.max(0, (5 - i) * 2);
      scores[et.id] = clamp(5, 95, base + matches * 4 + position);
    }
    const avgScore = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length);
    return { name: r.name, url: r.url, avgScore, scores, snippet: r.snippet, source: r.source };
  });
}

export function computeGitHubScores(ideaText, githubResults) {
  const terms = ideaText.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return githubResults.map((r, i) => {
    const text = (r.description + ' ' + r.name).toLowerCase();
    const scores = {};
    for (const et of ENTITY_TYPES) {
      let matches = 0;
      for (const kw of terms) {
        if (text.includes(kw)) matches++;
      }
      const base = et.group === 'tech' ? 65 : 35;
      const starBonus = Math.min((r.stars || 0) / 100, 15);
      const position = Math.max(0, (5 - i) * 2);
      scores[et.id] = clamp(5, 100, base + matches * 3 + starBonus + position);
    }
    const avgScore = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length);
    return { name: r.name, url: r.url, avgScore, scores, stars: r.stars, forks: r.forks, source: 'github' };
  });
}

export function computeArXivScores(ideaText, arxivResults) {
  const terms = ideaText.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return arxivResults.map((r, i) => {
    const text = (r.title + ' ' + r.summary).toLowerCase();
    const scores = {};
    for (const et of ENTITY_TYPES) {
      let matches = 0;
      for (const kw of terms) {
        if (text.includes(kw)) matches++;
      }
      const base = et.group === 'tech' ? 60 : 30;
      const authorBonus = Math.min((r.authors?.length || 0) * 2, 10);
      const position = Math.max(0, (5 - i) * 2);
      scores[et.id] = clamp(5, 95, base + matches * 3 + authorBonus + position);
    }
    const avgScore = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length);
    return { name: r.title.substring(0, 60), url: r.absUrl, avgScore, scores, authors: r.authors, published: r.published, source: 'arxiv' };
  });
}

export function computeGaps(baseline, competitors, { threshold = 5 } = {}) {
  const gaps = [];
  for (const et of ENTITY_TYPES) {
    const ours = baseline[et.id] || 50;
    const scores = competitors.map((c) => c.scores?.[et.id] || 50);
    const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 50;
    const diff = ours - avg;
    if (Math.abs(diff) >= threshold) {
      gaps.push({ entityId: et.id, entityName: et.name, icon: et.icon, diff, type: diff > 0 ? 'advantage' : 'disadvantage' });
    }
  }
  gaps.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return gaps;
}

export function computeKayrosIndex(baseline, competitors) {
  const avgBaseline = Object.values(baseline).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(baseline).length);
  const compAvgs = competitors.map((c) => c.avgScore || 50);
  const avgCompetitor = compAvgs.length > 0 ? compAvgs.reduce((a, b) => a + b, 0) / compAvgs.length : 50;
  const ki = Math.round((avgBaseline - avgCompetitor + 100) / 2);
  return clamp(0, 100, ki);
}

function clamp(min, max, val) {
  return Math.max(min, Math.min(max, Math.round(val)));
}
