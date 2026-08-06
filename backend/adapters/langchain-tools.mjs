// KayrosLab backend — LangChain tools bridge (optional peer dependency).
// core/ stays zero-dep; install @langchain/core only if you use LC tools.

export {
  toKayrosTool,
  registerLangChainTools,
  extractInputKeys,
  inferSideEffect,
  normalizeLcResult,
  fromAsyncFn,
} from '../../core/adapters/langchain-tools.mjs';

import { registerLangChainTools } from '../../core/adapters/langchain-tools.mjs';

/**
 * Dynamically import @langchain/core/tools if available.
 * @returns {Promise<null|object>}
 */
export async function loadLangChainToolsModule() {
  try {
    return await import('@langchain/core/tools');
  } catch {
    return null;
  }
}

/**
 * Register LangChain tools into Fastify kayrosContext.tools.
 * @param {object} app
 * @param {object|object[]} lcTools
 * @param {object} [opts]
 * @returns {string[]} registered names
 */
export function attachLangChainTools(app, lcTools, opts = {}) {
  const registry = app?.kayrosContext?.tools;
  if (!registry) throw new Error('attachLangChainTools: app.kayrosContext.tools manquant');
  return registerLangChainTools(registry, lcTools, opts);
}
