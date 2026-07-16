// KayrosLab — Backend Fastify : proxy LLM securise (cle cote serveur) + endpoints gouvernes + embeddings.
// Reutilise le coeur committe (../../core). A deployer sur un hote Node (VPS/PaaS), pas sur mutualise.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  KayrosLLM, RoutingPolicy, MockProvider, OllamaProvider, AnthropicProvider,
  Orchestrator, GovernanceService, demoTools, OllamaEmbeddings,
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

app.listen({ port: Number(PORT), host: '0.0.0.0' })
  .then((addr) => app.log.info(`KayrosLab backend sur ${addr}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
