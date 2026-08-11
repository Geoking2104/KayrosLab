import { BaseAgent } from './base-agent.mjs';
import { scoreCollisions } from '../novelty.mjs';

const ANALOGY_FRAMEWORKS = [
  {
    name: 'Symbiotic Mesh (Marine Biology)',
    mechanism: 'Cross-species dependency and mutual benefit exchange. Identify non-obvious partners whose success is coupled.',
  },
  {
    name: 'Origami Kinetics (Structural Architecture)',
    mechanism: 'Folding/unfolding dynamics. Identify where compression creates expansion, where constraints enable novel structures.',
  },
  {
    name: 'Order-Book Liquidity (HFT Finance)',
    mechanism: 'Bid-ask spread and market depth. Identify latent demand that needs a matching mechanism to surface.',
  },
  {
    name: 'Molecular Emulsion (Gastronomy)',
    mechanism: 'Immiscible phases bound by a surfactant. Identify two domains that dont naturally mix but can be mediated by a third.',
  },
  {
    name: 'Thermal Chimney (Geothermal)',
    mechanism: 'Pressure differential drives flow. Identify where a gradient (regulatory, market, tech) creates directional force.',
  },
  {
    name: 'Mycelial Network (Ecology)',
    mechanism: 'Underground resource redistribution and early-warning signals. Identify hidden infrastructure that can redistribute value or risk across nodes.',
  },
  {
    name: 'Phase Transition (Physics)',
    mechanism: 'Abrupt qualitative change once a critical threshold is crossed. Identify latent thresholds that unlock new regimes of behaviour.',
  },
];

function correlationFrom(ctx) {
  return {
    runId: ctx.runId || ctx.run_id,
    run_id: ctx.runId || ctx.run_id,
    traceId: ctx.traceId || ctx.trace_id,
    trace_id: ctx.traceId || ctx.trace_id,
  };
}

export class BisociateurAgent extends BaseAgent {
  constructor(opts = {}) {
    super({
      name: 'Bisociateur',
      systemPrompt:
        'You are the Bisociateur, inspired by Arthur Koestlers bisociation theory. ' +
        'Your role is to connect two apparently unrelated domains to generate breakthrough concepts. ' +
        'Given a strategic brief, select the most promising analogy framework and explain: ' +
        '(1) the mechanism transferred from the source domain, ' +
        '(2) how it applies to the target domain, ' +
        '(3) the novelty-feasibility tradeoff. ' +
        'Output must include a concrete proposal that can be tested. ' +
        'When possible, structure your answer with clear sections: Proposal, Mechanism transferred, First experiment.',
      ...opts,
    });
    this._toolNames = [];
    this.frameworks = opts.frameworks || ANALOGY_FRAMEWORKS;
    this.embeddings = opts.embeddings || null;
  }

  async execute(task, ctx = {}) {
    const brief = [ctx.goal, task].filter(Boolean).join('\n');
    const collision = await this.runBisociation(brief || task, ctx);
    const text = collision.output;
    await this.addContribution(text);
    return {
      agent: this.name,
      output: text,
      model: this._resolveModel(ctx.model) || null,
      structured: { collision },
      degraded: collision.degraded || null,
    };
  }

  async runBisociation(brief, ctx = {}) {
    const correlation = correlationFrom(ctx);
    const framework = this._selectFramework(brief);
    const domain = { name: framework.name, mechanism: framework.mechanism, source: framework.name };

    let collisionOutput;
    let degraded = null;
    if (this.llm) {
      const messages = [
        { role: 'system', content: this.systemPrompt },
        {
          role: 'user',
          content:
            `Strategic Brief: ${brief}\n\n` +
            `Analogy Framework: ${framework.name}\n` +
            `Mechanism: ${framework.mechanism}\n\n` +
            `Generate a bisociative collision. Include:\n` +
            `- A concrete Proposal\n` +
            `- The Mechanism transferred\n` +
            `- A first testable experiment`,
        },
      ];
      const res = await this.llm.complete(
        {
          role: 'Bisociateur',
          messages,
          temperature: 0.7,
          model: this._resolveModel(ctx.model),
          ...correlation,
        },
        { provider: ctx.provider, sovereignty: ctx.sovereignty, ...correlation },
      );
      collisionOutput = res.text;
      degraded = res.degraded || null;
    } else {
      collisionOutput =
        `[Bisociateur] Using "${framework.name}" as the analogy framework:\n` +
        `Mechanism transferred: ${framework.mechanism}\n` +
        `Applied to brief "${String(brief).substring(0, 50)}...": novel recombination identified.`;
    }

    const proposal =
      this._extractSection(collisionOutput, ['proposal', 'proposition', 'idée']) ||
      collisionOutput.slice(0, 280);
    const mechanismTransferred =
      this._extractSection(collisionOutput, ['mechanism', 'mécanisme', 'bridge', 'pont']) ||
      framework.mechanism;
    const firstExperiment = this._extractSection(collisionOutput, [
      'experiment',
      'expérience',
      'test',
      'first experiment',
    ]);

    let collision = {
      framework: domain,
      output: collisionOutput,
      proposal,
      mechanismTransferred,
      firstExperiment,
      noveltyScore: 65 + (String(brief).length % 30),
      feasibilityScore: 40 + (String(brief).split(' ').length % 40),
      degraded,
    };

    const emb = ctx.embeddings || this.embeddings;
    if (emb && typeof emb.embedBatch === 'function') {
      try {
        const scored = await scoreCollisions([collision], {
          embeddings: emb,
          inputText: brief,
          memoryHits: ctx.memoryHits || [],
        });
        if (scored[0]) {
          collision = {
            ...collision,
            ...scored[0],
            noveltyScore: scored[0].noveltyScore ?? collision.noveltyScore,
            novelty: scored[0].novelty,
            noveltyBreakdown: scored[0].noveltyBreakdown,
          };
        }
      } catch {
        /* soft – keep heuristic scores */
      }
    }

    return collision;
  }

  async runMultiCollision(brief, ctx = {}, { k = 3 } = {}) {
    const selected = this._selectFrameworks(brief, k);
    const collisions = [];

    for (const fw of selected) {
      const forced = await this._generateWithFramework(brief, fw, ctx);
      collisions.push(forced);
    }

    const emb = ctx.embeddings || this.embeddings;
    if (emb && collisions.length > 1) {
      try {
        const scored = await scoreCollisions(collisions, {
          embeddings: emb,
          inputText: brief,
          memoryHits: ctx.memoryHits || [],
        });
        return scored.sort((a, b) => (b.novelty || 0) - (a.novelty || 0));
      } catch {
        /* soft */
      }
    }

    return collisions;
  }

  async _generateWithFramework(brief, framework, ctx = {}) {
    const correlation = correlationFrom(ctx);
    const domain = { name: framework.name, mechanism: framework.mechanism, source: framework.name };
    let collisionOutput;
    let degraded = null;

    if (this.llm) {
      const messages = [
        { role: 'system', content: this.systemPrompt },
        {
          role: 'user',
          content:
            `Strategic Brief: ${brief}\n\n` +
            `Analogy Framework: ${framework.name}\n` +
            `Mechanism: ${framework.mechanism}\n\n` +
            `Generate a bisociative collision using ONLY this framework.`,
        },
      ];
      const res = await this.llm.complete(
        {
          role: 'Bisociateur',
          messages,
          temperature: 0.75,
          model: this._resolveModel(ctx.model),
          ...correlation,
        },
        { provider: ctx.provider, sovereignty: ctx.sovereignty, ...correlation },
      );
      collisionOutput = res.text;
      degraded = res.degraded || null;
    } else {
      collisionOutput = `[Bisociateur] Framework "${framework.name}": novel recombination for "${String(brief).slice(0, 40)}..."`;
    }

    return {
      framework: domain,
      output: collisionOutput,
      proposal:
        this._extractSection(collisionOutput, ['proposal', 'proposition']) ||
        collisionOutput.slice(0, 280),
      mechanismTransferred:
        this._extractSection(collisionOutput, ['mechanism', 'mécanisme', 'bridge']) ||
        framework.mechanism,
      firstExperiment: this._extractSection(collisionOutput, ['experiment', 'expérience', 'test']),
      noveltyScore: 60 + Math.floor(Math.random() * 25),
      feasibilityScore: 40 + Math.floor(Math.random() * 35),
      degraded,
    };
  }

  _selectFramework(brief) {
    return this._selectFrameworks(brief, 1)[0];
  }

  _selectFrameworks(brief, k = 1) {
    const text = String(brief || '').toLowerCase();
    const scored = this.frameworks.map((fw, idx) => {
      const keywords = (fw.name + ' ' + fw.mechanism).toLowerCase().split(/\s+/);
      const matches = keywords.filter((w) => w.length > 3 && text.includes(w)).length;
      return { fw, score: matches, idx };
    });
    scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
    return scored.slice(0, k).map((s) => s.fw);
  }

  _extractSection(text, labels = []) {
    if (!text) return null;
    for (const label of labels) {
      // Match "Label: value" or "Label - value" on a single line
      const re = new RegExp(
        '(?:' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\s*[:\\-–]\\s*([^\\n]+)',
        'i',
      );
      const m = text.match(re);
      if (m) return m[1].trim().slice(0, 400);
    }
    const paras = text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 40);
    return paras[0] ? paras[0].slice(0, 400) : null;
  }
}
