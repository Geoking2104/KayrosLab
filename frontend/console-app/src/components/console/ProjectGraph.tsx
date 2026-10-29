import { useMemo } from "react";
import { CYCLE, STATUS_LABEL, VERDICT_LABEL, VOTING, type Agent, type Collective, type Thread, type Verdict } from "@/lib/console/model";
import type { GraphSpec, GraphSpecNode, NodeType, Stakeholder } from "@/lib/console/live";
import { cn } from "@/lib/cn";
import { t, tc } from "@/lib/i18n";

// Graphe de projet en lecture seule, façon n8n : chaque nœud est une étape du
// moteur (question, collectif, agents, porte de consensus, arbitrage, décision)
// et affiche son statut en direct à partir du dossier.

type Tone = "done" | "live" | "wait" | "stop" | "idle";
export type GraphNode = { id: string; col: number; row: number; kind: string; title: string; detail: string; tone: Tone; badge?: string };
export type GraphEdge = { from: string; to: string };

const W = 190, H = 78, GX = 70, GY = 22;
const TONE: Record<Tone, string> = {
  done: "border-go bg-go-soft",
  live: "border-accent bg-accent-soft animate-pulse",
  wait: "border-hold bg-hold-soft",
  stop: "border-stop bg-stop-soft",
  idle: "border-line bg-surface",
};
const verdictTone = (v?: Verdict): Tone => (v === "GO" ? "done" : v === "NO_GO" ? "stop" : v ? "wait" : "idle");

export function buildGraph(thread: Thread | undefined, collective: Collective | undefined, agents: Agent[], stakeholders: Stakeholder[]) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const status = thread?.status;
  const running = status === "running";
  nodes.push({ id: "question", col: 0, row: 0, kind: t("Question"), title: thread ? thread.question.slice(0, 70) : t("Aucun dossier"), detail: thread ? STATUS_LABEL[thread.status] : t("Lancez une mission sur un collectif du projet."), tone: !thread ? "idle" : status === "needs_clarification" ? "wait" : "done" });
  nodes.push({ id: "collective", col: 1, row: 0, kind: t("Collectif"), title: tc(collective?.name) || t("Collectif"), detail: t("{{n}} agents · {{v}}", { n: collective?.agentIds.length ?? 0, v: VOTING.find((x) => x.id === collective?.voting)?.label ?? "" }), tone: thread ? (running ? "live" : "done") : "idle" });
  edges.push({ from: "question", to: "collective" });
  const ids = thread?.agentIds.length ? thread.agentIds : collective?.agentIds ?? [];
  ids.forEach((id, row) => {
    const agent = agents.find((a) => a.id === id);
    const c = thread?.contributions.find((x) => x.agentId === id);
    nodes.push({ id: `agent:${id}`, col: 2, row, kind: agent?.veto ? t("Agent · veto") : t("Agent"), title: tc(agent?.name) || id, detail: c ? (c.objections[0] || c.strengths[0] || "") : running ? t("Analyse en cours") : t("En attente"), tone: c ? verdictTone(c.verdict) : running ? "live" : "idle", badge: c ? VERDICT_LABEL[c.verdict] : undefined });
    edges.push({ from: "collective", to: `agent:${id}` });
    edges.push({ from: `agent:${id}`, to: "gate" });
  });
  const gateRow = Math.max(0, Math.floor((ids.length - 1) / 2));
  const vetoed = thread?.contributions.some((c) => c.verdict === "NO_GO" && agents.find((a) => a.id === c.agentId)?.veto);
  nodes.push({ id: "gate", col: 3, row: gateRow, kind: t("Porte de consensus"), title: VOTING.find((x) => x.id === collective?.voting)?.label ?? t("Majorité"), detail: vetoed ? t("Veto exercé") : thread?.verdict ? t("Verdict {{v}}", { v: VERDICT_LABEL[thread.verdict] }) : t("En attente des avis"), tone: vetoed ? "stop" : thread?.verdict ? verdictTone(thread.verdict) : running ? "live" : "idle", badge: thread?.verdict ? VERDICT_LABEL[thread.verdict] : undefined });
  const deciders = stakeholders.filter((s) => s.role === "decideur").map((s) => s.name);
  nodes.push({ id: "arbitration", col: 4, row: gateRow, kind: t("Arbitrage humain"), title: deciders.join(", ") || t("Décideur à désigner"), detail: thread?.arbitration ? t("Arbitré par {{v}}", { v: thread.arbitration.by || "—" }) : status === "awaiting_arbitration" ? t("À arbitrer") : t("En attente"), tone: thread?.arbitration ? "done" : status === "awaiting_arbitration" ? "wait" : "idle" });
  edges.push({ from: "gate", to: "arbitration" });
  const informed = stakeholders.filter((s) => s.role !== "decideur").length;
  nodes.push({ id: "decision", col: 5, row: gateRow, kind: t("Décision"), title: status === "resolved" ? t("Décision inscrite") : t("Non décidé"), detail: t("{{n}} parties prenantes informées ou consultées", { n: informed }), tone: status === "resolved" ? "done" : status === "failed" ? "stop" : "idle" });
  edges.push({ from: "arbitration", to: "decision" });
  return { nodes, edges };
}


export const NODE_TYPES: { id: NodeType; label: () => string }[] = [
  { id: "question", label: () => t("Question") },
  { id: "collectif", label: () => t("Collectif") },
  { id: "agent", label: () => t("Agent") },
  { id: "porte", label: () => t("Porte de consensus") },
  { id: "arbitrage", label: () => t("Arbitrage humain") },
  { id: "notification", label: () => t("Notification") },
  { id: "decision", label: () => t("Décision") },
];

/** Graphe par défaut d’un projet, modifiable ensuite. */
export function defaultSpec(collective: Collective | undefined): GraphSpec {
  const agents = collective?.agentIds ?? [];
  const nodes: GraphSpecNode[] = [
    { id: "question", type: "question", label: "", config: {} },
    { id: "collectif", type: "collectif", label: "", config: { session_id: collective?.id } },
    ...agents.map((id) => ({ id: `agent-${id}`, type: "agent" as const, label: "", config: { agent_id: id } })),
    { id: "porte", type: "porte", label: "", config: { threshold: collective?.voting ?? "majority" } },
    { id: "arbitrage", type: "arbitrage", label: "", config: { role: "decideur" } },
    { id: "notification", type: "notification", label: "", config: { role: "informe" } },
    { id: "decision", type: "decision", label: "", config: {} },
  ];
  const edges = [
    { from: "question", to: "collectif" },
    ...(agents.length ? agents.flatMap((id) => [{ from: "collectif", to: `agent-${id}` }, { from: `agent-${id}`, to: "porte" }]) : [{ from: "collectif", to: "porte" }]),
    { from: "porte", to: "arbitrage" }, { from: "arbitrage", to: "decision" }, { from: "arbitrage", to: "notification" },
  ];
  return { nodes, edges };
}

/** Place les nœuds d’un graphe libre (colonne = plus long chemin) et y projette le statut en direct. */
export function layoutSpec(spec: GraphSpec, thread: Thread | undefined, collective: Collective | undefined, agents: Agent[], stakeholders: Stakeholder[]) {
  const live = buildGraph(thread, collective, agents, stakeholders).nodes;
  const byId = (id: string) => live.find((n) => n.id === id);
  const col = new Map<string, number>();
  const depth = (id: string, seen = new Set<string>()): number => {
    if (col.has(id)) return col.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = spec.edges.filter((e) => e.to === id).map((e) => e.from);
    const d = parents.length ? Math.max(...parents.map((p) => depth(p, seen) + 1)) : 0;
    col.set(id, d);
    return d;
  };
  const rows = new Map<number, number>();
  const nodes: GraphNode[] = spec.nodes.map((n) => {
    const c = depth(n.id);
    const row = rows.get(c) ?? 0;
    rows.set(c, row + 1);
    const base = n.type === "question" ? byId("question") : n.type === "collectif" ? byId("collective")
      : n.type === "agent" ? byId(`agent:${n.config.agent_id}`) : n.type === "porte" ? byId("gate")
      : n.type === "arbitrage" ? byId("arbitration") : n.type === "decision" ? byId("decision") : undefined;
    const kind = NODE_TYPES.find((x) => x.id === n.type)?.label() ?? n.type;
    let { title = n.label || kind, detail = "", tone = "idle" as Tone, badge } = base ?? {};
    if (n.type === "agent" && !base) { const a = agents.find((x) => x.id === n.config.agent_id); title = tc(a?.name) || n.config.agent_id || t("Agent à choisir"); detail = t("Hors collectif du dossier"); }
    if (n.type === "porte") {
      const rule = VOTING.find((x) => x.id === n.config.threshold)?.label ?? t("Majorité");
      title = rule;
      if (n.config.min_go != null && thread?.contributions.length) {
        const share = Math.round((thread.contributions.filter((x) => x.verdict !== "NO_GO").length / thread.contributions.length) * 100);
        detail = t("{{s}} % favorables · seuil {{m}} %", { s: share, m: n.config.min_go });
        tone = share >= n.config.min_go ? tone : "stop";
      } else if (n.config.min_go != null) detail = t("Seuil {{m}} % d’avis favorables", { m: n.config.min_go });
      if (n.config.veto) detail = `${detail ? `${detail} · ` : ""}${t("veto actif")}`;
    }
    if (n.type === "arbitrage" && n.config.role && n.config.role !== "decideur") {
      title = stakeholders.filter((s) => s.role === n.config.role).map((s) => s.name).join(", ") || t("Personne désignée");
    }
    if (n.type === "notification") {
      const people = stakeholders.filter((s) => s.role === (n.config.role ?? "informe"));
      title = people.map((s) => s.name).join(", ") || t("Aucun informé");
      detail = t("{{n}} destinataires e-mail", { n: people.filter((s) => s.email).length });
      tone = thread?.status === "resolved" && people.length ? "done" : "idle";
    }
    if (n.label) title = n.label;
    return { id: n.id, col: c, row, kind, title, detail, tone, badge };
  });
  return { nodes, edges: spec.edges };
}

export function ProjectGraph({ thread, collective, agents, stakeholders, spec, selected, onSelect }: { thread?: Thread; collective?: Collective; agents: Agent[]; stakeholders: Stakeholder[]; spec?: GraphSpec | null; selected?: string; onSelect?: (id: string) => void }) {
  const { nodes, edges } = useMemo(() => (spec ? layoutSpec(spec, thread, collective, agents, stakeholders) : buildGraph(thread, collective, agents, stakeholders)), [spec, thread, collective, agents, stakeholders]);
  const pos = (n: GraphNode) => ({ x: 16 + n.col * (W + GX), y: 16 + n.row * (H + GY) });
  const cols = Math.max(1, ...nodes.map((n) => n.col + 1));
  const width = 32 + cols * W + (cols - 1) * GX;
  const height = 32 + Math.max(1, ...nodes.map((n) => n.row + 1)) * (H + GY);
  const stage = thread?.stage;
  return (
    <div className="grid gap-3" data-testid="project-graph">
      <ol className="flex flex-wrap gap-1" aria-label={t("Cycle de décision")}>
        {CYCLE.map((step) => {
          const index = CYCLE.findIndex((s) => s.id === stage);
          const mine = CYCLE.findIndex((s) => s.id === step.id);
          return (
            <li key={step.id} className={cn("rounded-full border px-2.5 py-1 text-[11px]", step.id === stage ? "border-accent bg-accent-soft font-semibold" : mine < index ? "border-go text-go" : "border-line text-muted")} aria-current={step.id === stage ? "step" : undefined}>
              {step.label}
            </li>
          );
        })}
      </ol>
      <div className="overflow-x-auto rounded-xl border border-line bg-paper" style={{ backgroundImage: "radial-gradient(circle, rgba(0,0,0,.08) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
        <div className="relative" style={{ width, height }}>
          <svg className="absolute inset-0" width={width} height={height} aria-hidden="true">
            {edges.map((e) => {
              const a = nodes.find((n) => n.id === e.from), b = nodes.find((n) => n.id === e.to);
              if (!a || !b) return null;
              const p = pos(a), q = pos(b);
              const x1 = p.x + W, y1 = p.y + H / 2, x2 = q.x, y2 = q.y + H / 2, mid = (x1 + x2) / 2;
              return <path key={`${e.from}-${e.to}`} d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`} fill="none" stroke="currentColor" className="text-line" strokeWidth={2} />;
            })}
          </svg>
          {nodes.map((n) => {
            const p = pos(n);
            return (
              <div key={n.id} data-node={n.id} data-tone={n.tone} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} aria-pressed={onSelect ? selected === n.id : undefined}
                onClick={onSelect ? () => onSelect(n.id) : undefined} onKeyDown={onSelect ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(n.id); } } : undefined}
                className={cn("absolute flex flex-col rounded-lg border-2 px-2.5 py-1.5 shadow-sm", TONE[n.tone], onSelect && "cursor-pointer", selected === n.id && "ring-2 ring-accent ring-offset-2")} style={{ left: p.x, top: p.y, width: W, height: H }}>
                <span className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted">
                  {n.kind}
                  {n.badge ? <span className="rounded bg-white/70 px-1 font-semibold normal-case text-ink">{n.badge}</span> : null}
                </span>
                <span className="truncate text-sm font-medium" title={n.title}>{n.title}</span>
                <span className="line-clamp-2 text-[11px] text-ink-soft" title={n.detail}>{n.detail}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
