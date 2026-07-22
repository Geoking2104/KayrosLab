const BACKEND_SEARCH = '/v1/positionning/search';

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

function getMockResults(idea) {
  const terms = idea.toLowerCase();
  const mockDb = [
    { name: 'Hugging Face', url: 'https://huggingface.co', snippet: 'Plateforme ML open-source avec modèles pré-entraînés' },
    { name: 'OpenAI', url: 'https://openai.com', snippet: 'API GPT-4, DALL-E, Whisper. Modèles propriétaires avancés' },
    { name: 'Anthropic', url: 'https://anthropic.com', snippet: 'Claude API, safety-first. Modèles pour entreprise' },
    { name: 'Mistral AI', url: 'https://mistral.ai', snippet: 'LLMs open-weight français. Déploiement souverain' },
    { name: 'Google Vertex AI', url: 'https://cloud.google.com/vertex-ai', snippet: 'Plateforme ML GCP. Modèles Gemini' },
    { name: 'Replicate', url: 'https://replicate.com', snippet: 'Cloud ML pour développeurs. API standardisée' },
    { name: 'Cohere', url: 'https://cohere.com', snippet: 'API NLP entreprise. Embeddings, RAG, classification' },
    { name: 'LlamaIndex', url: 'https://llamaindex.ai', snippet: 'Framework open-source RAG et agentic' },
    { name: 'LangChain', url: 'https://langchain.com', snippet: 'Framework pour applications LLM' },
    { name: 'Qdrant', url: 'https://qdrant.tech', snippet: 'Vector database open-source' },
  ];
  return mockDb.filter((r) =>
    terms.split(' ').some((t) => r.snippet.toLowerCase().includes(t) || r.name.toLowerCase().includes(t))
  ).slice(0, 5);
}
