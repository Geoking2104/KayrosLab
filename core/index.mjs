// KayrosLab — Cœur LLM gouverné : point d'assemblage.
export * from './resilience.mjs';
export * from './kayros-llm.mjs';
export * from './tool-registry.mjs';
export * from './memory.mjs';
export * from './memory-types.mjs';
export * from './memory-scope.mjs';
export * from './memory-rank.mjs';
export * from './embeddings.mjs';
export * from './embed-select.mjs';
export * from './novelty.mjs';
export * from './kpi-drift.mjs';
export * from './governance.mjs';
export * from './orchestrator.mjs';
export * from './cycle-lifecycle.mjs';
export * from './model.mjs';
export * from './quant-guidance.mjs';
export * from './ki.mjs';
export * from './evaluation.mjs';
export * from './execution.mjs';
export * from './impact.mjs';
export * from './loop.mjs';
export * from './notify.mjs';
export * from './campaign.mjs';
export * from './comments.mjs';
export * from './auth.mjs';
export * from './connectors.mjs';
export * from './account-link-store.mjs';
export * from './account-link-service.mjs';
export * from './connectors-motif.mjs';
export * from './connectors-slack-deep.mjs';
export * from './pg-store.mjs';
export * from './positionning/index.mjs';
export * from './agents/index.mjs';

import { KayrosLLM } from './kayros-llm.mjs';
import { ToolRegistry } from './tool-registry.mjs';
import { Governance } from './governance.mjs';
import { Orchestrator } from './orchestrator.mjs';
import { OllamaEmbeddings, MockEmbeddings, HttpEmbeddings, MemoryService } from './embeddings.mjs';
import { createEmbeddingsWithFallback } from './embed-select.mjs';
import { QuantGuidance } from './quant-guidance.mjs';
import { createDefaultAgents } from './agents/index.mjs';

/**
 * createEngine — assemble le cœur gouverné.
 * @param {object} opts
 */
export function createEngine(opts = {}) {
  const sovereignty = opts.sovereignty || 'local';
  const model = opts.model || 'llama3.1:8b-instruct';
  const quant = opts.quant || null;

  let embeddings;
  if (opts.embeddingsUrl) embeddings = new HttpEmbeddings({ url: opts.embeddingsUrl, model: opts.embedModel, secret: opts.secret, fetchImpl: opts.fetchImpl });
  else if (sovereignty === 'local') embeddings = new OllamaEmbeddings({ endpoint: opts.ollamaEndpoint, model: opts.embedModel || 'nomic-embed-text', fetchImpl: opts.fetchImpl });
  else embeddings = new MockEmbeddings();

  // Soft-fallback chain when requested
  if (opts.embedFallback) {
    embeddings = createEmbeddingsWithFallback({ forceMock: opts.forceMockEmbed, endpoint: opts.ollamaEndpoint, fetchImpl: opts.fetchImpl });
  }

  const vectors = opts.vectors || null;
  const memory = new MemoryService({ embeddings, store: vectors });
  const llm = opts.llm || new KayrosLLM({ model, quant, sovereignty, ollamaEndpoint: opts.ollamaEndpoint, fetchImpl: opts.fetchImpl });
  const tools = opts.tools || new ToolRegistry();
  const governance = opts.governance || new Governance();
  const quantGuidance = opts.quantGuidance || new QuantGuidance();
  const agents = opts.agents || createDefaultAgents({ llm, tools });

  // Inject embeddings into Bisociateur when available (enables real novelty scoring)
  if (agents.Bisociateur && embeddings) {
    agents.Bisociateur.embeddings = embeddings;
  }

  const orchestrator = opts.orchestrator || new Orchestrator({
    llm, tools, governance, memory, agents, quantGuidance,
  });

  return {
    llm, tools, governance, vectors, embeddings,
    memory, quantGuidance, agents, orchestrator,
  };
}
