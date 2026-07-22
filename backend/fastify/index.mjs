// KayrosLab — Backend Fastify : proxy LLM securise (cle cote serveur) + endpoints gouvernes + embeddings.
// Reutilise le coeur committe (../../core). A deployer sur un hote Node (VPS/PaaS), pas sur mutualise.
import Fastify from 'fastify';
import cors from '@fastify/cors';
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

const {
  PORT = 8787,
  ALLOWED_ORIGIN = '*',
  ANTHROPIC_API_KEY = '',
  ANTHROPIC_MODEL = 'claude-3-5-sonnet-latest',
  ANTHROPIC_MAXTOK = '1024',
  OLLAMA_ENDPOINT = 'http://localhost:11434',
  OLLAMA_MODEL = 'llama3.2',
  EMBED_MODEL = 'nomic-embed-text',
  KAYROS_SECRET = '',
} = process.env;

// Appel reel Anthropic (cle cote serveur). Transforme le format messages.
async function anthropicBackend(req) {
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
  return { text, provider: 'anthropic', latencyMs: Date.now() - t0,
    usage: { tokensIn: data.usage?.input_tokens ?? 0, tokensOut: data.usage?.output_tokens ?? 0, costUsd: 0 } };
}

const providers = {
  mock: new MockProvider(),
  anthropic: new AnthropicProvider({ callBackend: anthropicBackend }),
  ollama: new OllamaProvider({ endpoint: OLLAMA_ENDPOINT, defaultModel: OLLAMA_MODEL }),
};
const policy = new RoutingPolicy({ defaultProvider: ANTHROPIC_API_KEY ? 'anthropic' : 'mock', fallback: 'mock' });
const llm = new KayrosLLM(providers, policy);
const embeddings = new OllamaEmbeddings({ endpoint: OLLAMA_ENDPOINT, model: EMBED_MODEL });
const tools = demoTools(); // registre partage (inclut simulate_trajectory / estimate_resources, deterministes)

// --- Authentification & portefeuille ---
// KAYROS_AUTH_SECRET absent => les routes protegees sont desactivees (503), pas ouvertes.
const AUTH_SECRET = process.env.KAYROS_AUTH_SECRET || '';
const USERS_FILE = process.env.KAYROS_USERS_FILE || '';
const IDEAS_FILE = process.env.KAYROS_IDEAS_FILE || '';

// Persistance : fichier si configure, sinon memoire (perdue au redemarrage).
const userStore = USERS_FILE ? new FileUserStore({ path: USERS_FILE }) : new InMemoryUserStore();
if (USERS_FILE) await userStore.load();
const ideas = IDEAS_FILE ? new FileIdeaRepository({ path: IDEAS_FILE }) : new InMemoryIdeaRepository();
if (IDEAS_FILE) await ideas.load();

const auth = AUTH_SECRET ? new AuthService({ secret: AUTH_SECRET, users: userStore }) : null;
const scorecards = defaultScorecards();

// Pas de cache de metadonnees : tout (idee, agregat, titre) est porte par
// l'enregistrement du gate persiste ou relu depuis l'idee. Un cache memoire
// aurait ete perdu au redemarrage, contredisant la persistance des gates.

// --- Canaux de notification reels ---
// Webhook (Slack/Teams/n8n) si configure ; SMTP via nodemailer si configure ET installe.
const canaux = [new ConsoleNotifier({ logger: console })];
if (process.env.KAYROS_NOTIFY_WEBHOOK) {
  canaux.push(new WebhookNotifier({ url: process.env.KAYROS_NOTIFY_WEBHOOK }));
}
if (process.env.KAYROS_SMTP_URL) {
  try {
    const { createTransport } = await import('nodemailer');   // dependance OPTIONNELLE
    const transport = createTransport(process.env.KAYROS_SMTP_URL);
    canaux.push(new EmailNotifier({
      from: process.env.KAYROS_MAIL_FROM || 'kayroslab@localhost',
      send: ({ to, from, subject, text }) => transport.sendMail({ to: to.join(','), from, subject, text }),
    }));
  } catch (e) {
    console.warn('[kayroslab] SMTP configure mais nodemailer absent — canal email desactive.', e.message);
  }
}
if (canaux.length === 1) {
  console.warn('[kayroslab] Aucun canal externe : definissez KAYROS_NOTIFY_WEBHOOK ou KAYROS_SMTP_URL, sinon les censeurs hors application ne seront pas prevenus.');
}

// Gouvernance PARTAGEE : un gate ouvert doit rester visible par le censeur
// entre deux requetes HTTP (sinon la file d'attente n'existe pas).
const GATES_FILE = process.env.KAYROS_GATES_FILE || '';
const gateStore = GATES_FILE ? new FileGateStore({ path: GATES_FILE }) : new InMemoryGateStore();

const governance = new GovernanceService({
  store: gateStore,
  notifier: gateNotifier({
    canal: new CompositeNotifier(canaux),
    // Destinataires = les porteurs du role requis, DANS le tenant de l'idee.
    // On lit l'idee dans le depot : la notification part pendant open(), donc AVANT
    // que gateMeta soit renseigne — ne pas dependre de l'ordre d'execution.
    resolveDestinataires: async (evt) => {
      const idea = evt.ideaId ? await ideas.get(evt.ideaId) : null;
      const users = await userStore.list({ tenantId: idea?.tenantId ?? 'default' });
      return users.filter((u) => u.role === evt.requiredRole).map((u) => u.email);
    },
    resolveTitre: async (evt) => (evt.ideaId ? (await ideas.get(evt.ideaId))?.title ?? null : null),
  }),
});

// Restaure la file d'arbitrage : sans cela, un redemarrage effacait les gates en cours
// alors que comptes et idees survivaient.
await governance.restore();
if (!GATES_FILE) {
  console.warn('[kayroslab] KAYROS_GATES_FILE non defini : les gates en cours seront perdus au redemarrage.');
} else {
  const enCours = governance.list().length;
  if (enCours) console.warn(`[kayroslab] ${enCours} gate(s) en attente restaure(s).`);
}

// Les metadonnees des gates restaures sont reconstruites depuis les idees (voir /v1/gates).

if (AUTH_SECRET && !USERS_FILE) {
  console.warn('[kayroslab] KAYROS_USERS_FILE non defini : les comptes seront perdus au redemarrage.');
}

/** Extrait et verifie le porteur. Leve 401/503 le cas echeant. */
async function requireAuth(req, reply) {
  if (!auth) { reply.code(503).send({ error: 'authentification non configuree (KAYROS_AUTH_SECRET)' }); return null; }
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) { reply.code(401).send({ error: 'jeton requis' }); return null; }
  try { return await auth.verify(token); }
  catch (e) { reply.code(401).send({ error: e.message }); return null; }
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: ALLOWED_ORIGIN });

// Secret partage optionnel
app.addHook('preHandler', async (req, reply) => {
  if (!KAYROS_SECRET) return;
  if (req.method === 'GET') return;
  if (req.headers['x-kayros-secret'] !== KAYROS_SECRET) return reply.code(401).send({ error: 'non autorise' });
});

app.get('/health', async () => ({ ok: true, providers: Object.keys(providers), model: ANTHROPIC_MODEL, embedModel: EMBED_MODEL, anthropicConfigured: !!ANTHROPIC_API_KEY }));

// Completion brute (utilisee par HttpBackendProvider cote navigateur).
app.post('/v1/llm', async (req, reply) => {
  const { messages, model, provider, role, temperature } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return reply.code(400).send({ error: 'messages requis' });
  const opts = provider ? { provider } : {};
  const r = await llm.complete({ messages, model, role, temperature }, opts);
  return { text: r.text, provider: r.provider, usage: r.usage, latencyMs: r.latencyMs };
});

// Embeddings (souverain via Ollama). Utilise par HttpEmbeddings cote navigateur.
app.post('/v1/embed', async (req, reply) => {
  const { input, model } = req.body || {};
  const texts = Array.isArray(input) ? input : (typeof input === 'string' ? [input] : null);
  if (!texts || !texts.length) return reply.code(400).send({ error: 'champ input requis (string ou string[])' });
  if (model) embeddings.model = model;
  try {
    const vecs = await embeddings.embedBatch(texts);
    return { embeddings: vecs, model: embeddings.model };
  } catch (e) { return reply.code(502).send({ error: String(e.message || e) }); }
});

// Liste des outils exposables (metadonnees uniquement).
app.get('/v1/tools', async () => ({
  tools: tools.list().map((t) => ({ name: t.name, description: t.description, sideEffect: t.sideEffect, inputKeys: t.inputKeys })),
}));

// Execution d'un outil. Restreint aux outils `read` (deterministes, sans effet de bord) :
// simulate_trajectory / estimate_resources / search_regulatory_risks / calculate_ki_impact.
app.post('/v1/tools/call', async (req, reply) => {
  const { name, input, ideaId } = req.body || {};
  if (!name) return reply.code(400).send({ error: 'name requis' });
  const t = tools.get(name);
  if (!t) return reply.code(404).send({ error: `outil inconnu: ${name}` });
  if (t.sideEffect !== 'read') return reply.code(403).send({ error: `outil ${name} non exposable (sideEffect=${t.sideEffect})` });
  try {
    const result = await tools.call(name, input || {}, { ideaId });
    return { name, result };
  } catch (e) { return reply.code(400).send({ error: String(e.message || e) }); }
});

// Requete gouvernee (orchestrateur + gate de sortie). En mode gate: 202 pending_review.
app.post('/v1/govern/query', async (req, reply) => {
  const { query, governance = 'supervise', sovereignty = 'cloud', provider, ideaId } = req.body || {};
  if (!query) return reply.code(400).send({ error: 'query requis' });
  const orch = new Orchestrator({ llm, tools: demoTools(), governance: new GovernanceService() });
  const plan = await orch.plan(query, { ideaId });
  const agents = [];
  let final = null, gate = null;
  for await (const ev of orch.run(plan, { governance, sovereignty, provider })) {
    if (ev.type === 'trace') agents.push(ev.agent);
    else if (ev.type === 'gate') { gate = ev; break; }
    else if (ev.type === 'final') final = ev;
  }
  if (gate) return reply.code(202).send({ status: 'pending_review', gateId: gate.gateId, gateType: gate.gateType, trace: { agents } });
  return { status: final.status, answer: final.answer ?? final.message, trace: { agents } };
});

// Boucle Projeter -> Ecouter (EF-43) : tick SANS ETAT, appelable par un cron.
// Evalue les KPIs et renvoie les signaux a re-injecter + une proposition de re-arbitrage.
app.post('/v1/projeter/monitor', async (req, reply) => {
  const { kpis = [], readings = [], ideaId = 'idea' } = req.body || {};
  if (!Array.isArray(kpis) || !Array.isArray(readings)) return reply.code(400).send({ error: 'kpis[] et readings[] requis' });
  const { alerts } = evaluateKpis(kpis, readings);
  const signals = alertsToSignals(alerts, { ideaId });
  const reArbitrage = alerts.length ? { type: 're-arbitrage', ideaId, reasons: alerts.map((a) => a.kpiId) } : null;
  return { alerts, signals, reArbitrage };
});

// ---------------- Authentification ----------------
app.post('/v1/auth/register', async (req, reply) => {
  if (!auth) return reply.code(503).send({ error: 'authentification non configuree' });
  const { email, password, name, role, tenantId } = req.body || {};
  try {
    // Creation d'un role privilegie reservee au COMEX authentifie.
    let asked = role || 'contributeur';
    if (asked !== 'contributeur') {
      const caller = await requireAuth(req, reply); if (!caller) return;
      if (caller.role !== 'comex') return reply.code(403).send({ error: 'seul un COMEX peut creer ce role' });
    }
    return { user: await auth.register({ email, password, name, role: asked, tenantId }) };
  } catch (e) { return reply.code(400).send({ error: e.message }); }
});

app.post('/v1/auth/login', async (req, reply) => {
  if (!auth) return reply.code(503).send({ error: 'authentification non configuree' });
  const { email, password } = req.body || {};
  try {
    // Cle de limitation combinant email et IP (freine le bruteforce cible et distribue).
    return await auth.login({ email, password, throttleKey: `${String(email ?? '').toLowerCase()}|${req.ip}` });
  } catch (e) {
    if (e.code === 'AUTH_THROTTLED') return reply.code(429).send({ error: e.message });
    return reply.code(401).send({ error: e.message });
  }
});

app.post('/v1/auth/logout', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const h = req.headers.authorization || '';
  await auth.logout(h.slice(7));
  return { ok: true };
});

app.get('/v1/auth/me', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  return { user: { id: me.sub, email: me.email, role: me.role, tenantId: me.tenantId } };
});

// ---------------- Portefeuille (toutes routes scopees au tenant du porteur) ----------------
app.get('/v1/ideas', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const { stage, status, category, q, inclureModeration } = req.query || {};
  const list = await ideas.list({ tenantId: me.tenantId, stage, status, category, q });
  // Une idee en attente de moderation ne pollue pas le portefeuille (ni WIP, ni entonnoir).
  return { ideas: inclureModeration === 'true' ? list : list.filter(estPubliee) };
});

app.post('/v1/ideas', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const { id, title, intake, category, campagneId } = req.body || {};
  try {
    // Campagne : fenetre de soumission respectee, moderation appliquee si exigee.
    const campagne = campagneId ? campagnes.get(campagneId) : null;
    if (campagneId && !campagne) return reply.code(404).send({ error: 'campagne introuvable' });
    if (campagne && campagne.tenantId !== me.tenantId) return reply.code(404).send({ error: 'campagne introuvable' });
    const fenetre = estOuverte(campagne);
    if (!fenetre.ouverte) return reply.code(409).send({ error: `campagne ${fenetre.raison}`, code: fenetre.raison });

    const derive = intake ? processIntake(intake) : null;
    const idea = {
      ...createIdea({
        id: id || `D${Date.now()}`, title, author: me.email, category,
        intake, tenantId: me.tenantId,                     // tenant impose par le jeton, pas par le client
      }),
      campagneId: campagne?.id ?? null,
      moderation: etatInitial(campagne),
      comments: [],
    };
    await ideas.save(idea);
    return reply.code(201).send({
      idea, derive,                                        // hypotheses + cibles d'attaque
      enModeration: !estPubliee(idea),                     // l'auteur sait si son idee attend un feu vert
    });
  } catch (e) { return reply.code(400).send({ error: e.message }); }
});

app.get('/v1/ideas/:id', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const idea = await ideas.get(req.params.id);
  if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
  return { idea };
});

app.patch('/v1/ideas/:id', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const idea = await ideas.get(req.params.id);
  if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
  const { stage, status, motif } = req.body || {};
  try {
    let out = idea;
    if (stage) out = setStage(out, stage, { by: me.email, motif });
    if (status) out = setStatus(out, status, { by: me.email, motif });
    await ideas.save(out);
    if (stage) journal({ type: 'etape', by: me.email, de: idea.stage, a: stage, ideaId: idea.id, titre: idea.title });
    if (status) journal({ type: 'statut', by: me.email, de: idea.status, a: status, ideaId: idea.id, titre: idea.title });
    return { idea: out };
  } catch (e) { return reply.code(400).send({ error: e.message }); }
});

app.get('/v1/portfolio', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const board = await portfolio(ideas, { tenantId: me.tenantId });
  const all = await ideas.list({ tenantId: me.tenantId });
  const byStatus = {};
  for (const i of all) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
  return { ...board, byStatus };
});

// Vote multi-evaluateurs : instruit la decision, ne la tranche pas.
app.post('/v1/ideas/:id/votes', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const idea = await ideas.get(req.params.id);
  if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
  const { score, comment } = req.body || {};
  if (typeof score !== 'number') return reply.code(400).send({ error: 'score numerique requis (0..100)' });
  const votes = [...(idea.votes ?? []).filter((v) => v.by !== me.email), { by: me.email, role: me.role, score, comment }];
  const out = { ...idea, votes, updatedAt: new Date().toISOString() };
  await ideas.save(out);
  journal({ type: 'vote', by: me.email, score, ideaId: idea.id, titre: idea.title });
  return { agregat: aggregateVotes(votes) };
});

// ---------------- Gates de gouvernance ----------------
// Ouvre un gate d'arbitrage : l'agregat de vote INSTRUIT la decision, le veto tranche.
app.post('/v1/ideas/:id/gates', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const idea = await ideas.get(req.params.id);
  if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
  const { type = 'validation', requiredRole = 'comex' } = req.body || {};
  const agregat = aggregateVotes(idea.votes ?? []);
  const { gateId } = governance.open({ ideaId: idea.id, type, requiredRole, payload: idea.title, evaluation: agregat });
  return reply.code(201).send({ gateId, agregat });
});

// File d'attente du censeur : ce qu'IL doit arbitrer, dans SON tenant.
app.get('/v1/gates', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  // Enrichissement depuis l'IDEE (et non depuis un cache memoire) : les gates
  // restaures apres redemarrage restent complets.
  const enrichis = await Promise.all(governance.list().map(async (g) => {
    const idea = g.ideaId ? await ideas.get(g.ideaId) : null;
    return {
      gateId: g.gateId, type: g.type, requiredRole: g.requiredRole, ideaId: g.ideaId ?? null,
      titre: idea?.title ?? g.payload ?? g.ideaId,
      agregat: g.evaluation ?? null,               // l'agregat est persiste avec le gate
      createdAt: g.createdAt,
      tenantId: idea?.tenantId ?? 'default',
      pourMoi: g.requiredRole === me.role,          // l'UI met en avant ce qui m'incombe
    };
  }));
  return {
    gates: enrichis.filter((g) => g.tenantId === me.tenantId).map(({ tenantId, ...g }) => g),
    monRole: me.role,
  };
});

// Resolution : le service verifie l'habilitation du role ET impose un motif si refus/revision.
app.post('/v1/gates/:gateId/resolve', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  // On lit l'enregistrement AVANT resolution (resolve() le retire de la file).
  const rec = governance.list().find((g) => g.gateId === req.params.gateId);
  if (!rec) return reply.code(404).send({ error: 'gate introuvable' });
  const cible = rec.ideaId ? await ideas.get(rec.ideaId) : null;
  if (cible && (cible.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
  const { decision, reason = '' } = req.body || {};
  try {
    const resolution = governance.resolve(req.params.gateId, { decision, by: me.email, role: me.role, reason });
    // Repercussion sur l'idee : la decision touche les DEUX axes.
    {
      const idea = cible;
      if (idea) {
        const map = { approve: 'en_developpement', reject: 'non_poursuivi', revise: 'en_revue' };
        let out = setStatus(idea, map[decision] ?? idea.status, { by: me.email, motif: reason || decision });
        if (decision === 'approve') out = setStage(out, 'projeter', { by: me.email, motif: 'gate approuve' });
        if (decision === 'revise') out = setStage(out, 'eprouver', { by: me.email, motif: 'revision demandee' });
        await ideas.save(out);
      }
    }
    return { resolution };
  } catch (e) { return reply.code(403).send({ error: e.message }); }
});

// ---------------- Impact : realise vs projete ----------------
// Calcule et STOCKE la projection sur l'idee (reference future du suivi).
app.post('/v1/ideas/:id/projection', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const idea = await ideas.get(req.params.id);
  if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
  const { scenarios = [], variables = [], milestones = [], costHypotheses = {}, seed } = req.body || {};
  try {
    const projection = scenarios.length ? simulateTrajectory({ scenarios, variables, seed }) : null;
    const ressources = milestones.length ? estimateResources({ milestones, costHypotheses }) : null;
    const out = { ...idea, projection, ressources, updatedAt: new Date().toISOString() };
    await ideas.save(out);
    return { projection, ressources };
  } catch (e) { return reply.code(400).send({ error: e.message }); }
});

// Enregistre une valeur CONSTATEE (investissement, benefice, releve de KPI).
app.post('/v1/ideas/:id/impact', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const idea = await ideas.get(req.params.id);
  if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
  const { type, montant, libelle, kpiId, value } = req.body || {};
  let impact = idea.impact ?? emptyImpact();
  try {
    if (type === 'investissement') impact = recordInvestment(impact, { montant, libelle });
    else if (type === 'benefice') impact = recordBenefit(impact, { montant, libelle });
    else if (type === 'releve') impact = recordActual(impact, { kpiId, value });
    else return reply.code(400).send({ error: "type attendu : investissement | benefice | releve" });
    const out = { ...idea, impact, updatedAt: new Date().toISOString() };
    await ideas.save(out);
    return { rapport: impactReport(idea.projection ?? {}, impact) };
  } catch (e) { return reply.code(400).send({ error: e.message }); }
});

// Le rapport d'ecart : c'est ici que la projection rencontre le reel.
app.get('/v1/ideas/:id/impact', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const idea = await ideas.get(req.params.id);
  if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
  return {
    projection: idea.projection ?? null,
    ressources: idea.ressources ?? null,
    rapport: impactReport(idea.projection ?? {}, idea.impact ?? emptyImpact()),
  };
});

// Notation d'une idee avec une grille : le circuit d'ecriture qui manquait.
app.post('/v1/ideas/:id/score', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const idea = await ideas.get(req.params.id);
  if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) return reply.code(404).send({ error: 'introuvable' });
  const { scorecardId, values = {} } = req.body || {};
  const card = scorecardId ? scorecards.get(scorecardId) : (scorecards.forStage(idea.stage)[0] ?? null);
  if (!card) return reply.code(400).send({ error: `aucune grille pour l'etape "${idea.stage}"` });
  try {
    const resultat = card.score(values);
    const entree = { scorecardId: card.id, values, resultat, by: me.email, ts: new Date().toISOString() };
    const scores = { ...(idea.scores ?? {}), [card.id]: entree };
    // Historisation (EF-71) : on conserve chaque notation, on n'ecrase pas.
    const scoreHistory = [...(idea.scoreHistory ?? []), entree];
    await ideas.save({ ...idea, scores, scoreHistory, ki: resultat.normalise, updatedAt: entree.ts });
    return { resultat, historique: scoreHistory.length };
  } catch (e) { return reply.code(400).send({ error: e.message }); }
});

app.get('/v1/scorecards', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const { stage } = req.query || {};
  const list = stage ? scorecards.forStage(stage) : scorecards.list();
  return { scorecards: list.map((s) => ({ id: s.id, stage: s.stage, label: s.label, scale: s.scale, criteria: s.criteria })) };
});

// ---------------- Campagnes & moderation (EF-61/62) ----------------
const campagnes = new Map();          // en memoire : volume faible, redemarrage tolerable
const activites = [];                 // journal d'activite (digest)
const journal = (evt) => { activites.push({ ...evt, ts: evt.ts ?? new Date().toISOString() }); if (activites.length > 5000) activites.shift(); };

app.get('/v1/campaigns', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const list = [...campagnes.values()].filter((c) => c.tenantId === me.tenantId);
  const toutes = await ideas.list({ tenantId: me.tenantId });
  return { campaigns: list.map((c) => ({ ...c, stats: statsCampagne(toutes, c.id), ...estOuverte(c) })) };
});

app.post('/v1/campaigns', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  try {
    auth.requireRole(me, ['comex', 'facilitateur']);   // seuls eux ouvrent une campagne
    const c = createCampaign({ ...req.body, id: req.body?.id || `camp_${Date.now()}`, tenantId: me.tenantId });
    campagnes.set(c.id, c);
    return reply.code(201).send({ campaign: c });
  } catch (e) { return reply.code(e.code === 'AUTH_FORBIDDEN' ? 403 : 400).send({ error: e.message }); }
});

// File de moderation : les soumissions en attente de recevabilite.
app.get('/v1/moderation', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const toutes = await ideas.list({ tenantId: me.tenantId });
  return { file: fileModeration(toutes, { tenantId: me.tenantId }), monRole: me.role };
});

app.post('/v1/ideas/:id/moderate', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const idea = await chargerIdee(req, reply, me); if (!idea) return;
  const { decision, motif } = req.body || {};
  try {
    auth.requireRole(me, ['comex', 'facilitateur']);
    const out = moderer(idea, { decision, by: me.email, motif });
    await ideas.save(out);
    journal({ type: 'moderation', by: me.email, a: decision, ideaId: idea.id, titre: idea.title });
    return { idea: out };
  } catch (e) { return reply.code(e.code === 'AUTH_FORBIDDEN' ? 403 : 400).send({ error: e.message }); }
});

// ---------------- Fil de commentaires (EF-67) ----------------
app.get('/v1/ideas/:id/comments', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const idea = await chargerIdee(req, reply, me); if (!idea) return;
  return { fil: commentTree(idea.comments ?? []), total: countComments(idea.comments ?? []) };
});

app.post('/v1/ideas/:id/comments', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const idea = await chargerIdee(req, reply, me); if (!idea) return;
  try {
    const comments = addComment(idea.comments ?? [], { by: me.email, role: me.role, texte: req.body?.texte, parentId: req.body?.parentId ?? null });
    await ideas.save({ ...idea, comments, updatedAt: new Date().toISOString() });
    journal({ type: 'commentaire', by: me.email, ideaId: idea.id, titre: idea.title });
    return reply.code(201).send({ fil: commentTree(comments), total: countComments(comments) });
  } catch (e) { return reply.code(400).send({ error: e.message }); }
});

app.delete('/v1/ideas/:id/comments/:commentId', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const idea = await chargerIdee(req, reply, me); if (!idea) return;
  try {
    const comments = removeComment(idea.comments ?? [], req.params.commentId, { by: me.email, role: me.role });
    await ideas.save({ ...idea, comments, updatedAt: new Date().toISOString() });
    return { fil: commentTree(comments), total: countComments(comments) };
  } catch (e) { return reply.code(403).send({ error: e.message }); }
});

// ---------------- Activite & digest (EF-74/75) ----------------
app.get('/v1/activity', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const mesIdees = new Set((await ideas.list({ tenantId: me.tenantId })).map((i) => i.id));
  return { activites: activites.filter((a) => mesIdees.has(a.ideaId)).slice(-100).reverse() };
});

app.get('/v1/digest', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const { depuis, jusqua, periode = 'quotidien' } = req.query || {};
  const mesIdees = new Set((await ideas.list({ tenantId: me.tenantId })).map((i) => i.id));
  const d = buildDigest(activites.filter((a) => mesIdees.has(a.ideaId)), { depuis, jusqua, periode });
  return { digest: d, message: formatDigest(d, { destinataires: [me.email] }) };
});

// ---------------- Comparaison inter-idees (EF-54) ----------------
app.post('/v1/reporting/compare', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (ids.length < 2) return reply.code(400).send({ error: 'au moins 2 idees a comparer' });
  const list = (await ideas.list({ tenantId: me.tenantId })).filter((i) => ids.includes(i.id));
  return { comparaison: compare(list) };
});

// ---------------- Cycle aval : etape Realiser (EF-80 a EF-83) ----------------
async function chargerIdee(req, reply, me) {
  const idea = await ideas.get(req.params.id);
  if (!idea || (idea.tenantId ?? 'default') !== me.tenantId) { reply.code(404).send({ error: 'introuvable' }); return null; }
  return idea;
}

// Demarre l'execution a partir de la roadmap produite en Projeter.
app.post('/v1/ideas/:id/execution', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const idea = await chargerIdee(req, reply, me); if (!idea) return;
  if (!idea.roadmap?.jalons?.length && !req.body?.roadmap?.jalons?.length) {
    return reply.code(400).send({ error: "aucune roadmap : passer d'abord par Projeter" });
  }
  try {
    const execution = startExecution({ roadmap: req.body?.roadmap ?? idea.roadmap });
    const out = setStage({ ...idea, execution }, 'realiser', { by: me.email, motif: 'demarrage execution' });
    await ideas.save(out);
    return reply.code(201).send({ execution, progression: progression(execution) });
  } catch (e) { return reply.code(400).send({ error: e.message }); }
});

// Avancement d'un jalon, changement de phase, ou cloture.
app.patch('/v1/ideas/:id/execution', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const idea = await chargerIdee(req, reply, me); if (!idea) return;
  if (!idea.execution) return reply.code(400).send({ error: 'execution non demarree' });
  const { jalonId, patch, action, force, verdict, enseignements } = req.body || {};
  try {
    let execution = idea.execution;
    if (jalonId) execution = updateJalon(execution, jalonId, patch ?? {}, { by: me.email });
    if (action === 'phase_suivante') execution = advancePhase(execution, { force: !!force, by: me.email });
    if (action === 'cloturer') execution = cloturer(execution, { verdict, enseignements, by: me.email });
    let out = { ...idea, execution, updatedAt: new Date().toISOString() };
    // Une cloture termine l'idee : le statut suit.
    if (action === 'cloturer') out = setStatus(out, 'termine', { by: me.email, motif: `bilan ${verdict}` });
    await ideas.save(out);
    return { execution, progression: progression(execution) };
  } catch (e) {
    return reply.code(e.code === 'JALONS_OUVERTS' ? 409 : 400).send({ error: e.message, code: e.code ?? null });
  }
});

// ---------------- Reporting (EF-84 a EF-87) ----------------
app.get('/v1/reporting/dashboard', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const list = await ideas.list({ tenantId: me.tenantId });
  return { dashboard: dashboard(list), funnel: funnel(list), tempsParEtape: tempsParEtape(list) };
});

app.get('/v1/reporting/export', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const list = await ideas.list({ tenantId: me.tenantId });
  reply.header('Content-Type', 'text/csv; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="portefeuille-${me.tenantId}.csv"`);
  return exportCsv(list);
});

// ---------------- Stage Timer (hackathon deadlines) ----------------
const stageTimer = new StageTimer({ governance });

app.post('/v1/timer/deadline', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const { ideaId, stage, maxHours, deadline } = req.body || {};
  if (!ideaId || !stage) return reply.code(400).send({ error: 'ideaId et stage requis' });
  stageTimer.setDeadline(ideaId, stage, { maxHours, deadline });
  return { ok: true, status: stageTimer.status() };
});

app.post('/v1/timer/tick', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const result = await stageTimer.tick();
  return { gates: result.gates.length, warnings: result.warnings.length, status: stageTimer.status() };
});

app.get('/v1/timer/status', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  return { timer: stageTimer.status() };
});

// ---------------- Leaderboard temps reel (hackathon) ----------------
app.post('/v1/reporting/leaderboard', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const { critere = 'ki', sens = 'desc', top = 20, campagneId = null } = req.body || {};
  const list = await ideas.list({ tenantId: me.tenantId });
  return { leaderboard: leaderboard(list, { critere, sens, top, campagneId }) };
});

// ---------------- Connecteurs conversationnels (Slack/Teams/Discord) ----------------
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

// Hook le notifier de gouvernance pour publier les gates ouverts dans le chat
if (slackAdapter) {
  const origNotifier = governance._notifier;
  governance._notifier = async (evt) => {
    if (origNotifier) try { await origNotifier(evt); } catch { /* best-effort */ }
    try {
      const idea = evt.ideaId ? await ideas.get(evt.ideaId) : null;
      const view = slackAdapter.buildGateView(evt, {
        ideaTitre: idea?.title ?? null,
        gateType: evt.type ?? evt.gateType ?? null,
        agregat: evt.evaluation ?? null,
      });
      await slackAdapter.postMessage(process.env.SLACK_GATE_CHANNEL || 'general', view);
    } catch { /* panne Slack non bloquante */ }
  };
}

// Point d'entree Slack (block actions, view submissions, slash commands)
app.post('/v1/connectors/slack/interactive', async (req, reply) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  // Slack envoie parfois un payload en form-encoded string
  let payload = body;
  if (body.payload) try { payload = JSON.parse(body.payload); } catch { payload = body; }
  const evt = slackAdapter?.parseRequest({ body: payload, headers: req.headers });
  if (!evt) return reply.code(200).send(''); // Slack attend un 200 meme si rien
  const res = await connectorService.handleInteraction(evt);
  if (res.type === 'ack') return reply.code(200).send('');
  if (res.type === 'ephemeral') return reply.code(200).send({ response_type: 'ephemeral', text: res.text });
  if (res.type === 'modal' && res.view) {
    const blocks = slackAdapter.renderView(res.view);
    return reply.code(200).send({
      response_action: 'push',
      view: { type: 'modal', callback_id: 'gate_motif', title: { text: res.view.title }, blocks, submit: { text: 'Confirmer' } },
    });
  }
  return reply.code(200).send('');
});

// Generation d'un jeton de liaison (back-office -> chat)
app.post('/v1/connectors/link', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const { platformId, userId, platform = 'slack' } = req.body || {};
  if (!platformId || !userId) return reply.code(400).send({ error: 'platformId et userId requis' });
  const { token, expiresAt } = linkService.createToken({ platformId, userId, platform });
  return { token, expiresAt, modeEmploi: `Dans KayrosLab, allez dans Profil > Lier un compte et saisissez ce jeton (expire dans 15 min).` };
});

// Validation du jeton de liaison (depuis le back-office apres auth)
app.post('/v1/connectors/link/:token', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  try {
    const result = linkService.link(req.params.token, { id: me.sub, email: me.email, role: me.role, tenantId: me.tenantId });
    return { ok: true, platformId: result.platformId };
  } catch (e) { return reply.code(400).send({ error: e.message }); }
});

// === POST /v1/positionning/search — Recherche concurrents (DuckDuckGo par defaut, Google si API key) ===
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
const GOOGLE_CX = process.env.GOOGLE_CX || '';

app.post('/v1/positionning/search', async (req, reply) => {
  const { q, limit = 5 } = req.body || {};
  if (!q) return reply.code(400).send({ error: 'Champ "q" requis' });

  try {
    let results;
    if (GOOGLE_API_KEY && GOOGLE_CX) {
      results = await searchGoogle(q, limit);
    } else {
      results = await searchDuckDuckGo(q, limit);
    }
    return { results, provider: GOOGLE_API_KEY ? 'google' : 'duckduckgo' };
  } catch (err) {
    app.log.error(err);
    return reply.code(502).send({ error: 'Echec de la recherche', message: err.message });
  }
});

async function searchGoogle(q, limit) {
  const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(q)}&num=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Search API: ${res.status}`);
  const data = await res.json();
  return (data.items || []).map((item) => ({
    name: item.title,
    url: item.link,
    snippet: item.snippet || '',
  }));
}

async function searchDuckDuckGo(q, limit) {
  // Scrape les resultats HTML de DuckDuckGo (lite, sans JS)
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KayrosLab/1.0)' },
  });
  if (!res.ok) throw new Error(`DuckDuckGo: ${res.status}`);
  const html = await res.text();

  // Parse la table de resultats (structure HTML de lite.duckduckgo.com)
  const results = [];
  const rows = html.match(/<tr>.*?<\/tr>/gs) || [];
  let current = null;

  for (const row of rows) {
    const nameMatch = row.match(/class=["']result-link["'][^>]*>([^<]+)<\/a>/i);
    const urlMatch = row.match(/href=["'](https?:\/\/[^"']+)["']/i);
    const snippetMatch = row.match(/class=["']result-snippet["'][^>]*>(.*?)<\/td>/is);

    if (nameMatch && urlMatch) {
      current = {
        name: nameMatch[1].replace(/<[^>]*>/g, '').trim(),
        url: urlMatch[1].split('?')[0], // nettoie les parametres de tracking
        snippet: '',
      };
    }
    if (current && snippetMatch) {
      current.snippet = snippetMatch[1].replace(/<[^>]*>/g, '').trim();
      results.push(current);
      current = null;
      if (results.length >= limit) break;
    }
  }

  return results;
}

app.listen({ port: Number(PORT), host: '0.0.0.0' })
  .then((addr) => app.log.info(`KayrosLab backend sur ${addr}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
