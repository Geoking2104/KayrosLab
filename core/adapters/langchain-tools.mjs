// KayrosLab — Bridge LangChain tools → ToolRegistry (V16).
// Optional peer: @langchain/core. core/ stays usable without LangChain installed.
//
// Usage:
//   import { toKayrosTool, registerLangChainTools } from './adapters/langchain-tools.mjs';
//   registerLangChainTools(registry, [lcTool1, lcTool2], { sideEffect: 'read' });

/**
 * Extract input key names from a LangChain tool schema.
 * Supports: Zod object (.shape), JSON Schema (.properties), array of strings.
 * @param {any} schema
 * @returns {string[]}
 */
export function extractInputKeys(schema) {
  if (!schema) return [];
  if (Array.isArray(schema)) {
    return schema.map(String).filter(Boolean);
  }
  if (schema.shape && typeof schema.shape === 'object') {
    return Object.keys(schema.shape);
  }
  if (schema._def?.schema) {
    return extractInputKeys(schema._def.schema);
  }
  if (schema._def?.innerType) {
    return extractInputKeys(schema._def.innerType);
  }
  if (schema.properties && typeof schema.properties === 'object') {
    return Object.keys(schema.properties);
  }
  if (schema.type === 'object' && schema.properties) {
    return Object.keys(schema.properties);
  }
  return [];
}

/**
 * Infer sideEffect from tool name / description heuristics.
 * @param {{name?:string, description?:string}} tool
 * @param {'none'|'read'|'write'} [fallback='read']
 */
export function inferSideEffect(tool, fallback = 'read') {
  const blob = `${tool?.name || ''} ${tool?.description || ''}`.toLowerCase();
  if (/\b(delete|write|update|create|send|post|put|patch|mutate|insert|drop|publish)\b/.test(blob)) {
    return 'write';
  }
  if (/\b(search|get|fetch|read|list|find|query|lookup|retrieve)\b/.test(blob)) {
    return 'read';
  }
  return fallback;
}

/**
 * Normalize LangChain invoke/call result to a plain JSON-serializable value.
 * @param {any} result
 */
export function normalizeLcResult(result) {
  if (result == null) return result;
  if (typeof result === 'object' && result.content != null && (result.lc_id || result.tool_call_id || result.name)) {
    const content = result.content;
    if (typeof content === 'string') {
      try { return JSON.parse(content); } catch { return content; }
    }
    return content;
  }
  if (typeof result === 'object' && typeof result.toJSON === 'function') {
    try { return result.toJSON(); } catch { /* fall through */ }
  }
  return result;
}

function schemaHasMultiple(schema) {
  return extractInputKeys(schema).length > 1;
}

function pickInvoke(lcTool) {
  if (typeof lcTool.invoke === 'function') return lcTool.invoke;
  if (typeof lcTool.call === 'function') return lcTool.call;
  if (typeof lcTool.func === 'function') {
    return async function (input) { return lcTool.func(input); };
  }
  if (typeof lcTool._call === 'function') {
    return async function (input) { return lcTool._call(input); };
  }
  return null;
}

/**
 * Convert a LangChain tool into a Kayros ToolDef.
 *
 * @param {object} lcTool
 * @param {object} [opts]
 * @returns {object} ToolDef
 */
export function toKayrosTool(lcTool, opts = {}) {
  if (!lcTool) throw new Error('toKayrosTool: lcTool requis');

  const name = opts.name || lcTool.name || lcTool.id;
  if (!name || typeof name !== 'string') {
    throw new Error('toKayrosTool: tool sans name');
  }

  const description = opts.description
    || lcTool.description
    || lcTool.lc_kwargs?.description
    || `LangChain tool: ${name}`;

  const schema = lcTool.schema || lcTool.lc_kwargs?.schema || null;
  const inputKeys = opts.inputKeys || extractInputKeys(schema);
  const sideEffect = opts.sideEffect || inferSideEffect({ name, description }, 'read');
  const gate = opts.gate != null ? !!opts.gate : sideEffect === 'write';

  const invoke = pickInvoke(lcTool);
  if (!invoke) {
    throw new Error(`toKayrosTool: ${name} n'expose ni invoke() ni call() ni func()`);
  }

  return {
    name,
    description,
    inputKeys,
    sideEffect,
    gate,
    source: 'langchain',
    lcName: lcTool.name || name,
    handler: async (input, ctx) => {
      const mapped = opts.mapInput ? await opts.mapInput(input, ctx) : (input || {});
      let arg = mapped;
      if (typeof mapped === 'object' && inputKeys.length === 1 && inputKeys[0] in mapped && !schemaHasMultiple(schema)) {
        if (lcTool.lc_namespace && !lcTool.schema) {
          arg = mapped[inputKeys[0]];
        }
      }
      const raw = await invoke.call(lcTool, arg);
      const normalized = normalizeLcResult(raw);
      return opts.mapResult ? await opts.mapResult(input, ctx, normalized) : normalized;
    },
  };
}

/**
 * Register one or many LangChain tools onto a Kayros ToolRegistry.
 *
 * @param {{register:Function, get:Function}} registry
 * @param {object|object[]} lcTools
 * @param {object} [opts]
 * @returns {string[]}
 */
export function registerLangChainTools(registry, lcTools, opts = {}) {
  if (!registry || typeof registry.register !== 'function') {
    throw new Error('registerLangChainTools: registry invalide');
  }
  const list = Array.isArray(lcTools) ? lcTools : [lcTools];
  const names = [];
  for (const t of list) {
    if (!t) continue;
    const toolName = t.name || t.id;
    const per = (opts.overrides && toolName && opts.overrides[toolName]) || {};
    const def = toKayrosTool(t, { ...opts, ...per, overrides: undefined });
    if (opts.prefix) def.name = opts.prefix + def.name;
    if (opts.skipExisting && registry.get(def.name)) continue;
    registry.register(def);
    names.push(def.name);
  }
  return names;
}

/**
 * Create a Kayros tool from a plain async function (no LangChain required).
 */
export function fromAsyncFn(def) {
  if (!def?.name || typeof def.fn !== 'function') {
    throw new Error('fromAsyncFn: name + fn requis');
  }
  return {
    name: def.name,
    description: def.description || def.name,
    inputKeys: def.inputKeys || [],
    sideEffect: def.sideEffect || inferSideEffect(def, 'read'),
    gate: def.gate != null ? !!def.gate : def.sideEffect === 'write',
    source: 'fn',
    handler: async (input, ctx) => def.fn(input, ctx),
  };
}
