// Shared plan JSON extraction (Orchestrator + PlannerAgent).

export const PLAN_AGENTS = ['Planner', 'Critic', 'DevilsAdvocate', 'RedTeam', 'Bisociateur', 'Synthesizer'];

export function extractFirstArray(s) {
  const start = s.indexOf('[');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return s.slice(start);
}

export function salvageObjects(raw) {
  const objs = [];
  let depth = 0, inStr = false, esc = false, startObj = -1;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth === 0) startObj = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && startObj >= 0) {
        try { objs.push(JSON.parse(raw.slice(startObj, i + 1))); } catch { /* ignore */ }
        startObj = -1;
      }
    }
  }
  return objs;
}

export function parsePlanSteps(text, { allowed = PLAN_AGENTS } = {}) {
  try {
    let s = String(text ?? '');
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, ' ').replace(/<think>[\s\S]*$/i, ' ');
    s = s.replace(/```(?:json)?/gi, ' ');
    const raw = extractFirstArray(s);
    if (!raw) return null;
    let arr;
    try { arr = JSON.parse(raw); }
    catch { arr = salvageObjects(raw); }
    if (!Array.isArray(arr) || !arr.length) return null;
    const allow = new Set(allowed);
    const steps = arr
      .filter((x) => x && typeof x.description === 'string' && allow.has(x.agent))
      .slice(0, 8)
      .map((x, i) => ({
        id: `s${i + 1}`,
        agent: x.agent,
        description: x.description,
        ...(x.tool ? { tool: x.tool } : {}),
      }));
    return steps.length ? steps : null;
  } catch {
    return null;
  }
}

export function ensureSynthesizerLast(steps) {
  if (!steps?.length) return steps;
  const out = [...steps];
  if (out[out.length - 1].agent !== 'Synthesizer') {
    out.push({
      id: `s${out.length + 1}`,
      agent: 'Synthesizer',
      description: 'Synthese et recommandations arbitrables',
    });
  }
  return out.map((x, i) => ({ ...x, id: x.id || `s${i + 1}` }));
}
