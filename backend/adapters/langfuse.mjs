// KayrosLab backend — Langfuse observer attachment (optional peer: langfuse).

export {
  createLangfuseObserver,
  createNoopObserver,
  loadLangfuseConfig,
  wrapLlmWithObserver,
  wrapToolsWithObserver,
  loadLangfuseModule,
} from '../../core/adapters/langfuse.mjs';

import { createLangfuseObserver } from '../../core/adapters/langfuse.mjs';

/**
 * Attach Langfuse to Fastify kayrosContext.
 * Wraps llm + tools when keys present; no-op otherwise.
 */
export async function attachLangfuse(app, opts = {}) {
  if (!app?.kayrosContext) throw new Error('attachLangfuse: kayrosContext manquant');

  const observer = await createLangfuseObserver(opts);
  app.kayrosContext.langfuse = observer;

  if (!observer.enabled) {
    app.log?.info?.('[kayros] Langfuse disabled (missing keys or SDK)');
    return observer;
  }

  if (app.kayrosContext.llm) {
    app.kayrosContext.llm = observer.wrapLlm(app.kayrosContext.llm, { provider: 'kayros-backend' });
  }
  if (app.kayrosContext.tools) {
    app.kayrosContext.tools = observer.wrapTools(app.kayrosContext.tools);
  }
  if (app.kayrosContext.engine) {
    const eng = app.kayrosContext.engine;
    if (eng.llm) eng.llm = observer.wrapLlm(eng.llm);
    if (eng.tools) eng.tools = observer.wrapTools(eng.tools);
    if (eng.orchestrator) {
      if (eng.orchestrator.llm) eng.orchestrator.llm = eng.llm;
      if (eng.orchestrator.tools) eng.orchestrator.tools = eng.tools;
    }
  }

  const flush = () => { observer.flush().catch(() => {}); };
  if (typeof process !== 'undefined') process.once?.('beforeExit', flush);

  app.log?.info?.('[kayros] Langfuse observer attached');
  return observer;
}

/** Run fn inside a named trace with metadata. */
export async function withLangfuseTrace(observer, name, meta, fn) {
  if (!observer?.enabled) return fn();
  const trace = observer.trace(name, meta);
  const scoped = observer.withMeta({ ...meta, trace });
  try {
    const result = await fn(scoped, trace);
    try {
      if (trace && typeof trace.update === 'function') {
        trace.update({ output: typeof result === 'string' ? result.slice(0, 2000) : result });
      }
    } catch { /* noop */ }
    return result;
  } catch (e) {
    try {
      if (trace && typeof trace.update === 'function') {
        trace.update({ level: 'ERROR', statusMessage: String(e.message || e) });
      }
    } catch { /* noop */ }
    throw e;
  } finally {
    await observer.flush().catch(() => {});
  }
}
