// KayrosLab -- the produce-then-verify roster of the Graph Engineering spec.
//
// These five agents complete the reference pipeline. Each one owns exactly
// one state channel and returns it as structured data alongside its text, so
// the orchestrator can emit a typed channel event under permission control
// instead of routing on free text.
//
// `channel` on the class is the contract: a node may only emit the channel
// its agent declares, and only if the graph granted it that write.

import { BaseAgent } from './base-agent.mjs';

const MAX_ITEMS = 24;

/** Splits an LLM answer into short, deduplicated lines. */
function toLines(text, limit = MAX_ITEMS) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/^[\s\-*\d.)]+/, '').trim())
    .filter(Boolean)
    .filter((line, index, all) => all.indexOf(line) === index)
    .slice(0, limit);
}

/** Reads a fenced or bare JSON object out of an LLM answer, or null. */
function parseJsonBlock(text) {
  const raw = String(text ?? '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  if (!candidate || !candidate.trim()) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Base for an agent that owns one state channel. */
class ChannelAgent extends BaseAgent {
  constructor(opts, channel) {
    super(opts);
    this.channel = channel;
  }
}

// ------------------------------------------------------------ Researcher

export class ResearcherAgent extends ChannelAgent {
  constructor(opts = {}) {
    super({
      name: 'Researcher',
      systemPrompt:
        'You are the Researcher. Collect verifiable external facts relevant to the goal. '
        + 'Answer as a plain list, one fact per line. Never invent a source: if you do not '
        + 'have one, state the fact without a source rather than fabricating a citation.',
      ...opts,
    }, 'research');
  }

  async execute(task, ctx = {}) {
    const res = await super.execute(task, ctx);
    const lines = toLines(res.output);
    // A line carrying a URL or a "source:" marker is treated as a source.
    const sources = lines.filter((line) => /https?:\/\/|^source\s*:/i.test(line));
    const facts = lines.filter((line) => !sources.includes(line));
    return {
      ...res,
      channel: { type: 'research', facts, sources },
    };
  }
}

// ------------------------------------------------------------- Simulator

export class SimulatorAgent extends ChannelAgent {
  constructor(opts = {}) {
    super({
      name: 'Simulator',
      systemPrompt:
        'You are the Simulator. Run the domain computation for the goal and answer with a '
        + 'JSON object {"metrics": {"name": number}, "warnings": ["..."]}. '
        + 'Every metric must be a finite number. Put any assumption you had to make in warnings.',
      ...opts,
    }, 'simulation');
  }

  async execute(task, ctx = {}) {
    const res = await super.execute(task, ctx);
    const parsed = parseJsonBlock(res.output) || {};
    const metrics = {};
    for (const [key, value] of Object.entries(parsed.metrics || {})) {
      if (typeof value === 'number' && Number.isFinite(value)) metrics[key] = value;
    }
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((w) => typeof w === 'string').slice(0, MAX_ITEMS)
      : [];
    if (!Object.keys(metrics).length) {
      // Being explicit beats silently reporting an empty simulation as a success.
      warnings.push('aucune metrique exploitable dans la reponse du simulateur');
    }
    return { ...res, channel: { type: 'simulation', metrics, warnings } };
  }
}

// ---------------------------------------------------------------- Writer

export class WriterAgent extends ChannelAgent {
  constructor(opts = {}) {
    super({
      name: 'Writer',
      systemPrompt:
        'You are the Writer. Produce the deliverable in Markdown from the research facts and '
        + 'the simulation metrics you are given. Use only those inputs. If a previous review '
        + 'rejected your draft, address every comment it raised.',
      ...opts,
    }, 'draft');
  }

  async execute(task, ctx = {}) {
    const previous = ctx.review?.status === 'KO' && ctx.review.comments?.length
      ? `\n\nRevision demandee, corriger:\n- ${ctx.review.comments.join('\n- ')}`
      : '';
    const res = await super.execute(`${task}${previous}`, ctx);
    return {
      ...res,
      channel: { type: 'draft', content: String(res.output ?? ''), format: 'markdown' },
    };
  }
}

// -------------------------------------------------------------- Verifier

export class VerifierAgent extends ChannelAgent {
  constructor(opts = {}) {
    super({
      name: 'Verifier',
      systemPrompt:
        'You are the Verifier. Check the draft against the success criteria. '
        + 'Answer with a JSON object {"status": "OK" | "KO", "comments": ["..."]}. '
        + 'Answer KO whenever a criterion is unmet, and say which one in comments. '
        + 'You may not rewrite the draft: you only annotate.',
      ...opts,
    }, 'review');
  }

  async execute(task, ctx = {}) {
    const criteria = (ctx.successCriteria || []).join('\n- ');
    const draft = ctx.draft?.content ?? '';
    const prompt = [
      task,
      criteria ? `\n\nCriteres de succes:\n- ${criteria}` : '',
      draft ? `\n\nLivrable a verifier:\n${draft}` : '\n\nAucun livrable fourni.',
    ].join('');
    const res = await super.execute(prompt, ctx);
    const parsed = parseJsonBlock(res.output) || {};
    const comments = Array.isArray(parsed.comments)
      ? parsed.comments.filter((c) => typeof c === 'string').slice(0, MAX_ITEMS)
      : [];
    // Fail closed: anything that is not an explicit OK is a KO. An
    // unparseable verdict must never be read as an approval.
    let status = parsed.status === 'OK' ? 'OK' : 'KO';
    if (!draft) {
      status = 'KO';
      comments.unshift('aucun livrable a verifier');
    }
    if (status === 'KO' && !comments.length) {
      comments.push('verdict non exploitable, revision demandee par defaut');
    }
    return { ...res, channel: { type: 'review', status, comments } };
  }
}

// ---------------------------------------------------------------- Logger

export class LoggerAgent extends ChannelAgent {
  constructor(opts = {}) {
    super({
      name: 'Logger',
      systemPrompt: 'You are the Logger. You persist the audit trail; you do not reason.',
      ...opts,
    }, 'artifacts');
  }

  /** Deterministic: the audit trail must never depend on a model. */
  async execute(task, ctx = {}) {
    const artifact = {
      kind: 'run_summary',
      ideaId: ctx.ideaId ?? null,
      runId: ctx.runId || ctx.run_id || null,
      traceId: ctx.traceId || ctx.trace_id || null,
      review: ctx.review ?? null,
      draftBytes: ctx.draft?.content ? ctx.draft.content.length : 0,
      metrics: ctx.simulation?.metrics ?? null,
      facts: ctx.research?.facts?.length ?? 0,
      ts: new Date().toISOString(),
    };
    await this.addContribution(`audit ${artifact.kind}`);
    return {
      agent: this.name,
      output: JSON.stringify(artifact),
      model: null,
      degraded: null,
      channel: { type: 'artifacts', artifacts: [artifact] },
    };
  }
}

// ------------------------------------------------------------- HumanGate

export class HumanGateAgent extends BaseAgent {
  constructor(opts = {}) {
    super({
      name: 'HumanGate',
      systemPrompt: 'You are the escalation marker; a human decides from here.',
      ...opts,
    });
    this.channel = null;
  }

  /** Deterministic: escalation must not depend on a model being reachable. */
  async execute(_task, ctx = {}) {
    const comments = ctx.review?.comments || [];
    return {
      agent: this.name,
      output: comments.length
        ? `Escalade humaine: budget de revision epuise. Motifs: ${comments.join(' ; ')}`
        : 'Escalade humaine: budget de revision epuise.',
      model: null,
      degraded: null,
      escalation: true,
    };
  }
}
