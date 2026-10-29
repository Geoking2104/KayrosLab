import { useState } from "react";
import { Link2, Plus, Trash2 } from "lucide-react";
import type { GraphSpec, GraphSpecNode, NodeType, StakeholderRole } from "@/lib/console/live";
import { VOTING, type Agent, type Collective, type Voting } from "@/lib/console/model";
import { Button, Field, controlClass } from "./ui";
import { NODE_TYPES } from "./ProjectGraph";
import { STAKEHOLDER_ROLES } from "@/lib/console/roles";
import { t, tc } from "@/lib/i18n";

/** Vrai si ajouter from → to crée une boucle. */
export function wouldLoop(spec: GraphSpec, from: string, to: string) {
  if (from === to) return true;
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of spec.edges) if (e.from === id) stack.push(e.to);
  }
  return false;
}

export function addNode(spec: GraphSpec, type: NodeType, linkFrom?: string): { spec: GraphSpec; id: string } {
  let i = 1;
  while (spec.nodes.some((n) => n.id === `${type}-${i}`)) i += 1;
  const id = `${type}-${i}`;
  const node: GraphSpecNode = { id, type, label: "", config: type === "porte" ? { threshold: "majority" } : type === "arbitrage" ? { role: "decideur" } : type === "notification" ? { role: "informe" } : {} };
  const edges = linkFrom && spec.nodes.some((n) => n.id === linkFrom) ? [...spec.edges, { from: linkFrom, to: id }] : spec.edges;
  return { spec: { nodes: [...spec.nodes, node], edges }, id };
}

export function GraphEditor({ spec, onChange, selected, onSelect, agents, collectives }: {
  spec: GraphSpec; onChange: (spec: GraphSpec) => void; selected: string; onSelect: (id: string) => void; agents: Agent[]; collectives: Collective[];
}) {
  const [type, setType] = useState<NodeType>("agent");
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const node = spec.nodes.find((n) => n.id === selected);
  const patchNode = (patch: Partial<GraphSpecNode>) => onChange({ ...spec, nodes: spec.nodes.map((n) => (n.id === selected ? { ...n, ...patch, config: { ...n.config, ...(patch.config ?? {}) } } : n)) });

  return (
    <div className="grid gap-3 rounded-xl border border-accent/40 bg-accent-soft/40 p-3" data-testid="graph-editor">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("Type de nœud")}>
          <select className={controlClass} value={type} onChange={(e) => setType(e.target.value as NodeType)}>
            {NODE_TYPES.map((x) => <option key={x.id} value={x.id}>{x.label()}</option>)}
          </select>
        </Field>
        <Button type="button" onClick={() => { const res = addNode(spec, type, selected || undefined); onChange(res.spec); onSelect(res.id); setError(""); }}>
          <Plus size={14} aria-hidden /> {selected ? t("Ajouter après le nœud choisi") : t("Ajouter un nœud")}
        </Button>
        <p className="text-xs text-muted">{t("Cliquez un nœud du graphe pour le configurer ou le relier.")}</p>
      </div>
      {node ? (
        <div className="grid gap-3 rounded-lg border border-line bg-surface p-3" data-testid="node-config">
          <p className="text-sm font-semibold">{t("Nœud {{v}}", { v: node.id })} · {NODE_TYPES.find((x) => x.id === node.type)?.label()}</p>
          <Field label={t("Libellé")}><input className={controlClass} value={node.label} onChange={(e) => patchNode({ label: e.target.value })} /></Field>
          {node.type === "collectif" ? (
            <Field label={t("Collectif")}>
              <select className={controlClass} value={node.config.session_id ?? ""} onChange={(e) => patchNode({ config: { session_id: e.target.value } })}>
                <option value="">—</option>
                {collectives.map((c) => <option key={c.id} value={c.id}>{tc(c.name)}</option>)}
              </select>
            </Field>
          ) : null}
          {node.type === "agent" ? (
            <Field label={t("Agent")}>
              <select className={controlClass} value={node.config.agent_id ?? ""} onChange={(e) => patchNode({ config: { agent_id: e.target.value } })}>
                <option value="">—</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{tc(a.name)}</option>)}
              </select>
            </Field>
          ) : null}
          {node.type === "porte" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("Règle de vote")}>
                <select className={controlClass} value={node.config.threshold ?? "majority"} onChange={(e) => patchNode({ config: { threshold: e.target.value as Voting } })}>
                  {VOTING.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </Field>
              <Field label={t("Seuil d’avis favorables (%)")}>
                <input type="number" min={0} max={100} className={controlClass} value={node.config.min_go ?? ""} onChange={(e) => patchNode({ config: { min_go: e.target.value === "" ? undefined : Math.max(0, Math.min(100, Number(e.target.value))) } })} />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" className="size-4" checked={Boolean(node.config.veto)} onChange={(e) => patchNode({ config: { veto: e.target.checked } })} />
                {t("Veto bloquant")}
              </label>
            </div>
          ) : null}
          {node.type === "arbitrage" || node.type === "notification" ? (
            <Field label={t("Rôle concerné")}>
              <select className={controlClass} value={node.config.role ?? (node.type === "arbitrage" ? "decideur" : "informe")} onChange={(e) => patchNode({ config: { role: e.target.value as StakeholderRole } })}>
                {STAKEHOLDER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </Field>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("Relier vers")}>
              <select className={controlClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">—</option>
                {spec.nodes.filter((n) => n.id !== node.id).map((n) => <option key={n.id} value={n.id}>{n.label || n.id}</option>)}
              </select>
            </Field>
            <Button type="button" variant="secondary" disabled={!target} onClick={() => {
              if (spec.edges.some((e) => e.from === node.id && e.to === target)) { setError(t("Ce lien existe déjà.")); return; }
              if (wouldLoop(spec, node.id, target)) { setError(t("Ce lien créerait une boucle.")); return; }
              onChange({ ...spec, edges: [...spec.edges, { from: node.id, to: target }] }); setTarget(""); setError("");
            }}><Link2 size={14} aria-hidden /> {t("Relier")}</Button>
          </div>
          {spec.edges.filter((e) => e.from === node.id || e.to === node.id).length ? (
            <ul className="grid gap-1 text-sm">
              {spec.edges.filter((e) => e.from === node.id || e.to === node.id).map((e) => (
                <li key={`${e.from}-${e.to}`} className="flex items-center gap-2">
                  <span className="flex-1">{e.from} → {e.to}</span>
                  <button type="button" className="rounded p-1 text-muted hover:text-stop" aria-label={t("Supprimer le lien {{v}}", { v: `${e.from} → ${e.to}` })} onClick={() => onChange({ ...spec, edges: spec.edges.filter((x) => x !== e) })}><Trash2 size={13} /></button>
                </li>
              ))}
            </ul>
          ) : null}
          <div>
            <Button type="button" variant="danger" onClick={() => { onChange({ nodes: spec.nodes.filter((n) => n.id !== node.id), edges: spec.edges.filter((e) => e.from !== node.id && e.to !== node.id) }); onSelect(""); }}>
              <Trash2 size={14} aria-hidden /> {t("Supprimer le nœud")}
            </Button>
          </div>
          {error ? <p className="text-xs text-stop" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
