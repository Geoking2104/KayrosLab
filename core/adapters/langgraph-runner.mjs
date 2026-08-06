// KayrosLab — LangGraph runner scaffold (V16).
// Optional peer: @langchain/langgraph (+ @langchain/core).
// core/ remains usable without LangGraph installed.
// Contract: LangGraph proposes structured output; Kayros gates / persists.

export function mapGraphStateToKayros(state = {}, opts = {}) {
  const maxSummary = opts.maxSummaryChars ?? 4000;
  let summary =
    state.summary
    || state.output
    || state.result
    || (typeof state.messages === 'object' && extractLastMessageContent(state.messages))
    || '';

  if (!summary && state.research) {
    summary = typeof state.research === 'string' ? state.research : JSON.stringify(state.research);
  }
  if (!summary) {
    try {
      summary = JSON.stringify(state).slice(0, maxSummary);
    } catch {
      summary = String(state);
    }
  }
  summary = String(summary).slice(0, maxSummary);

  const signals = Array.isArray(state.signals)
    ? state.signals
    : Array.isArray(state.findings)
      ? state.findings.map((f, i) => ({
          id: f.id || `lg:finding:${i}`,
          source: 'langgraph',
          contenu: typeof f === 'string' ? f : (f.text || f.contenu || JSON.stringify(f)),
        }))
      : [];

  const artifacts = state.artifacts || state.documents || null;
  const warnings = Array.isArray(state.warnings) ? state.warnings : [];

  return {
    summary,
    artifacts,
    signals,
    warnings,
    ...(opts.includeRaw ? { raw: state } : {}),
  };
}

function extractLastMessageContent(messages) {
  if (!Array.isArray(messages) || !messages.length) return '';
  const last = messages[messages.length - 1];
  if (typeof last === 'string') return last;
  if (last?.content != null) {
    return typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
  }
  return '';
}

export async function runLangGraphStep(graph, input = {}, opts = {}) {
  if (!graph || typeof graph.invoke !== 'function') {
    throw new Error('runLangGraphStep: graph.invoke requis (compiled StateGraph)');
  }

  const initial = opts.mapInput
    ? await opts.mapInput(input)
    : defaultMapInput(input);

  const finalState = await graph.invoke(initial, opts.config);
  const mapped = opts.mapOutput
    ? await opts.mapOutput(finalState)
    : mapGraphStateToKayros(finalState, { includeRaw: opts.includeRaw });

  return mapped;
}

function defaultMapInput(input) {
  return {
    idea: input.idea || input.query || '',
    constraints: input.constraints || {},
    notes: input.notes || [],
    context: input.context || null,
    messages: input.messages || [],
    signals: [],
    findings: [],
    summary: '',
    artifacts: null,
    warnings: [],
  };
}

export async function createResearchGraph(opts = {}) {
  if (!opts.forceMock) {
    try {
      const real = await tryCreateLangGraphResearch(opts);
      if (real) return real;
    } catch (err) {
      if (opts.strict) throw err;
    }
  }
  return createMockResearchGraph(opts);
}

async function tryCreateLangGraphResearch(opts = {}) {
  let StateGraph, START, END, Annotation;
  try {
    const mod = await import('@langchain/langgraph');
    StateGraph = mod.StateGraph;
    START = mod.START;
    END = mod.END;
    Annotation = mod.Annotation;
  } catch {
    return null;
  }
  if (!StateGraph || !Annotation) return null;

  const ResearchState = Annotation.Root({
    idea: Annotation(),
    constraints: Annotation(),
    notes: Annotation(),
    findings: Annotation({
      reducer: (a, b) => (a || []).concat(b || []),
      default: () => [],
    }),
    summary: Annotation(),
    signals: Annotation({
      reducer: (a, b) => (a || []).concat(b || []),
      default: () => [],
    }),
    artifacts: Annotation(),
    warnings: Annotation({
      reducer: (a, b) => (a || []).concat(b || []),
      default: () => [],
    }),
    messages: Annotation({
      reducer: (a, b) => (a || []).concat(b || []),
      default: () => [],
    }),
  });

  const tools = normalizeTools(opts.tools);

  async function gatherNode(state) {
    const findings = [];
    const warnings = [];
    const q = state.idea || '';
    const search = tools.find((t) => /search|fetch|lookup|web|docs/i.test(t.name));
    if (search) {
      try {
        const out = await search.handler(
          search.inputKeys?.[0] ? { [search.inputKeys[0]]: q } : { q },
          { source: 'langgraph-research' },
        );
        findings.push({
          id: 'lg:tool:' + search.name,
          text: typeof out === 'string' ? out : JSON.stringify(out),
          tool: search.name,
        });
      } catch (e) {
        warnings.push(`tool ${search.name}: ${e.message || e}`);
      }
    } else {
      findings.push({
        id: 'lg:heuristic',
        text: `Research stub for: ${q}`.slice(0, 500),
      });
    }
    return { findings, warnings };
  }

  async function synthesizeNode(state) {
    const parts = (state.findings || []).map((f) => f.text || f.contenu || '').filter(Boolean);
    let summary;
    if (typeof opts.llmComplete === 'function') {
      try {
        summary = await opts.llmComplete(
          `Synthèse courte des findings pour l'idée: ${state.idea}\n\n- ${parts.join('\n- ')}`,
        );
      } catch {
        summary = null;
      }
    }
    if (!summary) {
      summary = parts.length
        ? `Synthèse research (${parts.length} finding(s)): ${parts.join(' · ')}`.slice(0, 2000)
        : `Aucune finding pour: ${state.idea}`;
    }
    const signals = (state.findings || []).map((f, i) => ({
      id: f.id || `lg:sig:${i}`,
      source: 'langgraph-research',
      contenu: f.text || f.contenu || '',
    }));
    return { summary, signals };
  }

  const graph = new StateGraph(ResearchState)
    .addNode('gather', gatherNode)
    .addNode('synthesize', synthesizeNode)
    .addEdge(START, 'gather')
    .addEdge('gather', 'synthesize')
    .addEdge('synthesize', END);

  const compiled = graph.compile();
  return {
    id: 'langgraph-research',
    nodes: ['gather', 'synthesize'],
    invoke: (state, config) => compiled.invoke(state, config),
    _compiled: compiled,
  };
}

export function createMockResearchGraph(opts = {}) {
  const tools = normalizeTools(opts.tools);
  return {
    id: 'mock-research',
    nodes: ['gather', 'synthesize'],
    async invoke(state = {}) {
      const idea = state.idea || '';
      const findings = [];
      const warnings = [];
      const search = tools.find((t) => /search|fetch|lookup|web|docs/i.test(t.name));
      if (search) {
        try {
          const out = await search.handler(
            search.inputKeys?.[0] ? { [search.inputKeys[0]]: idea } : { q: idea },
            { source: 'mock-research' },
          );
          findings.push({
            id: 'mock:tool:' + search.name,
            text: typeof out === 'string' ? out : JSON.stringify(out),
            tool: search.name,
          });
        } catch (e) {
          warnings.push(String(e.message || e));
        }
      } else {
        findings.push({ id: 'mock:heuristic', text: `Mock research for: ${idea}` });
      }
      const summary = findings.map((f) => f.text).join(' · ').slice(0, 2000);
      const signals = findings.map((f, i) => ({
        id: f.id || `mock:sig:${i}`,
        source: 'mock-research',
        contenu: f.text,
      }));
      return { ...state, findings, warnings, summary, signals };
    },
  };
}

function normalizeTools(tools) {
  if (!tools) return [];
  if (Array.isArray(tools)) return tools.filter((t) => t && typeof t.handler === 'function');
  if (typeof tools.list === 'function') return tools.list().filter((t) => typeof t.handler === 'function');
  return [];
}

export async function loadLangGraphModule() {
  try {
    return await import('@langchain/langgraph');
  } catch {
    return null;
  }
}
