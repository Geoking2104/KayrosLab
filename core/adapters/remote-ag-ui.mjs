// KayrosLab — Adaptateur d'agent distant AG-UI (P8).
//
// Un agent `metadata.runtime: 'remote-ag-ui'` délègue son analyse à un serveur AG-UI distant
// (POST RunAgentInput → flux SSE d'événements TEXT_MESSAGE_CONTENT / RUN_FINISHED / RUN_ERROR).
// La gouvernance KayrosLab reste locale et s'applique à la SORTIE :
//  - règles effectives (resolveEffectiveRules) envoyées en contexte et rattachées au résultat ;
//  - checkCompliance sur le texte reçu ; en mode enforce : 1 relance corrective puis
//    HarnessComplianceError (même politique que KayrosLLM.complete) ; flag : notation seule.
// URL distante : http(s) public uniquement (assertPublicUrl/assertPublicHost, anti-SSRF), pas de
// redirection, délai et taille bornés. Le verdict reste soumis au consensus et à l'arbitrage humain.

import { checkCompliance, correctiveInstruction, harnessMode, HarnessComplianceError, HARNESS_MAX_RETRIES } from '../agent-harness.mjs';
import { resolveEffectiveRules } from '../swarm.mjs';
import { assertPublicUrl, assertPublicHost } from '../public-sources.mjs';

export const REMOTE_AG_UI_RUNTIME = 'remote-ag-ui';
export const REMOTE_AG_UI_LIMITS = Object.freeze({ timeoutMs: 60000, maxBytes: 256 * 1024 });

export function isRemoteAgUiAgent(definition) { return definition?.metadata?.runtime === REMOTE_AG_UI_RUNTIME; }

/** Valide la configuration distante ({ url }) ; aucune clé n'est stockée dans la définition. */
export function remoteAgUiConfig(definition) {
  const remote = definition?.metadata?.remote_ag_ui || {};
  return { url: assertPublicUrl(remote.url).toString(), agent: remote.agent ? String(remote.agent).slice(0, 120) : null };
}

/** Parse un flux SSE AG-UI et concatène les deltas de texte. */
export function parseAgUiEvents(body) {
  let text = ''; let finished = false; let error = null; const events = [];
  for (const block of String(body || '').split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data) continue;
    let ev; try { ev = JSON.parse(data); } catch { continue; }
    events.push(ev.type);
    if (ev.type === 'TEXT_MESSAGE_CONTENT' && typeof ev.delta === 'string') text += ev.delta;
    else if (ev.type === 'TEXT_MESSAGE_CHUNK' && typeof ev.delta === 'string') text += ev.delta;
    else if (ev.type === 'RUN_FINISHED') finished = true;
    else if (ev.type === 'RUN_ERROR') error = String(ev.message || 'erreur distante');
  }
  return { text, finished, error, events };
}

async function readLimited(res, maxBytes) {
  if (!res.body?.getReader) { const t = await res.text(); return t.slice(0, maxBytes); }
  const reader = res.body.getReader(); const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error('agent distant : réponse trop volumineuse'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

async function callOnce({ url, input, fetchImpl, lookup, limits, signal }) {
  const target = assertPublicUrl(url);
  await assertPublicHost(target, lookup ? { lookup } : {});
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('agent distant : délai dépassé')), limits.timeoutMs);
  const onAbort = () => ctrl.abort(signal.reason);
  signal?.addEventListener?.('abort', onAbort, { once: true });
  try {
    const res = await fetchImpl(target.toString(), {
      method: 'POST', redirect: 'manual', credentials: 'omit', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(input),
    });
    if (res.status >= 300) throw new Error(`agent distant : HTTP ${res.status}`);
    const parsed = parseAgUiEvents(await readLimited(res, limits.maxBytes));
    if (parsed.error) throw new Error(`agent distant : ${parsed.error}`);
    if (!parsed.text.trim()) throw new Error('agent distant : réponse vide');
    return parsed;
  } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); }
}

/**
 * Exécute l'agent distant ; renvoie un résultat brut compatible normalizeAgentAnalysis,
 * avec `compliance`, `effective_rules` et `provider: 'remote-ag-ui'`.
 */
export async function runRemoteAgUiAgent({ definition, effectiveContext = '', question, context = '', runId = null, compliance, signal = null,
  fetchImpl = globalThis.fetch, lookup = null, limits = {}, env } = {}) {
  const { url } = remoteAgUiConfig(definition);
  const lim = { ...REMOTE_AG_UI_LIMITS, ...limits };
  const effective_rules = resolveEffectiveRules(definition);
  const mode = harnessMode({ compliance }, env);
  const role = definition.agent_id;
  const messages = [{ id: 'u1', role: 'user', content: `${question}${context ? `\n\nContexte : ${context}` : ''}\n\nRéponds en JSON {"verdict":"GO|NO_GO|CONDITIONAL_GO","primary_reason":"…"}.` }];
  const baseInput = {
    threadId: runId || `run_${Date.now().toString(36)}`, runId: runId || `run_${Date.now().toString(36)}`,
    state: {}, tools: [], forwardedProps: {},
    context: [
      { description: 'kayros_effective_context', value: String(effectiveContext).slice(0, 20000) },
      { description: 'kayros_effective_rules', value: JSON.stringify(effective_rules.map((r) => ({ rule_id: r.rule_id, rule_text: r.rule_text }))) },
    ],
  };
  let attempt = 0; let out; let report;
  for (;;) {
    attempt += 1;
    out = await callOnce({ url, input: { ...baseInput, messages }, fetchImpl, lookup, limits: lim, signal });
    if (mode === 'off') { report = null; break; }
    report = checkCompliance(out.text, { role });
    if (report.compliant || mode === 'flag') break;
    if (attempt > HARNESS_MAX_RETRIES) throw new HarnessComplianceError({ text: out.text, compliance: report }, attempt);
    messages.push({ id: `a${attempt}`, role: 'assistant', content: out.text }, { id: `c${attempt}`, role: 'user', content: correctiveInstruction(report.flags, { role }) });
  }
  return { output: out.text, provider: REMOTE_AG_UI_RUNTIME, compliance: report, effective_rules, attempts: attempt };
}
