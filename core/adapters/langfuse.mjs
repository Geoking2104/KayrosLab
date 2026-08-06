// KayrosLab — Langfuse observability scaffold (V16).
// Optional peer: langfuse. No-op when LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY absent.

export function loadLangfuseConfig(envSource) {
  const e = envSource || (typeof process !== 'undefined' ? process.env : {});
  return {
    publicKey: e.LANGFUSE_PUBLIC_KEY || '',
    secretKey: e.LANGFUSE_SECRET_KEY || '',
    baseUrl: e.LANGFUSE_BASE_URL || e.LANGFUSE_HOST || 'https://cloud.langfuse.com',
    release: e.LANGFUSE_RELEASE || e.KAYROS_RELEASE || 'kayroslab',
    enabled: Boolean((e.LANGFUSE_PUBLIC_KEY || '') && (e.LANGFUSE_SECRET_KEY || '')),
  };
}

export function createNoopObserver() {
  return {
    enabled: false,
    client: null,
    async trace() { return null; },
    async generation() { return null; },
    async span() { return null; },
    async score() { return null; },
    async flush() { return; },
    wrapLlm(llm) { return llm; },
    wrapTools(tools) { return tools; },
    withMeta(meta) {
      return {
        ...this,
        _meta: { ...(this._meta || {}), ...meta },
        wrapLlm: (llm) => wrapLlmWithObserver(llm, this, { ...(this._meta || {}), ...meta }),
        wrapTools: (tools) => wrapToolsWithObserver(tools, this, { ...(this._meta || {}), ...meta }),
      };
    },
    _meta: {},
  };
}

export async function createLangfuseObserver(opts = {}) {
  const cfg = { ...loadLangfuseConfig(), ...opts };
  if (opts.forceNoop || !cfg.publicKey || !cfg.secretKey) return createNoopObserver();
  if (opts.client) return buildObserver(opts.client, cfg);

  let Langfuse;
  try {
    const mod = await import('langfuse');
    Langfuse = mod.Langfuse || mod.default?.Langfuse || mod.default;
  } catch {
    return createNoopObserver();
  }
  if (!Langfuse) return createNoopObserver();

  try {
    const client = new Langfuse({
      publicKey: cfg.publicKey,
      secretKey: cfg.secretKey,
      baseUrl: cfg.baseUrl,
      release: cfg.release,
    });
    return buildObserver(client, cfg);
  } catch {
    return createNoopObserver();
  }
}

function buildObserver(client, cfg) {
  const observer = {
    enabled: true,
    client,
    _meta: {},

    trace(name, opts = {}) {
      const meta = mergeMeta(observer._meta, opts);
      try {
        return client.trace({
          name: name || 'kayros',
          input: opts.input,
          metadata: toMetadata(meta),
          sessionId: meta.sessionId || undefined,
          userId: meta.userId || undefined,
          tags: buildTags(meta),
        });
      } catch { return null; }
    },

    generation(opts = {}) {
      const meta = mergeMeta(observer._meta, opts);
      const parent = opts.trace || opts.parent;
      try {
        const payload = {
          name: opts.name || 'llm.complete',
          model: opts.model,
          input: opts.input,
          output: opts.output,
          metadata: toMetadata(meta),
          usage: opts.usage,
          startTime: opts.startTime,
          endTime: opts.endTime,
          level: opts.level,
          statusMessage: opts.statusMessage,
        };
        if (parent && typeof parent.generation === 'function') return parent.generation(payload);
        if (typeof client.generation === 'function') return client.generation({ ...payload, traceId: opts.traceId });
        return null;
      } catch { return null; }
    },

    span(opts = {}) {
      const meta = mergeMeta(observer._meta, opts);
      const parent = opts.trace || opts.parent;
      try {
        const payload = {
          name: opts.name || 'span',
          input: opts.input,
          output: opts.output,
          metadata: toMetadata(meta),
          startTime: opts.startTime,
          endTime: opts.endTime,
          level: opts.level,
          statusMessage: opts.statusMessage,
        };
        if (parent && typeof parent.span === 'function') return parent.span(payload);
        if (typeof client.span === 'function') return client.span({ ...payload, traceId: opts.traceId });
        return null;
      } catch { return null; }
    },

    score(opts = {}) {
      try {
        if (typeof client.score === 'function') {
          return client.score({
            name: opts.name || 'score',
            value: opts.value,
            traceId: opts.traceId,
            observationId: opts.observationId,
            comment: opts.comment,
            dataType: opts.dataType,
          });
        }
      } catch { /* noop */ }
      return null;
    },

    async flush() {
      try {
        if (typeof client.flushAsync === 'function') await client.flushAsync();
        else if (typeof client.flush === 'function') await client.flush();
      } catch { /* noop */ }
    },

    wrapLlm(llm, meta) { return wrapLlmWithObserver(llm, observer, mergeMeta(observer._meta, meta)); },
    wrapTools(tools, meta) { return wrapToolsWithObserver(tools, observer, mergeMeta(observer._meta, meta)); },

    withMeta(meta) {
      return {
        ...observer,
        _meta: mergeMeta(observer._meta, meta),
        wrapLlm: (llm, m) => wrapLlmWithObserver(llm, observer, mergeMeta(observer._meta, meta, m)),
        wrapTools: (tools, m) => wrapToolsWithObserver(tools, observer, mergeMeta(observer._meta, meta, m)),
      };
    },
  };
  return observer;
}

function mergeMeta(...parts) {
  const out = {};
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue;
    for (const [k, v] of Object.entries(p)) {
      if (v !== undefined && v !== null && k !== 'input' && k !== 'output' && k !== 'trace' && k !== 'parent') out[k] = v;
    }
  }
  return out;
}

function toMetadata(meta = {}) {
  const m = {};
  if (meta.ideaId) m.ideaId = String(meta.ideaId);
  if (meta.stage) m.stage = String(meta.stage);
  if (meta.tenantId) m.tenantId = String(meta.tenantId);
  if (meta.userId) m.userId = String(meta.userId);
  if (meta.gateId) m.gateId = String(meta.gateId);
  if (meta.provider) m.provider = String(meta.provider);
  if (meta.extra && typeof meta.extra === 'object') Object.assign(m, meta.extra);
  return m;
}

function buildTags(meta = {}) {
  const tags = ['kayroslab'];
  if (meta.stage) tags.push(`stage:${meta.stage}`);
  if (meta.provider) tags.push(`provider:${meta.provider}`);
  return tags;
}

export function wrapLlmWithObserver(llm, observer, baseMeta = {}) {
  if (!llm || typeof llm.complete !== 'function') return llm;
  if (!observer?.enabled) return llm;
  const original = llm.complete.bind(llm);
  return new Proxy(llm, {
    get(target, prop, receiver) {
      if (prop === 'complete') {
        return async function complete(req, ...rest) {
          const meta = mergeMeta(baseMeta, req?.meta, req?.context);
          const start = new Date();
          let error = null;
          let result = null;
          try {
            result = await original(req, ...rest);
            return result;
          } catch (e) {
            error = e;
            throw e;
          } finally {
            const end = new Date();
            observer.generation({
              name: 'llm.complete',
              model: req?.model || result?.model || meta.model,
              input: summarizeMessages(req?.messages || req?.prompt || req),
              output: result?.text ?? result?.content ?? (error ? String(error.message || error) : undefined),
              startTime: start,
              endTime: end,
              usage: result?.usage,
              ideaId: meta.ideaId,
              stage: meta.stage,
              tenantId: meta.tenantId,
              userId: meta.userId,
              gateId: meta.gateId,
              provider: result?.provider || meta.provider,
              level: error ? 'ERROR' : undefined,
              statusMessage: error ? String(error.message || error) : undefined,
              extra: { latencyMs: result?.latencyMs, provider: result?.provider },
            });
          }
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export function wrapToolsWithObserver(tools, observer, baseMeta = {}) {
  if (!tools || typeof tools.call !== 'function') return tools;
  if (!observer?.enabled) return tools;
  const originalCall = tools.call.bind(tools);
  return new Proxy(tools, {
    get(target, prop, receiver) {
      if (prop === 'call') {
        return async function call(name, input, ctx = {}) {
          const meta = mergeMeta(baseMeta, ctx);
          const start = new Date();
          let error = null;
          let result = null;
          try {
            result = await originalCall(name, input, ctx);
            return result;
          } catch (e) {
            error = e;
            throw e;
          } finally {
            const end = new Date();
            observer.span({
              name: `tool.${name}`,
              input: safeJson(input),
              output: error ? undefined : safeJson(result),
              startTime: start,
              endTime: end,
              ideaId: meta.ideaId || ctx?.ideaId,
              stage: meta.stage || ctx?.stage,
              tenantId: meta.tenantId || ctx?.tenantId,
              userId: meta.userId || ctx?.userId,
              gateId: meta.gateId || ctx?.gateId,
              level: error ? 'ERROR' : undefined,
              statusMessage: error ? String(error.message || error) : undefined,
              extra: { tool: name, sideEffect: target.get?.(name)?.sideEffect },
            });
          }
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function summarizeMessages(messages) {
  if (typeof messages === 'string') return messages.slice(0, 4000);
  if (!Array.isArray(messages)) return safeJson(messages);
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content.slice(0, 2000) : safeJson(m.content),
  }));
}

function safeJson(v) {
  try {
    if (v == null) return v;
    if (typeof v === 'string') return v.slice(0, 4000);
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v).slice(0, 1000);
  }
}

export async function loadLangfuseModule() {
  try { return await import('langfuse'); } catch { return null; }
}
