export class BaseAgent {
  constructor({ name, systemPrompt, tools = null, memory = null, llm = null } = {}) {
    if (!name) throw new Error('BaseAgent: name required');
    this.name = name;
    this.systemPrompt = systemPrompt || `You are ${name}, a specialized strategic ideation agent.`;
    this.tools = tools;
    this.memory = memory;
    this.llm = llm;
    this._contributions = [];
  }

  getContributions() { return [...this._contributions]; }

  async addContribution(content) {
    const entry = { agent: this.name, content, ts: new Date().toISOString() };
    this._contributions.push(entry);
    if (this.memory?.addContribution) this.memory.addContribution(entry);
    return entry;
  }

  async execute(task, { goal, context = '', provider, sovereignty, model } = {}) {
    const messages = [
      { role: 'system', content: this.systemPrompt },
    ];
    if (context) messages.push({ role: 'system', content: `Context: ${context}` });
    messages.push({ role: 'user', content: `Goal: ${goal}\n\nTask: ${task}` });

    let text;
    if (this.llm) {
      const res = await this.llm.complete(
        { role: this.name, messages, model, temperature: 0.3 },
        { provider, sovereignty },
      );
      text = res.text;
    } else {
      text = `[${this.name}] Analysis for: ${task.substring(0, 100)}`;
    }
    await this.addContribution(text);
    return { agent: this.name, output: text };
  }

  getToolNames() {
    return this._toolNames || [];
  }
}
