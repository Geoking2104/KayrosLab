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
export * from './novelty-controller.mjs';
export * from './epistemic.mjs';
export * from './decision-packet.mjs';
export * from './dialectic.mjs';
export * from './frame.mjs';
export * from './world-model.mjs';
export * from './adaptive.mjs';
export * from './run-hooks-p1.mjs';
export * from './run-hooks-p2.mjs';
export * from './run-hooks-p3p4.mjs';
export * from './kpi-drift.mjs';
export * from './projection.mjs';
export * from './roadmap.mjs';
export * from './risques.mjs';
export * from './capitalisation.mjs';
export * from './gates-futurs.mjs';
export * from './arbitrage.mjs';
export * from './ecouter.mjs';
export * from './cartographier.mjs';
export * from './construire.mjs';
export * from './collision.mjs';
export * from './eprouver.mjs';
export * from './loop.mjs';
export * from './model.mjs';
export * from './cycle-lifecycle.mjs';
export * from './workflow-state.mjs';
export * from './workflow-graph.mjs';
export * from './workflow-permissions.mjs';
export * from './workflow-presets.mjs';
export * from './log-sink.mjs';
export * from './run-store.mjs';
export * from './role-context.mjs';
export * from './shared-data.mjs';
export * from './repository.mjs';
export * from './pg-store.mjs';
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
export * from './audit.mjs';
export * from './working-group.mjs';
export * from './adapters/langchain-tools.mjs';
export * from './adapters/langgraph-runner.mjs';
export * from './connectors-discord.mjs';
export * from './positionning/index.mjs';
export * from './quant-guidance.mjs';
export * from './quant-schema.mjs';
export * from './quant-ui.mjs';
export * from './plan-parse.mjs';
export * from './swarm.mjs';
export * from './personality.mjs';
export * from './sales-oracle.mjs';

import { KayrosLLM, RoutingPolicy, MockProvider, OllamaProvider, HttpBackendProvider } from './kayros-llm.mjs';
import { demoTools } from './tool-registry.mjs';
import { GovernanceService } from './governance.mjs';
import { Orchestrator } from './orchestrator.mjs';
import { InMemoryVectorStore, QdrantVectorStore } from './memory.mjs';
import { OllamaEmbeddings, MockEmbeddings, HttpEmbeddings, MemoryService } from './embeddings.mjs';
import { LayeredMemory, FileOffloadBackend, FileLayeredStore } from './memory.mjs';
import { createAllAgents } from './agents/index.mjs';
import { recommendForEngine, filterGuidanceByAvailable, rebindAgentsQuant } from './quant-guidance.mjs';
import { SwarmService } from './swarm.mjs';
import {
  CrystalKnowsProfileAdapter,
  LinkedInSelfProfileAdapter,
  ProfileImportService,
} from './personality.mjs';

async function tryLoadNodeIo() {
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    return { fs: fs.default || fs, path: path.default || path };
  } catch { return null; }
}

export function createEngine(opts = {}) {
  const scopeDefaults = {
    tenantId: opts.tenantId || null,
    defaultScope: opts.defaultScope || null,
    defaultScopeId: opts.defaultScopeId || null,
    userId: opts.userId || null,
    teamId: opts.teamId || null,
    organizationId: opts.organizationId || null,
  };
  const baseModel = opts.model || null;
  const roleQuant = { ...(opts.roleModel || {}), ...(opts.roleQuant || {}) };
  let quantGuidance = opts.quantGuidance || recommendForEngine({
    model: baseModel || 'llama3.2',
    quant: opts.quant || null,
    roleQuant,
    preferHigherQuant: !!opts.preferHigherQuant,
    sovereignty: opts.sovereignty,
    availableModels: opts.availableModels || null,
  });
  const providers = {};
  providers.mock = new MockProvider();
  let ollamaProvider = null;
  if (opts.sovereignty === 'local' || opts.ollamaEndpoint) {
    ollamaProvider = new OllamaProvider({
      endpoint: opts.ollamaEndpoint || 'http://localhost:11434',
      defaultModel: quantGuidance.resolvedDefaultModel || baseModel || 'llama3.2',
      fetchImpl: opts.fetchImpl,
    });
    providers.ollama = ollamaProvider;
  }
  const backendUrl = opts.httpBackendUrl ?? opts.backendUrl;
  if (backendUrl) {
    providers.http = new HttpBackendProvider({
      url: backendUrl, secret: opts.secret, fetchImpl: opts.fetchImpl,
    });
  }
  if (opts.anthropicKey) {
    // optional Anthropic adapter if present in kayros-llm
  }
  const defaultProvider = opts.sovereignty === 'local' ? 'ollama' : ((opts.httpBackendUrl || opts.backendUrl) ? 'http' : 'mock');
  const policy = new RoutingPolicy({
    defaultProvider, fallback: 'mock',
    roleModel: opts.roleModel || {}, roleQuant: opts.roleQuant || {},
    defaultQuant: opts.quant || null, preferHigherQuant: !!opts.preferHigherQuant,
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
  else if (opts.sovereignty === 'local') embeddings = new OllamaEmbeddings({ endpoint: opts.ollamaEndpoint, model: opts.embedModel || 'nomic-embed-text', fetchImpl: opts.fetchImpl });
  else embeddings = new MockEmbeddings();
  const memory = new MemoryService({ embeddings, store: vectors });
  let offloadBackend = null;
  if (opts.offloadRoot || opts.fs) {
    offloadBackend = new FileOffloadBackend({ rootDir: opts.offloadRoot || './.kayros-l0', fs: opts.fs || null, path: opts.path || null });
  }
  let persistentStore = null;
  if (opts.memoryPath || opts.fs) {
    persistentStore = new FileLayeredStore({ path: opts.memoryPath || './.kayros-memory.json', fs: opts.fs || null, partitionByTenant: !!opts.partitionByTenant });
  }
  const layered = new LayeredMemory({ memoryService: memory, store: vectors, offloadBackend, persistentStore });
  if (persistentStore?.enabled) layered.load({ tenantId: opts.tenantId || null }).catch(() => {});
  const agents = createAllAgents({ llm, tools, memory, quantGuidance, baseModel });
  const profileImporter = opts.profileImporter || new ProfileImportService({
    linkedinAdapter: opts.linkedinProfileAdapter || (opts.linkedinAccessToken
      ? new LinkedInSelfProfileAdapter({ accessToken: opts.linkedinAccessToken, fetchImpl: opts.fetchImpl }) : null),
    crystalKnowsAdapter: opts.crystalKnowsProfileAdapter || (opts.crystalKnowsApiToken
      ? new CrystalKnowsProfileAdapter({ apiToken: opts.crystalKnowsApiToken, fetchImpl: opts.fetchImpl }) : null),
  });
  const swarm = new SwarmService({
    llm, memory, systemAgents: opts.systemAgents,
    auditSink: opts.swarmAuditSink || opts.auditSink || null,
    profileImporter,
  });
  if (agents.Bisociateur && embeddings) agents.Bisociateur.embeddings = embeddings;
  const orchestrator = new Orchestrator({
    llm, tools, governance, memory, layered, plannerModel: opts.plannerModel, agents, quantGuidance, ...scopeDefaults,
  });
  const engine = {
    llm, tools, governance, vectors, embeddings, memory, layered, orchestrator, agents, swarm, profileImporter,
    quantGuidance, baseModel, scopeDefaults,
  };
  engine.attachNodeFs = async () => {
    if (opts.fs) return true;
    if (!opts.memoryPath && !opts.offloadRoot) return false;
    const io = await tryLoadNodeIo();
    if (!io) return false;
    if (opts.offloadRoot || opts.memoryPath) {
      layered.offloadBackend = new FileOffloadBackend({ rootDir: opts.offloadRoot || './.kayros-l0', fs: io.fs, path: io.path });
      layered.persistentStore = new FileLayeredStore({ path: opts.memoryPath || './.kayros-memory.json', fs: io.fs, partitionByTenant: !!opts.partitionByTenant });
      await layered.load({ tenantId: opts.tenantId || null }).catch(() => {});
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
    if (ollamaProvider && quantGuidance.resolvedDefaultModel) ollamaProvider.defaultModel = quantGuidance.resolvedDefaultModel;
    rebindAgentsQuant(agents, quantGuidance, baseModel);
    return quantGuidance;
  };
  const maybeSync = async () => {
    if (!opts.syncAvailableQuants || !ollamaProvider || typeof ollamaProvider.listModels !== 'function') return quantGuidance;
    try {
      const tags = await ollamaProvider.listModels();
      if (Array.isArray(tags) && tags.length) return engine.rebindFromAvailable(tags);
    } catch { /* soft */ }
    return quantGuidance;
  };
  engine.syncAvailableQuants = maybeSync();
  return engine;
}
