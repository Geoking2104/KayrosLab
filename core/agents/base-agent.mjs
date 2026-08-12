export class BaseAgent {
  /**
   * @param {Object} [opts]
   * @param {string} opts.name
   * @param {string} [opts.systemPrompt]
   * @param {Object} [opts.tools]
   * @param {Object} [opts.memory]
   * @param {Object} [opts.llm]
   * @param {string} [opts.preferredModel]
   * @param {Object} [opts.quantRec]
   */
  constructor({ name, systemPrompt, tools = null, memory = null, llm = null, preferredModel = null, quantRec = null } = {}) {
    if (!name) throw new Error('BaseAgent: name required');
    this.name = name;
    this.systemPrompt = systemPrompt || `You are ${name}, a specialized strategic ideation agent.`;
    this.tools = tools;
    this.memory = memory;
    this.llm = llm;
    this.preferredModel = preferredModel || null;
    this.quantRec = quantRec || null;
    // The state channel this agent owns, or null when it only produces text.
    // Declared here so every agent answers the question the same way.
    this.channel = null;
    this._contributions = [];
  }

  getContributions() { return [...this._contributions]; }

  async addContribution(content) {
    const entry = { agent: this.name, content, ts: new Date().toISOString() };
    this._contributions.push(entry);
    if (this.memory?.addContribution) this.memory.addContribution(entry);
    return entry;
  }

  /** Model used for this call: explicit override > preferredModel (quant-aware) > undefined. */
  _resolveModel(model) {
    return model || this.preferredModel || undefined;
  }

  async execute(task, {
    goal, context = '', provider, sovereignty, model, runId, run_id, traceId, trace_id,
  } = {}) {
    const correlation = {
      runId: runId || run_id,
      run_id: runId || run_id,
      traceId: traceId || trace_id,
      trace_id: traceId || trace_id,
    };
    const messages = [
      { role: 'system', content: this.systemPrompt },
    ];
    if (context) messages.push({ role: 'system', content: `Context: ${context}` });
    messages.push({ role: 'user', content: `Goal: ${goal}\n\nTask: ${task}` });

    let text;
    let degraded = null;
    if (this.llm) {
      const res = await this.llm.complete(
        {
          role: this.name, messages, model: this._resolveModel(model), temperature: 0.3,
          ...correlation,
        },
        { provider, sovereignty, ...correlation },
      );
      text = res.text;
      degraded = res.degraded || null;
    } else {
      text = `[${this.name}] Analysis for: ${task.substring(0, 100)}`;
    }
    await this.addContribution(text);
    return {
      agent: this.name,
      output: text,
      model: this._resolveModel(model) || null,
      degraded,
    };
  }

  getToolNames() {
    return this._toolNames || [];
  }
}
