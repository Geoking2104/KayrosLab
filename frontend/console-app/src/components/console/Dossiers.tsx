import { useState } from "react";
import { useConsole } from "@/lib/console/store";
import {
  CYCLE,
  formatWhen,
  useCaseLabel,
  VERDICT_LABEL,
  votingLabel,
  type Agent,
  type CycleId,
  type Evidence,
  type Thread,
  type ThreadStatus,
} from "@/lib/console/model";
import { readDocument } from "@/lib/console/read";
import { cn } from "@/lib/cn";
import { Button, Empty, Field, Panel, ProgressBar, StatusPill, TextArea, VerdictPill } from "./ui";
import { go } from "./Shell";
import { AgentMark } from "./agent-mark";

const FILTERS: { id: "all" | ThreadStatus; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "awaiting_arbitration", label: "À arbitrer" },
  { id: "running", label: "En instruction" },
  { id: "needs_clarification", label: "Précision" },
  { id: "resolved", label: "Clos" },
];

export function Dossiers({ threadId }: { threadId: string }) {
  const { state, deleteThread, addAgentToThread, startMission } = useConsole();
  const selected = state.threads.find((thread) => thread.id === threadId);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const list = state.threads.filter((thread) => filter === "all" || thread.status === filter);

  if (selected) return <Dossier threadId={selected.id} />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Dossiers</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          D’abord le document, ensuite une question choisie, ensuite le comité. Vous ne voyez que vos dossiers.
        </p>
      </div>
      <DocumentDesk
        onPose={(question, file) => {
          const collective = state.collectives.find((item) => item.id === state.selectedCollectiveId) ?? state.collectives[0];
          if (!collective) return { ok: false, reason: "Aucun collectif pour instruire." };
          const id = startMission({
            question,
            collectiveId: collective.id,
            profile: state.defaultProfile,
            useCase: "comex_decision",
            evidence: file ? [file] : [],
          });
          go("dossiers", id);
          return { ok: true };
        }}
      />
      <div className="flex flex-wrap gap-2" role="tablist">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={cn("min-h-10 rounded-full px-3 text-sm", filter === item.id ? "bg-ink text-surface" : "bg-surface text-ink-soft")}
          >
            {item.label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty title="Aucun dossier dans ce filtre" body="Lancez une instruction : le dossier s’ouvre ici, pas dans un écran à part." action={<Button onClick={() => go("instruire")}>Instruire une décision</Button>} />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((thread) => {
            const collective = state.collectives.find((item) => item.id === thread.collectiveId);
            return (
              <li key={thread.id} className="rounded-3xl border border-line bg-surface p-4">
                <button type="button" onClick={() => go("dossiers", thread.id)} className="w-full text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={thread.status} />
                    <VerdictPill verdict={thread.verdict} />
                    <span className="text-xs text-muted">{collective?.name}</span>
                  </div>
                  <p className="mt-2 font-medium">{thread.question}</p>
                  <p className="mt-1 text-xs text-muted">{formatWhen(thread.updatedAt)}</p>
                  {thread.status === "running" ? (
                    <div className="mt-3">
                      <ProgressBar done={thread.progress.done} total={thread.progress.total} active />
                    </div>
                  ) : null}
                </button>
                <AddAgents
                  thread={thread}
                  agents={state.agents}
                  onAdd={(agentId) => addAgentToThread(thread.id, agentId)}
                />
                <button
                  type="button"
                  className="mt-3 min-h-11 rounded-lg border border-line bg-stop-soft px-3 text-sm text-stop"
                  onClick={() => deleteThread(thread.id)}
                >
                  Supprimer
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Dossier({ threadId }: { threadId: string }) {
  const { state, arbitrate, replyClarification, addAgentToThread, removeAgentFromThread, deleteThread, attachReading, poseQuestion } = useConsole();
  const thread = state.threads.find((item) => item.id === threadId);
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [agentError, setAgentError] = useState("");
  const collective = state.collectives.find((item) => item.id === thread?.collectiveId);
  const manager = state.role === "comex";

  if (!thread || !collective) {
    return <Empty title="Dossier introuvable" body="Il n’appartient pas à votre compte, ou l’identifiant est périmé." action={<Button onClick={() => go("dossiers")}>Retour aux dossiers</Button>} />;
  }

  function act(action: "accept" | "conditions" | "reevaluate" | "override") {
    const result = arbitrate(thread!.id, action, note);
    setError(result.ok ? "" : result.reason ?? "Action refusée");
  }

  return (
    <div className="flex flex-col gap-5">
      <button type="button" onClick={() => go("dossiers")} className="w-fit text-sm text-muted">
        ← Tous les dossiers
      </button>
      <CycleRail stage={thread.stage} />
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={thread.status} />
          <VerdictPill verdict={thread.verdict} />
          <span className="text-xs text-muted">{useCaseLabel(thread.useCase)} · {thread.provider}</span>
        </div>
        <h1 className="mt-3 text-2xl font-medium leading-snug tracking-tight">{thread.question}</h1>
        <p className="mt-2 text-sm text-muted">
          {collective.name} · {votingLabel(collective.voting)}
          {collective.personality ? " · simulation de personnalité active" : ""} · {formatWhen(thread.updatedAt)}
        </p>
      </div>
      <DocumentDesk
        existing={thread.evidence}
        onKeep={(file) => attachReading(thread.id, file)}
        onPose={(question) => poseQuestion(thread.id, question)}
      />
      <Panel>
        <h2 className="text-sm font-medium">Agents de ce dossier</h2>
        <ul className="mt-3 grid gap-2">
          {thread.agentIds.map((id) => {
            const agent = state.agents.find((item) => item.id === id);
            return (
              <li key={id} className="flex items-center gap-2 rounded-2xl bg-paper px-3 py-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => go("agents", { agent: id, dossier: thread.id })}
                >
                  <AgentMark agent={agent} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{agent?.name ?? id}</span>
                    <span className="block text-xs text-muted">{agent?.role ?? "Fiche"}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="min-h-11 shrink-0 rounded-full border-2 border-[#9f2c22] px-3 text-sm font-medium text-[#9f2c22]"
                  onClick={() => {
                    const result = removeAgentFromThread(thread.id, id);
                    setAgentError(result.ok ? "" : result.reason ?? "Refusé");
                  }}
                >
                  Retirer
                </button>
              </li>
            );
          })}
        </ul>
        {agentError ? <p className="mt-2 text-sm text-stop" role="alert">{agentError}</p> : null}
        <AddAgents thread={thread} agents={state.agents} onAdd={(agentId) => addAgentToThread(thread.id, agentId)} />
      </Panel>

      {thread.status === "running" ? (
        <Panel>
          <p className="text-sm font-medium">Instruction en cours</p>
          <p className="mt-1 text-sm text-muted">Chaque agent instruit à son tour. Cette page se met à jour seule.</p>
          <div className="mt-3">
            <ProgressBar done={thread.progress.done} total={thread.progress.total} active />
          </div>
          <div className="mt-4 grid gap-2">
            {thread.agentIds.map((id, index) => {
              const agent = state.agents.find((item) => item.id === id);
              const done = index < thread.progress.done;
              const current = index === thread.progress.done;
              return (
                <div key={id} className="rounded-lg bg-paper px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span>{agent?.name ?? id}</span>
                    <span className="text-xs text-muted">{done ? "Déposé" : current ? "En cours" : "En file"}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-[#0b5cab]"
                      style={{ width: done ? "100%" : current ? "45%" : "0%" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {thread.status === "needs_clarification" ? (
        <Panel>
          <h2 className="text-sm font-medium">Précision attendue</h2>
          <p className="mt-1 text-sm text-muted">Ce n’est pas un GO conditionnel. Le collectif s’est arrêté parce que la question n’est pas instruisible.</p>
          <ul className="mt-3 list-disc pl-5 text-sm">
            {thread.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-3">
            <TextArea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Objet, montant, échéance" aria-label="Précision" />
            <Button className="self-start" onClick={() => replyClarification(thread.id, reply)}>
              Relancer le même collectif
            </Button>
          </div>
        </Panel>
      ) : null}

      {thread.verdict ? (
        <Panel>
          <p className="text-xs uppercase tracking-wide text-muted">Lecture</p>
          <p className="mt-1 text-xl font-medium">{VERDICT_LABEL[thread.verdict]}</p>
          {thread.verdict === "CONDITIONAL_GO" ? (
            <p className="mt-2 text-sm text-ink-soft">
              Les conditions sont soumises à l’arbitrage. Le dossier n’est pas renvoyé en clarification.
            </p>
          ) : null}
          {thread.conditions.length ? (
            <ul className="mt-4 flex flex-col gap-2">
              {thread.conditions.map((condition) => (
                <li key={condition} className="rounded-lg bg-hold-soft px-3 py-2 text-sm text-hold">
                  {condition}
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      ) : null}

      {thread.contributions.length ? (
        <div className="grid gap-3">
          {thread.contributions.map((item) => {
            const agent = state.agents.find((entry) => entry.id === item.agentId);
            return (
              <Panel key={item.agentId}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium">
                    {agent?.name} · {agent?.role}
                    {agent?.veto ? " · veto" : ""}
                  </h2>
                  <VerdictPill verdict={item.verdict} />
                </div>
                <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                  <Block title="Appuis" items={item.strengths} />
                  <Block title="Objections" items={item.objections} />
                  <Block title="Conditions" items={item.conditions} />
                  <div>
                    <dt className="text-xs text-muted">Repère</dt>
                    <dd className="font-mono text-xs">{item.metric}</dd>
                  </div>
                </dl>
              </Panel>
            );
          })}
        </div>
      ) : null}

      {thread.status === "awaiting_arbitration" ? (
        <Panel>
          <h2 className="text-sm font-medium">Arbitrage</h2>
          {manager ? (
            <>
              <p className="mt-1 text-sm text-muted">Le consensus ne s’exécute pas tout seul. Choisissez, le motif reste dans le fil.</p>
              <TextArea className="mt-3" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Motif, obligatoire pour une dérogation au veto" aria-label="Motif d’arbitrage" />
              {error ? <p className="mt-2 text-sm text-stop" role="alert">{error}</p> : null}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button onClick={() => act("accept")}>Accepter le consensus</Button>
                <Button variant="secondary" onClick={() => act("conditions")}>Passer sous conditions</Button>
                <Button variant="secondary" onClick={() => act("reevaluate")}>Demander une réévaluation</Button>
                <Button variant="danger" onClick={() => act("override")} disabled={note.trim().length < 12}>
                  Déroger au veto
                </Button>
              </div>
            </>
          ) : (
            <div className="mt-3 rounded-lg bg-paper px-3 py-3 text-sm">
              <p className="font-medium">Rôle COMEX ou admin requis</p>
              <p className="mt-1 text-muted">
                Vous pouvez lire le dossier et répondre à une précision. Les actions d’arbitrage ne sont pas actives : aucun envoi, donc pas de refus après coup.
              </p>
              <p className="mt-3 text-muted">Basculez sur COMEX dans le bandeau du compte pour voir le geste d’arbitrage sur ce même dossier.</p>
            </div>
          )}
        </Panel>
      ) : null}

      {thread.arbitration ? (
        <Panel>
          <h2 className="text-sm font-medium">Décision humaine</h2>
          <p className="mt-2 text-sm">
            {labelAction(thread.arbitration.action)} · {thread.arbitration.by} · {formatWhen(thread.arbitration.at)}
          </p>
          {thread.arbitration.note ? <p className="mt-2 text-sm text-ink-soft">{thread.arbitration.note}</p> : null}
        </Panel>
      ) : null}

      <Panel>
        <h2 className="text-sm font-medium">Retirer la décision</h2>
        <p className="mt-1 text-sm text-muted">Le collectif et les autres dossiers restent.</p>
        <Button
          className="mt-3"
          variant="danger"
          onClick={() => {
            deleteThread(thread.id);
            go("dossiers");
          }}
        >
          Supprimer le dossier
        </Button>
      </Panel>

      <Trace thread={thread} agents={state.agents} />

      <Panel>
        <h2 className="text-sm font-medium">Journal</h2>
        <ol className="mt-3 flex flex-col gap-3">
          {[...thread.events].reverse().map((event) => (
            <li key={`${event.at}-${event.label}`} className="grid gap-1 border-l border-line pl-3 text-sm">
              <span className="text-xs text-muted">{formatWhen(event.at)}</span>
              <span className="font-medium">{event.label}</span>
              <span className="text-ink-soft">{event.detail}</span>
            </li>
          ))}
        </ol>
      </Panel>
      <p className="text-xs text-muted">Identifiant {thread.id}. Le lien public d’intégration ouvre ce dossier, pas un autre écran.</p>
    </div>
  );
}

function Trace({ thread, agents }: { thread: Thread; agents: Agent[] }) {
  const steps = traceOf(thread, agents);
  return (
    <Panel>
      <h2 className="text-sm font-medium">Trace du comité</h2>
      <p className="mt-1 text-sm text-muted">Lecture seule. Elle suit ce dossier. Elle ne rebranche ni le collectif, ni un flux.</p>
      <ol className="mt-4 grid gap-0">
        {steps.map((step, index) => (
          <li key={`${step.at}-${step.title}-${index}`} className="grid grid-cols-[16px_1fr] gap-3">
            <span className="flex flex-col items-center">
              <span className="mt-1 size-3 rounded-full" style={{ background: step.color, boxShadow: step.live ? `0 0 0 4px ${step.soft}` : undefined }} />
              {index < steps.length - 1 ? <span className="w-px flex-1 bg-line" /> : null}
            </span>
            <div className={index < steps.length - 1 ? "pb-4" : ""}>
              <p className="text-xs font-medium" style={{ color: step.color }}>{step.kind}{step.live ? " · en cours" : ""}{step.at ? ` · ${formatWhen(step.at)}` : ""}</p>
              <p className="text-sm font-medium">{step.title}</p>
              <p className="text-sm text-ink-soft">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

const TRACE_TONE = {
  Document: { color: "#0f766e", soft: "#e5f3f1" },
  Agent: { color: "#146c43", soft: "#e5f4ec" },
  Canal: { color: "#8a5a10", soft: "#f8f1e3" },
  Modèle: { color: "#0b5cab", soft: "#e7f2fb" },
  Humain: { color: "#4a154b", soft: "#f6eef6" },
} as const;

function traceOf(thread: Thread, agents: Agent[]) {
  const steps = thread.events.map((event) => {
    const kind = traceKind(event.label, event.detail);
    const tone = TRACE_TONE[kind];
    return { kind, ...tone, title: event.label, detail: event.detail, at: event.at, live: false };
  });
  const opinions = thread.contributions.map((item) => {
    const agent = agents.find((entry) => entry.id === item.agentId);
    const tone = TRACE_TONE.Agent;
    return {
      kind: "Agent" as const,
      ...tone,
      title: agent?.name ?? item.agentId,
      detail: `${item.verdict} · ${item.metric}${item.objections[0] ? ` · ${item.objections[0]}` : ""}`,
      at: "",
      live: false,
    };
  });
  const verdictAt = steps.findIndex((step) => step.title === "Verdict produit");
  const at = verdictAt === -1 ? steps.length : verdictAt;
  steps.splice(at, 0, ...opinions);
  if (thread.status === "running" && thread.progress.done < thread.progress.total) {
    const id = thread.agentIds[thread.progress.done];
    const agent = agents.find((entry) => entry.id === id);
    steps.push({
      kind: "Agent",
      ...TRACE_TONE.Agent,
      title: agent?.name ?? "Agent",
      detail: "Instruit maintenant. Les autres restent en file.",
      at: thread.updatedAt,
      live: true,
    });
  }
  if (steps.length === 0) {
    steps.push({
      kind: "Humain",
      ...TRACE_TONE.Humain,
      title: "Dossier ouvert",
      detail: "Aucune intervention enregistrée.",
      at: thread.createdAt,
      live: false,
    });
  }
  return steps;
}

function traceKind(label: string, detail: string) {
  const text = `${label} ${detail}`;
  if (/document/i.test(label)) return "Document" as const;
  if (/agent/i.test(label)) return "Agent" as const;
  if (/slack|teams|discord|salesforce/i.test(text)) return "Canal" as const;
  if (/arbitrage|précision|réévaluation|question posée/i.test(label)) return "Humain" as const;
  return "Modèle" as const;
}

function AddAgents({
  thread,
  agents,
  onAdd,
}: {
  thread: Thread;
  agents: Agent[];
  onAdd: (agentId: string) => { ok: boolean; reason?: string };
}) {
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const available = agents.filter((agent) => agent.enabled && !thread.agentIds.includes(agent.id));
  const blocked = thread.status === "needs_clarification";

  return (
    <div className="mt-3">
      {open && !blocked ? (
        available.length === 0 ? (
          <p className="mb-3 text-sm text-muted">Tous les agents actifs sont déjà dans ce dossier.</p>
        ) : (
          <ul className="mb-3 grid gap-2">
            {available.map((agent) => (
              <li key={agent.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-paper px-3 py-2">
                <span className="flex min-w-0 items-center gap-3 text-sm">
                  <AgentMark agent={agent} size={28} />
                  <span>{agent.name} · {agent.role}</span>
                </span>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const result = onAdd(agent.id);
                    setError(result.ok ? "" : result.reason ?? "Refusé");
                    if (result.ok) setOpen(false);
                  }}
                >
                  Ajouter
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {error ? <p className="mb-2 text-sm text-stop" role="alert">{error}</p> : null}
      <button
        type="button"
        className="inline-flex min-h-11 items-center rounded-full bg-[#146c43] px-4 text-sm font-medium text-white disabled:opacity-45"
        disabled={blocked}
        onClick={() => {
          setError(blocked ? "Précisez d’abord la question." : "");
          setOpen((value) => !value);
        }}
      >
        Ajouter un agent
      </button>
      {blocked ? <p className="mt-2 text-sm text-muted">Précisez d’abord la question. Un agent ajouté n’aurait rien à instruire.</p> : null}
    </div>
  );
}

function CycleRail({ stage }: { stage: CycleId }) {
  const current = CYCLE.findIndex((step) => step.id === stage);
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8" aria-label="Cycle du dossier">
      {CYCLE.map((step, index) => {
        const tone = STEP_TONE[step.id];
        const state = index < current ? "done" : index === current ? "now" : "later";
        return (
          <li
            key={step.id}
            className="rounded-2xl px-2 py-2"
            style={{
              background: state === "now" ? tone.color : state === "done" ? tone.soft : "#f4f7f5",
              color: state === "now" ? "#fff" : tone.color,
            }}
          >
            <span className="mt-1 block text-xs font-medium">{step.label}</span>
            <span className="mt-0.5 block text-[11px] leading-tight opacity-80">{step.hint}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DocumentDesk({
  existing = [],
  onKeep,
  onPose,
}: {
  existing?: Evidence[];
  onKeep?: (file: Evidence) => { ok: boolean; reason?: string };
  onPose: (question: string, file: Evidence | null) => { ok: boolean; reason?: string };
}) {
  const saved = existing.find((file) => file.summary);
  const [name, setName] = useState(saved?.name ?? "");
  const [text, setText] = useState(saved?.text ?? "");
  const [summary, setSummary] = useState(saved?.summary ?? "");
  const [facts, setFacts] = useState<string[]>(saved?.facts ?? []);
  const [questions, setQuestions] = useState<string[]>(saved?.questions ?? []);
  const [picked, setPicked] = useState(saved?.questions?.[0] ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  function read() {
    const source = text.trim();
    const label = name.trim() || "note.txt";
    const reading = readDocument(label, source);
    if (reading.thin) {
      setSummary("");
      setFacts([]);
      setQuestions([]);
      setError(reading.note);
      return;
    }
    setName(label);
    setSummary(reading.summary);
    setFacts(reading.facts);
    setQuestions(reading.questions);
    setPicked(reading.questions[0] ?? "");
    setError("");
    setNote(reading.note);
    onKeep?.({
      name: label,
      type: "Lecture",
      text: source,
      summary: reading.summary,
      facts: reading.facts,
      questions: reading.questions,
    });
  }

  function download() {
    const source = text.trim();
    const body = summary
      ? `# ${name || "lecture"}\n\n${summary}\n\n${facts.map((item) => `- ${item}`).join("\n")}\n\n## Texte\n\n${source}\n`
      : source;
    if (!body.trim()) {
      setError("Collez un texte avant de télécharger.");
      return;
    }
    const filename = `${(name || "lecture").replace(/\.\w+$/, "").replace(/[^\w\- ]+/g, "").trim() || "lecture"}.md`;
    const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 1500);
    setError("");
    setNote(`Téléchargement lancé : ${filename}`);
  }

  return (
    <Panel>
      <h2 className="text-sm font-medium">Document, avant le comité</h2>
      <p className="mt-1 text-sm text-muted">
        Collez le texte, lisez-le, téléchargez la lecture, puis choisissez une question. Moteur local déterministe : seuls les chiffres et les clauses présents dans le texte sont repris. api.kayroslab.com n’est pas appelé.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="inline-flex min-h-11 items-center rounded-full bg-[#1e4d78] px-4 text-sm font-medium text-white disabled:opacity-45" disabled={text.trim().length < 40} onClick={read}>
          Lire
        </button>
        <button type="button" className="inline-flex min-h-11 items-center rounded-full border-2 border-[#161a18] bg-white px-4 text-sm font-medium" onClick={download}>
          Télécharger
        </button>
      </div>
      <div className="mt-4">
        <Field label="Texte du document">
          <TextArea value={text} onChange={(event) => setText(event.target.value)} placeholder="Collez l’extrait : objet, montant, échéance, clause." aria-label="Texte du document" />
        </Field>
      </div>
      {name ? <p className="mt-2 text-xs text-muted">{name}</p> : null}
      {error ? <p className="mt-2 text-sm text-stop" role="alert">{error}</p> : null}
      {note && !error ? <p className="mt-2 text-sm text-ink-soft">{note}</p> : null}
      {summary ? (
        <div className="mt-4 grid gap-3">
          <p className="text-sm">{summary}</p>
          {facts.length ? (
            <ul className="list-disc pl-5 text-sm">
              {facts.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
          <fieldset>
            <legend className="text-sm font-medium">Questions proposées</legend>
            <div className="mt-2 grid gap-2">
              {questions.map((question) => (
                <label key={question} className="flex items-start gap-2 rounded-lg bg-paper px-3 py-2 text-sm">
                  <input type="radio" name="proposed" checked={picked === question} onChange={() => setPicked(question)} />
                  <span>{question}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            className="inline-flex min-h-11 w-fit items-center rounded-full bg-[#4a154b] px-4 text-sm font-medium text-white disabled:opacity-45"
            disabled={!picked}
            onClick={() => {
              const file: Evidence | null = summary ? { name: name || "note.txt", type: "Lecture", text, summary, facts, questions } : null;
              const result = onPose(picked, file);
              setError(result.ok ? "" : result.reason ?? "Refusé");
            }}
          >
            Poser au comité
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

const STEP_TONE: Record<CycleId, { color: string; soft: string }> = {
  ecouter: { color: "#0f766e", soft: "#e5f3f1" },
  cartographier: { color: "#0b5cab", soft: "#e7f2fb" },
  construire: { color: "#146c43", soft: "#e5f4ec" },
  positionner: { color: "#8a5a10", soft: "#f8f1e3" },
  eprouver: { color: "#9f2c22", soft: "#f8e8e6" },
  arbitrer: { color: "#4a154b", soft: "#f6eef6" },
  projeter: { color: "#1e4d78", soft: "#e7eef5" },
  realiser: { color: "#3c4540", soft: "#e6ebe8" },
};

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <dt className="text-xs text-muted">{title}</dt>
      <dd>{items.length ? items.join(" ") : "—"}</dd>
    </div>
  );
}

function labelAction(action: string) {
  if (action === "accept") return "Consensus accepté";
  if (action === "conditions") return "Passé sous conditions";
  if (action === "override") return "Dérogation au veto";
  return "Réévaluation";
}
