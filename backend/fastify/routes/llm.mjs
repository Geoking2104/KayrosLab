import { z } from 'zod';

const completeSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.any() })).min(1),
  model: z.string().optional(),
  provider: z.string().optional(),
  role: z.string().optional(),
  temperature: z.number().optional(),
});

const embedSchema = z.object({
  input: z.union([z.string(), z.array(z.string())]),
  model: z.string().optional(),
});

const toolsCallSchema = z.object({
  name: z.string().min(1),
  input: z.object({}).passthrough().optional(),
  ideaId: z.string().optional(),
});

const governQuerySchema = z.object({
  query: z.string().min(1),
  governance: z.string().optional(),
  sovereignty: z.string().optional(),
  provider: z.string().optional(),
  ideaId: z.string().optional(),
});

const monitorSchema = z.object({
  kpis: z.array(z.any()).optional().default([]),
  readings: z.array(z.any()).optional().default([]),
  ideaId: z.string().optional().default('idea'),
});

export default async function llmRoute(app) {
  app.post('/v1/llm', async (req, reply) => {
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'messages requis', issues: parsed.error.issues });
    const { messages, model, provider, role, temperature } = parsed.data;
    const opts = provider ? { provider } : {};
    const r = await app.kayrosContext.llm.complete({ messages, model, role, temperature }, opts);
    return { text: r.text, provider: r.provider, usage: r.usage, latencyMs: r.latencyMs };
  });

  app.post('/v1/embed', async (req, reply) => {
    const parsed = embedSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'champ input requis', issues: parsed.error.issues });
    const { input, model } = parsed.data;
    const texts = Array.isArray(input) ? input : [input];
    if (model) app.kayrosContext.embeddings.model = model;
    try {
      const vecs = await app.kayrosContext.embeddings.embedBatch(texts);
      return { embeddings: vecs, model: app.kayrosContext.embeddings.model };
    } catch (e) { return reply.code(502).send({ error: String(e.message || e) }); }
  });

  app.get('/v1/tools', async () => ({
    tools: app.kayrosContext.tools.list().map((t) => ({ name: t.name, description: t.description, sideEffect: t.sideEffect, inputKeys: t.inputKeys })),
  }));

  app.post('/v1/tools/call', async (req, reply) => {
    const parsed = toolsCallSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'name requis', issues: parsed.error.issues });
    const { name, input, ideaId } = parsed.data;
    const t = app.kayrosContext.tools.get(name);
    if (!t) return reply.code(404).send({ error: `outil inconnu: ${name}` });
    if (t.sideEffect !== 'read') return reply.code(403).send({ error: `outil ${name} non exposable (sideEffect=${t.sideEffect})` });
    try {
      const result = await app.kayrosContext.tools.call(name, input || {}, { ideaId });
      return { name, result };
    } catch (e) { return reply.code(400).send({ error: String(e.message || e) }); }
  });

  app.post('/v1/govern/query', async (req, reply) => {
    const parsed = governQuerySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'query requis', issues: parsed.error.issues });
    const { query, governance, sovereignty, provider, ideaId } = parsed.data;
    const { llm, tools } = app.kayrosContext;
    const orch = new (await import('../../core/index.mjs')).Orchestrator({ llm, tools: demoTools(), governance: new GovernanceService() });
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

  app.post('/v1/projeter/monitor', async (req, reply) => {
    const parsed = monitorSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'kpis[] et readings[] requis', issues: parsed.error.issues });
    const { kpis, readings, ideaId } = parsed.data;
    const { alerts } = evaluateKpis(kpis, readings);
    const signals = alertsToSignals(alerts, { ideaId });
    const reArbitrage = alerts.length ? { type: 're-arbitrage', ideaId, reasons: alerts.map((a) => a.kpiId) } : null;
    return { alerts, signals, reArbitrage };
  });
}
