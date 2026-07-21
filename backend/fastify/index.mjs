// KayrosLab — Backend Fastify : proxy LLM securise (cle cote serveur) + endpoints gouvernes + embeddings.
// Reutilise le coeur committe (../../core). A deployer sur un hote Node (VPS/PaaS), pas sur mutualise.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  KayrosLLM, RoutingPolicy, MockProvider, OllamaProvider, AnthropicProvider,
  Orchestrator, GovernanceService, demoTools, OllamaEmbeddings,
  evaluateKpis, alertsToSignals,
  AuthService, InMemoryIdeaRepository, createIdea, setStage, setStatus,
  portfolio, counts, processIntake, aggregateVotes, defaultScorecards,
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
const auth = AUTH_SECRET ? new AuthService({ secret: AUTH_SECRET }) : null;
const ideas = new InMemoryIdeaRepository();
const scorecards = defaultScorecards();

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
  const { stage, status, category, q } = req.query || {};
  return { ideas: await ideas.list({ tenantId: me.tenantId, stage, status, category, q }) };
});

app.post('/v1/ideas', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const { id, title, intake, category } = req.body || {};
  try {
    const derive = intake ? processIntake(intake) : null;
    const idea = createIdea({
      id: id || `D${Date.now()}`, title, author: me.email, category,
      intake, tenantId: me.tenantId,                       // tenant impose par le jeton, pas par le client
    });
    await ideas.save(idea);
    return reply.code(201).send({ idea, derive });          // hypotheses + cibles d'attaque
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
  return { agregat: aggregateVotes(votes) };
});

app.get('/v1/scorecards', async (req, reply) => {
  const me = await requireAuth(req, reply); if (!me) return;
  const { stage } = req.query || {};
  const list = stage ? scorecards.forStage(stage) : scorecards.list();
  return { scorecards: list.map((s) => ({ id: s.id, stage: s.stage, label: s.label, scale: s.scale, criteria: s.criteria })) };
});

app.listen({ port: Number(PORT), host: '0.0.0.0' })
  .then((addr) => app.log.info(`KayrosLab backend sur ${addr}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
