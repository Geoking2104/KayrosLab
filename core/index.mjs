// KayrosLab — Coeur LLM gouverne : point d'assemblage.
export * from './resilience.mjs';
export * from './kayros-llm.mjs';
export * from './tool-registry.mjs';
export * from './memory.mjs';
export * from './ki.mjs';
export * from './governance.mjs';
export * from './orchestrator.mjs';

import { KayrosLLM, RoutingPolicy, MockProvider, OllamaProvider, HttpBackendProvider } from './kayros-llm.mjs';
import { demoTools } from './tool-registry.mjs';
import { GovernanceService } from './governance.mjs';
import { Orchestrator } from './orchestrator.mjs';
import { InMemoryVectorStore } from './memory.mjs';

/**
 * Fabrique un moteur.
 * - P0 : mock (defaut, offline).
 * - P1 : sovereignty:'local' => Ollama direct.
 * - P2 : backendUrl => proxy PHP/Fastify (cle cote serveur), provider par defaut 'backend'.
 * @param {{sovereignty?:'cloud'|'local', ollamaEndpoint?:string, model?:string, backendUrl?:string, backendProvider?:string, secret?:string, fetchImpl?:Function}} [opts]
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
  const orchestrator = new Orchestrator({ llm, tools, governance });
  return { llm, tools, governance, vectors, orchestrator };
}
