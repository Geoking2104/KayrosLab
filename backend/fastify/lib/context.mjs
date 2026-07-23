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
  ConnectorService, SlackAdapter, AccountLinkService, AbstractView, AbstractAction, InteractionResponse,
} from '../../core/index.mjs';

export default async function buildContext() {
  const {
    PORT = '8787',
    ALLOWED_ORIGIN = '*',
    ANTHROPIC_API_KEY = '',
    ANTHROPIC_MODEL = 'claude-3-5-sonnet-latest',
    ANTHROPIC_MAXTOK = '1024',
    OLLAMA_ENDPOINT = 'http://localhost:11434',
    OLLAMA_MODEL = 'llama3.2',
    EMBED_MODEL = 'nomic-embed-text',
    KAYROS_SECRET = '',
  } = process.env;

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
    ollama: new OllamaProvider({ endpoint: OLLAMA_ENDPOINT, defaultModel: OLLAMA_MODEL }),
  };

  const policy = new RoutingPolicy({ defaultProvider: ANTHROPIC_API_KEY ? 'anthropic' : 'mock', fallback: 'mock' });
  const llm = new KayrosLLM(providers, policy);
  const embeddings = new OllamaEmbeddings({ endpoint: OLLAMA_ENDPOINT, model: EMBED_MODEL });
  const tools = demoTools();

  const AUTH_SECRET = process.env.KAYROS_AUTH_SECRET || '';
  const USERS_FILE = process.env.KAYROS_USERS_FILE || '';
  const IDEAS_FILE = process.env.KAYROS_IDEAS_FILE || '';

  const userStore = USERS_FILE ? new FileUserStore({ path: USERS_FILE }) : new InMemoryUserStore();
  if (USERS_FILE) await userStore.load();
  const ideas = IDEAS_FILE ? new FileIdeaRepository({ path: IDEAS_FILE }) : new InMemoryIdeaRepository();
  if (IDEAS_FILE) await ideas.load();

  const auth = AUTH_SECRET ? new AuthService({ secret: AUTH_SECRET, users: userStore }) : null;
  const scorecards = defaultScorecards();

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

  const GATES_FILE = process.env.KAYROS_GATES_FILE || '';
  const gateStore = GATES_FILE ? new FileGateStore({ path: GATES_FILE }) : new InMemoryGateStore();

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

  const campagnes = new Map();
  const activites = [];
  const journal = (evt) => { activites.push({ ...evt, ts: evt.ts ?? new Date().toISOString() }); if (activites.length > 5000) activites.shift(); };

  const stageTimer = new StageTimer({ governance });
  const linkService = new AccountLinkService();
  const slackAdapter = process.env.SLACK_BOT_TOKEN
    ? new SlackAdapter({
        signingSecret: process.env.SLACK_SIGNING_SECRET || '',
        botToken: process.env.SLACK_BOT_TOKEN,
        webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
        linkService,
      })
    : null;
  const connectorService = new ConnectorService({
    adapters: [slackAdapter].filter(Boolean),
    linkService, governance, ideas, users: userStore,
  });

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

  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
  const GOOGLE_CX = process.env.GOOGLE_CX || '';
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

  return {
    providers, llm, embeddings, tools, auth, userStore, ideas, scorecards,
    governance, gateStore, campagnes, activites, journal, stageTimer,
    linkService, slackAdapter, connectorService,
    KAYROS_SECRET, GOOGLE_API_KEY, GOOGLE_CX, GITHUB_TOKEN,
    ANTHROPIC_API_KEY, ANTHROPIC_MODEL, EMBED_MODEL, PORT, ALLOWED_ORIGIN,
  };
}
