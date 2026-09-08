import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { generateCollisions } from "@/lib/kayros/ai";
import { cn, uid } from "@/lib/utils";
import { currentIdea, useKayros } from "@/lib/kayros/store";
import type { Agent, VotingThreshold } from "@/lib/kayros/types";
import { Button } from "@/components/ui/button";
import { Field, InlineEdit, Kicker, Panel, Pill, t } from "./bits";

export function NoveltyView() {
  const locale = useKayros((s) => s.locale);
  const idea = useKayros(currentIdea);
  const applyCollisions = useKayros((s) => s.applyCollisions);
  const updateIdea = useKayros((s) => s.updateIdea);
  const flags = useKayros((s) => s.flags);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!idea) return null;

  async function grok() {
    setBusy(true);
    setErr("");
    try {
      const res = await generateCollisions({
        data: { title: idea.title, brief: idea.brief, constraints: idea.constraints },
      });
      if (!res.ok || !res.collisions.length) {
        setErr(res.error || t(locale, "Indisponible — moteur local utilisé", "Unavailable — local engine"));
        applyCollisions(idea.id, idea.collisions);
      } else {
        applyCollisions(
          idea.id,
          res.collisions.map((c) => ({
            id: uid("col"),
            framework: c.framework,
            mechanism: c.mechanism,
            proposal: c.proposal,
            bridge: c.bridge,
            signature: c.signature,
            novelty: 0,
            noveltyScore: 0,
            noveltyBreakdown: { batch: 0, memory: 0, input: 0 },
            nearDuplicate: false,
          })),
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Kicker>Bisociateur · 0.40 / 0.40 / 0.20</Kicker>
          <h1 className="font-display text-2xl">{t(locale, "Novelty & Signature", "Novelty & Signature")}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => applyCollisions(idea.id, idea.collisions)}>
            {t(locale, "Rescorer", "Rescore")}
          </Button>
          <Button disabled={busy} onClick={grok}>
            {busy ? "…" : t(locale, "Générer avec Grok", "Generate with Grok")}
          </Button>
        </div>
      </header>
      {err && <p className="text-sm text-warning">{err}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {idea.collisions.map((c, idx) => (
          <Panel key={c.id} className={c.nearDuplicate ? "opacity-60" : ""}>
            <div className="flex items-start justify-between gap-2">
              <Kicker>#{idx + 1}</Kicker>
              <Pill tone={c.nearDuplicate ? "warning" : "accent"}>{c.noveltyScore}</Pill>
            </div>
            <InlineEdit
              value={c.framework}
              onChange={(framework) => {
                const next = idea.collisions.map((x) => (x.id === c.id ? { ...x, framework } : x));
                updateIdea(idea.id, { collisions: next });
              }}
              className="mt-2 font-display text-lg"
            />
            <p className="text-xs text-muted">{c.mechanism}</p>
            <p className="mt-2 text-sm text-accent">{flags.kayrosSignature ? c.signature : c.bridge}</p>
            <InlineEdit
              value={c.proposal}
              onChange={(proposal) => {
                const next = idea.collisions.map((x) => (x.id === c.id ? { ...x, proposal } : x));
                updateIdea(idea.id, { collisions: next });
              }}
              multiline
              className="mt-2 text-sm"
            />
            <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-faint">
              <div>batch {c.noveltyBreakdown.batch}</div>
              <div>memory {c.noveltyBreakdown.memory}</div>
              <div>input {c.noveltyBreakdown.input}</div>
            </dl>
          </Panel>
        ))}
      </div>
    </div>
  );
}

export function PositionerView() {
  const locale = useKayros((s) => s.locale);
  const idea = useKayros(currentIdea);
  const updateIdea = useKayros((s) => s.updateIdea);
  if (!idea) return null;
  const { nodes, edges } = idea.ontology;

  return (
    <div className="grid gap-4">
      <header>
        <Kicker>Web · GitHub · GitLab · ArXiv · OWL</Kicker>
        <h1 className="font-display text-2xl">Positioner</h1>
      </header>
      <Panel className="overflow-hidden">
        <svg viewBox="0 0 100 100" className="h-[420px] w-full">
          {edges.map((e) => {
            const a = nodes.find((n) => n.id === e.from);
            const b = nodes.find((n) => n.id === e.to);
            if (!a || !b) return null;
            return (
              <line
                key={e.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--color-line)"
                strokeWidth="0.4"
              />
            );
          })}
          {nodes.map((n) => (
            <g key={n.id}>
              <circle
                cx={n.x}
                cy={n.y}
                r={n.kind === "idea" ? 4.2 : 2.4}
                fill={n.kind === "idea" ? "var(--color-accent)" : n.kind === "gap" ? "var(--color-warning)" : "var(--color-raised)"}
                stroke="var(--color-accent)"
                strokeWidth="0.4"
              />
              <text x={n.x} y={n.y + 6} textAnchor="middle" fontSize="3.2" fill="var(--color-muted)">
                {n.label.slice(0, 22)}
              </text>
            </g>
          ))}
        </svg>
      </Panel>
      <Panel>
        <Kicker>{t(locale, "Nœuds éditables", "Editable nodes")}</Kicker>
        <div className="mt-2 grid gap-2">
          {nodes.map((n) => (
            <div key={n.id} className="grid grid-cols-[80px_1fr] items-center gap-2 text-sm">
              <span className="text-[11px] text-faint">{n.kind}</span>
              <InlineEdit
                value={n.label}
                onChange={(label) =>
                  updateIdea(idea.id, {
                    ontology: { ...idea.ontology, nodes: nodes.map((x) => (x.id === n.id ? { ...x, label } : x)) },
                  })
                }
              />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export function SwarmView() {
  const locale = useKayros((s) => s.locale);
  const agents = useKayros((s) => s.agents);
  const swarms = useKayros((s) => s.swarms);
  const steps = useKayros((s) => s.steps);
  const idea = useKayros(currentIdea);
  const updateAgent = useKayros((s) => s.updateAgent);
  const addAgent = useKayros((s) => s.addAgent);
  const selected = useKayros((s) => s.selectedAgentId);
  const selectAgent = useKayros((s) => s.selectAgent);
  const runSwarm = useKayros((s) => s.runSwarm);
  const arbitrateSwarm = useKayros((s) => s.arbitrateSwarm);
  const toggleSwarmMember = useKayros((s) => s.toggleSwarmMember);
  const updateSwarm = useKayros((s) => s.updateSwarm);
  const [swarmId, setSwarmId] = useState(swarms[0]?.id ?? "");
  const [justification, setJustification] = useState("");
  const swarm = swarms.find((s) => s.id === swarmId) ?? swarms[0];
  const agent = agents.find((a) => a.id === selected) ?? agents.find((a) => a.id === swarm?.agentIds[0]) ?? agents[0];
  const threshold = swarm?.votingThreshold ?? "majority";

  const members: Agent[] = swarm
    ? orderedMembers(swarm.agentIds, swarm.id, steps, agents)
    : [];
  const unassigned = agents.filter((a) => swarm && !swarm.agentIds.includes(a.id));
  const depts = [...new Set(agents.map((a) => a.department))];
  const run = swarm?.lastRun;
  const pending = run?.status === "pending_human_arbitration";
  if (!swarm) return null;

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Kicker>{t(locale, "Registre · config · run · arbitrage", "Registry · config · run · arbitration")}</Kicker>
          <h1 className="font-display text-2xl">{t(locale, "Architecture des essaims", "Swarm architecture")}</h1>
          <p className="max-w-2xl text-sm text-muted">
            {t(
              locale,
              "Vote instruit, veto décide. Le consensus reste consultatif jusqu'à l'arbitrage humain.",
              "Vote instructs, veto decides. Consensus stays advisory until human arbitration.",
            )}
          </p>
        </div>
        <Button onClick={addAgent}>{t(locale, "Ajouter un agent", "Add agent")}</Button>
      </header>

      <ol className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {(
          [
            ["01", locale === "fr" ? "Tenant" : "Tenant"],
            ["02", locale === "fr" ? "Registre" : "Registry"],
            ["03", locale === "fr" ? "Configuration" : "Configuration"],
            ["04", locale === "fr" ? "Run gouverné" : "Governed run"],
            ["05", locale === "fr" ? "Arbitrage" : "Arbitration"],
          ] as const
        ).map(([n, label]) => (
          <li key={n} className="rounded-lg border border-line bg-surface px-3 py-2">
            <span className="font-mono text-micro text-accent">{n}</span>
            <p className="text-sm">{label}</p>
          </li>
        ))}
      </ol>

      <Panel>
        <Kicker>{t(locale, "Carte des départements", "Department map")}</Kicker>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {depts.map((dept) => {
            const group = agents.filter((a) => a.department === dept);
            return (
              <div key={dept} className="rounded-md border border-line bg-paper p-2">
                <p className="text-micro uppercase tracking-wider text-faint">{dept}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {group.map((a) => {
                    const inSwarm = swarm?.agentIds.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => selectAgent(a.id)}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-micro",
                          agent?.id === a.id ? "border-accent text-accent" : "border-line text-muted",
                          inSwarm && "bg-accent/10",
                        )}
                      >
                        {a.displayName}
                        {a.vetoPower ? " · veto" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {swarm && (
        <>
          <div className="flex flex-wrap gap-2">
            {swarms.map((s) => (
              <Button key={s.id} variant={s.id === swarm.id ? "default" : "secondary"} onClick={() => setSwarmId(s.id)}>
                {s.name}
                {s.lastVerdict ? ` · ${s.lastVerdict}` : ""}
              </Button>
            ))}
          </div>

          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <InlineEdit
                  value={swarm.name}
                  onChange={(name) => updateSwarm(swarm.id, { name })}
                  className="font-display text-xl"
                />
                <InlineEdit
                  value={swarm.purpose}
                  onChange={(purpose) => updateSwarm(swarm.id, { purpose })}
                  className="mt-1 text-sm"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={threshold}
                  onChange={(e) => updateSwarm(swarm.id, { votingThreshold: e.target.value as VotingThreshold })}
                  className="h-10 rounded-md border border-line bg-paper px-2 text-sm"
                  suppressHydrationWarning
                >
                  <option value="majority">majority</option>
                  <option value="unanimous">unanimous</option>
                  <option value="veto_power_csuite">veto_power_csuite</option>
                </select>
                <label className="flex h-10 items-center gap-2 rounded-md border border-line px-3 text-xs">
                  <input
                    type="checkbox"
                    checked={swarm.personalityEnabled}
                    onChange={(e) => updateSwarm(swarm.id, { personalityEnabled: e.target.checked })}
                    suppressHydrationWarning
                  />
                  SIMULATION
                </label>
                <Button onClick={() => runSwarm(swarm.id, idea?.title)}>{t(locale, "Exécuter", "Run")}</Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-stretch gap-2">
              {members.map((m, i) => {
                const cell = steps.find((s) => s.agentId === m.id);
                const orphan = swarm.id === "swarm-cycle" && !cell && m.id === "critic";
                return (
                  <div key={m.id} className="flex items-stretch gap-2">
                    {i > 0 && (
                      <span className="hidden self-center font-mono text-faint md:inline" aria-hidden>
                        →
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => selectAgent(m.id)}
                      className={cn(
                        "min-h-20 min-w-28 rounded-lg border bg-paper p-3 text-left",
                        agent?.id === m.id ? "border-accent" : "border-line",
                        m.vetoPower && "border-danger/50",
                      )}
                    >
                      <span className="font-mono text-micro text-accent">{cell?.n ?? (orphan ? "sat" : "—")}</span>
                      <strong className="mt-1 block text-sm">{m.displayName}</strong>
                      <span className="text-micro text-muted">
                        {m.role}
                        {m.vetoPower ? " · veto" : ""}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
            {swarm.id === "swarm-cycle" && (
              <p className="mt-3 text-xs text-faint">
                {t(
                  locale,
                  "Critic est satellite (Éprouver est tenu par Red Team). Projection et Tracker vivent dans Boucle KPI.",
                  "Critic is a satellite (Challenge is owned by Red Team). Projection and Tracker live in the KPI loop.",
                )}
              </p>
            )}
          </Panel>

          {run && (
            <Panel>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Kicker>
                    {run.labelled} · {run.threshold} · {run.status}
                  </Kicker>
                  <p className="font-display text-lg">{run.question}</p>
                  <p className="text-sm text-muted">{run.rationale}</p>
                </div>
                <Pill tone={run.verdict === "NO_GO" ? "danger" : run.verdict === "GO" ? "positive" : "warning"}>
                  {run.verdict}
                </Pill>
              </div>
              <ul className="mt-3 grid gap-2">
                {run.votes.map((v) => {
                  const a = agents.find((x) => x.id === v.agentId);
                  return (
                    <li key={v.agentId} className="flex items-start justify-between gap-3 border-b border-line py-2 text-sm last:border-0">
                      <span>
                        <strong>{a?.displayName ?? v.agentId}</strong>
                        <span className="block text-xs text-muted">{v.reason}</span>
                      </span>
                      <Pill tone={v.verdict === "NO_GO" ? "danger" : v.verdict === "GO" ? "positive" : "warning"}>
                        {v.verdict}
                        {run.vetoPath.includes(v.agentId) ? " · path" : ""}
                      </Pill>
                    </li>
                  );
                })}
              </ul>
              {pending && (
                <div className="mt-4 grid gap-2">
                  <textarea
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    placeholder={t(locale, "Justification (obligatoire pour outrepasse)", "Justification (required to override)")}
                    className="min-h-16 rounded-md border border-line bg-paper p-2 text-sm"
                    suppressHydrationWarning
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => arbitrateSwarm(swarm.id, "accept_consensus", justification)}>
                      {t(locale, "Accepter le consensus", "Accept consensus")}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!justification.trim()}
                      onClick={() => arbitrateSwarm(swarm.id, "override_veto", justification)}
                    >
                      {t(locale, "Outrepasser le veto", "Override veto")}
                    </Button>
                    <Button variant="ghost" onClick={() => arbitrateSwarm(swarm.id, "reevaluate", justification)}>
                      {t(locale, "Réévaluer", "Re-evaluate")}
                    </Button>
                  </div>
                </div>
              )}
              {run.human && (
                <p className="mt-3 text-xs text-faint">
                  {run.human.action} · {run.human.by}
                  {run.human.justification ? ` · ${run.human.justification}` : ""}
                </p>
              )}
            </Panel>
          )}
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="grid gap-2">
          <Kicker>{t(locale, "Membres", "Members")}</Kicker>
          {members.map((a) => (
            <article
              key={a.id}
              className={cn(
                "rounded-lg border p-3",
                agent?.id === a.id ? "border-accent bg-surface" : "border-line bg-paper",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="text-left" onClick={() => selectAgent(a.id)}>
                  <strong className="text-sm">{a.displayName}</strong>
                  <span className="block text-xs text-muted">
                    {a.role} · {a.provider}/{a.model} {a.quant}
                  </span>
                </button>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked
                    onChange={() => toggleSwarmMember(swarm.id, a.id)}
                    suppressHydrationWarning
                  />
                  in
                </label>
              </div>
            </article>
          ))}
          {unassigned.length > 0 && (
            <>
              <Kicker>{t(locale, "Hors essaim", "Outside swarm")}</Kicker>
              {unassigned.map((a) => (
                <article key={a.id} className="rounded-lg border border-line bg-paper p-3">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" className="text-left" onClick={() => selectAgent(a.id)}>
                      <strong className="text-sm">{a.displayName}</strong>
                      <span className="block text-xs text-muted">{a.role}</span>
                    </button>
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => toggleSwarmMember(swarm.id, a.id)}
                        suppressHydrationWarning
                      />
                      in
                    </label>
                  </div>
                </article>
              ))}
            </>
          )}
        </div>

        {agent && (
          <Panel>
            <Kicker>
              {agent.id} · {agent.kind === "system" ? "system_predefined" : agent.kind === "hybrid" ? "hybrid_modified" : "user_defined"}
            </Kicker>
            <InlineEdit
              value={agent.displayName}
              onChange={(displayName) => updateAgent(agent.id, { displayName })}
              className="font-display text-xl"
            />
            <div className="mt-3 grid gap-2">
              <Field label="Mission">
                <InlineEdit value={agent.mission} onChange={(mission) => updateAgent(agent.id, { mission })} multiline />
              </Field>
              <Field label={t(locale, "Instructions", "Instructions")}>
                <InlineEdit
                  value={agent.instructions}
                  onChange={(instructions) => updateAgent(agent.id, { instructions })}
                  multiline
                />
              </Field>
              <Field label={t(locale, "Règles effectives · une par ligne", "Effective rules")}>
                <InlineEdit
                  value={agent.rules.join("\n")}
                  onChange={(v) => updateAgent(agent.id, { rules: v.split("\n").filter(Boolean) })}
                  multiline
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="provider">
                  <InlineEdit value={agent.provider} onChange={(provider) => updateAgent(agent.id, { provider })} />
                </Field>
                <Field label="model / quant">
                  <InlineEdit
                    value={`${agent.model} ${agent.quant}`.trim()}
                    onChange={(v) => {
                      const [model, ...rest] = v.split(" ");
                      updateAgent(agent.id, { model, quant: rest.join(" ") });
                    }}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={agent.enabled}
                  onChange={(e) => updateAgent(agent.id, { enabled: e.target.checked })}
                  suppressHydrationWarning
                />
                enabled
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={agent.vetoPower}
                  onChange={(e) => updateAgent(agent.id, { vetoPower: e.target.checked })}
                  suppressHydrationWarning
                />
                veto
              </label>
              {agent.kind === "hybrid" && (
                <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                  {t(
                    locale,
                    "Profil consenti · pas d'usage RH, crédit, logement. Provenance : ",
                    "Consented profile · not for hiring/credit/housing. Provenance: ",
                  )}
                  {agent.personality?.provenance}
                  {agent.personality?.disc ? ` · DISC ${agent.personality.disc}` : ""}
                </p>
              )}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function orderedMembers(ids: string[], swarmId: string, steps: { agentId: string }[], agents: Agent[]): Agent[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  if (swarmId === "swarm-cycle") {
    const fromSteps = steps
      .map((s) => byId.get(s.agentId))
      .filter((a): a is Agent => a !== undefined && ids.includes(a.id));
    const extra = ids
      .map((id) => byId.get(id))
      .filter((a): a is Agent => a !== undefined && !fromSteps.some((m) => m.id === a.id));
    return [...fromSteps, ...extra];
  }
  return ids.map((id) => byId.get(id)).filter((a): a is Agent => a !== undefined);
}

export function OracleView() {
  const locale = useKayros((s) => s.locale);
  const cases = useKayros((s) => s.oracleCases);
  const agents = useKayros((s) => s.agents);
  const runOracleCase = useKayros((s) => s.runOracleCase);

  return (
    <div className="grid gap-4">
      <header>
        <Kicker>SIMULATION</Kicker>
        <h1 className="font-display text-2xl">Sales Oracle</h1>
        <p className="text-sm text-muted">
          {t(
            locale,
            "Révéler veto path, objections et conditions avant l'envoi réel.",
            "Reveal veto paths, objections and conditions before the real send.",
          )}
        </p>
      </header>
      {cases.map((c) => (
        <Panel key={c.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <Kicker>{c.useCase}</Kicker>
              <h2 className="font-display text-lg">{c.name}</h2>
              <p className="text-sm text-muted">{c.question}</p>
            </div>
            <Button onClick={() => runOracleCase(c.id)}>{t(locale, "Révéler", "Rehearse")}</Button>
          </div>
          <p className="mt-2 text-xs text-faint">
            {c.committee.map((m) => agents.find((a) => a.id === m.agentId)?.displayName ?? m.agentId).join(" · ")}
          </p>
          {c.result && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Pill tone={c.result.verdict === "NO_GO" ? "danger" : c.result.verdict === "GO" ? "positive" : "warning"}>
                {c.result.verdict} · {c.result.labelled}
              </Pill>
              <ul className="grid gap-1 text-sm">
                {c.result.objections.map((o) => (
                  <li key={o}>· {o}</li>
                ))}
              </ul>
              <div>
                <Kicker>Evidence gaps</Kicker>
                <ul className="mt-1 text-sm text-muted">
                  {c.result.evidenceGaps.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
              <div>
                <Kicker>Conditions</Kicker>
                <ul className="mt-1 text-sm text-muted">
                  {c.result.conditions.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}

export function ForecastView() {
  const locale = useKayros((s) => s.locale);
  const idea = useKayros(currentIdea);
  if (!idea) return null;
  const f = idea.forecast;
  const data = f.p50.map((p50, i) => ({
    t: `+${i + 1}`,
    p10: f.p10[i],
    p50,
    p90: f.p90[i],
    actual: f.actuals[i],
  }));

  return (
    <div className="grid gap-4">
      <header className="flex items-end justify-between">
        <div>
          <Kicker>TimesFM 2.5 · {f.labelled}</Kicker>
          <h1 className="font-display text-2xl">{t(locale, "Prévision KPI", "KPI forecast")}</h1>
          <p className="text-sm text-muted">
            {t(locale, "Baseline déterministe. Bandes P10–P90 optionnelles.", "Deterministic baseline. Optional P10–P90 bands.")}
          </p>
        </div>
        <Pill tone={f.needsReview ? "warning" : "positive"}>
          σ {f.uncertaintyRatio}
          {f.needsReview ? " · review" : ""}
        </Pill>
      </header>
      <Panel className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="t" stroke="var(--color-muted)" fontSize={11} />
            <YAxis stroke="var(--color-muted)" fontSize={11} />
            <Tooltip
              contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", color: "var(--color-ink)" }}
            />
            <Area type="monotone" dataKey="p90" stroke="none" fill="var(--color-accent)" fillOpacity={0.08} />
            <Area type="monotone" dataKey="p10" stroke="none" fill="var(--color-paper)" fillOpacity={1} />
            <Line type="monotone" dataKey="p50" stroke="var(--color-accent)" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="actual" stroke="var(--color-positive)" dot={false} strokeDasharray="4 4" />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}
