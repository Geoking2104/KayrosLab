// KayrosLab — Cœur LLM gouverné : point d'assemblage.
export * from './resilience.mjs';
export * from './kayros-llm.mjs';
export * from './tool-registry.mjs';
export * from './memory.mjs';
export * from './memory-types.mjs';
export * from './memory-scope.mjs';
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
export * from './quant-ui.mjs';
export * from './plan-parse.mjs';

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
import { recommendForEngine, filterGuidanceByAvailable, normalizeRole } from './quant-guidance.mjs';

export function rebindAgentsQuant(agents, quantGuidance, baseModel) {
  if (!agents || !quantGuidance) return agents;
  for (const [name, agent] of Object.entries(agents)) {
    if (!agent) continue;
    const roleKey = normalizeRole(name);
    const quantRec = quantGuidance.byRole?.[roleKey]
      || quantGuidance.byRole?.[name]
      || quantGuidance.global
      || null;
    let preferredModel = null;
    if (typeof quantGuidance.resolveForRole === 'function' && baseModel) {
      preferredModel = quantGuidance.resolveForRole(roleKey, baseModel)
        || quantGuidance.resolveForRole(name, baseModel);
    } else if (quantGuidance.resolvedDefaultModel) {
      preferredModel = quantGuidance.resolvedDefaultModel;
    }
    agent.preferredModel = preferredModel;
    agent.quantRec = quantRec;
  }
  return agents;
}

async function tryLoadNodeIo() {
  try {
    if (typeof process === 'undefined' || !process.versions?.node) return null;
    const [fs, path] = await Promise.all([
      import('node:fs/promises'),
      import('node:path'),
    ]);
    return { fs, path };
  } catch {
    return null;
  }
}

export function createEngine(opts = {}) {
  const baseModel = opts.model || 'llama3.2';

  // A: L3 scope defaults (tenant / user / team / org)
  const scopeDefaults = {
    tenantId: opts.tenantId || null,
    defaultScope: opts.defaultScope || (opts.tenantId ? 'tenant' : null),
    defaultScopeId: opts.defaultScopeId || opts.tenantId || null,
    userId: opts.userId || null,
    teamId: opts.teamId || null,
    organizationId: opts.organizationId || null,
  };

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
    availableModels: opts.availableModels || null,
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

  if (persistentStore?.enabled) {
    layered.load().catch(() => {});
  }

  const agents = createAllAgents({
    llm, tools, memory, quantGuidance, baseModel,
  });

  const orchestrator = new Orchestrator({
    llm, tools, governance, memory, layered,
    plannerModel: opts.plannerModel,
    agents,
    quantGuidance,
    ...scopeDefaults,
  });

  const engine = {
    llm, tools, governance, vectors, embeddings,
    memory, layered, orchestrator, agents,
    quantGuidance,
    baseModel,
    scopeDefaults,
  };

  engine.attachNodeFs = async () => {
    if (opts.fs) return true;
    if (!opts.memoryPath && !opts.offloadRoot) return false;
    const io = await tryLoadNodeIo();
    if (!io) return false;
    if (opts.offloadRoot || opts.memoryPath) {
      layered.offloadBackend = new FileOffloadBackend({
        rootDir: opts.offloadRoot || './.kayros-l0',
        fs: io.fs,
        path: io.path,
      });
      layered.persistentStore = new FileLayeredStore({
        path: opts.memoryPath || './.kayros-memory.json',
        fs: io.fs,
      });
      await layered.load().catch(() => {});
    }
    return true;
  };

  if ((opts.memoryPath || opts.offloadRoot) && !opts.fs) {
    engine.persistenceReady = engine.attachNodeFs().catch(() => false);
  } else {
    engine.persistenceReady = Promise.resolve(!!(persistentStore?.enabled));
  }

  engine.rebindFromAvailable = async (tags) => {
    if (!Array.isArray(tags) || !tags.length) return quantGuidance;
    quantGuidance = filterGuidanceByAvailable(quantGuidance, tags);
    engine.quantGuidance = quantGuidance;
    orchestrator.quantGuidance = quantGuidance;
    if (policy) policy.availableModels = tags;
    if (ollamaProvider && quantGuidance.resolvedDefaultModel) {
      ollamaProvider.defaultModel = quantGuidance.resolvedDefaultModel;
    }
    rebindAgentsQuant(agents, quantGuidance, baseModel);
    return quantGuidance;
  };

  const maybeSync = async () => {
    if (!opts.syncAvailableQuants || !ollamaProvider || typeof ollamaProvider.listModels !== 'function') {
      return quantGuidance;
    }
    try {
      const tags = await ollamaProvider.listModels();
      if (Array.isArray(tags) && tags.length) {
        return engine.rebindFromAvailable(tags);
      }
    } catch { /* soft */ }
    return quantGuidance;
  };

  engine.syncAvailableQuants = maybeSync();

  return engine;
}
