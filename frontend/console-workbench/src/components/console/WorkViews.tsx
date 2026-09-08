import { useState } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";
import { currentIdea, useKayros } from "@/lib/kayros/store";
import { Button } from "@/components/ui/button";
import { InlineEdit, Kicker, Panel, Pill, t } from "./bits";

export function CycleView() {
  const locale = useKayros((s) => s.locale);
  const cycle = useKayros((s) => s.cycle);
  const steps = useKayros((s) => s.steps);
  const startCycle = useKayros((s) => s.startCycle);
  const advanceCycle = useKayros((s) => s.advanceCycle);
  const resetCycle = useKayros((s) => s.resetCycle);
  const setView = useKayros((s) => s.setView);

  function onRun() {
    if (cycle?.status === "running") {
      advanceCycle();
      return;
    }
    if (cycle?.status === "gated") {
      setView("inbox");
      return;
    }
    if (cycle?.status === "done") {
      setView("result");
      return;
    }
    startCycle();
  }

  const runLabel =
    cycle?.status === "running"
      ? t(locale, "Étape suivante", "Next step")
      : cycle?.status === "gated"
        ? t(locale, "Ouvrir la porte", "Open gate")
        : cycle?.status === "done"
          ? t(locale, "Voir le résultat", "See result")
          : t(locale, "Lancer", "Run");

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Kicker>SSE · live cycle</Kicker>
          <h1 className="font-display text-2xl">{t(locale, "Fil d'événements", "Event stream")}</h1>
          <p className="text-sm text-muted">
            meta → start → recall → positionning → trace → distill → synthesis → gate → final → done
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={resetCycle}>
            {t(locale, "Rejouer", "Reset")}
          </Button>
          <Button onClick={onRun}>{runLabel}</Button>
        </div>
      </header>
      <div className="flex flex-wrap gap-1">
        {steps.map((s) => (
          <Pill key={s.id} tone={cycle?.currentStage === s.id ? "accent" : "muted"}>
            {s.n} {locale === "fr" ? s.fr : s.en}
          </Pill>
        ))}
      </div>
      <Panel>
        <ol className="grid gap-2">
          {(cycle?.events ?? []).length === 0 && (
            <p className="text-sm text-muted">{t(locale, "Aucun run. Lancez le cycle.", "No run yet.")}</p>
          )}
          {(cycle?.events ?? []).map((ev) => (
            <li key={ev.id} className="grid grid-cols-[72px_1fr] gap-3 border-b border-line py-2 text-sm last:border-0">
              <span className="font-mono text-micro text-accent">{ev.type}</span>
              <span>
                {ev.text}
                {ev.agent ? <span className="text-muted"> · {ev.agent}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}

export function PortfolioView() {
  const locale = useKayros((s) => s.locale);
  const ideas = useKayros((s) => s.ideas);
  const selectIdea = useKayros((s) => s.selectIdea);
  const addIdea = useKayros((s) => s.addIdea);
  const reactivate = useKayros((s) => s.reactivate);
  const setView = useKayros((s) => s.setView);
  const cols = [
    "nouveau",
    "en_revue",
    "en_developpement",
    "termine",
    "en_pause",
    "non_poursuivi",
  ] as const;

  return (
    <div className="grid gap-4">
      <header className="flex items-end justify-between">
        <div>
          <Kicker>Kanban</Kicker>
          <h1 className="font-display text-2xl">Portfolio</h1>
        </div>
        <Button onClick={addIdea}>{t(locale, "Nouvelle idée", "New idea")}</Button>
      </header>
      <div className="grid auto-cols-[minmax(200px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
        {cols.map((col) => (
          <div key={col} className="min-w-[200px] rounded-xl border border-line bg-surface p-2">
            <p className="px-1 pb-2 text-micro uppercase tracking-wider text-faint">{col}</p>
            <div className="grid gap-2">
              {ideas
                .filter((i) => i.status === col)
                .map((idea) => (
                  <article
                    key={idea.id}
                    className="rounded-lg border border-line bg-paper p-3 text-left hover:border-accent/50"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        selectIdea(idea.id);
                        setView("board");
                      }}
                      className="block w-full text-left"
                    >
                      <strong className="block text-sm">{idea.title}</strong>
                      <span className="text-micro text-muted">
                        {idea.stage} · KI {idea.ki.global.toFixed(1)}
                      </span>
                    </button>
                    {idea.dormant && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-2"
                        onClick={() => reactivate(idea.id)}
                      >
                        {t(locale, "Réactiver", "Reactivate")}
                      </Button>
                    )}
                  </article>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MemoryView() {
  const locale = useKayros((s) => s.locale);
  const memory = useKayros((s) => s.memory);
  const updateFact = useKayros((s) => s.updateFact);
  const addFact = useKayros((s) => s.addFact);
  const promoteFact = useKayros((s) => s.promoteFact);
  const removeFact = useKayros((s) => s.removeFact);
  const layers = ["L0", "L1", "L2", "L3"] as const;

  return (
    <div className="grid gap-4">
      <header>
        <Kicker>{t(locale, "Mémoire stratifiée", "Layered memory")}</Kicker>
        <h1 className="font-display text-2xl">L0 → L3</h1>
      </header>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {layers.map((layer) => (
          <Panel key={layer}>
            <div className="mb-3 flex items-center justify-between">
              <Kicker>{layer}</Kicker>
              <Button size="sm" variant="ghost" onClick={() => addFact(layer, t(locale, "Nouveau fait", "New fact"))}>
                +
              </Button>
            </div>
            <div className="grid gap-2">
              {memory
                .filter((m) => m.layer === layer)
                .map((m) => (
                  <article key={m.id} className="rounded-md border border-line bg-paper p-2">
                    <InlineEdit value={m.text} onChange={(v) => updateFact(m.id, v)} multiline />
                    <div className="mt-2 flex justify-between text-micro text-faint">
                      <span>{m.source}</span>
                      <span className="flex gap-2">
                        <button type="button" className="text-accent" onClick={() => promoteFact(m.id)}>
                          {t(locale, "promouvoir", "promote")}
                        </button>
                        <button type="button" className="text-danger" onClick={() => removeFact(m.id)}>
                          {t(locale, "ôter", "remove")}
                        </button>
                      </span>
                    </div>
                  </article>
                ))}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

export function GovernanceView() {
  const locale = useKayros((s) => s.locale);
  const gates = useKayros((s) => s.gates);
  const ideas = useKayros((s) => s.ideas);
  const agents = useKayros((s) => s.agents);
  const resolveGate = useKayros((s) => s.resolveGate);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  function decide(id: string, decision: "approve" | "reject" | "revise") {
    const reason = (reasons[id] ?? "").trim();
    if (!reason) {
      toast.error(t(locale, "Motif obligatoire pour trancher.", "A reason is required to decide."));
      return;
    }
    resolveGate(id, decision, reason);
  }

  return (
    <div className="grid gap-4">
      <header>
        <Kicker>{t(locale, "Vote instruit · veto décide", "Vote instructs · veto decides")}</Kicker>
        <h1 className="font-display text-2xl">{t(locale, "Portes humaines", "Human gates")}</h1>
      </header>
      {gates.length === 0 && (
        <Panel>
          <p className="text-sm text-muted">
            {t(locale, "Aucune porte. Lancez un cycle jusqu'à Arbitrer.", "No gate yet. Run a cycle to Decide.")}
          </p>
        </Panel>
      )}
      {gates.map((gate) => {
        const idea = ideas.find((i) => i.id === gate.ideaId);
        return (
          <Panel key={gate.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Kicker>{gate.id}</Kicker>
                <h2 className="font-display text-lg">{idea?.title}</h2>
              </div>
              <Pill tone={gate.status === "open" ? "warning" : "positive"}>{gate.status}</Pill>
            </div>
            <ul className="mt-3 grid gap-2">
              {gate.votes.map((v) => {
                const agent = agents.find((a) => a.id === v.agentId);
                return (
                  <li key={v.agentId} className="flex items-start justify-between gap-3 border-b border-line py-2 text-sm">
                    <span>
                      <strong>{agent?.displayName ?? v.agentId}</strong>
                      <span className="block text-xs text-muted">{v.reason}</span>
                    </span>
                    <Pill tone={v.verdict === "NO_GO" ? "danger" : v.verdict === "GO" ? "positive" : "warning"}>
                      {v.verdict} · w{v.weight}
                    </Pill>
                  </li>
                );
              })}
            </ul>
            {gate.status === "open" && (
              <div className="mt-4 grid gap-2">
                <textarea
                  value={reasons[gate.id] ?? ""}
                  onChange={(e) => setReasons((r) => ({ ...r, [gate.id]: e.target.value }))}
                  placeholder={t(locale, "Motif obligatoire", "Reason required")}
                  className="min-h-16 rounded-md border border-line bg-paper p-2 text-sm"
                />
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!(reasons[gate.id] ?? "").trim()} onClick={() => decide(gate.id, "approve")}>
                    Approve
                  </Button>
                  <Button variant="secondary" disabled={!(reasons[gate.id] ?? "").trim()} onClick={() => decide(gate.id, "revise")}>
                    Revise
                  </Button>
                  <Button variant="danger" disabled={!(reasons[gate.id] ?? "").trim()} onClick={() => decide(gate.id, "reject")}>
                    Reject
                  </Button>
                </div>
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

export function InboxView() {
  const locale = useKayros((s) => s.locale);
  const gates = useKayros((s) => s.gates);
  const ideas = useKayros((s) => s.ideas);
  const agents = useKayros((s) => s.agents);
  const swarms = useKayros((s) => s.swarms);
  const resolveGate = useKayros((s) => s.resolveGate);
  const arbitrateSwarm = useKayros((s) => s.arbitrateSwarm);
  const setView = useKayros((s) => s.setView);
  const selectIdea = useKayros((s) => s.selectIdea);
  const startCycle = useKayros((s) => s.startCycle);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const openGates = gates.filter((g) => g.status === "open");
  const pendingSwarms = swarms.filter((s) => s.lastRun?.status === "pending_human_arbitration");
  const empty = openGates.length === 0 && pendingSwarms.length === 0;

  function decide(id: string, decision: "approve" | "reject" | "revise") {
    const reason = (reasons[id] ?? "").trim();
    if (!reason) {
      toast.error(t(locale, "Motif obligatoire pour trancher.", "A reason is required to decide."));
      return;
    }
    resolveGate(id, decision, reason);
  }

  return (
    <div className="grid gap-4">
      <header>
        <Kicker>{t(locale, "Quand l'essaim a besoin de vous", "When the swarm needs you")}</Kicker>
        <h1 className="font-display text-2xl">Inbox</h1>
        <p className="text-sm text-muted">
          {t(
            locale,
            "Pas chaque trace — seulement les portes et les consensus en attente.",
            "Not every trace — only gates and pending consensus.",
          )}
        </p>
      </header>

      {empty && (
        <Panel>
          <p className="text-sm text-muted">
            {t(
              locale,
              "Rien à arbitrer. Lancez un cycle jusqu'à Arbitrer, ou révélez le Comex.",
              "Nothing to arbitrate. Run a cycle to Decide, or reveal the Comex.",
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                startCycle();
                setView("board");
              }}
            >
              {t(locale, "Lancer le cycle", "Run cycle")}
            </Button>
            <Button variant="secondary" onClick={() => setView("swarms")}>
              {t(locale, "Essaims", "Swarms")}
            </Button>
          </div>
        </Panel>
      )}

      {pendingSwarms.map((swarm) => {
        const run = swarm.lastRun!;
        const key = `swarm-${swarm.id}`;
        return (
          <Panel key={swarm.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Kicker>{t(locale, "Essaim · SIMULATION", "Swarm · SIMULATION")}</Kicker>
                <h2 className="font-display text-lg">{swarm.name}</h2>
                <p className="text-sm text-muted">{run.question}</p>
              </div>
              <Pill tone={run.verdict === "NO_GO" ? "danger" : run.verdict === "GO" ? "positive" : "warning"}>
                {run.verdict}
              </Pill>
            </div>
            <p className="mt-2 text-sm">{run.rationale}</p>
            {run.vetoPath.length > 0 && (
              <p className="mt-1 text-xs text-danger">veto · {run.vetoPath.join(" → ")}</p>
            )}
            <div className="mt-4 grid gap-2">
              <textarea
                value={reasons[key] ?? ""}
                onChange={(e) => setReasons((r) => ({ ...r, [key]: e.target.value }))}
                placeholder={t(locale, "Justification (obligatoire pour outrepasse)", "Justification (required to override)")}
                className="min-h-16 rounded-md border border-line bg-paper p-2 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => arbitrateSwarm(swarm.id, "accept_consensus", reasons[key] ?? "")}>
                  {t(locale, "Accepter le consensus", "Accept consensus")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!(reasons[key] ?? "").trim()}
                  onClick={() => arbitrateSwarm(swarm.id, "override_veto", reasons[key] ?? "")}
                >
                  {t(locale, "Outrepasser le veto", "Override veto")}
                </Button>
                <Button variant="ghost" onClick={() => arbitrateSwarm(swarm.id, "reevaluate", reasons[key] ?? "")}>
                  {t(locale, "Réévaluer", "Re-evaluate")}
                </Button>
              </div>
            </div>
          </Panel>
        );
      })}

      {openGates.map((gate) => {
        const idea = ideas.find((i) => i.id === gate.ideaId);
        return (
          <Panel key={gate.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Kicker>{t(locale, "Porte humaine", "Human gate")}</Kicker>
                <h2 className="font-display text-lg">{idea?.title}</h2>
              </div>
              <Pill tone="warning">{gate.status}</Pill>
            </div>
            <ul className="mt-3 grid gap-2">
              {gate.votes.map((v) => {
                const agent = agents.find((a) => a.id === v.agentId);
                return (
                  <li key={v.agentId} className="flex items-start justify-between gap-3 border-b border-line py-2 text-sm">
                    <span>
                      <strong>{agent?.displayName ?? v.agentId}</strong>
                      <span className="block text-xs text-muted">{v.reason}</span>
                    </span>
                    <Pill tone={v.verdict === "NO_GO" ? "danger" : v.verdict === "GO" ? "positive" : "warning"}>
                      {v.verdict}
                    </Pill>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 grid gap-2">
              <textarea
                value={reasons[gate.id] ?? ""}
                onChange={(e) => setReasons((r) => ({ ...r, [gate.id]: e.target.value }))}
                placeholder={t(locale, "Motif obligatoire", "Reason required")}
                className="min-h-16 rounded-md border border-line bg-paper p-2 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <Button disabled={!(reasons[gate.id] ?? "").trim()} onClick={() => decide(gate.id, "approve")}>
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  disabled={!(reasons[gate.id] ?? "").trim()}
                  onClick={() => decide(gate.id, "revise")}
                >
                  Revise
                </Button>
                <Button variant="danger" disabled={!(reasons[gate.id] ?? "").trim()} onClick={() => decide(gate.id, "reject")}>
                  Reject
                </Button>
                {idea && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      selectIdea(idea.id);
                      setView("board");
                    }}
                  >
                    {t(locale, "Voir la carte", "See card")}
                  </Button>
                )}
              </div>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

export function ResultView() {
  const locale = useKayros((s) => s.locale);
  const idea = useKayros(currentIdea);
  const startCycle = useKayros((s) => s.startCycle);
  const setView = useKayros((s) => s.setView);
  if (!idea) return null;
  const radar = Object.entries(idea.ki.strategic).map(([k, v]) => ({ dim: k, v }));
  const best = [...idea.collisions].sort((a, b) => b.novelty - a.novelty)[0];

  return (
    <div className="grid gap-4">
      <header>
        <Kicker>{t(locale, "Résultat mesuré", "Measured result")}</Kicker>
        <h1 className="font-display text-2xl md:text-3xl">{idea.title}</h1>
        <p className="text-sm text-muted">
          {t(
            locale,
            "Le cycle se clôt sur un scorecard, pas une slide.",
            "The cycle ends on a scorecard, not a slide.",
          )}
        </p>
      </header>
      {idea.kpis.length === 0 ? (
        <Panel>
          <p className="text-sm text-muted">
            {t(locale, "Pas encore de KPI. Lancez le cycle jusqu'à Réaliser.", "No KPIs yet. Run the cycle through Execute.")}
          </p>
          <Button
            className="mt-3"
            onClick={() => {
              startCycle();
              setView("board");
            }}
          >
            {t(locale, "Lancer le cycle", "Run cycle")}
          </Button>
        </Panel>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {idea.kpis.map((k) => (
            <Panel key={k.name}>
              <Kicker>{k.name}</Kicker>
              <p className="font-display text-2xl tabular">
                {k.actual}
                <span className="text-sm text-muted"> {k.unit}</span>
              </p>
              <p className="text-xs text-faint">
                {t(locale, "cible", "target")} {k.target}
              </p>
            </Panel>
          ))}
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel className="h-72">
          <Kicker>KI stratégique</Kicker>
          <ResponsiveContainer width="100%" height="90%">
            <RadarChart data={radar}>
              <PolarGrid stroke="var(--color-line)" />
              <PolarAngleAxis dataKey="dim" tick={{ fill: "var(--color-muted)", fontSize: 11 }} />
              <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
              <Radar dataKey="v" stroke="var(--color-accent)" fill="var(--color-accent)" fillOpacity={0.25} />
            </RadarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel>
          <Kicker>Kayros Signature</Kicker>
          {best ? (
            <>
              <p className="mt-2 font-display text-lg">{best.framework}</p>
              <p className="text-sm text-accent">{best.signature}</p>
              <p className="mt-2 text-sm text-muted">{best.proposal}</p>
              <Pill tone="accent">novelty {best.noveltyScore}</Pill>
            </>
          ) : (
            <p className="text-sm text-muted">{t(locale, "Lancez Construire.", "Run Build.")}</p>
          )}
          {idea.forecast.labelled && (
            <p className="mt-4 text-xs uppercase tracking-widest text-warning">{idea.forecast.labelled}</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
