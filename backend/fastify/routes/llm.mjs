import { z } from 'zod';
import { orchestratorForRequest } from '../lib/context.mjs';

const completeSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.any() })).min(1),
  model: z.string().optional(),
  provider: z.string().optional(),
  role: z.string().optional(),
  temperature: z.number().optional(),
});

const embedSchema = z.object({
  input: z.union([
    z.string().min(1).max(16_000),
    z.array(z.string().min(1).max(16_000)).min(1).max(32),
  ]),
}).strict();

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
  tenantId: z.string().optional(),
  userId: z.string().optional(),
  teamId: z.string().optional(),
  organizationId: z.string().optional(),
});

const monitorSchema = z.object({
  kpis: z.array(z.any()).optional().default([]),
  readings: z.array(z.any()).optional().default([]),
  ideaId: z.string().optional().default('idea'),
});

/** Public demo body: system + user (no key on client). */
const demoChatSchema = z.object({
  system: z.string().max(4000).optional().default(''),
  user: z.string().min(1).max(6000),
});

const demoRate = new Map();
const DEMO_MAX_PER_HOUR = 30;

function checkDemoRate(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  let e = demoRate.get(ip);
  if (!e || now - e.start > windowMs) {
    e = { start: now, count: 0 };
    demoRate.set(ip, e);
  }
  e.count += 1;
  return e.count <= DEMO_MAX_PER_HOUR;
}

export function requestsSemanticMap(system) {
  const prompt = String(system || '');
  return prompt.includes('centralConcept') && prompt.includes('communities') && prompt.includes('bridges');
}

export function semanticMapFallback(system) {
  const english = /You are|Return ONLY|opening question/i.test(String(system || ''));
  const communities = english ? [
    ['Uses', 'Value and practical uses', ['benefit', 'practice', 'adoption']],
    ['People', 'Users and collective behaviors', ['needs', 'trust', 'habits']],
    ['Systems', 'Technical and operational conditions', ['resources', 'process', 'resilience']],
    ['Institutions', 'Rules and social environment', ['governance', 'ethics', 'ecosystem']],
  ] : [
    ['Usages', 'Valeur et usages concrets', ['bénéfice', 'pratique', 'adoption']],
    ['Personnes', 'Utilisateurs et comportements collectifs', ['besoins', 'confiance', 'habitudes']],
    ['Systèmes', 'Conditions techniques et opérationnelles', ['ressources', 'processus', 'résilience']],
    ['Institutions', 'Règles et environnement social', ['gouvernance', 'éthique', 'écosystème']],
  ];
  return JSON.stringify({
    centralConcept: english ? 'Strategic possibility' : 'Possibilité stratégique',
    communities: communities.map(([label, meaning, concepts], index) => ({ id: `c${index + 1}`, label, meaning, concepts })),
    bridges: [
      { id: 'b1', label: english ? 'Trust by design' : 'Confiance par conception', connects: ['c1', 'c2'], opportunity: english ? 'Make adoption a design constraint.' : 'Faire de l’adoption une contrainte de conception.', question: english ? 'What would make the first use immediately trustworthy?' : 'Qu’est-ce qui rendrait le premier usage immédiatement digne de confiance ?', distance: 6 },
      { id: 'b2', label: english ? 'Lean resilience' : 'Résilience frugale', connects: ['c1', 'c3'], opportunity: english ? 'Test value with minimal infrastructure.' : 'Tester la valeur avec une infrastructure minimale.', question: english ? 'What is the smallest resilient experiment?' : 'Quelle est la plus petite expérimentation résiliente ?', distance: 7 },
      { id: 'b3', label: english ? 'Shared governance' : 'Gouvernance partagée', connects: ['c2', 'c4'], opportunity: english ? 'Turn affected people into co-designers.' : 'Transformer les personnes concernées en co-concepteurs.', question: english ? 'Who should have a real veto in the experiment?' : 'Qui devrait disposer d’un véritable veto dans l’expérimentation ?', distance: 8 },
      { id: 'b4', label: english ? 'Responsible infrastructure' : 'Infrastructure responsable', connects: ['c3', 'c4'], opportunity: english ? 'Connect operational choices to public commitments.' : 'Relier les choix opérationnels aux engagements publics.', question: english ? 'Which rule would improve rather than slow the test?' : 'Quelle règle améliorerait le test plutôt que de le ralentir ?', distance: 9 },
    ],
    blindSpots: english ? ['non-users', 'unintended effects'] : ['non-utilisateurs', 'effets non intentionnels'],
  });
}

/** Optional Bearer session — does not fail the request if absent. */
async function tryAuthSession(app, req) {
  const { auth } = app.kayrosContext || {};
  if (!auth) return null;
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  try {
    return await auth.verify(token);
  } catch {
    return null;
  }
}

export default async function llmRoute(app) {
  app.post('/v1/llm', async (req, reply) => {
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'messages requis', issues: parsed.error.issues });
    const { messages, model, provider, role, temperature } = parsed.data;
    const opts = provider ? { provider } : {};
    const r = await app.kayrosContext.llm.complete({ messages, model, role, temperature }, opts);
    return { text: r.text, provider: r.provider, usage: r.usage, latencyMs: r.latencyMs, degraded: r.degraded || null };
  });

  app.post('/v1/demo/chat', async (req, reply) => {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
      || req.ip
      || 'unknown';
    if (!checkDemoRate(ip)) {
      return reply.code(429).send({ error: `Quota démo dépassé (${DEMO_MAX_PER_HOUR}/h). Réessayez plus tard.` });
    }

    const parsed = demoChatSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'user requis', issues: parsed.error.issues });
    }
    const { system, user } = parsed.data;
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: user });

    try {
      const provider = app.kayrosContext.MISTRAL_API_KEY ? 'mistral' : undefined;
      const r = await app.kayrosContext.llm.complete(
        { messages, temperature: 0.4, role: 'demo-agent' },
        provider ? { provider } : {},
      );
      const structuredFallback = r.provider === 'mock' && requestsSemanticMap(system)
        ? semanticMapFallback(system)
        : null;
      const text = structuredFallback || r.text;
      return {
        content: text,
        text,
        model: r.model || app.kayrosContext.MISTRAL_MODEL || r.provider,
        provider: r.provider,
        usage: r.usage,
        latencyMs: r.latencyMs,
        degraded: structuredFallback
          ? { reason: 'structured_demo_fallback', provider: r.provider }
          : (r.degraded || null),
      };
    } catch (e) {
      app.log.error(e);
      return reply.code(502).send({ error: String(e.message || e) });
    }
  });

  app.post('/v1/embed', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const me = await app.requireAuth(req, reply);
    if (!me) return;
    const parsed = embedSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'champ input requis', issues: parsed.error.issues });
    const { input } = parsed.data;
    const texts = Array.isArray(input) ? input : [input];
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

  /**
   * Prefer shared engine (layered memory + quant). Fallback: ephemeral Orchestrator.
   * Session tenant/sub wins over body when present.
   */
  app.post('/v1/govern/query', async (req, reply) => {
    const parsed = governQuerySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'query requis', issues: parsed.error.issues });
    const { query, governance, sovereignty, provider, ideaId } = parsed.data;

    const session = await tryAuthSession(app, req);
    const tenantId = session?.tenantId || parsed.data.tenantId || null;
    const userId = session?.sub || parsed.data.userId || null;
    const teamId = parsed.data.teamId || null;
    const organizationId = parsed.data.organizationId || null;

    const { engine, llm, tools, governance: govSvc } = app.kayrosContext;
    let orch = orchestratorForRequest(engine, { tenantId, userId, teamId, organizationId });
    if (!orch) {
      const core = await import('../../../core/index.mjs');
      orch = new core.Orchestrator({
        llm,
        tools: tools || core.demoTools(),
        governance: govSvc || new core.GovernanceService(),
        tenantId,
        userId,
        teamId,
        organizationId,
        layered: engine?.layered || null,
      });
    }

    const plan = await orch.plan(query, { ideaId });
    const agents = [];
    let final = null, gate = null;
    for await (const ev of orch.run(plan, {
      governance,
      sovereignty,
      provider,
      tenantId,
      userId,
      teamId,
      organizationId,
    })) {
      if (ev.type === 'trace') agents.push(ev.agent);
      else if (ev.type === 'gate') { gate = ev; break; }
      else if (ev.type === 'final') final = ev;
    }

    try {
      await engine?.layered?.save?.({ tenantId });
    } catch { /* soft */ }

    if (gate) {
      return reply.code(202).send({
        status: 'pending_review',
        gateId: gate.gateId,
        gateType: gate.gateType,
        trace: { agents },
        scope: { tenantId, userId },
      });
    }
    return {
      status: final.status,
      answer: final.answer ?? final.message,
      trace: { agents },
      scope: { tenantId, userId },
    };
  });

  app.post('/v1/projeter/monitor', async (req, reply) => {
    const parsed = monitorSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'kpis[] et readings[] requis', issues: parsed.error.issues });
    const { kpis, readings, ideaId } = parsed.data;
    const { evaluateKpis, alertsToSignals } = await import('../../../core/index.mjs');
    const { alerts } = evaluateKpis(kpis, readings);
    const signals = alertsToSignals(alerts, { ideaId });
    const reArbitrage = alerts.length ? { type: 're-arbitrage', ideaId, reasons: alerts.map((a) => a.kpiId) } : null;
    return { alerts, signals, reArbitrage };
  });
}
