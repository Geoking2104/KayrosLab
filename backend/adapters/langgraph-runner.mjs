// KayrosLab backend — LangGraph runner (optional peer: @langchain/langgraph).

export {
  runLangGraphStep,
  mapGraphStateToKayros,
  createResearchGraph,
  createMockResearchGraph,
  loadLangGraphModule,
} from '../../core/adapters/langgraph-runner.mjs';

import {
  runLangGraphStep,
  createResearchGraph,
} from '../../core/adapters/langgraph-runner.mjs';

/**
 * Attach a research graph helper on Fastify app.kayrosContext.
 * @param {object} app
 * @param {object} [opts]
 */
export async function attachResearchGraph(app, opts = {}) {
  if (!app?.kayrosContext) throw new Error('attachResearchGraph: kayrosContext manquant');
  const tools = opts.tools || app.kayrosContext.tools;
  const graph = await createResearchGraph({
    ...opts,
    tools,
    llmComplete: opts.llmComplete || (app.kayrosContext.llm
      ? async (prompt) => {
          const r = await app.kayrosContext.llm.complete?.(prompt);
          return typeof r === 'string' ? r : r?.text || r?.content || String(r);
        }
      : undefined),
  });
  app.kayrosContext.researchGraph = graph;
  app.kayrosContext.runResearch = (input, runOpts) => runLangGraphStep(graph, input, runOpts);
  return graph;
}
