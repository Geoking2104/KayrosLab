// KayrosLab — Backend Fastify : proxy LLM securise (cle cote serveur) + endpoints gouvernes.
// Reutilise le coeur committe (../../core). A deployer sur un hote Node (VPS/PaaS), pas sur mutualise.
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  KayrosLLM, RoutingPolicy, MockProvider, OllamaProvider, AnthropicProvider,
  Orchestrator, GovernanceService, demoTools,
} from '../../core/index.mjs';

const {
  PORT = 8787,
  ALLOWED_ORIGIN = '*',
  ANTHROPIC_API_KEY = '',
  ANTHROPIC_MODEL = 'claude-3-5-sonnet-latest',
  ANTHROPIC_MAXTOK = '1024',
  OLLAMA_ENDPOINT = 'http://localhost:11434',
  OLLAMA_MODEL = 'llama3.2',
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

const app = Fastify({ logger: true });
await app.register(cors, { origin: ALLOWED_ORIGIN });

// Secret partage optionnel
app.addHook('preHandler', async (req, reply) => {
  if (!KAYROS_SECRET) return;
  if (req.method === 'GET') return;
  if (req.headers['x-kayros-secret'] !== KAYROS_SECRET) return reply.code(401).send({ error: 'non autorise' });
});

app.get('/health', async () => ({ ok: true, providers: Object.keys(providers), model: ANTHROPIC_MODEL, anthropicConfigured: !!ANTHROPIC_API_KEY }));

// Completion brute (utilisee par HttpBackendProvider cote navigateur).
app.post('/v1/llm', async (req, reply) => {
  const { messages, model, provider, role, temperature } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return reply.code(400).send({ error: 'messages requis' });
  const opts = provider ? { provider } : {};
  const r = await llm.complete({ messages, model, role, temperature }, opts);
  return { text: r.text, provider: r.provider, usage: r.usage, latencyMs: r.latencyMs };
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
