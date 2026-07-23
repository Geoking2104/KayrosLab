const BACKEND_SEARCH = '/v1/positionning/search';
const BACKEND_GITHUB = '/v1/positionning/github';
const BACKEND_ARXIV = '/v1/positionning/arxiv';
const BACKEND_ANALYZE = '/v1/positionning/analyze';

export async function searchCompetitors(idea) {
  try {
    const res = await fetch(BACKEND_SEARCH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: idea, limit: 5 }),
    });
    if (!res.ok) throw new Error(`Search backend returned ${res.status}`);
    const data = await res.json();
    return data.results || [];
  } catch {
    return getMockResults(idea);
  }
}

export async function searchGitHub(idea, { limit = 5, token } = {}) {
  try {
    const res = await fetch(BACKEND_GITHUB, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: idea, limit }),
    });
    if (!res.ok) throw new Error(`GitHub backend returned ${res.status}`);
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

export async function searchArXiv(idea, { limit = 5 } = {}) {
  try {
    const res = await fetch(BACKEND_ARXIV, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: idea, limit }),
    });
    if (!res.ok) throw new Error(`ArXiv backend returned ${res.status}`);
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

export async function analyzeIdea(idea, opts = {}) {
  try {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const res = await fetch(BACKEND_ANALYZE, {
      method: 'POST',
      headers,
      body: JSON.stringify({ idea, limit: 5 }),
    });
    if (!res.ok) throw new Error(`Analyze backend returned ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

function getMockResults(idea) {
  const terms = idea.toLowerCase();
  const mockDb = [
    { name: 'Hugging Face', url: 'https://huggingface.co', snippet: 'Plateforme ML open-source avec modèles pré-entraînés et datasets collaboratifs' },
    { name: 'OpenAI', url: 'https://openai.com', snippet: 'API GPT-4, DALL-E, Whisper. Modèles propriétaires avancés pour entreprise' },
    { name: 'Anthropic', url: 'https://anthropic.com', snippet: 'Claude API, safety-first. Modèles pour entreprise et déploiement sécurisé' },
    { name: 'Mistral AI', url: 'https://mistral.ai', snippet: 'LLMs open-weight français. Déploiement souverain et personnalisable' },
    { name: 'Google Vertex AI', url: 'https://cloud.google.com/vertex-ai', snippet: 'Plateforme ML GCP. Modèles Gemini, entraînement et déploiement MLOps' },
    { name: 'Replicate', url: 'https://replicate.com', snippet: 'Cloud ML pour développeurs avec API standardisée et modèles communautaires' },
    { name: 'Cohere', url: 'https://cohere.com', snippet: 'API NLP entreprise avec embeddings, RAG, classification et recherche sémantique' },
    { name: 'LlamaIndex', url: 'https://llamaindex.ai', snippet: 'Framework open-source RAG et agentic pour applications LLM avec données' },
    { name: 'LangChain', url: 'https://langchain.com', snippet: 'Framework pour applications LLM avec chaînes, agents et outils' },
    { name: 'Qdrant', url: 'https://qdrant.tech', snippet: 'Vector database open-source haute performance avec recherche sémantique' },
  ];
  return mockDb.filter((r) =>
    terms.split(' ').some((t) => r.snippet.toLowerCase().includes(t) || r.name.toLowerCase().includes(t))
  ).slice(0, 5);
}
