import { ALL_ENTITY_IDS, ENTITY_TYPES } from './ontology.mjs';
import { computeGaps, computeKayrosIndex } from './analyzer.mjs';
import { WebScanner } from './scanner-web.mjs';
import { GitHubScanner } from './scanner-github.mjs';
import { GitLabScanner } from './scanner-gitlab.mjs';

const DEFAULT_MODEL = 'mistral-small-latest';
const BLOCKED_DEMO_NAMES = ['aha', 'aha!', 'klaxoon', 'accept mission', 'miro'];

export async function runMistralContextualPositionning(ideaText, {
  apiKey,
  model = DEFAULT_MODEL,
  limit = 5,
  gapThreshold,
  googleApiKey,
  googleCx,
  githubToken,
  gitlabToken,
  gitlabBaseUrl,
  fetchImpl,
} = {}) {
  const idea = String(ideaText ?? '').trim();
  if (!idea) throw new Error('idea required');
  if (!apiKey) {
    const err = new Error('MISTRAL_API_KEY non configuree');
    err.code = 'NO_KEY';
    throw err;
  }

  const fetchFn = fetchImpl ?? globalThis.fetch;
  if (!fetchFn) throw new Error('fetch implementation required');

  const comparisonSources = await collectComparisonSources(idea, {
    limit,
    fetchFn,
    googleApiKey,
    googleCx,
    githubToken,
    gitlabToken,
    gitlabBaseUrl,
  });
  const prompt = buildPrompt(idea, limit, comparisonSources);
  let rawText = '';
  let references = [];
  let providerMode = 'mistral_conversations_web_search';

  try {
    const conversation = await callMistralConversation({ apiKey, model, prompt, fetchFn });
    rawText = conversation.text;
    references = conversation.references;
  } catch {
    providerMode = 'mistral_chat_json';
    rawText = await callMistralChatJson({ apiKey, model, prompt, fetchFn });
  }

  const payload = parseJsonPayload(rawText);
  const examples = normalizeExamples(payload.examples, { idea, limit, references });
  if (!examples.length) throw new Error("Mistral n'a retourne aucun exemple exploitable");

  const baseline = normalizeScores(payload.baselineScores);
  if (!baseline) throw new Error("Mistral n'a pas retourne de baselineScores complets");

  const competitors = examples.map((example, index) => toCompetitor(example, { idea, index, references }));
  const gaps = computeGaps(
    baseline,
    competitors,
    gapThreshold != null ? { threshold: gapThreshold } : {},
  ).map((gap) => ({ ...gap, neuronId: gap.neuronId ?? gap.entityId }));

  return {
    idea,
    baseline,
    competitors,
    gaps,
    kayrosIndex: computeKayrosIndex(baseline, competitors),
    provider: 'mistral',
    providerMode,
    model,
    searchQueries: cleanStringList(payload.searchQueries),
    sourceCoverage: summarizeSourceCoverage(comparisonSources),
    refinedIdea: cleanText(payload.refinedIdea || payload.refined_idea),
    positioningSummary: cleanText(payload.positioningSummary || payload.summary),
    differentiationHypotheses: cleanStringList(payload.differentiationHypotheses),
    summary: {
      totalCompetitors: competitors.length,
      source: providerMode,
      sourceCoverage: summarizeSourceCoverage(comparisonSources),
      topGaps: gaps.slice(0, 3),
    },
  };
}

async function callMistralConversation({ apiKey, model, prompt, fetchFn }) {
  const res = await fetchFn('https://api.mistral.ai/v1/conversations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      inputs: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search' }],
      store: false,
      completion_args: {
        temperature: 0.2,
        max_tokens: 2200,
      },
    }),
  });
  const data = await safeJson(res);
  if (!res.ok) {
    const err = new Error(`mistral conversations http ${res.status}`);
    err.detail = data;
    throw err;
  }
  return {
    text: extractConversationText(data),
    references: extractReferences(data),
  };
}

async function callMistralChatJson({ apiKey, model, prompt, fetchFn }) {
  const res = await fetchFn('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 2200,
    }),
  });
  const data = await safeJson(res);
  if (!res.ok) {
    const err = new Error(`mistral chat http ${res.status}`);
    err.detail = data;
    throw err;
  }
  return data.choices?.[0]?.message?.content ?? '';
}

async function collectComparisonSources(idea, {
  limit,
  fetchFn,
  googleApiKey,
  googleCx,
  githubToken,
  gitlabToken,
  gitlabBaseUrl,
}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 8));
  const web = new WebScanner({ googleApiKey, googleCx, fetchImpl: fetchFn });
  const github = new GitHubScanner({ token: githubToken, fetchImpl: fetchFn });
  const gitlab = new GitLabScanner({ token: gitlabToken, baseUrl: gitlabBaseUrl, fetchImpl: fetchFn });

  const [githubResults, gitlabResults, crunchbaseResults, ideaproofResults] = await Promise.all([
    github.search(idea, { limit: safeLimit }).catch(() => []),
    gitlab.search(idea, { limit: safeLimit }).catch(() => []),
    web.search(`${idea} site:crunchbase.com/organization`, { limit: safeLimit }).catch(() => []),
    web.search(`${idea} ideaproof`, { limit: safeLimit }).catch(() => []),
  ]);

  return {
    github: githubResults.map(normalizeGithubSignal),
    gitlab: gitlabResults.map(normalizeGitlabSignal),
    crunchbase: crunchbaseResults.filter((item) => sourceMatches(item, 'crunchbase')).map((item) => normalizeWebSignal(item, 'Crunchbase')),
    ideaproof: ideaproofResults.filter((item) => sourceMatches(item, 'ideaproof')).map((item) => normalizeWebSignal(item, 'IdeaProof')),
  };
}

function buildPrompt(idea, limit, comparisonSources) {
  const ontology = ENTITY_TYPES.map((entity) => `${entity.id}: ${entity.name} (${entity.group})`).join('\n');
  const sources = JSON.stringify(comparisonSources, null, 2);
  return `Tu es l'agent Positioner de KayrosLab. Ta mission est de positionner et finetuner l'idee exprimee par l'utilisateur a partir de bases de comparaison externes.

Saisie utilisateur:
${idea}

Contraintes importantes:
- Ne reprends pas les anciens exemples de demonstration KayrosLab: Aha!, Klaxoon, Accept Mission, Miro. Ne les retourne que si la saisie utilisateur les mentionne explicitement.
- Ne fais pas une liste generique de logiciels. Les exemples doivent venir du contexte semantique de la saisie et des signaux ci-dessous.
- Utilise GitHub, GitLab, Crunchbase et IdeaProof comme bases de comparaison quand des signaux existent.
- Les bases vides signifient "source non exploitable pour cette requete"; n'invente pas de metriques ou de noms pour les remplir.
- Priorise les exemples utiles pour positionner et affiner l'idee: meme probleme, meme technologie, meme marche, projet adjacent ou alternative structurante.
- Les exemples retournes doivent etre des societes, produits, projets open-source ou initiatives reellement identifies dans les signaux externes ou par ta recherche web.
- Retourne uniquement du JSON valide, sans markdown.

Signaux externes deja collectes:
${sources}

Ontologie KayrosLab 14 dimensions:
${ontology}

Schema JSON attendu:
{
  "searchQueries": ["requete contextuelle 1", "requete contextuelle 2"],
  "refinedIdea": "formulation ajustee de l'idee apres comparaison externe",
  "baselineScores": { "architecture": 0, "stack": 0, "data_layer": 0, "security": 0, "ia_ml": 0, "scale_perf": 0, "api_surface": 0, "business_model": 0, "pricing": 0, "go_to_market": 0, "icp": 0, "revenue_model": 0, "customer_success": 0, "unit_economics": 0 },
  "examples": [
    {
      "name": "nom de societe ou projet",
      "type": "company|product|open_source|research|public_initiative",
      "url": "https://...",
      "whyAligned": "raison concrete d'alignement avec la saisie",
      "evidence": ["signal source ou fait court issu des bases de comparaison"],
      "technologySignals": ["signal tech"],
      "businessSignals": ["signal business"],
      "ontologyScores": { "architecture": 0, "stack": 0, "data_layer": 0, "security": 0, "ia_ml": 0, "scale_perf": 0, "api_surface": 0, "business_model": 0, "pricing": 0, "go_to_market": 0, "icp": 0, "revenue_model": 0, "customer_success": 0, "unit_economics": 0 },
      "github": { "repo": "", "stars": null, "forks": null, "contributors": null, "commits90": null, "issues": null, "freshness": "" },
      "gitlab": { "repo": "", "stars": null, "forks": null, "contributors": null, "commits90": null, "issues": null, "freshness": "" }
    }
  ],
  "positioningSummary": "synthese courte",
  "differentiationHypotheses": ["hypothese de differenciation"]
}

Retourne ${Math.max(1, Math.min(Number(limit) || 5, 8))} exemples maximum. Les scores sont des entiers 0-100.`;
}

function normalizeExamples(rawExamples, { idea, limit, references }) {
  const list = Array.isArray(rawExamples) ? rawExamples : [];
  const allowBlocked = mentionsBlockedName(idea);
  const normalized = list
    .map((entry) => normalizeExample(entry, references))
    .filter((entry) => entry.name)
    .filter((entry) => entry.url)
    .filter((entry) => entry.ontologyScores)
    .filter((entry) => allowBlocked || !isBlockedDemoName(entry));

  return dedupeByName(normalized).slice(0, Math.max(1, Math.min(Number(limit) || 5, 8)));
}

function normalizeExample(entry, references) {
  const name = cleanText(entry?.name || entry?.title);
  const url = cleanUrl(entry?.url) || findReferenceUrl(name, references);
  return {
    name,
    type: cleanText(entry?.type || 'company'),
    url,
    whyAligned: cleanText(entry?.whyAligned || entry?.why_aligned || entry?.description || entry?.snippet),
    evidence: cleanStringList(entry?.evidence || entry?.sources),
    technologySignals: cleanStringList(entry?.technologySignals || entry?.technology_signals),
    businessSignals: cleanStringList(entry?.businessSignals || entry?.business_signals),
    ontologyScores: normalizeScores(entry?.ontologyScores || entry?.ontology_scores || entry?.scores),
    github: normalizeRepoSignals(entry?.github),
    gitlab: normalizeRepoSignals(entry?.gitlab),
  };
}

function toCompetitor(example) {
  const scores = example.ontologyScores;
  const avgScore = Math.round(Object.values(scores).reduce((sum, score) => sum + score, 0) / ALL_ENTITY_IDS.length);
  const evidenceCount = example.evidence.length || (example.url ? 1 : 0);
  const signalCount = example.technologySignals.length + example.businessSignals.length;

  return {
    name: example.name,
    url: example.url,
    avgScore,
    scores,
    snippet: example.whyAligned,
    source: 'mistral_context',
    kind: example.type,
    alignment: example.whyAligned,
    evidence: example.evidence,
    technologySignals: example.technologySignals,
    businessSignals: example.businessSignals,
    kpis: {
      web: {
        sources: evidenceCount,
        mentions: Math.max(evidenceCount + signalCount, evidenceCount),
        freshness: 'Mistral web_search',
      },
      github: example.github,
      gitlab: example.gitlab,
    },
  };
}

function normalizeScores(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const scores = {};
  for (const id of ALL_ENTITY_IDS) {
    const value = Number(raw[id]);
    if (!Number.isFinite(value)) return null;
    scores[id] = clamp(0, 100, value);
  }
  return scores;
}

function normalizeRepoSignals(raw) {
  const empty = { repo: '', stars: 'n/a', forks: 'n/a', contributors: 'n/a', commits90: 'n/a', issues: 'n/a', freshness: 'n/a' };
  if (!raw || typeof raw !== 'object') return empty;
  return {
    repo: cleanText(raw.repo || raw.name),
    stars: numberOrNa(raw.stars),
    forks: numberOrNa(raw.forks),
    contributors: numberOrNa(raw.contributors),
    commits90: numberOrNa(raw.commits90 ?? raw.commits_90 ?? raw.commits),
    issues: numberOrNa(raw.issues ?? raw.openIssues ?? raw.open_issues),
    freshness: cleanText(raw.freshness || raw.lastPush || raw.last_push) || 'n/a',
  };
}

function normalizeGithubSignal(item) {
  return {
    source: 'GitHub',
    name: cleanText(item.name),
    url: cleanUrl(item.url),
    description: cleanText(item.description),
    stars: numberOrNa(item.stars),
    forks: numberOrNa(item.forks),
    contributors: numberOrNa(item.contributors),
    totalCommits: numberOrNa(item.totalCommits),
    openIssues: numberOrNa(item.openIssues),
    lastPush: cleanText(item.lastPush),
    daysSinceLastPush: numberOrNa(item.daysSinceLastPush),
    language: cleanText(item.language),
    topics: cleanStringList(item.topics),
  };
}

function normalizeGitlabSignal(item) {
  return {
    source: 'GitLab',
    name: cleanText(item.name),
    url: cleanUrl(item.url),
    description: cleanText(item.description),
    stars: numberOrNa(item.stars),
    forks: numberOrNa(item.forks),
    contributors: numberOrNa(item.contributors),
    openIssues: numberOrNa(item.openIssues),
    lastPush: cleanText(item.lastPush),
    daysSinceLastPush: numberOrNa(item.daysSinceLastPush),
    language: cleanText(item.language),
    topics: cleanStringList(item.topics),
    visibility: cleanText(item.visibility),
  };
}

function normalizeWebSignal(item, source) {
  return {
    source,
    name: cleanText(item.name),
    url: cleanUrl(item.url),
    snippet: cleanText(item.snippet),
    provider: cleanText(item.source),
  };
}

function summarizeSourceCoverage(comparisonSources) {
  return Object.entries(comparisonSources || {}).map(([id, entries]) => ({
    id,
    label: sourceLabel(id),
    count: Array.isArray(entries) ? entries.length : 0,
  }));
}

function sourceLabel(id) {
  const labels = {
    github: 'GitHub',
    gitlab: 'GitLab',
    crunchbase: 'Crunchbase',
    ideaproof: 'IdeaProof',
  };
  return labels[id] || id;
}

function sourceMatches(item, sourceName) {
  const haystack = `${item?.url || ''} ${item?.name || ''} ${item?.snippet || ''}`.toLowerCase();
  return haystack.includes(sourceName);
}

function parseJsonPayload(text) {
  const source = String(text ?? '').trim();
  const direct = tryParseJson(source);
  if (direct) return direct;

  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParseJson(fenced[1]);
    if (parsed) return parsed;
  }

  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const parsed = tryParseJson(source.slice(start, end + 1));
    if (parsed) return parsed;
  }

  throw new Error('La reponse Mistral ne contient pas de JSON exploitable');
}

function tryParseJson(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function extractConversationText(data) {
  const chunks = [];
  const outputs = Array.isArray(data?.outputs) ? data.outputs : [];
  for (const output of outputs) {
    if (output?.type === 'message.output' || output?.role === 'assistant') {
      collectText(output.content, chunks);
    }
  }
  if (!chunks.length) collectText(data?.content, chunks);
  if (!chunks.length) collectText(data?.message?.content, chunks);
  return chunks.join('\n').trim();
}

function collectText(content, chunks) {
  if (!content) return;
  if (typeof content === 'string') {
    chunks.push(content);
    return;
  }
  if (Array.isArray(content)) {
    for (const item of content) collectText(item, chunks);
    return;
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') chunks.push(content.text);
    else if (typeof content.content === 'string') chunks.push(content.content);
  }
}

function extractReferences(data) {
  const references = [];
  const outputs = Array.isArray(data?.outputs) ? data.outputs : [];
  for (const output of outputs) collectReferences(output?.content, references);
  return references;
}

function collectReferences(content, references) {
  if (!content) return;
  if (Array.isArray(content)) {
    for (const item of content) collectReferences(item, references);
    return;
  }
  if (typeof content === 'object') {
    if (content.type === 'tool_reference') {
      references.push({
        title: cleanText(content.title),
        url: cleanUrl(content.url),
        source: cleanText(content.source),
      });
    }
    if (content.content) collectReferences(content.content, references);
  }
}

function findReferenceUrl(name, references) {
  const needle = simplify(name);
  if (!needle) return '';
  const ref = references.find((entry) => simplify(entry.title).includes(needle) || needle.includes(simplify(entry.title)));
  return ref?.url || '';
}

function dedupeByName(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = simplify(item.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function isBlockedDemoName(entry) {
  const haystack = `${entry.name} ${entry.url}`.toLowerCase();
  return BLOCKED_DEMO_NAMES.some((name) => haystack.includes(name));
}

function mentionsBlockedName(text) {
  const haystack = String(text ?? '').toLowerCase();
  return BLOCKED_DEMO_NAMES.some((name) => haystack.includes(name));
}

function cleanStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(cleanText).filter(Boolean).slice(0, 8);
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cleanUrl(value) {
  const url = cleanText(value);
  return /^https?:\/\//i.test(url) ? url : '';
}

function numberOrNa(value) {
  if (value === null || value === undefined || value === '') return 'n/a';
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 'n/a';
}

function simplify(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function clamp(min, max, value) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
