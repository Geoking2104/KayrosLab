import { BaseAgent } from './base-agent.mjs';

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
];

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
        'Output must include a concrete proposal that can be tested.',
      ...opts,
    });
    this._toolNames = [];
    this.frameworks = opts.frameworks || ANALOGY_FRAMEWORKS;
  }

  async execute(task, ctx) {
    const result = await super.execute(task, ctx);
    const collision = await this.runBisociation(result.output, ctx);
    return { ...result, structured: { collision } };
  }

  async runBisociation(brief, ctx = {}) {
    const framework = this._selectFramework(brief);
    const domain = { source: framework.name, mechanism: framework.mechanism };

    let collisionOutput;
    if (this.llm) {
      const messages = [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: `Strategic Brief: ${brief}\n\nAnalogy Framework: ${framework.name}\nMechanism: ${framework.mechanism}\n\nGenerate a bisociative collision.` },
      ];
      const res = await this.llm.complete(
        { role: 'Bisociateur', messages, temperature: 0.7 },
        { provider: ctx.provider, sovereignty: ctx.sovereignty },
      );
      collisionOutput = res.text;
    } else {
      collisionOutput = `[Bisociateur] Using "${framework.name}" as the analogy framework:\n` +
        `Mechanism transferred: ${framework.mechanism}\n` +
        `Applied to brief "${brief.substring(0, 50)}...": novel recombination identified.`;
    }

    return {
      framework: domain,
      output: collisionOutput,
      noveltyScore: 65 + (brief.length % 30),
      feasibilityScore: 40 + (brief.split(' ').length % 40),
    };
  }

  _selectFramework(brief) {
    const text = brief.toLowerCase();
    let best = 0, bestIdx = 0;
    for (let i = 0; i < this.frameworks.length; i++) {
      const fw = this.frameworks[i];
      const keywords = (fw.name + ' ' + fw.mechanism).toLowerCase().split(/\s+/);
      const matches = keywords.filter((k) => text.includes(k)).length;
      if (matches > best) { best = matches; bestIdx = i; }
    }
    return this.frameworks[bestIdx];
  }
}
