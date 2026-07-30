// KayrosLab â€” Coeur LLM gouverne : point d'assemblage.
export * from './resilience.mjs';
export * from './kayros-llm.mjs';
export * from './tool-registry.mjs';
export * from './memory.mjs';
export * from './embeddings.mjs';
export * from './projection.mjs';
export * from './loop.mjs';
export * from './model.mjs';
export * from './repository.mjs';
export * from './intake.mjs';
export * from './scorecard.mjs';
export * from './evaluation.mjs';
export * from './impact.mjs';
export * from './execution.mjs';
export * from './reporting.mjs';
export * from './campaign.mjs';
export * from './comments.mjs';
export * from './notify.mjs';
export * from './auth.mjs';
export * from './ki.mjs';
export * from './governance.mjs';
export * from './orchestrator.mjs';
export * from './timer.mjs';
export * from './connectors.mjs';
export * from './positionning/index.mjs';
export * from './canvas/index.mjs';

import { KayrosLLM, RoutingPolicy, MockProvider, OllamaProvider, HttpBackendProvider } from './kayros-llm.mjs';
import { demoTools } from './tool-registry.mjs';
import { GovernanceService } from './governance.mjs';
import { Orchestrator } from './orchestrator.mjs';
import { InMemoryVectorStore, QdrantVectorStore } from './memory.mjs';
import { OllamaEmbeddings, MockEmbeddings, HttpEmbeddings, MemoryService } from './embeddings.mjs';
import { createAllAgents } from './agents/index.mjs';

/**
 * Fabrique un moteur.
 * - P0 : mock (defaut, offline).
 * - P1 : sovereignty:'local' => Ollama (LLM + embeddings).
 * - P2 : backendUrl => proxy PHP/Fastify ; embeddingsUrl => embeddings via proxy.
 * @param {{sovereignty?:'cloud'|'local', ollamaEndpoint?:string, model?:string, plannerModel?:string, embedModel?:string, backendUrl?:string, embeddingsUrl?:string, backendProvider?:string, secret?:string, fetchImpl?:Function}} [opts]
 */
export function createEngine(opts = {}) {
  const providers = { mock: new MockProvider() };
  if (opts.sovereignty === 'local') {
    providers.ollama = new OllamaProvider({ endpoint: opts.ollamaEndpoint, defaultModel: opts.model, fetchImpl: opts.fetchImpl });
  }
  if (opts.backendUrl) {
    providers.backend = new HttpBackendProvider({ url: opts.backendUrl, provider: opts.backendProvider, secret: opts.secret, fetchImpl: opts.fetchImpl });
  }
  const defaultProvider = opts.backendUrl ? 'backend' : (opts.sovereignty === 'local' ? 'ollama' : 'mock');
  const policy = new RoutingPolicy({ defaultProvider, fallback: 'mock' });
  const llm = new KayrosLLM(providers, policy);
  const tools = demoTools();
  const governance = new GovernanceService();
  // Vector store : Qdrant > InMemory.
  let vectors;
  if (opts.qdrantUrl) {
    vectors = new QdrantVectorStore({
      url: opts.qdrantUrl, collection: opts.qdrantCollection || 'kayroslab',
      dim: opts.qdrantDim || 768, apiKey: opts.qdrantApiKey, fetchImpl: opts.fetchImpl,
    });
  } else {
    vectors = new InMemoryVectorStore();
  }

  // Embeddings : proxy > Ollama local > mock offline.
  let embeddings;
  if (opts.embeddingsUrl) embeddings = new HttpEmbeddings({ url: opts.embeddingsUrl, model: opts.embedModel, secret: opts.secret, fetchImpl: opts.fetchImpl });
  else if (opts.sovereignty === 'local') embeddings = new OllamaEmbeddings({ endpoint: opts.ollamaEndpoint, model: opts.embedModel, fetchImpl: opts.fetchImpl });
  else embeddings = new MockEmbeddings();
  const memory = new MemoryService({ embeddings, store: vectors });

  const agents = createAllAgents({ llm, tools, memory });
  const orchestrator = new Orchestrator({ llm, tools, governance, memory, plannerModel: opts.plannerModel, agents });
  return { llm, tools, governance, vectors, embeddings, memory, orchestrator, agents };
}
