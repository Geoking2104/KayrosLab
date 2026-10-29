import { useState } from "react";
import { useConsole } from "@/lib/console/store";
import {
  CYCLE,
  formatWhen,
  useCaseLabel,
  VERDICT_LABEL,
  votingLabel,
  type Agent,
  type AgentKind,
  type CycleId,
  type Evidence,
  type Thread,
  type ThreadStatus,
  GUARDRAILS,
} from "@/lib/console/model";
import { readDocument } from "@/lib/console/read";
import { cn } from "@/lib/cn";
import { Section, Button, Empty, Field, Panel, ProgressBar, StatusPill, TextArea, VerdictPill, controlClass } from "./ui";
import { go } from "./Shell";
import { AgentMark } from "./agent-mark";
import { LinkedMark, ProfileLink, profileClue, type ProfileSource } from "./profile-link";
import { t, tc, tk } from "@/lib/i18n";

const FILTERS: { id: "all" | ThreadStatus; label: string }[] = [
  { id: "all", get label() { return t("Tous"); } },
  { id: "awaiting_arbitration", get label() { return t("À arbitrer"); } },
  { id: "running", get label() { return t("En instruction"); } },
  { id: "needs_clarification", get label() { return t("Précision"); } },
  { id: "resolved", get label() { return t("Clos"); } },
];

export function Dossiers({ threadId }: { threadId: string }) {
  const { state, deleteThread, startMission } = useConsole();
  const selected = state.threads.find((thread) => thread.id === threadId);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [pickedAgents, setPickedAgents] = useState<string[]>([]);
  const list = state.threads.filter((thread) => filter === "all" || thread.status === filter);

  if (selected) return <Dossier threadId={selected.id} />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-ink">{t("Dossiers")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t(
          "Deux départs : un document analysé, ou un texte brut comme sur un modèle. La question propose ensuite les agents capables d’intervenir. Le comité ne part que lorsque KayrosLab l’annonce."
        )}</p>
      </div>
      <Briefing
        agents={state.agents.filter((agent) => agent.enabled)}
        checkedIds={pickedAgents}
        onToggle={(id) => setPickedAgents((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))}
        onLaunch={(question, file) => {
          const collective = state.collectives.find((item) => item.id === state.selectedCollectiveId) ?? state.collectives[0];
          if (!collective) return { ok: false, reason: t("Aucun collectif pour instruire.") };
          if (pickedAgents.length === 0) return { ok: false, reason: t("Choisissez au moins un agent.") };
          const id = startMission({
            question,
            collectiveId: collective.id,
            profile: state.defaultProfile,
            useCase: "comex_decision",
            evidence: [file],
            agentIds: pickedAgents,
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
            className={cn("min-h-10 rounded-full px-3 text-sm font-semibold", filter === item.id ? "bg-accent text-white shadow-cta" : "border border-line bg-surface text-ink-soft")}
          >
            {item.label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty title={t("Aucun dossier dans ce filtre")} body={t(
          "Lancez une instruction : le dossier s’ouvre ici, pas dans un écran à part."
        )} action={<Button onClick={() => go("instruire")}>{t("Instruire une décision")}</Button>} />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((thread) => {
            const collective = state.collectives.find((item) => item.id === thread.collectiveId);
            return (
              <li key={thread.id} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
                <button type="button" onClick={() => go("dossiers", thread.id)} className="w-full text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={thread.status} />
                    <VerdictPill verdict={thread.verdict} />
                    <span className="text-xs text-muted">{tc(collective?.name)}</span>
                  </div>
                  <p className="mt-2 font-medium">{tc(thread.question)}</p>
                  <p className="mt-1 text-xs text-muted">{formatWhen(thread.updatedAt)}</p>
                  {thread.status === "running" ? (
                    <div className="mt-3">
                      <ProgressBar done={thread.progress.done} total={thread.progress.total} active />
                    </div>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="mt-3 min-h-11 rounded-lg border border-line bg-stop-soft px-3 text-sm text-stop"
                  onClick={() => deleteThread(thread.id)}
                >{t("Supprimer")}</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Détail d’un dossier, affiché dans le panneau latéral. */
export function Dossier({ threadId }: { threadId: string }) {
  const { state, arbitrate, replyClarification, addAgentToThread, removeAgentFromThread, deleteThread, attachReading, poseQuestion } = useConsole();
  const thread = state.threads.find((item) => item.id === threadId);
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [agentError, setAgentError] = useState("");
  const collective = state.collectives.find((item) => item.id === thread?.collectiveId);
  const manager = state.role === "comex";

  if (!thread || !collective) {
    return <Empty title={t("Dossier introuvable")} body={t("Il n’appartient pas à votre compte, ou l’identifiant est périmé.")} action={<Button onClick={() => go("dossiers")}>{t("Retour aux dossiers")}</Button>} />;
  }

  const support = supportOf(thread.contributions);

  function act(action: "accept" | "conditions" | "reevaluate" | "override") {
    const result = arbitrate(thread!.id, action, note);
    setError(result.ok ? "" : result.reason ?? t("Action refusée"));
  }

  return (
    <div className="flex flex-col gap-5">
      <button type="button" onClick={() => go("dossiers")} className="w-fit text-sm font-bold text-accent">{t("← Tous les dossiers")}</button>
      <section className="overflow-hidden rounded-3xl border border-[#d8e6f3] bg-surface shadow-card">
        <div className="flex items-center gap-3 bg-gradient-to-r from-accent to-accent-strong px-5 py-4 text-white">
          <img src={`${import.meta.env.BASE_URL}logo-kayroslab.png`} alt="" width={36} height={36} className="size-9 rounded-[9px]" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80">{t("Dossier")}</p>
            <h1 className="text-base font-bold leading-snug text-white">{tc(thread.question)}</h1>
          </div>
        </div>
        <div className="border-b border-[#e1ecf6] bg-[#f3f8fd] px-3 py-3">
          <CycleRail stage={thread.stage} />
        </div>
        <div className="grid gap-3 p-4 md:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={thread.status} />
            <VerdictPill verdict={thread.verdict} />
            <span className="text-xs text-muted">{useCaseLabel(thread.useCase)} · {thread.provider}</span>
          </div>
          <p className="text-sm text-ink-soft">
            {tc(collective.name)} · {votingLabel(collective.voting)}
            {collective.personality ? t(" · simulation de personnalité active") : ""} · {formatWhen(thread.updatedAt)}
          </p>
          {thread.verdict ? (
            <div className={cn("grid gap-2 rounded-xl border border-line border-l-4 bg-white px-4 py-3", thread.verdict === "GO" ? "border-l-go" : thread.verdict === "NO_GO" ? "border-l-stop" : "border-l-hold")}>
              <p className="flex items-center gap-2 text-sm font-bold text-ink">
                <span className={cn("size-2.5 shrink-0 rounded-full", thread.verdict === "GO" ? "bg-go" : thread.verdict === "NO_GO" ? "bg-stop" : "bg-hold")} aria-hidden="true" />{t("KayrosLab — Verdict :")}{" "}{VERDICT_LABEL[thread.verdict]}
              </p>
              {support != null ? (
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5 text-[13px] text-muted">
                  <span>{t("Score d’appui")}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-paper-2" aria-hidden="true">
                    <span className="block h-full rounded-full bg-gradient-to-r from-[#00a1e0] to-teal" style={{ width: `${support}%` }} />
                  </span>
                  <b className="font-bold text-ink">{support}/100</b>
                </div>
              ) : null}
              {thread.contributions.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {thread.contributions.map((item) => {
                    const agent = state.agents.find((entry) => entry.id === item.agentId);
                    return (
                      <li key={item.agentId} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper py-0.5 pr-2.5 pl-1 text-xs font-semibold text-ink">
                        <VerdictPill verdict={item.verdict} />
                        {tc(agent?.role ?? agent?.name)}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {thread.conditions.map((condition) => (
                <p key={condition} className="text-sm text-ink-soft"><span className="font-bold text-ink">{t("Condition :")}</span> {tc(condition)}</p>
              ))}
              {thread.verdict === "CONDITIONAL_GO" ? (
                <p className="text-sm text-ink-soft">{t(
                  "Les conditions sont soumises à l’arbitrage. Le dossier n’est pas renvoyé en clarification."
                )}</p>
              ) : null}
            </div>
          ) : null}
          {thread.arbitration ? (
            <div className="grid gap-1 rounded-xl border border-line border-l-4 border-l-go bg-[#fbfdfc] px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-bold text-ink">
                <span className="size-2.5 shrink-0 rounded-full bg-go" aria-hidden="true" />{t("KayrosLab — Décision :")}{" "}{thread.verdict ? VERDICT_LABEL[thread.verdict] : t("Arbitrée")}
              </p>
              <p className="text-sm text-ink-soft">
                {labelAction(thread.arbitration.action)} · {tc(thread.arbitration.by)} · {formatWhen(thread.arbitration.at)}
                {thread.arbitration.note ? ` · ${tc(thread.arbitration.note)}` : ""}
              </p>
            </div>
          ) : null}
        </div>
      </section>
      <Briefing
        agents={state.agents.filter((agent) => agent.enabled)}
        checkedIds={thread.agentIds}
        existing={thread.evidence}
        currentQuestion={tc(thread.question)}
        busy={thread.status === "running"}
        onOpenAgent={(id) => go("agents", { agent: id, dossier: thread.id })}
        onToggle={(id) => {
          const result = thread.agentIds.includes(id) ? removeAgentFromThread(thread.id, id) : addAgentToThread(thread.id, id);
          setAgentError(result.ok ? "" : result.reason ?? t("Refusé"));
        }}
        onRead={(file) => attachReading(thread.id, file)}
        onLaunch={(question) => poseQuestion(thread.id, question)}
      />
      {agentError ? <p className="text-sm text-stop" role="alert">{agentError}</p> : null}

      {thread.status === "running" ? (
        <Panel>
          <p className="text-sm font-medium">{t("Instruction en cours")}</p>
          <p className="mt-1 text-sm text-muted">{t("Chaque agent instruit à son tour. Cette page se met à jour seule.")}</p>
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
                    <span>{tc(agent?.name) || id}</span>
                    <span className="text-xs text-muted">{done ? t("Déposé") : current ? t("En cours") : t("En file")}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#00a1e0] to-teal"
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
          <h2 className="text-sm font-medium">{t("Précision attendue")}</h2>
          <p className="mt-1 text-sm text-muted">{t(
            "Ce n’est pas un GO conditionnel. Le collectif s’est arrêté parce que la question n’est pas instruisible."
          )}</p>
          <ul className="mt-3 list-disc pl-5 text-sm">
            {thread.questions.map((question) => (
              <li key={question}>{tc(question)}</li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-3">
            <TextArea value={reply} onChange={(event) => setReply(event.target.value)} placeholder={t("Objet, montant, échéance")} aria-label={t("Précision")} />
            <Button className="self-start" onClick={() => replyClarification(thread.id, reply)}>{t("Relancer le même collectif")}</Button>
          </div>
        </Panel>
      ) : null}

      {thread.contributions.length ? (
        <div className="grid gap-3">
          {thread.contributions.map((item) => {
            const agent = state.agents.find((entry) => entry.id === item.agentId);
            const edge = item.verdict === "GO" ? "border-l-go" : item.verdict === "NO_GO" ? "border-l-stop" : "border-l-hold";
            return (
              <Panel key={item.agentId} className={cn("border-l-4", edge)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium">
                    {tc(agent?.name)} · {tc(agent?.role)}
                    {agent?.veto ? t(" · veto") : ""}
                  </h2>
                  <VerdictPill verdict={item.verdict} />
                </div>
                <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                  <Block title={t("Appuis")} items={item.strengths} />
                  <Block title={t("Objections")} items={item.objections} />
                  <Block title={t("Conditions")} items={item.conditions} />
                  <div>
                    <dt className="text-xs text-muted">{t("Repère")}</dt>
                    <dd className="font-mono text-xs">{tc(item.metric)}</dd>
                  </div>
                </dl>
              </Panel>
            );
          })}
        </div>
      ) : null}

      {thread.status === "awaiting_arbitration" ? (
        <Panel>
          <h2 className="text-sm font-medium">{t("Arbitrage")}</h2>
          {manager ? (
            <>
              <p className="mt-1 text-sm text-muted">{t(
                "Le consensus ne s’exécute pas tout seul. Choisissez, le motif reste dans le fil."
              )}</p>
              <TextArea className="mt-3" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("Motif, obligatoire pour une dérogation au veto")} aria-label={t("Motif d’arbitrage")} />
              {error ? <p className="mt-2 text-sm text-stop" role="alert">{error}</p> : null}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button onClick={() => act("accept")}>{t("Accepter le consensus")}</Button>
                <Button variant="secondary" onClick={() => act("conditions")}>{t("Passer sous conditions")}</Button>
                <Button variant="secondary" onClick={() => act("reevaluate")}>{t("Demander une réévaluation")}</Button>
                <Button variant="danger" onClick={() => act("override")} disabled={note.trim().length < 12}>{t("Déroger au veto")}</Button>
              </div>
            </>
          ) : (
            <div className="mt-3 rounded-lg bg-paper px-3 py-3 text-sm">
              <p className="font-medium">{t("Rôle COMEX ou admin requis")}</p>
              <p className="mt-1 text-muted">{t(
                "Vous pouvez lire le dossier et répondre à une précision. Les actions d’arbitrage ne sont pas actives : aucun envoi, donc pas de refus après coup."
              )}</p>
              <p className="mt-3 text-muted">{t(
                "Basculez sur COMEX dans le bandeau du compte pour voir le geste d’arbitrage sur ce même dossier."
              )}</p>
            </div>
          )}
        </Panel>
      ) : null}

      <Section id="dossier-retirer" title={t("Retirer la décision")} defaultOpen={false}>
        <p className="mt-1 text-sm text-muted">{t("Le collectif et les autres dossiers restent.")}</p>
        <Button
          className="mt-3"
          variant="danger"
          onClick={() => {
            deleteThread(thread.id);
            go("dossiers");
          }}
        >{t("Supprimer le dossier")}</Button>
      </Section>

      <Trace thread={thread} agents={state.agents} />

      <Section id="dossier-journal" title={t("Journal")} defaultOpen={false}>
        <ol className="mt-3 flex flex-col gap-3">
          {[...thread.events].reverse().map((event) => (
            <li key={`${event.at}-${event.label}`} className="grid gap-1 border-l border-line pl-3 text-sm">
              <span className="text-xs text-muted">{formatWhen(event.at)}</span>
              <span className="font-medium">{tc(event.label)}</span>
              <span className="text-ink-soft">{tc(event.detail)}</span>
            </li>
          ))}
        </ol>
      </Section>
      <p className="text-xs text-muted">{t("Identifiant {{id}}. Le lien public d’intégration ouvre ce dossier, pas un autre écran.", { id: thread.id })}</p>
    </div>
  );
}

function Trace({ thread, agents }: { thread: Thread; agents: Agent[] }) {
  const steps = traceOf(thread, agents);
  return (
    <Section id="dossier-trace" title={t("Trace du comité")} defaultOpen={false}>
      <p className="mt-1 text-sm text-muted">{t(
        "Lecture seule. Elle suit ce dossier. Elle ne rebranche ni le collectif, ni un flux."
      )}</p>
      <ol className="mt-4 grid gap-0">
        {steps.map((step, index) => (
          <li key={`${step.at}-${step.title}-${index}`} className="grid grid-cols-[16px_1fr] gap-3">
            <span className="flex flex-col items-center">
              <span className="mt-1 size-3 rounded-full" style={{ background: step.color, boxShadow: step.live ? `0 0 0 4px ${step.soft}` : undefined }} />
              {index < steps.length - 1 ? <span className="w-px flex-1 bg-line" /> : null}
            </span>
            <div className={index < steps.length - 1 ? "pb-4" : ""}>
              <p className="text-xs font-medium" style={{ color: step.color }}>{t(step.kind)}{step.live ? t(" · en cours") : ""}{step.at ? ` · ${formatWhen(step.at)}` : ""}</p>
              <p className="text-sm font-medium">{tc(step.title)}</p>
              <p className="text-sm text-ink-soft">{tc(step.detail)}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

const TRACE_TONE = {
  Document: { color: "#0f766e", soft: "#e6f4f2" },
  Agent: { color: "#157347", soft: "#e7f4ec" },
  Canal: { color: "#b45309", soft: "#fdf3e4" },
  Modèle: { color: "#0176d3", soft: "#eaf5fe" },
  Humain: { color: "#5b4cdb", soft: "#eeecfb" },
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
      detail: `${item.verdict} · ${tc(item.metric)}${item.objections[0] ? ` · ${tc(item.objections[0])}` : ""}`,
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
      detail: t("Instruit maintenant. Les autres restent en file."),
      at: thread.updatedAt,
      live: true,
    });
  }
  if (steps.length === 0) {
    steps.push({
      kind: "Humain",
      ...TRACE_TONE.Humain,
      title: t("Dossier ouvert"),
      detail: t("Aucune intervention enregistrée."),
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

const AGENT_TOPICS: { re: RegExp; match: RegExp; why: string }[] = [
  { re: /marge|prix|budget|remise|tr[eé]sorerie|€|eur|co[uû]t|chiffre|plafond|margin|price|discount|cash|cost|cap\b/i, match: /finance|cfo|daf|marge|prix/i, get why() { return t("La question touche à l’argent, à la marge ou au prix."); } },
  { re: /clause|contrat|r[eé]sili|rgpd|juridique|opposab|obligation|engagement|avenant|contract|terminat|gdpr|legal|commitment|amendment/i, match: /juridique|legal|veto|clause/i, get why() { return t("La question touche au droit ou à une clause."); } },
  { re: /technique|h[eé]berg|souverain|dette|faisab|production|inf[eé]rence|n[oœ]ud|capacit[eé]|logiciel|technical|hosting|sovereign|debt|feasib|inference|capacity|software/i, match: /technique|cto|ing[eé]nier|faisab|dette/i, get why() { return t("La question touche à la faisabilité ou à la technique."); } },
  { re: /client|revenu|deal|signat|commercial|volume|relation|customer|revenue|sales/i, match: /commercial|sales|revenu|client/i, get why() { return t("La question touche au revenu ou à la relation client."); } },
];

function suggestAgents(text: string, agents: Agent[]) {
  const clean = text.trim();
  if (clean.length < 8) return [];
  const scored = agents
    .map((agent) => {
      const blob = `${agent.name} ${agent.role} ${agent.department} ${agent.mission} ${agent.brief ?? ""}`;
      const hits = AGENT_TOPICS.filter((topic) => topic.re.test(clean) && topic.match.test(blob));
      return { agent, hits };
    })
    .filter((item) => item.hits.length > 0)
    .sort((a, b) => b.hits.length - a.hits.length);
  if (scored.length) return scored.map((item) => ({ agent: item.agent, why: item.hits[0].why }));
  return agents
    .filter((agent) => agent.kind === "metier")
    .map((agent) => ({ agent, why: t("Comité général : la question ne désigne pas encore un métier.") }));
}

function Briefing({
  agents,
  checkedIds,
  existing = [],
  currentQuestion = "",
  busy = false,
  onOpenAgent,
  onToggle,
  onRead,
  onLaunch,
}: {
  agents: Agent[];
  checkedIds: string[];
  existing?: Evidence[];
  currentQuestion?: string;
  busy?: boolean;
  onOpenAgent?: (id: string) => void;
  onToggle: (id: string) => void;
  onRead?: (file: Evidence) => { ok: boolean; reason?: string };
  onLaunch: (question: string, file: Evidence) => { ok: boolean; reason?: string };
}) {
  const saved = existing.find((file) => file.summary);
  const [name, setName] = useState(saved?.name ?? "");
  const [text, setText] = useState(saved?.text ?? "");
  const [summary, setSummary] = useState(saved?.summary ?? "");
  const [facts, setFacts] = useState<string[]>(saved?.facts ?? []);
  const [questions, setQuestions] = useState<string[]>(saved?.questions ?? []);
  const [picked, setPicked] = useState(saved?.questions?.[0] ?? "");
  const [raw, setRaw] = useState(saved ? "" : currentQuestion);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const asked = (custom.trim().length >= 8 ? custom.trim() : picked.trim()) || (raw.trim().length >= 8 ? raw.trim() : "");
  const analyzed = Boolean(summary);
  const ready = asked.trim().length >= 8 && checkedIds.length > 0;
  const sameRun = busy && asked.trim() === currentQuestion.trim();
  const proposals = suggestAgents(asked || raw || currentQuestion, agents);

  function applyReading(label: string, source: string) {
    const reading = readDocument(label, source);
    if (reading.thin) {
      setSummary("");
      setFacts([]);
      setQuestions([]);
      setPicked("");
      setError(reading.note);
      return;
    }
    const file: Evidence = {
      name: label,
      type: tk("Lecture"),
      text: source,
      summary: reading.summary,
      facts: reading.facts,
      questions: reading.questions,
    };
    setName(label);
    setText(source);
    setSummary(reading.summary);
    setFacts(reading.facts);
    setQuestions(reading.questions);
    setPicked(reading.questions[0] ?? "");
    setError("");
    onRead?.(file);
  }

  function onFile(file: File) {
    const allowed = /\.(txt|md|csv|json)$/i.test(file.name);
    if (!allowed) {
      setError(t("Déposez un .txt, un .md, un .csv ou un .json. Un PDF n’est pas lu."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => applyReading(file.name, String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function download() {
    if (!summary) {
      setError(t("KayrosLab n’a pas encore analysé de document."));
      return;
    }
    const body = [
      t("# Lecture KayrosLab — {{name}}", { name: name || t("document") }),
      "",
      `## ${t("Résumé")}`,
      summary,
      "",
      `## ${t("Décorticage")}`,
      ...facts.map((item) => `- ${item}`),
      "",
      `## ${t("Questions")}`,
      ...questions.map((item, index) => `${index + 1}. ${item}`),
      "",
      t(
        "Moteur local déterministe. Seuls les chiffres, dates et clauses présents dans le document sont repris."
      ),
    ].join("\n");
    const filename = `${(name || "lecture").replace(/\.\w+$/, "").replace(/[^\w\- ]+/g, "").trim() || "lecture"}-kayroslab.md`;
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
  }

  return (
    <Panel>
      <h2 className="text-sm font-medium">{t("Préparer la réflexion")}</h2>
      <ol className="mt-4 flex flex-col gap-5">
        <li>
          <p className="text-sm font-medium">{t("1. Document, ou texte brut")}</p>
          <p className="mt-1 text-sm text-muted">{t(
            "Le document est lu puis téléchargeable. Sans document, le texte brut suffit pour démarrer, comme sur un modèle."
          )}</p>
          <label className="mt-3 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-paper px-4 py-5 text-sm">
            <span className="font-medium">{t("Déposer un .txt, .md, .csv ou .json")}</span>
            <input
              className="mt-3 block w-full text-sm"
              type="file"
              accept=".txt,.md,.csv,.json,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFile(file);
                event.target.value = "";
              }}
            />
          </label>
          {!analyzed ? (
            <div className="mt-3">
              <Field label={t("Texte brut")} hint={t("Question ou brief. Aucun téléchargement n’est exigé.")}>
                <TextArea value={raw} onChange={(event) => setRaw(event.target.value)} placeholder={t("Écrivez ici pour démarrer sans document")} aria-label={t("Texte brut")} />
              </Field>
              {raw.trim().length >= 40 ? (
                <button type="button" className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-white" onClick={() => applyReading("saisie.txt", raw.trim())}>{t("Découper ce texte en questions")}</button>
              ) : null}
            </div>
          ) : null}
          {analyzed ? (
            <div className="mt-3 grid gap-2">
              <p className="text-xs text-muted">{name}{" "}{t("· analyse KayrosLab")}</p>
              <p className="text-sm">{summary}</p>
              <ul className="list-disc pl-5 text-sm">
                {facts.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ) : null}
        </li>
        <li>
          <p className="text-sm font-medium">{t("2. Télécharger l’analyse")}</p>
          <p className="mt-1 text-sm text-muted">{t(
            "Seulement après une analyse. Sans document, le texte brut ne se télécharge pas : il sert de départ."
          )}</p>
          <button
            type="button"
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-white px-4 text-sm font-semibold text-ink disabled:opacity-45"
            disabled={!analyzed}
            onClick={download}
          >{t("Télécharger l’analyse")}</button>
        </li>
        <li>
          <p className="text-sm font-medium">{t("3. Question")}</p>
          <p className="mt-1 text-sm text-muted">{t(
            "Choisissez une question proposée, écrivez la vôtre, ou gardez le texte brut."
          )}</p>
          {analyzed ? (
            <div className="mt-3 grid gap-2">
              {questions.map((question) => (
                <label key={question} className="flex items-start gap-2 rounded-lg bg-paper px-3 py-2 text-sm">
                  <input type="radio" name="brief-question" checked={picked === question && custom.trim().length < 8} onChange={() => { setPicked(question); setCustom(""); }} />
                  <span>{question}</span>
                </label>
              ))}
            </div>
          ) : null}
          <div className="mt-3">
            <Field label={analyzed ? t("Ou une question sur ce texte") : t("Question")} hint={analyzed ? t("Si vous écrivez ici, elle remplace la question cochée.") : t("Vous pouvez démarrer sans document.")}>
              <TextArea value={custom} onChange={(event) => setCustom(event.target.value)} placeholder={t("Posez la question au comité")} aria-label={t("Question au comité")} />
            </Field>
          </div>
        </li>
        <li>
          <p className="text-sm font-medium">{t("4. Agents proposés pour cette question")}</p>
          <p className="mt-1 text-sm text-muted">{t(
            "KayrosLab retient ceux dont le métier répond au texte. Vous pouvez en ajouter ou en retirer. Le collectif n’est pas modifié."
          )}</p>
          {proposals.length && (asked.trim().length >= 8 || raw.trim().length >= 8 || currentQuestion.trim().length >= 8) ? (
            <div className="mt-3 grid gap-2">
              <ul className="grid gap-2">
                {proposals.map((item) => {
                  const on = checkedIds.includes(item.agent.id);
                  return (
                    <li key={item.agent.id} className={cn("rounded-xl border px-3 py-2", on ? "border-accent bg-accent-soft" : "border-line bg-white")}>
                      <div className="flex items-center gap-3">
                        <input type="checkbox" className="size-4" checked={on} aria-label={t("Proposer {{name}}", { name: tc(item.agent.name) })} onChange={() => onToggle(item.agent.id)} />
                        <AgentMark agent={item.agent} size={28} />
                        <button type="button" className="min-w-0 flex-1 text-left text-sm" onClick={() => onOpenAgent?.(item.agent.id)}>
                          <span className="block font-medium">{tc(item.agent.name)}</span>
                          <span className="block text-xs text-muted">{tc(item.agent.role)} · {item.why}</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                className="inline-flex min-h-11 w-fit items-center rounded-[10px] bg-accent px-4 text-sm font-semibold text-white shadow-cta"
                onClick={() => {
                  for (const item of proposals) {
                    if (!checkedIds.includes(item.agent.id)) onToggle(item.agent.id);
                  }
                }}
              >{t("Retenir ces propositions")}</button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">{t("Écrivez la question pour voir qui peut intervenir.")}</p>
          )}
          {(asked.trim().length >= 8 || currentQuestion.trim().length >= 8) && agents.some((agent) => !proposals.some((item) => item.agent.id === agent.id)) ? (
            <ul className="mt-3 grid gap-2">
              {agents.filter((agent) => !proposals.some((item) => item.agent.id === agent.id)).map((agent) => {
                const on = checkedIds.includes(agent.id);
                return (
                  <li key={agent.id} className="flex items-center gap-3 rounded-2xl bg-paper px-3 py-2">
                    <input type="checkbox" className="size-4" checked={on} aria-label={t("Ajouter {{name}}", { name: tc(agent.name) })} onChange={() => onToggle(agent.id)} />
                    <AgentMark agent={agent} size={28} />
                    <button type="button" className="min-w-0 flex-1 text-left text-sm" onClick={() => onOpenAgent?.(agent.id)}>
                      <span className="block font-medium">{tc(agent.name)}</span>
                      <span className="block text-xs text-muted">{tc(agent.role)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <OutsideAgent onAdded={(id) => { if (!checkedIds.includes(id)) onToggle(id); }} />
        </li>
      </ol>
      {error ? <p className="mt-3 text-sm text-stop" role="alert">{error}</p> : null}
      <div className="mt-4 rounded-2xl bg-paper px-4 py-3">
        <ul className="grid gap-1 text-sm">
          <li>{analyzed ? t("Document analysé.") : raw.trim() || custom.trim() ? t("Démarrage par texte brut, sans téléchargement.") : t("Ni document, ni texte.")}</li>
          <li>{asked.trim().length >= 8 ? t("Question retenue.") : t("Question pas encore choisie.")}</li>
          <li>{checkedIds.length ? (checkedIds.length > 1 ? t("{{count}} agents retenus.", { count: checkedIds.length }) : t("{{count}} agent retenu.", { count: checkedIds.length })) : t("Aucun agent retenu.")}</li>
        </ul>
        {ready && sameRun ? (
          <p className="mt-3 text-sm font-medium">{t("La réflexion est en cours auprès du comité.")}</p>
        ) : ready ? (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-sm font-medium">{t("KayrosLab est prêt à lancer la réflexion auprès du comité.")}</p>
            <button
              type="button"
              className="inline-flex min-h-11 w-fit items-center rounded-[10px] bg-accent px-4 text-sm font-semibold text-white shadow-cta"
              onClick={() => {
                const result = onLaunch(asked.trim(), {
                  name: name || (analyzed ? "document.txt" : "saisie.txt"),
                  type: analyzed ? tk("Lecture") : tk("Saisie"),
                  text: text || raw || asked,
                  summary: summary || asked.trim(),
                  facts,
                  questions: questions.length ? questions : [asked.trim()],
                });
                setError(result.ok ? "" : result.reason ?? t("Refusé"));
              }}
            >{t("Lancer la réflexion")}</button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">{t("Pas encore prêt. Il manque une étape ci-dessus.")}</p>
        )}
      </div>
    </Panel>
  );
}

const OUTSIDE_TYPES: { id: AgentKind; label: string; hint: string; color: string; soft: string }[] = [
  { id: "metier", get label() { return t("Métier"); }, get hint() { return t("Une fonction, sans personnifier personne."); }, color: "#0f766e", soft: "#e6f4f2" },
  { id: "hybride", get label() { return t("Hybride"); }, get hint() { return t("Métier plus un profil consenti."); }, color: "#0176d3", soft: "#eaf5fe" },
  { id: "impersonator", get label() { return t("Impersonator"); }, get hint() { return t("Reliez CrystalKnows ou LinkedIn avant la fiche."); }, color: "#5b4cdb", soft: "#eeecfb" },
];

function OutsideAgent({ onAdded }: { onAdded: (id: string) => void }) {
  const { state, createAgent, setRole } = useConsole();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AgentKind | null>(null);
  const manager = state.role === "comex";

  return (
    <div className="mt-3">
      {open ? (
        <div className="rounded-xl border border-line bg-white p-3">
          {!kind ? (
            <>
              <p className="text-sm font-medium">{t("Choisissez le type d’agent")}</p>
              <p className="mt-1 text-sm text-muted">{t("En dehors des propositions. Il rejoint ce dossier, pas le collectif.")}</p>
              {manager ? (
                <div className="mt-3 grid gap-2">
                  {OUTSIDE_TYPES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setKind(item.id)}
                      className="rounded-xl border border-line px-3 py-3 text-left"
                      style={{ background: item.soft, borderLeft: `4px solid ${item.color}` }}
                    >
                      <span className="text-xs font-bold uppercase tracking-[0.08em]" style={{ color: item.color }}>{item.label}</span>
                      <span className="mt-1 block text-sm text-ink-soft">{item.hint}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-3">
                  <p className="text-sm text-muted">{t("Créer un agent est réservé au COMEX.")}</p>
                  <Button className="mt-3" onClick={() => setRole("comex")}>{t("Passer en COMEX")}</Button>
                </div>
              )}
            </>
          ) : (
            <OutsideForm
              kind={kind}
              onBack={() => setKind(null)}
              onCreate={(draft) => {
                const result = createAgent(draft);
                if (result.ok && result.id) onAdded(result.id);
                if (result.ok) {
                  setKind(null);
                  setOpen(false);
                }
                return result;
              }}
            />
          )}
          <Button className="mt-3" variant="ghost" onClick={() => { setOpen(false); setKind(null); }}>{t("Annuler")}</Button>
        </div>
      ) : (
        <button
          type="button"
          className="inline-flex min-h-11 items-center rounded-[10px] border border-line-strong bg-white px-4 text-sm font-semibold text-ink"
          onClick={() => setOpen(true)}
        >{t("Ajouter un agent")}</button>
      )}
    </div>
  );
}

function OutsideForm({
  kind,
  onBack,
  onCreate,
}: {
  kind: AgentKind;
  onBack: () => void;
  onCreate: (agent: {
    name: string;
    role: string;
    department: string;
    mission: string;
    kind: AgentKind;
    veto: boolean;
    enabled: boolean;
    consented: boolean;
    simulation: boolean;
    clues: string;
    brief?: string;
  }) => { ok: boolean; reason?: string; id?: string };
}) {
  const personal = kind !== "metier";
  const [name, setName] = useState("");
  const [role, setRole] = useState(personal ? t("Persona simulée") : "");
  const [department, setDepartment] = useState(personal ? "Simulation" : "");
  const [mission, setMission] = useState("");
  const [clues, setClues] = useState("");
  const [guards, setGuards] = useState<boolean[]>(GUARDRAILS.map(() => false));
  const [error, setError] = useState("");
  const [link, setLink] = useState<null | { source: ProfileSource; url: string }>(null);
  const label = kind === "metier" ? t("Métier") : kind === "hybride" ? t("Hybride") : t("Impersonator");

  function save() {
    if (kind === "impersonator" && !link) {
      setError(t("Reliez CrystalKnows ou un profil public LinkedIn avant la fiche."));
      return;
    }
    if (!name.trim()) {
      setError(t("Le nom est requis."));
      return;
    }
    if (!personal && (!role.trim() || !department.trim() || !mission.trim())) {
      setError(t("Fonction, service et mission sont requis."));
      return;
    }
    if (personal && guards.some((item) => !item)) {
      setError(t("Cochez les cinq garde-fous avant d’enregistrer."));
      return;
    }
    const result = onCreate({
      name: name.trim(),
      role: role.trim() || t("Persona simulée"),
      department: department.trim() || "Simulation",
      mission: mission.trim() || t("Instruit dans son périmètre."),
      kind,
      veto: false,
      enabled: true,
      consented: personal,
      simulation: personal,
      clues: personal
        ? (kind === "impersonator" && link
          ? (clues.trim().includes(link.url) ? clues.trim() : `${profileClue(link.source, link.url)}${clues.trim() ? ` · ${clues.trim()}` : ""}`)
          : clues.trim() || t("Saisie manuelle"))
        : "",
      brief: "",
    });
    if (!result.ok) setError(result.reason ?? t("Refusé"));
  }

  if (kind === "impersonator" && !link) {
    return (
      <div className="grid gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-violet">{t("Impersonator · simulation")}</p>
        <ProfileLink
          onContinue={(source, url) => {
            setLink({ source, url });
            setClues(profileClue(source, url));
            setError("");
          }}
        />
        <Button variant="ghost" onClick={onBack}>{t("Autre type")}</Button>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm font-medium">{t("Nouvel agent · {{label}}", { label })}</p>
      <Field label={t("Nom")}>
        <input className={controlClass} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={personal ? t("Rôle simulé") : t("Fonction")}>
          <input className={controlClass} value={role} onChange={(event) => setRole(event.target.value)} />
        </Field>
        <Field label={t("Service")}>
          <input className={controlClass} value={department} onChange={(event) => setDepartment(event.target.value)} />
        </Field>
      </div>
      <Field label={t("Mission")}>
        <TextArea value={mission} onChange={(event) => setMission(event.target.value)} />
      </Field>
      {kind === "impersonator" && link ? (
        <LinkedMark source={link.source} url={link.url} onChange={() => setLink(null)} />
      ) : null}
      {personal ? (
        <>
          <Field label={kind === "impersonator" ? t("Notes") : t("Indices autorisés")} hint={kind === "impersonator" ? t("L’adresse n’est pas visitée. Aucune fiche n’est téléchargée.") : t("Export ou saisie. Aucun scraping.")}>
            <input className={controlClass} value={clues} onChange={(event) => setClues(event.target.value)} />
          </Field>
          <ul className="grid gap-2">
            {GUARDRAILS.map((item, index) => (
              <li key={item}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4"
                    checked={guards[index]}
                    onChange={() => setGuards((current) => current.map((value, i) => (i === index ? !value : value)))}
                  />
                  <span>{tc(item)}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={save}>{t("Créer et retenir")}</Button>
        <Button variant="ghost" onClick={onBack}>{t("Autre type")}</Button>
      </div>
    </div>
  );
}

function supportOf(items: { verdict: "GO" | "CONDITIONAL_GO" | "NO_GO" }[]) {
  if (!items.length) return null;
  const weight = { GO: 100, CONDITIONAL_GO: 55, NO_GO: 0 };
  return Math.round(items.reduce((sum, item) => sum + weight[item.verdict], 0) / items.length);
}

function CycleRail({ stage }: { stage: CycleId }) {
  const current = CYCLE.findIndex((step) => step.id === stage);
  return (
    <ol className="flex gap-1 overflow-x-auto" aria-label={t("Cycle du dossier")}>
      {CYCLE.map((step, index) => {
        const state = index < current ? "done" : index === current ? "now" : "later";
        return (
          <li
            key={step.id}
            title={step.hint}
            aria-current={state === "now" ? "step" : undefined}
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1.5 text-center text-[11px] font-semibold whitespace-nowrap",
              state === "now" && "bg-accent text-white",
              state === "done" && "bg-[#c9e6d6] text-[#155a37]",
              state === "later" && "bg-[#dfe9f3] text-[#3d4b5a]",
            )}
          >
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}


function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <dt className="text-xs text-muted">{title}</dt>
      <dd>{items.length ? items.map((item) => tc(item)).join(" ") : "—"}</dd>
    </div>
  );
}

function labelAction(action: string) {
  if (action === "accept") return t("Consensus accepté");
  if (action === "conditions") return t("Passé sous conditions");
  if (action === "override") return t("Dérogation au veto");
  return t("Réévaluation");
}
