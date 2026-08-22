import {
  KayrosLLM, RoutingPolicy, MockProvider, OllamaProvider, AnthropicProvider,
  Orchestrator, GovernanceService, demoTools, OllamaEmbeddings,
  evaluateKpis, alertsToSignals,
  AuthService, InMemoryUserStore, FileUserStore,
  InMemoryIdeaRepository, FileIdeaRepository, createIdea, setStage, setStatus,
  portfolio, counts, processIntake, aggregateVotes, defaultScorecards,
  emptyImpact, recordInvestment, recordBenefit, recordActual, impactReport,
  simulateTrajectory, estimateResources,
  ConsoleNotifier, WebhookNotifier, EmailNotifier, CompositeNotifier, gateNotifier,
  InMemoryGateStore, FileGateStore,
  startExecution, updateJalon, advancePhase, cloturer, progression,
  funnel, tempsParEtape, dashboard, exportCsv, compare, leaderboard,
  createCampaign, estOuverte, etatInitial, moderer, estPubliee, fileModeration, statsCampagne,
  addComment, editComment, removeComment, commentTree, countComments,
  buildDigest, formatDigest,
  StageTimer, DEFAULT_STAGE_LIMITS,
  ConnectorService, SlackAdapter, DiscordAdapter, TeamsAdapter, AccountLinkService, AbstractView, AbstractAction, InteractionResponse,
  createEngine,
  createAuditStore,
  WorkingGroupStore, createWorkingGroupStore,
  InMemoryRunStore, FileRunStore, UNIFIED_CONDITIONS,
  InMemorySalesOracleRepository, SalesOracleService,
} from '../../../core/index.mjs';
import { applySharedDataEnv } from '../../../core/shared-data.mjs';
import {
  createPgPool, applySchema, PgIdeaRepository, PgGateStore, PgRunStore, PgSalesOracleRepository,
} from '../../../core/pg-store.mjs';
import { createObjectStorageFromEnv } from './object-storage.mjs';
import { createLinkService } from './context-links.mjs';
import { createMcpClientRegistry } from './mcp-auth.mjs';

export function bindEngineToServer(engine, { llm, tools, governance }) {
  if (!engine) return null;
  if (llm) {
    engine.llm = llm;
    engine.orchestrator.llm = llm;
    for (const a of Object.values(engine.agents || {})) {
      if (a) a.llm = llm;
    }
  }
  if (tools) {
    engine.tools = tools;
    engine.orchestrator.tools = tools;
    for (const a of Object.values(engine.agents || {})) {
      if (a) a.tools = tools;
    }
  }
  if (governance) {
    engine.governance = governance;
    engine.orchestrator.governance = governance;
  }
  return engine;
}

export function orchestratorForRequest(engine, scope = {}) {
  if (!engine) return null;
  const {
    tenantId = null,
    userId = null,
    teamId = null,
    organizationId = null,
  } = scope;
  const orch = engine.orchestrator;
  orch.scopeDefaults = {
    ...orch.scopeDefaults,
    tenantId: tenantId ?? orch.scopeDefaults?.tenantId ?? null,
    defaultScope: tenantId ? 'tenant' : (orch.scopeDefaults?.defaultScope ?? null),
    defaultScopeId: tenantId || orch.scopeDefaults?.defaultScopeId || null,
    userId: userId ?? orch.scopeDefaults?.userId ?? null,
    teamId: teamId ?? orch.scopeDefaults?.teamId ?? null,
    organizationId: organizationId ?? orch.scopeDefaults?.organizationId ?? null,
  };
  return orch;
}

export default async function buildContext() {
  const sharedPaths = applySharedDataEnv(process.env);

  const {
    PORT = '8787',
    ALLOWED_ORIGIN = '*',
    ANTHROPIC_API_KEY = '',
    ANTHROPIC_MODEL = 'claude-3-5-sonnet-latest',
    ANTHROPIC_MAXTOK = '1024',
    MISTRAL_API_KEY = '',
    MISTRAL_MODEL = 'mistral-small-latest',
    OLLAMA_ENDPOINT = 'http://localhost:11434',
    OLLAMA_MODEL = 'llama3.2',
    EMBED_MODEL = 'nomic-embed-text',
    KAYROS_SECRET = '',
    KAYROS_MEMORY_FILE = '',
    KAYROS_OFFLOAD_ROOT = '',
    KAYROS_AUDIT_FILE = '',
    KAYROS_AUDIT_RING = '5000',
    KAYROS_WG_FILE = '',
    KAYROS_PARTITION_TENANT = '',
    KAYROS_QUANT = 'q4_K_M',
    KAYROS_SYNC_QUANTS = '',
    QDRANT_URL = '',
    QDRANT_COLLECTION = 'kayroslab',
    QDRANT_DIM = '768',
    QDRANT_API_KEY = '',
    CRYSTALKNOWS_API_TOKEN = '',
    LINKEDIN_ACCESS_TOKEN = '',
    KAYROS_MCP_CLIENTS_JSON = '',
    KAYROS_MCP_ALLOWED_ORIGINS = '',
    KAYROS_MCP_RATE_LIMIT = '60',
  } = process.env;

  const mcpClients = createMcpClientRegistry(KAYROS_MCP_CLIENTS_JSON);
  const MCP_ALLOWED_ORIGINS = String(KAYROS_MCP_ALLOWED_ORIGINS || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const MCP_RATE_LIMIT = Math.max(1, Number(KAYROS_MCP_RATE_LIMIT) || 60);

  const providers = {
    mock: new MockProvider(),
    anthropic: new AnthropicProvider({
      callBackend: async (req) => {
        if (!ANTHROPIC_API_KEY) { const e = new Error('ANTHROPIC_API_KEY non configuree'); e.code = 'NO_KEY'; throw e; }
        let system = '';
        const messages = [];
        for (const m of req.messages) {
          if (m.role === 'system') system += (m.content || '') + '\n';
          else messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') });
        }
        const payload = { model: req.model || ANTHROPIC_MODEL, max_tokens: Number(ANTHROPIC_MAXTOK), messages };
        if (system.trim()) payload.system = system.trim();
        const t0 = Date.now();
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) { const e = new Error('anthropic http ' + res.status); e.detail = data; throw e; }
        const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        return { text, provider: 'anthropic', latencyMs: Date.now() - t0, usage: { tokensIn: data.usage?.input_tokens ?? 0, tokensOut: data.usage?.output_tokens ?? 0, costUsd: 0 } };
      },
    }),
    mistral: {
      id: 'mistral',
      async complete(req) {
        if (!MISTRAL_API_KEY) { const e = new Error('MISTRAL_API_KEY non configuree'); e.code = 'NO_KEY'; throw e; }
        const messages = (req.messages || []).map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
          content: String(m.content ?? ''),
        }));
        const t0 = Date.now();
        const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + MISTRAL_API_KEY,
          },
          body: JSON.stringify({
            model: req.model || MISTRAL_MODEL,
            messages,
            temperature: typeof req.temperature === 'number' ? req.temperature : 0.4,
            max_tokens: 1200,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          const e = new Error('mistral http ' + res.status);
          e.detail = data;
          throw e;
        }
        const text = data.choices?.[0]?.message?.content ?? '';
        return {
          text,
          provider: 'mistral',
          latencyMs: Date.now() - t0,
          usage: {
            tokensIn: data.usage?.prompt_tokens ?? 0,
            tokensOut: data.usage?.completion_tokens ?? 0,
            costUsd: 0,
          },
        };
      },
    },
    ollama: new OllamaProvider({ endpoint: OLLAMA_ENDPOINT, defaultModel: OLLAMA_MODEL }),
  };

  const defaultProvider = MISTRAL_API_KEY
    ? 'mistral'
    : (ANTHROPIC_API_KEY ? 'anthropic' : 'mock');
  const policy = new RoutingPolicy({ defaultProvider, fallback: 'mock' });
  const llm = new KayrosLLM(providers, policy);
  const embeddings = new OllamaEmbeddings({ endpoint: OLLAMA_ENDPOINT, model: EMBED_MODEL });
  const tools = demoTools();
  try {
    const { registerSearchToolsFromEnv } = await import('./register-search-tools.mjs');
    registerSearchToolsFromEnv(tools);
  } catch (e) {
    console.warn('[kayros] search tools not registered:', e?.message || e);
  }

  const AUTH_SECRET = process.env.KAYROS_AUTH_SECRET || '';
  const USERS_FILE = process.env.KAYROS_USERS_FILE || '';
  const IDEAS_FILE = process.env.KAYROS_IDEAS_FILE || '';

  const pgPool = await createPgPool(process.env);
  // Le schema est applique au demarrage, pas seulement par le script de
  // deploiement VPS : une instance lancee ailleurs (conteneur, second noeud,
  // poste de dev) trouvait sinon une base vide et echouait a la premiere
  // ecriture. `create table if not exists` rend l'operation idempotente.
  if (pgPool) await applySchema(pgPool);
  let storeBackend = 'memory';

  const userStore = USERS_FILE ? new FileUserStore({ path: USERS_FILE }) : new InMemoryUserStore();
  if (USERS_FILE) await userStore.load();

  let ideas;
  if (pgPool) {
    ideas = new PgIdeaRepository(pgPool);
    storeBackend = 'postgres';
    console.info('[kayroslab] ideas store: Postgres');
  } else {
    ideas = IDEAS_FILE ? new FileIdeaRepository({ path: IDEAS_FILE }) : new InMemoryIdeaRepository();
    if (IDEAS_FILE) {
      await ideas.load();
      storeBackend = 'file';
    }
  }

  const auth = AUTH_SECRET ? new AuthService({ secret: AUTH_SECRET, users: userStore }) : null;
  const scorecards = defaultScorecards();
  const salesOracleRepository = pgPool ? new PgSalesOracleRepository(pgPool) : new InMemorySalesOracleRepository();
  const objectStorage = await createObjectStorageFromEnv(process.env);
  const salesOracle = new SalesOracleService({ repository: salesOracleRepository, objectStorage });

  const canaux = [new ConsoleNotifier({ logger: console })];
  if (process.env.KAYROS_NOTIFY_WEBHOOK) canaux.push(new WebhookNotifier({ url: process.env.KAYROS_NOTIFY_WEBHOOK }));
  if (process.env.KAYROS_SMTP_URL) {
    try {
      const { createTransport } = await import('nodemailer');
      canaux.push(new EmailNotifier({
        from: process.env.KAYROS_MAIL_FROM || 'kayroslab@localhost',
        send: ({ to, from, subject, text }) => createTransport(process.env.KAYROS_SMTP_URL).sendMail({ to: to.join(','), from, subject, text }),
      }));
    } catch { console.warn('[kayroslab] SMTP configure mais nodemailer absent'); }
  }

  // Runs suspendus sur un gate humain. Sans ce store le snapshot meurt avec
  // la requete et /v1/runs/:runId/resume n'a rien a reprendre.
  // Persistance des runs suspendus. Postgres des qu'il est la : un fichier
  // suppose un seul processus ecrivain, donc deux instances derriere un load
  // balancer perdraient des decisions. A defaut, fichier -- meme convention
  // que memoryPath / offloadRoot plus bas ; FileRunStore importe
  // node:fs/promises paresseusement, donc pas de dependance sur nodeFs
  // (resolu plus loin). KAYROS_RUNS_FILE=memory force le store volatil.
  const RUNS_FILE = process.env.KAYROS_RUNS_FILE || './.kayros-runs.json';
  let runStore;
  if (pgPool) {
    runStore = new PgRunStore(pgPool);
    console.info('[kayroslab] runs store: Postgres');
  } else if (RUNS_FILE === 'memory') {
    runStore = new InMemoryRunStore();
  } else {
    runStore = new FileRunStore({ path: RUNS_FILE });
  }

  const GATES_FILE = process.env.KAYROS_GATES_FILE || '';
  let gateStore;
  if (pgPool) {
    gateStore = new PgGateStore(pgPool);
    console.info('[kayroslab] gates store: Postgres');
  } else {
    gateStore = GATES_FILE ? new FileGateStore({ path: GATES_FILE }) : new InMemoryGateStore();
  }

  const governance = new GovernanceService({
    store: gateStore,
    notifier: gateNotifier({
      canal: new CompositeNotifier(canaux),
      resolveDestinataires: async (evt) => {
        const idea = evt.ideaId ? await ideas.get(evt.ideaId) : null;
        const users = await userStore.list({ tenantId: idea?.tenantId ?? 'default' });
        return users.filter((u) => u.role === evt.requiredRole).map((u) => u.email);
      },
      resolveTitre: async (evt) => (evt.ideaId ? (await ideas.get(evt.ideaId))?.title ?? null : null),
    }),
  });

  await governance.restore();
  const pendingGates = governance.list().length;
  console.info(`[kayroslab] gates pending restored: ${pendingGates} · backend=${storeBackend}`);
  if (sharedPaths) {
    console.info(`[kayroslab] shared data dir: ${sharedPaths.root}`);
  }

  const campagnes = new Map();
  const auditRing = Number(process.env.KAYROS_AUDIT_RING || 5000) || 5000;
  const auditStore = createAuditStore({ file: process.env.KAYROS_AUDIT_FILE || '' });
  if (auditStore.load) { try { await auditStore.load(); } catch {} }
  const workingGroups = createWorkingGroupStore({ file: process.env.KAYROS_WG_FILE || '' });
  if (workingGroups.load) { try { await workingGroups.load(); } catch {} }
  const activites = [];
  // Rehydrate le journal (timeline) depuis le store persistant au demarrage (EF-32).
  if (auditStore.events) activites.push(...auditStore.events.slice(-auditRing));
  const journal = async (evt) => {
    const e = { ...evt, ts: evt.ts ?? new Date().toISOString() };
    activites.push(e);
    if (activites.length > auditRing) activites.shift();
    try { await auditStore.append(e); } catch {}
  };

  const stageTimer = new StageTimer({ governance });

  const linkService = await createLinkService({ pgPool, env: process.env });

  const slackAdapter = process.env.SLACK_BOT_TOKEN
    ? new SlackAdapter({
        signingSecret: process.env.SLACK_SIGNING_SECRET || '',
        botToken: process.env.SLACK_BOT_TOKEN,
        webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
        linkService,
      })
    : null;
const discordAdapter = process.env.DISCORD_PUBLIC_KEY || process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_WEBHOOK_URL
    ? new DiscordAdapter({
        applicationId: process.env.DISCORD_APPLICATION_ID || '',
        botToken: process.env.DISCORD_BOT_TOKEN || '',
        publicKey: process.env.DISCORD_PUBLIC_KEY || '',
        webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
      })
    : null;
  const teamsAdapter = process.env.TEAMS_APP_ID || process.env.TEAMS_BOT_PASSWORD || process.env.TEAMS_WEBHOOK_URL
    ? new TeamsAdapter({
        botId: process.env.TEAMS_APP_ID || '',
        botPassword: process.env.TEAMS_BOT_PASSWORD || '',
        webhookUrl: process.env.TEAMS_WEBHOOK_URL || '',
        linkService,
      })
    : null;
  const connectorService = new ConnectorService({
    adapters: [slackAdapter, discordAdapter, teamsAdapter].filter(Boolean),
    linkService, governance, ideas, users: userStore,
  });

  const origHandle = connectorService.handleInteraction.bind(connectorService);
  connectorService.handleInteraction = async (evt) => {
    if (evt?._motifConfirmed && (evt.actionId?.startsWith('reject:') || evt.actionId?.startsWith('revise:'))) {
      const decision = evt.actionId.startsWith('reject:') ? 'reject' : 'revise';
      const gateId = evt.actionId.split(':')[1];
      const profile = linkService.get(evt.userId);
      if (!profile) {
        return new InteractionResponse({
          ephemeral: true,
          text: 'Account not linked to KayrosLab.',
        });
      }
      try {
        const rec = governance.list().find((g) => g.gateId === gateId);
        if (!rec) return new InteractionResponse({ ephemeral: true, text: 'Gate already resolved or missing' });
        const resolution = governance.resolve(gateId, {
          decision,
          by: profile.email,
          role: profile.role,
          reason: evt.payload?.reason ?? '',
        });
        if (ideas && rec.ideaId) {
          const idea = await ideas.get(rec.ideaId);
          if (idea) {
            const { setStatus, setStage } = await import('../../../core/model.mjs');
            const map = { approve: 'en_developpement', reject: 'non_poursuivi', revise: 'en_revue' };
            let out = setStatus(idea, map[decision] ?? idea.status, {
              by: profile.email,
              motif: resolution.reason || decision,
            });
            if (decision === 'revise') out = setStage(out, 'eprouver', { by: profile.email, motif: 'revision via chat' });
            await ideas.save(out);
          }
        }
        return new InteractionResponse({ type: 'ack', text: `Decision "${decision}" recorded.` });
      } catch (e) {
        return new InteractionResponse({ ephemeral: true, text: `Error: ${e.message}` });
      }
    }
    return origHandle(evt);
  };

  if (slackAdapter) {
    const origNotifier = governance._notifier;
    governance._notifier = async (evt) => {
      if (origNotifier) try { await origNotifier(evt); } catch { }
      try {
        const idea = evt.ideaId ? await ideas.get(evt.ideaId) : null;
        const view = slackAdapter.buildGateView(evt, { ideaTitre: idea?.title ?? null, gateType: evt.type ?? evt.gateType ?? null, agregat: evt.evaluation ?? null });
        await slackAdapter.postMessage(process.env.SLACK_GATE_CHANNEL || 'general', view);
      } catch { }
    };
  }

  if (discordAdapter) {
    const origNotifier = governance._notifier;
    governance._notifier = async (evt) => {
      if (origNotifier) try { await origNotifier(evt); } catch { }
      try {
        const idea = evt.ideaId ? await ideas.get(evt.ideaId) : null;
        const view = discordAdapter.buildGateView(evt, { ideaTitre: idea?.title ?? null, gateType: evt.type ?? evt.gateType ?? null, agregat: evt.evaluation ?? null });
        await discordAdapter.postMessage(process.env.DISCORD_GATE_CHANNEL || 'general', view);
      } catch { }
    };
  }

  if (teamsAdapter) {
    const origNotifier = governance._notifier;
    governance._notifier = async (evt) => {
      if (origNotifier) try { await origNotifier(evt); } catch { }
      try {
        const idea = evt.ideaId ? await ideas.get(evt.ideaId) : null;
        const view = teamsAdapter.buildGateView(evt, { ideaTitre: idea?.title ?? null, gateType: evt.type ?? evt.gateType ?? null, agregat: evt.evaluation ?? null });
        await teamsAdapter.postMessage(process.env.TEAMS_GATE_CHANNEL || 'general', view);
      } catch { }
    };
  }

  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
  const GOOGLE_CX = process.env.GOOGLE_CX || '';
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
  const GITLAB_TOKEN = process.env.GITLAB_TOKEN || '';
  const GITLAB_BASE_URL = process.env.GITLAB_BASE_URL || 'https://gitlab.com';

  let nodeFs = null;
  let nodePath = null;
  try {
    nodeFs = await import('node:fs/promises');
    nodePath = await import('node:path');
  } catch { /* */ }

  const memoryPath = KAYROS_MEMORY_FILE || (nodeFs ? './.kayros-memory.json' : null);
  const offloadRoot = KAYROS_OFFLOAD_ROOT || (nodeFs ? './.kayros-l0' : null);

  const engine = createEngine({
    sovereignty: 'local',
    model: OLLAMA_MODEL,
    quant: KAYROS_QUANT || 'q4_K_M',
    roleQuant: { Planner: 'q5_K_M', Critic: 'q5_K_M', Synthesizer: 'q5_K_M' },
    ollamaEndpoint: OLLAMA_ENDPOINT,
    embedModel: EMBED_MODEL,
    syncAvailableQuants: KAYROS_SYNC_QUANTS === '1' || KAYROS_SYNC_QUANTS === 'true',
    memoryPath,
    offloadRoot,
    partitionByTenant: KAYROS_PARTITION_TENANT === '1' || KAYROS_PARTITION_TENANT === 'true',
    qdrantUrl: QDRANT_URL || null,
    qdrantCollection: QDRANT_COLLECTION,
    qdrantDim: Number(QDRANT_DIM) || 768,
    qdrantApiKey: QDRANT_API_KEY || null,
    crystalKnowsApiToken: CRYSTALKNOWS_API_TOKEN || null,
    // Official LinkedIn Profile API: authenticated member only. Never exposed
    // to clients and never used to scrape arbitrary public profile URLs.
    linkedinAccessToken: LINKEDIN_ACCESS_TOKEN || null,
    fs: nodeFs,
    path: nodePath,
  });
  // L'orchestrateur enregistre lui-meme un run suspendu et le purge a la
  // terminaison : la route de reprise n'a plus qu'a lire le store.
  if (engine?.orchestrator) {
    engine.orchestrator.runStore = runStore;
    // Registre des resolveurs de condition, cote serveur : un graphe reprend
    // en les retrouvant par nom, sans que le client ait a les fournir.
    // UNIFIED_CONDITIONS contient deja celles du pipeline de reference : un
    // graphe unifie comme un graphe reduit se recompilent tous deux ici.
    engine.orchestrator.graphConditions = {
      ...UNIFIED_CONDITIONS,
      ...(engine.orchestrator.graphConditions || {}),
    };
  }

  bindEngineToServer(engine, { llm, tools, governance });
  if (engine.persistenceReady) {
    await engine.persistenceReady.catch(() => false);
  }
  if (engine.syncAvailableQuants && typeof engine.syncAvailableQuants.then === 'function') {
    engine.syncAvailableQuants.catch(() => {});
  }

  return {
    providers, llm, embeddings, tools, auth, userStore, ideas, scorecards,
    governance, gateStore, runStore, campagnes, activites, journal, auditStore, workingGroups, stageTimer,
    linkService, slackAdapter, discordAdapter, teamsAdapter, connectorService,
    engine, salesOracle, salesOracleRepository, objectStorage,
    sharedPaths,
    pgPool,
    storeBackend,
    KAYROS_SECRET, GOOGLE_API_KEY, GOOGLE_CX, GITHUB_TOKEN, GITLAB_TOKEN, GITLAB_BASE_URL,
    ANTHROPIC_API_KEY, ANTHROPIC_MODEL, MISTRAL_API_KEY, MISTRAL_MODEL,
    EMBED_MODEL, PORT, ALLOWED_ORIGIN,
    OLLAMA_ENDPOINT, OLLAMA_MODEL,
    mcpClients, MCP_ALLOWED_ORIGINS, MCP_RATE_LIMIT,
  };
}
