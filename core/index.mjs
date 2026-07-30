// KayrosLab — Cœur LLM gouverné : point d'assemblage.
export * from './resilience.mjs';
export * from './kayros-llm.mjs';
export * from './tool-registry.mjs';
export * from './memory.mjs';
export * from './memory-types.mjs';
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
export * from './quant-guidance.mjs';
export * from './quant-schema.mjs';

import { KayrosLLM, RoutingPolicy, MockProvider, OllamaProvider, HttpBackendProvider } from './kayros-llm.mjs';
import { demoTools } from './tool-registry.mjs';
import { GovernanceService } from './governance.mjs';
import { Orchestrator } from './orchestrator.mjs';
import {
  InMemoryVectorStore, QdrantVectorStore, LayeredMemory,
  FileOffloadBackend, FileLayeredStore,
} from './memory.mjs';
import { OllamaEmbeddings, MockEmbeddings, HttpEmbeddings, MemoryService } from './embeddings.mjs';
import { createAllAgents } from './agents/index.mjs';
import { recommendForEngine, filterGuidanceByAvailable } from './quant-guidance.mjs';

/**
 * Fabrique un moteur.
 * @param {Object} [opts]
 * @param {string} [opts.quant]
 * @param {Object} [opts.roleQuant]
 * @param {boolean} [opts.preferHigherQuant]
 * @param {boolean} [opts.syncAvailableQuants]  // try ollama listModels and filter
 * @param {string[]} [opts.availableModels]     // explicit installed tags
 */
export function createEngine(opts = {}) {
  const baseModel = opts.model || 'llama3.2';

  let quantGuidance = recommendForEngine({
    model: baseModel,
    quant: opts.quant || null,
    roleQuant: opts.roleQuant || {},
    preferHigherQuant: !!opts.preferHigherQuant,
    sovereignty: opts.sovereignty || null,
    availableModels: opts.availableModels || null,
  });

  const providers = { mock: new MockProvider() };
  let ollamaProvider = null;
  if (opts.sovereignty === 'local') {
    const defaultModel = quantGuidance.resolvedDefaultModel || baseModel;
    ollamaProvider = new OllamaProvider({
      endpoint: opts.ollamaEndpoint,
      defaultModel,
      fetchImpl: opts.fetchImpl,
    });
    providers.ollama = ollamaProvider;
  }
  if (opts.backendUrl) {
    providers.backend = new HttpBackendProvider({
      url: opts.backendUrl, provider: opts.backendProvider, secret: opts.secret, fetchImpl: opts.fetchImpl,
    });
  }
  const defaultProvider = opts.backendUrl ? 'backend' : (opts.sovereignty === 'local' ? 'ollama' : 'mock');

  const policy = new RoutingPolicy({
    defaultProvider,
    fallback: 'mock',
    roleModel: opts.roleModel || {},
    roleQuant: opts.roleQuant || {},
    defaultQuant: opts.quant || null,
    preferHigherQuant: !!opts.preferHigherQuant,
  });

  const llm = new KayrosLLM(providers, policy);
  const tools = demoTools();
  const governance = new GovernanceService();

  let vectors;
  if (opts.qdrantUrl) {
    vectors = new QdrantVectorStore({
      url: opts.qdrantUrl, collection: opts.qdrantCollection || 'kayroslab',
      dim: opts.qdrantDim || 768, apiKey: opts.qdrantApiKey, fetchImpl: opts.fetchImpl,
    });
  } else {
    vectors = new InMemoryVectorStore();
  }

  let embeddings;
  if (opts.embeddingsUrl) embeddings = new HttpEmbeddings({ url: opts.embeddingsUrl, model: opts.embedModel, secret: opts.secret, fetchImpl: opts.fetchImpl });
  else if (opts.sovereignty === 'local') embeddings = new OllamaEmbeddings({ endpoint: opts.ollamaEndpoint, model: opts.embedModel, fetchImpl: opts.fetchImpl });
  else embeddings = new MockEmbeddings();

  const memory = new MemoryService({ embeddings, store: vectors });

  let offloadBackend = null;
  if (opts.offloadRoot || opts.fs) {
    offloadBackend = new FileOffloadBackend({
      rootDir: opts.offloadRoot || './.kayros-l0',
      fs: opts.fs || null,
      path: opts.path || null,
    });
  }

  let persistentStore = null;
  if (opts.memoryPath || opts.fs) {
    persistentStore = new FileLayeredStore({
      path: opts.memoryPath || './.kayros-memory.json',
      fs: opts.fs || null,
    });
  }

  const layered = new LayeredMemory({
    memoryService: memory,
    store: vectors,
    offloadBackend,
    persistentStore,
  });

  if (persistentStore) {
    layered.load().catch(() => {});
  }

  // Best-effort: sync installed Ollama tags → filter quant recommendations
  const maybeSync = async () => {
    if (!opts.syncAvailableQuants || !ollamaProvider || typeof ollamaProvider.listModels !== 'function') return;
    try {
      const tags = await ollamaProvider.listModels();
      if (Array.isArray(tags) && tags.length) {
        quantGuidance = filterGuidanceByAvailable(quantGuidance, tags);
        if (ollamaProvider && quantGuidance.resolvedDefaultModel) {
          ollamaProvider.defaultModel = quantGuidance.resolvedDefaultModel;
        }
      }
    } catch { /* soft — Ollama down */ }
  };
  // Fire and forget; agents below use initial guidance (acceptable for cold start)
  const syncPromise = maybeSync();

  const agents = createAllAgents({
    llm, tools, memory, quantGuidance, baseModel,
  });

  const orchestrator = new Orchestrator({
    llm, tools, governance, memory, layered,
    plannerModel: opts.plannerModel,
    agents,
    quantGuidance,
  });

  return {
    llm, tools, governance, vectors, embeddings,
    memory, layered, orchestrator, agents,
    quantGuidance,
    /** Await to refresh quantGuidance from live `ollama list`. */
    syncAvailableQuants: syncPromise,
  };
}
