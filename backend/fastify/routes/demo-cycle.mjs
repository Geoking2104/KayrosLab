/**
 * POST /v1/demo/cycle/run — la demo publique sur le vrai moteur.
 *
 * Jusqu'ici la demo enchainait des prompts vers /v1/demo/chat : un proxy LLM
 * brut. L'orchestrateur, le graphe, les budgets d'essais, les permissions et
 * les gates n'y participaient pas. Ce que le visiteur voyait n'etait donc pas
 * le produit, mais une imitation cote navigateur.
 *
 * Cette route execute le moteur v2. Elle est publique (prefixe /v1/demo/), donc
 * bridee de bout en bout :
 *   - aucune memoire lue ni ecrite, aucun positionnement, aucune distillation ;
 *   - aucune persistance : ni idee, ni run store, ni journal d'audit ;
 *   - aucun gate bloquant : un gate suspend et rend la main ;
 *   - budget de pas et taille de requete reduits ;
 *   - limite de debit propre, bien plus stricte que la limite globale.
 *
 * Le cout d'un appel est celui d'un cycle LLM complet : c'est la raison d'etre
 * de chacune de ces brides.
 */
import { z } from 'zod';
import { orchestratorForRequest } from '../lib/context.mjs';
import { UNIFIED_CONDITIONS } from '../../../core/workflow-presets.mjs';

const demoCycleSchema = z.object({
  query: z.string().min(3).max(2000),
  // `kayros` par defaut : le cycle dialectique se termine sans gate humaine,
  // donc il produit un resultat complet en une requete. `unified` suspend sur
  // l'arbitrage, ce qui est le comportement voulu en production mais deroutant
  // pour un visiteur qui decouvre le produit.
  preset: z.enum(['kayros', 'reference', 'unified']).optional().default('kayros'),
  stream: z.boolean().optional().default(true),
  lang: z.enum(['fr', 'en']).optional().default('fr'),
});

/** Budget volontairement bas : une demo n'a pas vocation a boucler. */
const DEMO_MAX_STEPS = 8;
const DEMO_STEP_TIMEOUT_MS = 45_000;

function writeSse(raw, event) {
  try {
    raw.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch { /* flux ferme */ }
}

/**
 * L'etat complet ne sort pas : il porte le graphe entier et les journaux, il
 * est volumineux, et le visiteur n'en a pas l'usage. Seul l'essentiel transite.
 */
function publicEvent(event) {
  const out = {
    type: event.type,
    ts: event.ts ?? new Date().toISOString(),
  };
  if (event.nodeId) out.nodeId = event.nodeId;
  if (event.agent) out.agent = event.agent;
  if (event.stepId) out.stepId = event.stepId;
  if (event.thought) out.thought = event.thought;
  if (event.observation !== undefined) out.observation = event.observation;
  if (event.output !== undefined) out.output = event.output;
  if (event.status) out.status = event.status;
  if (event.answer) out.answer = event.answer;
  if (event.recommendation) out.recommendation = event.recommendation;
  if (event.message) out.message = event.message;
  if (event.reason) out.reason = event.reason;
  if (event.phase) out.phase = event.phase;
  if (event.gateType) out.gateType = event.gateType;
  if (event.facts) out.facts = event.facts;
  if (event.metrics) out.metrics = event.metrics;
  if (event.content) out.content = event.content;
  if (event.comments) out.comments = event.comments;
  if (event.decision) out.decision = event.decision;
  if (event.type === 'start' && event.graph) {
    // La topologie est le sujet de la demo : on la montre, mais reduite a ce
    // qui se lit — pas les permissions ni les budgets internes.
    out.graph = {
      nodes: event.graph.nodes.map((n) => ({ id: n.id, agent: n.agent, gate: n.gate?.type ?? null })),
      edges: event.graph.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
    };
  }
  return out;
}

export default async function demoCycleRoute(app) {
  app.post('/v1/demo/cycle/run', {
    config: {
      // Un cycle complet coute plusieurs appels LLM. La limite globale de 100
      // requetes par minute serait ici une invitation a vider le budget.
      rateLimit: { max: 5, timeWindow: '1 minute' },
    },
  }, async (req, reply) => {
    const parsed = demoCycleSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'query requis', issues: parsed.error.issues });
    }
    const body = parsed.data;
    const ctx = app.kayrosContext || {};

    const orch = orchestratorForRequest(ctx.engine, { tenantId: 'demo' });
    if (!orch) return reply.code(503).send({ error: 'moteur indisponible' });

    let plan;
    try {
      plan = await orch.plan(body.query, { ideaId: `demo-${Date.now()}`, preset: body.preset });
    } catch (e) {
      app.log.error(e);
      return reply.code(502).send({ error: String(e?.message || e) });
    }

    const runOpts = {
      graphConditions: { ...UNIFIED_CONDITIONS, ...(orch.graphConditions || {}) },
      governance: 'auto',
      // Tout ce qui touche a la memoire, a la persistance ou au reseau externe
      // est coupe : une demo publique ne doit ni apprendre, ni ecrire, ni
      // depenser au-dela de son propre cycle.
      recall: false,
      remember: false,
      offload: false,
      autoDistill: false,
      positionning: false,
      frameControl: false,
      worldModel: false,
      adaptive: false,
      noveltyControl: false,
      runStore: null,
      logSink: null,
      waitGate: false,
      waitNodeGate: false,
      maxSteps: DEMO_MAX_STEPS,
      stepTimeoutMs: DEMO_STEP_TIMEOUT_MS,
      tenantId: 'demo',
    };

    if (body.stream === false) {
      const events = [];
      try {
        for await (const ev of orch.run(plan, runOpts)) events.push(publicEvent(ev));
      } catch (e) {
        app.log.error(e);
        return reply.code(502).send({ error: String(e?.message || e), events });
      }
      const final = events.filter((e) => e.type === 'final').at(-1) ?? null;
      return { preset: body.preset, events, final };
    }

    reply.hijack();
    try {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    } catch (e) {
      app.log.error(e);
      try { reply.raw.end(); } catch { /* */ }
      return;
    }

    writeSse(reply.raw, {
      type: 'meta', preset: body.preset, lang: body.lang, ts: new Date().toISOString(),
    });

    // Un visiteur qui ferme l'onglet ne doit pas continuer a consommer des
    // appels LLM.
    let aborted = false;
    req.raw.on('close', () => { aborted = true; });

    try {
      for await (const ev of orch.run(plan, runOpts)) {
        if (aborted) break;
        writeSse(reply.raw, publicEvent(ev));
      }
    } catch (e) {
      app.log.error(e);
      writeSse(reply.raw, { type: 'error', error: String(e?.message || e), ts: new Date().toISOString() });
    } finally {
      try { reply.raw.end(); } catch { /* */ }
    }
  });
}
