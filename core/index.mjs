// KayrosLab — Coeur LLM gouverne : point d'assemblage.
export * from './resilience.mjs';
export * from './kayros-llm.mjs';
export * from './tool-registry.mjs';
export * from './memory.mjs';
export * from './ki.mjs';
export * from './governance.mjs';
export * from './orchestrator.mjs';

import { KayrosLLM, RoutingPolicy, MockProvider, OllamaProvider } from './kayros-llm.mjs';
import { demoTools } from './tool-registry.mjs';
import { GovernanceService } from './governance.mjs';
import { Orchestrator } from './orchestrator.mjs';
import { InMemoryVectorStore } from './memory.mjs';

export function createEngine(opts = {}) {
  const providers = { mock: new MockProvider() };
  if (opts.sovereignty === 'local') {
    providers.ollama = new OllamaProvider({ endpoint: opts.ollamaEndpoint, defaultModel: opts.model, fetchImpl: opts.fetchImpl });
  }
  const policy = new RoutingPolicy({ defaultProvider: opts.sovereignty === 'local' ? 'ollama' : 'mock', fallback: 'mock' });
  const llm = new KayrosLLM(providers, policy);
  const tools = demoTools();
  const governance = new GovernanceService();
  const vectors = new InMemoryVectorStore();
  const orchestrator = new Orchestrator({ llm, tools, governance });
  return { llm, tools, governance, vectors, orchestrator };
}
