export { ENTITY_TYPES, RELATIONSHIPS, ENTITY_MAP, getEntity, TECH_ENTITY_IDS, BUSINESS_ENTITY_IDS, ALL_ENTITY_IDS } from './ontology.mjs';
export { WebScanner } from './scanner-web.mjs';
export { GitHubScanner } from './scanner-github.mjs';
export { GitLabScanner } from './scanner-gitlab.mjs';
export { ArXivScanner } from './scanner-arxiv.mjs';
export {
  computeBaseline, computeCompetitorScores, computeGitHubScores, computeArXivScores,
  computeGaps, computeKayrosIndex,
} from './analyzer.mjs';
export { generateOWL, generateJSON } from './owl-exporter.mjs';
export { runMistralContextualPositionning } from './mistral-contextual-search.mjs';
export { factsFromPositionning, heuristicPositionning } from './to-l1.mjs';

export async function runPositionningAnalysis(ideaText, {
  googleApiKey, googleCx,
  githubToken, gitlabToken, gitlabBaseUrl,
  limit = 5, gapThreshold,
  fetchImpl,
} = {}) {
  const web = new WebScanner({ googleApiKey, googleCx, fetchImpl });
  const gh = new GitHubScanner({ token: githubToken, fetchImpl });
  const gl = new GitLabScanner({ token: gitlabToken, baseUrl: gitlabBaseUrl, fetchImpl });
  const arxiv = new ArXivScanner({ fetchImpl });

  const [webResults, ghResults, glResults, arxivResults] = await Promise.all([
    web.search(ideaText, { limit }).catch(() => []),
    gh.search(ideaText, { limit }).catch(() => []),
    gl.search(ideaText, { limit }).catch(() => []),
    arxiv.search(ideaText, { limit }).catch(() => []),
  ]);

  const baseline = computeBaseline(ideaText);
  const webCompetitors = computeCompetitorScores(ideaText, webResults);
  const ghCompetitors = computeGitHubScores(ideaText, ghResults);
  const arxivCompetitors = computeArXivScores(ideaText, arxivResults);
  const allCompetitors = [...webCompetitors, ...ghCompetitors, ...arxivCompetitors];
  const gaps = computeGaps(baseline, allCompetitors, gapThreshold != null ? { threshold: gapThreshold } : {});
  const ki = computeKayrosIndex(baseline, allCompetitors);

  return {
    idea: ideaText,
    baseline,
    competitors: allCompetitors,
    gaps,
    kayrosIndex: ki,
    summary: {
      totalCompetitors: allCompetitors.length,
      webCount: webResults.length,
      githubCount: ghResults.length,
      gitlabCount: glResults.length,
      arxivCount: arxivResults.length,
      topGaps: gaps.slice(0, 3),
    },
  };
}
