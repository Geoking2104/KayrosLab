import { useState } from "react";
import { useConsole } from "@/lib/console/store";
import { admitToMeeting, SESSION_QUOTA, simulateMeeting, VERDICT_LABEL, VOTING, votingLabel, type Agent, type Collective, type Voting } from "@/lib/console/model";
import { Button, Empty, Field, Panel, TextArea, VerdictPill, controlClass } from "./ui";
import { go } from "./Shell";
import { t, tc } from "@/lib/i18n";

export function Collectifs() {
  const { state, createCollective, selectCollective, addAgentToCollective, updateCollective, startMission } = useConsole();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(t("Comité investissement"));
  const [voting, setVoting] = useState<Voting>("majority");
  const [personality, setPersonality] = useState(true);
  const [picked, setPicked] = useState<string[]>(["ag-cfo", "ag-legal", "ag-cto"]);
  const [error, setError] = useState("");
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editError, setEditError] = useState("");
  const active = state.agents.filter((agent) => agent.enabled);
  const remaining = SESSION_QUOTA - state.collectives.length;

  function toggle(id: string) {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function submit() {
    const result = createCollective({ name, agentIds: picked, voting, personality });
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError("");
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-ink">{t("Collectifs")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t("Un collectif est l’équipe stable qui instruit vos dossiers.")}{" "}{state.collectives.length}/{SESSION_QUOTA}{" "}{t(
              "pour votre compte — les collectifs des autres membres du tenant ne sont ni listés ni modifiables."
            )}</p>
        </div>
        <Button onClick={() => setOpen((value) => !value)} disabled={remaining <= 0}>{t("Nouveau collectif")}</Button>
      </div>
      {remaining <= 0 ? (
        <p className="rounded-lg bg-hold-soft px-3 py-2 text-sm text-hold" role="status">{t(
          "Quota atteint pour votre compte. Un autre utilisateur du même tenant ne bloque pas ce quota, et vous ne pouvez pas écrire dans ses sessions."
        )}</p>
      ) : null}

      {open ? (
        <Panel>
          <h2 className="text-sm font-medium">{t("Composer")}</h2>
          <div className="mt-4 grid gap-4">
            <Field label={t("Nom")}>
              <input className={controlClass} value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label={t("Seuil")}>
              <select className={controlClass} value={voting} onChange={(event) => setVoting(event.target.value as Voting)}>
                {VOTING.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </Field>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 size-4" checked={personality} onChange={(event) => setPersonality(event.target.checked)} />
              <span>
                <span className="font-medium">{t("Simulation de personnalité")}</span>
                <span className="mt-1 block text-muted">{t(
                  "Transmise à la session. Les agents consentis parlent depuis leur profil, pas depuis un type générique."
                )}</span>
              </span>
            </label>
            <fieldset>
              <legend className="text-sm font-medium">{t("Agents actifs")}</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {active.map((agent) => (
                  <label key={agent.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 text-sm">
                    <input type="checkbox" checked={picked.includes(agent.id)} onChange={() => toggle(agent.id)} />
                    {tc(agent.name)}
                    <span className="text-muted">{tc(agent.role)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
            <div className="flex gap-2">
              <Button onClick={submit}>{t("Créer et sélectionner")}</Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>{t("Annuler")}</Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {state.collectives.length === 0 ? (
        <Empty title={t("Aucun collectif")} body={t("Le premier que vous créez est sélectionné automatiquement.")} />
      ) : (
        <div className="grid gap-3">
          {state.collectives.map((collective) => {
            const selected = collective.id === state.selectedCollectiveId;
            const threads = state.threads.filter((thread) => thread.collectiveId === collective.id);
            return (
              <Panel key={collective.id} className={selected ? "border-accent" : undefined}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted">{selected ? t("Sélectionné pour la prochaine instruction") : t("Non sélectionné")} · {votingLabel(collective.voting)}</p>
                    <h2 className="mt-1 text-lg font-medium">{tc(collective.name)}</h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!selected ? <Button variant="secondary" onClick={() => selectCollective(collective.id)}>{t("Sélectionner")}</Button> : null}
                    <Button variant="secondary" onClick={() => { setEditError(""); setEditId((current) => current === collective.id ? null : collective.id); }}>
                      {editId === collective.id ? "Fermer" : "Modifier"}
                    </Button>
                    <Button variant="secondary" onClick={() => setMeetingId((current) => current === collective.id ? null : collective.id)}>
                      {meetingId === collective.id ? t("Fermer la réunion") : t("Simuler la réunion")}
                    </Button>
                    <Button onClick={() => { selectCollective(collective.id); go("instruire"); }}>{t("Instruire")}</Button>
                  </div>
                </div>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {collective.agentIds.map((id) => {
                    const agent = state.agents.find((item) => item.id === id);
                    return (
                      <li key={id} className="inline-flex items-center gap-2 rounded-full bg-paper px-3 py-1 text-xs">
                        <span>{tc(agent?.name) || id}{agent?.veto ? t(" · veto") : ""}</span>
                        {editId === collective.id ? (
                          <button
                            type="button"
                            className="text-stop"
                            onClick={() => {
                              const result = updateCollective(collective.id, { removeAgentId: id });
                              setEditError(result.ok ? "" : result.reason ?? t("Refusé"));
                            }}
                          >{t("Retirer")}</button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {editId === collective.id ? (
                  <CollectiveEdit
                    key={collective.id}
                    collective={collective}
                    error={editError}
                    onSave={(patch) => {
                      const result = updateCollective(collective.id, patch);
                      setEditError(result.ok ? "" : result.reason ?? t("Refusé"));
                      if (result.ok) setEditId(null);
                    }}
                  />
                ) : null}
                {meetingId === collective.id ? (
                  <Meeting
                    questionDefault={t(
                      "Faut-il accorder une remise de 12 % pour signer avant la fin du trimestre ?"
                    )}
                    run={(question) => {
                      const agents = collective.agentIds
                        .map((id) => state.agents.find((agent) => agent.id === id))
                        .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent));
                      return simulateMeeting(agents, question, collective.voting, collective.personality);
                    }}
                    onOpen={(question) => {
                      selectCollective(collective.id);
                      const id = startMission({
                        question,
                        collectiveId: collective.id,
                        profile: state.defaultProfile,
                        useCase: "general",
                        evidence: [],
                      });
                      go("dossiers", id);
                    }}
                    candidates={active.filter((agent) => !collective.agentIds.includes(agent.id))}
                    onAdd={(agentId, question, current) => {
                      addAgentToCollective(collective.id, agentId);
                      const agent = state.agents.find((item) => item.id === agentId);
                      if (!agent || current?.status !== "ready") return current;
                      const room = collective.agentIds
                        .map((id) => state.agents.find((item) => item.id === id))
                        .filter((item): item is Agent => Boolean(item));
                      return admitToMeeting(current, agent, question, collective.voting, collective.personality, [...room, agent]);
                    }}
                    onDelete={() => setMeetingId(null)}
                  />
                ) : null}
                <label className="mt-4 flex flex-col gap-1 text-sm">
                  <span className="text-muted">{t("Ajouter un agent du registre")}</span>
                  <select
                    className={controlClass}
                    defaultValue=""
                    onChange={(event) => {
                      if (event.target.value) addAgentToCollective(collective.id, event.target.value);
                      event.target.value = "";
                    }}
                  >
                    <option value="">{t("Choisir…")}</option>
                    {active.filter((agent) => !collective.agentIds.includes(agent.id)).map((agent) => (
                      <option key={agent.id} value={agent.id}>{tc(agent.name)}</option>
                    ))}
                  </select>
                </label>
                <div className="mt-3 flex flex-col gap-1">
                  {threads.length === 0 ? <p className="text-sm text-muted">{t("Aucune mission sur ce collectif.")}</p> : threads.slice(0, 3).map((thread) => (
                    <button key={thread.id} type="button" className="text-left text-sm text-accent-strong" onClick={() => go("dossiers", thread.id)}>
                      {tc(thread.question)}
                    </button>
                  ))}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CollectiveEdit({
  collective,
  error,
  onSave,
}: {
  collective: Collective;
  error: string;
  onSave: (patch: { name: string; voting: Voting; personality: boolean }) => void;
}) {
  const [name, setName] = useState(collective.name);
  const [voting, setVoting] = useState(collective.voting);
  const [personality, setPersonality] = useState(collective.personality);

  return (
    <div className="mt-4 grid gap-3 border-t border-line pt-4">
      <Field label={t("Nom")}>
        <input className={controlClass} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label={t("Seuil")}>
        <select className={controlClass} value={voting} onChange={(event) => setVoting(event.target.value as Voting)}>
          {VOTING.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </Field>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 size-4" checked={personality} onChange={(event) => setPersonality(event.target.checked)} />
        <span>{t(
          "Simulation de personnalité transmise à la réunion et aux dossiers suivants."
        )}</span>
      </label>
      {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
      <Button className="w-fit" onClick={() => onSave({ name, voting, personality })}>{t("Enregistrer le collectif")}</Button>
    </div>
  );
}

function Meeting({
  questionDefault,
  run,
  onOpen,
  candidates,
  onAdd,
  onDelete,
}: {
  questionDefault: string;
  run: (question: string) => ReturnType<typeof simulateMeeting>;
  onOpen: (question: string) => void;
  candidates: Agent[];
  onAdd: (agentId: string, question: string, current: ReturnType<typeof simulateMeeting> | null) => ReturnType<typeof simulateMeeting> | null | undefined;
  onDelete: () => void;
}) {
  const [question, setQuestion] = useState(questionDefault);
  const [result, setResult] = useState<ReturnType<typeof simulateMeeting> | null>(null);
  const [pick, setPick] = useState("");

  function add() {
    if (!pick) return;
    const next = onAdd(pick, question, result);
    if (next) setResult(next);
    setPick("");
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{t("Réunion simulée")}</h3>
          <p className="mt-1 text-sm text-muted">{t("Chacun parle depuis sa fonction. Supprimer n’efface pas le collectif.")}</p>
        </div>
        <Button variant="danger" onClick={onDelete}>{t("Supprimer la réunion")}</Button>
      </div>
      <Field label={t("Ordre du jour")}>
        <TextArea className="mt-2" value={question} onChange={(event) => setQuestion(event.target.value)} />
      </Field>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label={t("Ajouter un agent")}>
          <select className={controlClass} value={pick} onChange={(event) => setPick(event.target.value)} disabled={candidates.length === 0}>
            <option value="">{candidates.length === 0 ? t("Tous les agents actifs sont déjà là") : "Choisir…"}</option>
            {candidates.map((agent) => (
              <option key={agent.id} value={agent.id}>{tc(agent.name)}</option>
            ))}
          </select>
        </Field>
        <Button variant="secondary" onClick={add} disabled={!pick}>{t("Ajouter")}</Button>
        <Button onClick={() => setResult(run(question))} disabled={question.trim().length < 3}>
          {result?.status === "ready" ? t("Rejouer la séance") : t("Ouvrir la séance")}
        </Button>
      </div>
      {result?.status === "clarify" || result?.status === "thin" ? (
        <p className="mt-3 rounded-lg bg-info-soft px-3 py-3 text-sm text-info" role="status">{result.ask}</p>
      ) : null}
      {result?.status === "ready" ? (
        <div className="mt-4 grid gap-3">
          <ol className="grid gap-2">
            {result.turns.map((turn, index) => (
              <li key={turn.agentId} className="rounded-lg bg-paper px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">{index + 1}</span>
                  <span className="text-sm font-medium">{tc(turn.name)}</span>
                  <span className="text-xs text-muted">{tc(turn.role)}</span>
                  <VerdictPill verdict={turn.verdict} />
                </div>
                <p className="mt-2 text-sm">{turn.line}</p>
              </li>
            ))}
          </ol>
          {result.absent.length ? <p className="text-sm text-muted">{t("Absents, agent inactif :")}{" "}{result.absent.join(", ")}.</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{t("Salle, seuil appliqué")}</span>
            <VerdictPill verdict={result.verdict} />
            <span className="text-xs text-muted">{VERDICT_LABEL[result.verdict]} · {result.provider}</span>
          </div>
          {result.conditions.length ? (
            <ul className="list-disc pl-5 text-sm">
              {result.conditions.map((item) => <li key={item}>{tc(item)}</li>)}
            </ul>
          ) : null}
          <p className="text-xs text-muted">{t(
            "Avis de salle. Ouvrir le dossier lance la même question pour de vrai, puis l’arbitrage."
          )}</p>
          <Button variant="secondary" onClick={() => onOpen(question)}>{t("Ouvrir le dossier")}</Button>
        </div>
      ) : null}
    </div>
  );
}
