// Enchaînement de collectifs le long du graphe d'un projet : chaque nœud
// « collectif » lié à une session devient une étape ; à la fin d'une mission,
// les portes situées entre cette étape et la suivante décident si la mission
// suivante démarre (avec le verdict précédent en contexte) ou si l'enchaînement
// attend un arbitrage humain.
import { evaluateGate } from './project-gates.mjs';

/** Ordre topologique des nœuds (le graphe est validé sans boucle). */
export function topoOrder(graph) {
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) if (indegree.has(e.to)) indegree.set(e.to, indegree.get(e.to) + 1);
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift(); order.push(id);
    for (const e of edges.filter((x) => x.from === id)) {
      indegree.set(e.to, indegree.get(e.to) - 1);
      if (indegree.get(e.to) === 0) queue.push(e.to);
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return order.map((id) => byId.get(id)).filter(Boolean);
}

/** Étapes : nœuds collectif liés à une session, dans l'ordre du graphe. */
export function pipelineSteps(graph) {
  return topoOrder(graph).filter((n) => n.type === 'collectif' && n.config?.session_id);
}

/**
 * Agents du graphe rattachés à un collectif (lien agent → collectif ou
 * collectif → agent) : `add` les ajoute à la session, `remove` (option
 * « exclure ») les retire de la session du collectif.
 */
export function agentNodesFor(graph, collectifId) {
  const nodes = new Map((graph?.nodes || []).map((n) => [n.id, n]));
  const add = []; const remove = [];
  for (const e of graph?.edges || []) {
    const other = e.to === collectifId ? nodes.get(e.from) : e.from === collectifId ? nodes.get(e.to) : null;
    if (other?.type !== 'agent' || !other.config?.agent_id) continue;
    (other.config.exclude ? remove : add).push(other.config.agent_id);
  }
  return { add: [...new Set(add)], remove: [...new Set(remove)] };
}

/** Portes atteintes depuis un nœud sans traverser un autre collectif (la porte « de sortie » de l'étape). */
export function gatesAfter(graph, nodeId) {
  const nodes = new Map((graph?.nodes || []).map((n) => [n.id, n]));
  const seen = new Set(); const gates = [];
  const stack = (graph?.edges || []).filter((e) => e.from === nodeId).map((e) => e.to);
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue; seen.add(id);
    const node = nodes.get(id);
    if (!node || node.type === 'collectif') continue;
    if (node.type === 'porte') gates.push(node);
    for (const e of graph.edges.filter((x) => x.from === id)) stack.push(e.to);
  }
  return gates;
}

export function lastRun(thread) {
  const runs = (thread?.messages || []).filter((m) => m.run);
  return runs.length ? runs[runs.length - 1].run : null;
}

/** Décision de passage après une étape terminée : { status: passed|blocked, results }. */
export function stepOutcome(graph, nodeId, thread) {
  const run = lastRun(thread);
  const results = gatesAfter(graph, nodeId).map((g) => evaluateGate(g, run?.analyses || []));
  return { status: results.some((r) => r.status === 'blocked') ? 'blocked' : 'passed', results, verdict: run?.consensus?.verdict || null, rationale: run?.consensus?.rationale || '' };
}

/** Contexte transmis à l'étape suivante : verdicts des étapes précédentes. */
export function chainContext(pipeline, project) {
  const done = pipeline.steps.filter((s) => s.status === 'completed' || s.status === 'overridden');
  const lines = done.map((s, i) => `Étape ${i + 1} « ${s.label || s.session_id} » : verdict ${s.verdict || 'inconnu'}${s.rationale ? ` — ${String(s.rationale).slice(0, 1500)}` : ''}${s.status === 'overridden' ? ' (porte levée par arbitrage humain)' : ''}`);
  return [`Enchaînement du projet « ${project?.name || pipeline.project_id} » (${pipeline.steps.length} collectifs).`, ...lines].join('\n');
}
