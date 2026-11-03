// Portes personnalisées du graphe de projet : elles s'appliquent aux avis du
// collectif et décident si le verdict peut être accepté tel quel.

const FAVORABLE = new Set(['GO', 'CONDITIONAL_GO']);
const EXECUTIVE = new Set(['executive', 'c-suite', 'csuite', 'c_suite']);

/** Évalue une porte (nœud « porte ») sur les analyses d'un run. */
export function evaluateGate(node, analyses = []) {
  const config = node?.config || {};
  const opinions = (analyses || []).filter((a) => a && a.verdict);
  const base = { gate_id: node.id, label: node.label || '', threshold: config.threshold || 'majority', min_go: config.min_go ?? null, veto: config.veto === true, strict: config.strict === true };
  if (!opinions.length) return { ...base, status: 'pending', go: 0, total: 0, share: null, reasons: ['en attente des avis'] };
  // Mode strict : seul un GO franc compte comme favorable (un GO sous conditions non).
  const go = opinions.filter((a) => (base.strict ? a.verdict === 'GO' : FAVORABLE.has(a.verdict))).length;
  const total = opinions.length;
  const share = Math.round((go / total) * 100);
  const noGo = opinions.filter((a) => a.verdict === 'NO_GO');
  const reasons = [];
  if (base.threshold === 'majority' && !(go > total / 2)) reasons.push(`majorité non atteinte (${go}/${total})`);
  const against = base.strict ? opinions.filter((a) => a.verdict !== 'GO') : noGo;
  if (base.threshold === 'unanimous' && against.length) reasons.push(`unanimité rompue (${against.map((a) => a.agent_id).join(', ')})`);
  if (base.threshold === 'veto_csuite') {
    const exec = noGo.filter((a) => a.veto_power === true || EXECUTIVE.has(String(a.seniority || '').toLowerCase()));
    if (exec.length) reasons.push(`opposition de la direction (${exec.map((a) => a.agent_id).join(', ')})`);
  }
  if (base.min_go != null && share < base.min_go) reasons.push(`${share} % d'avis favorables, seuil ${base.min_go} %`);
  if (base.veto) {
    const vetoes = noGo.filter((a) => a.veto_power === true);
    if (vetoes.length) reasons.push(`veto exercé (${vetoes.map((a) => a.agent_id).join(', ')})`);
  }
  return { ...base, status: reasons.length ? 'blocked' : 'passed', go, total, share, reasons };
}

/** Portes du graphe qui s'appliquent à une session : en aval d'un collectif de cette session (ou d'un collectif non lié). */
export function gatesForSession(graph, sessionId) {
  if (!graph?.nodes?.length) return [];
  const out = new Map(graph.nodes.map((n) => [n.id, graph.edges.filter((e) => e.from === n.id).map((e) => e.to)]));
  const collectives = graph.nodes.filter((n) => n.type === 'collectif');
  const roots = collectives.filter((n) => !n.config?.session_id || n.config.session_id === sessionId);
  const gates = graph.nodes.filter((n) => n.type === 'porte');
  if (!collectives.length) return gates;
  const reach = new Set();
  const stack = roots.map((n) => n.id);
  while (stack.length) { const id = stack.pop(); for (const next of out.get(id) || []) if (!reach.has(next)) { reach.add(next); stack.push(next); } }
  return gates.filter((g) => reach.has(g.id));
}

/** Évaluation de toutes les portes des projets qui contiennent le fil. */
export function evaluateThreadGates(projects, thread) {
  const runs = (thread?.messages || []).filter((m) => m.run);
  const run = runs.length ? runs[runs.length - 1].run : null;
  const results = [];
  for (const project of projects) {
    for (const node of gatesForSession(project.graph, thread.room_id)) {
      results.push({ project_id: project.id, project_name: project.name, ...evaluateGate(node, run?.analyses || []) });
    }
  }
  if (!results.length) return null;
  const consensus = run?.consensus?.verdict || null;
  const status = results.some((r) => r.status === 'blocked') ? 'blocked' : results.some((r) => r.status === 'pending') ? 'pending' : 'passed';
  return { run_id: run?.run_id || null, status, consensus_verdict: consensus, verdict: status === 'blocked' ? 'NO_GO' : consensus, results };
}
