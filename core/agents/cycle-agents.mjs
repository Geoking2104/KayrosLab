// KayrosLab -- les agents du cycle, nommes comme le metier les nomme.
//
// Le preset cycle8 s'appuyait sur le roster generique (Researcher, Writer,
// Simulator, Planner, Logger). Les correspondances etaient defendables mais
// approximatives : un « Positionneur » n'est pas un simulateur, et un « Suivi
// d'execution » n'est pas un logger. Un ecart de vocabulaire entre le produit
// et son moteur finit toujours par se payer -- en relecture, en debat sur ce
// qu'un agent est cense faire, et en prompts qui derivent.
//
// Chaque agent ci-dessous porte le nom que la demo affiche, la mission que le
// cycle lui prete, et le canal d'etat qu'il possede.

import { BaseAgent } from './base-agent.mjs';

const MAX_ITEMS = 24;

function toLines(text, limit = MAX_ITEMS) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/^[\s\-*\d.)]+/, '').trim())
    .filter(Boolean)
    .filter((line, index, all) => all.indexOf(line) === index)
    .slice(0, limit);
}

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

class ChannelAgent extends BaseAgent {
  constructor(opts, channel) {
    super(opts);
    this.channel = channel;
  }
}

// ── Etape 1 · Ecouter ───────────────────────────────────────────────────────

/** Eclaireur de signaux — collecte les signaux faibles et les faits datables. */
export class SignalScannerAgent extends ChannelAgent {
  constructor(opts = {}) {
    super({
      name: 'SignalScanner',
      systemPrompt:
        "Tu es l'Eclaireur de signaux de KayrosLab. Tu collectes des signaux faibles et des "
        + 'faits verifiables sur le sujet : ruptures naissantes, mouvements concurrents, '
        + 'evolutions reglementaires, changements d\'usage. Un fait par ligne. '
        + "N'invente jamais de source : si tu n'en as pas, donne le fait sans en citer.",
      ...opts,
    }, 'research');
  }

  async execute(task, ctx = {}) {
    const res = await super.execute(task, ctx);
    const lines = toLines(res.output);
    const sources = lines.filter((line) => /https?:\/\/|^source\s*:/i.test(line));
    return {
      ...res,
      channel: { type: 'research', facts: lines.filter((l) => !sources.includes(l)), sources },
    };
  }
}

// ── Etape 2 · Cartographier ─────────────────────────────────────────────────

/** Cartographe des tendances — relie les signaux, repere les ponts. */
export class TrendMapperAgent extends BaseAgent {
  constructor(opts = {}) {
    super({
      name: 'TrendMapper',
      systemPrompt:
        'Tu es le Cartographe des tendances de KayrosLab. A partir des signaux collectes, tu '
        + 'construis le reseau de sens : quelles tendances se renforcent, lesquelles '
        + "s'opposent, ou sont les ponts entre domaines eloignes et ou sont les angles morts. "
        + 'Tu decris des liens, pas une liste.',
      ...opts,
    });
  }
}

// ── Etape 3 · Construire ────────────────────────────────────────────────────

/** Generateur de scenarios — transforme la cartographie en scenarios tenables. */
export class ScenarioGeneratorAgent extends ChannelAgent {
  constructor(opts = {}) {
    super({
      name: 'ScenarioGenerator',
      systemPrompt:
        'Tu es le Generateur de scenarios de KayrosLab. Tu transformes la cartographie en '
        + 'scenarios concrets et distincts : proposition, cible, hypotheses a valider. '
        + "Chaque scenario doit etre attaquable — s'il ne l'est pas, il est trop vague. "
        + 'Redige en Markdown.',
      ...opts,
    }, 'draft');
  }

  async execute(task, ctx = {}) {
    // Une revue precedente est une commande, pas un contexte : elle est reprise
    // telle quelle pour que la revision porte sur ce qui a ete reproche.
    const revision = ctx.review?.status === 'KO' && ctx.review.comments?.length
      ? `\n\nRevision demandee, corriger :\n- ${ctx.review.comments.join('\n- ')}`
      : '';
    const res = await super.execute(`${task}${revision}`, ctx);
    return {
      ...res,
      channel: { type: 'draft', content: String(res.output ?? ''), format: 'markdown' },
    };
  }
}

// ── Etape 4 · Positionner ───────────────────────────────────────────────────

/** Positionneur — chiffre les ecarts concurrentiels et le Kayros Index. */
export class PositionerAgent extends ChannelAgent {
  constructor(opts = {}) {
    super({
      name: 'Positioner',
      systemPrompt:
        'Tu es le Positionneur de KayrosLab. Tu situes la proposition face au paysage '
        + 'concurrentiel et tu chiffres : ecarts couverts, ecarts laisses ouverts, indice de '
        + 'position. Reponds par un objet JSON {"metrics": {"nom": nombre}, "warnings": ["..."]}. '
        + 'Toute hypothese que tu as du poser va dans warnings.',
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
      // Un positionnement vide annonce comme reussi vaudrait moins que rien.
      warnings.push('aucune metrique de positionnement exploitable');
    }
    return { ...res, channel: { type: 'simulation', metrics, warnings } };
  }
}

// ── Etape 7 · Projeter ──────────────────────────────────────────────────────

/** Agent de projection — jalons, ressources, KPI, gates a venir. */
export class ProjectionAgentAgent extends BaseAgent {
  constructor(opts = {}) {
    super({
      name: 'ProjectionAgent',
      systemPrompt:
        'Tu es l\'Agent de projection de KayrosLab. A partir de la recommandation arbitree, tu '
        + 'traces la trajectoire : jalons dates, ressources necessaires, KPI de suivi, gates a '
        + 'prevoir. Tu ne reouvres pas la decision : elle est prise, tu l\'outilles.',
      ...opts,
    });
  }
}

// ── Etape 8 · Realiser ──────────────────────────────────────────────────────

/** Suivi d'execution — trace ce qui a ete decide et boucle le retour. */
export class ExecutionTrackerAgent extends ChannelAgent {
  constructor(opts = {}) {
    super({
      name: 'ExecutionTracker',
      systemPrompt: "Tu es le Suivi d'execution de KayrosLab. Tu traces, tu ne raisonnes pas.",
      ...opts,
    }, 'artifacts');
  }

  /** Deterministe : une piste d'audit ne doit pas dependre d'un modele. */
  async execute(task, ctx = {}) {
    const artifact = {
      kind: 'cycle_summary',
      ideaId: ctx.ideaId ?? null,
      runId: ctx.runId || ctx.run_id || null,
      traceId: ctx.traceId || ctx.trace_id || null,
      signaux: ctx.research?.facts?.length ?? 0,
      metriques: ctx.simulation?.metrics ?? null,
      scenarioOctets: ctx.draft?.content ? ctx.draft.content.length : 0,
      revue: ctx.review ?? null,
      ts: new Date().toISOString(),
    };
    await this.addContribution(`suivi ${artifact.kind}`);
    return {
      agent: this.name,
      output: JSON.stringify(artifact),
      model: null,
      degraded: null,
      channel: { type: 'artifacts', artifacts: [artifact] },
    };
  }
}
