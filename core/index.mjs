// KayrosLab — Coeur LLM gouverne : point d'assemblage.
export * from './resilience.mjs';
export * from './kayros-llm.mjs';
export * from './tool-registry.mjs';
export * from './memory.mjs';
export * from './embeddings.mjs';
export * from './ki.mjs';
export * from './governance.mjs';
export * from './orchestrator.mjs';

import { KayrosLLM, RoutingPolicy, MockProvider, OllamaProvider, HttpBackendProvider } from './kayros-llm.mjs';
import { demoTools } from './tool-registry.mjs';
import { GovernanceService } from './governance.mjs';
import { Orchestrator } from './orchestrator.mjs';
import { InMemoryVectorStore } from './memory.mjs';
import { OllamaEmbeddings, MockEmbeddings, HttpEmbeddings, MemoryService } from './embeddings.mjs';

/**
 * Fabrique un moteur.
 * - P0 : mock (defaut, offline).
 * - P1 : sovereignty:'local' => Ollama (LLM + embeddings).
 * - P2 : backendUrl => proxy PHP/Fastify ; embeddingsUrl => embeddings via proxy.
 * @param {{sovereignty?:'cloud'|'local', ollamaEndpoint?:string, model?:string, embedModel?:string, backendUrl?:string, embeddingsUrl?:string, backendProvider?:string, secret?:string, fetchImpl?:Function}} [opts]
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
  const vectors = new InMemoryVectorStore();

  // Embeddings : proxy > Ollama local > mock offline.
  let embeddings;
  if (opts.embeddingsUrl) embeddings = new HttpEmbeddings({ url: opts.embeddingsUrl, model: opts.embedModel, secret: opts.secret, fetchImpl: opts.fetchImpl });
  else if (opts.sovereignty === 'local') embeddings = new OllamaEmbeddings({ endpoint: opts.ollamaEndpoint, model: opts.embedModel, fetchImpl: opts.fetchImpl });
  else embeddings = new MockEmbeddings();
  const memory = new MemoryService({ embeddings, store: vectors });

  const orchestrator = new Orchestrator({ llm, tools, governance, memory });
  return { llm, tools, governance, vectors, embeddings, memory, orchestrator };
}
