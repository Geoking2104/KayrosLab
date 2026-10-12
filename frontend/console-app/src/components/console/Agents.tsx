import { useState } from "react";
import { useConsole } from "@/lib/console/store";
import { GUARDRAILS, simulateMetier, type Agent, type AgentKind } from "@/lib/console/model";
import { cn } from "@/lib/cn";
import { Button, Field, Panel, TextArea, VerdictPill, controlClass } from "./ui";
import { go } from "./Shell";
import { AgentMark } from "./agent-mark";

function AgentFocus({ agent, dossierId }: { agent: Agent; dossierId: string }) {
  return (
    <div className="flex flex-col gap-5">
      <button type="button" className="w-fit text-sm text-muted" onClick={() => (dossierId ? go("dossiers", dossierId) : go("agents"))}>
        ← {dossierId ? "Retour au dossier" : "Tous les agents"}
      </button>
      <Panel>
        <div className="flex items-start gap-3">
          <AgentMark agent={agent} size={44} />
          <div>
            <p className="text-xs text-muted">{agent.department} · {agent.kind} · {agent.provider}</p>
            <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink">{agent.name}</h1>
            <p className="text-sm text-ink-soft">{agent.role}{agent.veto ? " · droit de veto" : ""}{agent.enabled ? "" : " · inactif"}</p>
          </div>
        </div>
        <p className="mt-4 text-sm">{agent.mission}</p>
        {agent.brief ? <p className="mt-3 text-sm text-ink-soft">{agent.brief}</p> : null}
        <p className="mt-3 text-xs text-muted">Modèle {agent.model}. {agent.simulation ? "Fiche de simulation." : "Agent de registre."}</p>
        {agent.consented ? (
          <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-sm">
            Simulation étiquetée. Indices : {agent.clues || "saisie manuelle"}. Pas de décision matérielle.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}

const TABS: { id: AgentKind | "all"; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "metier", label: "Métier" },
  { id: "hybride", label: "Hybrides" },
  { id: "impersonator", label: "Impersonators" },
];

export function Agents({ agentId = "", dossierId = "" }: { agentId?: string; dossierId?: string }) {
  const { state, setRole, setAgentEnabled, createAgent, updateAgent, createImpersonatorTeam } = useConsole();
  const focus = state.agents.find((agent) => agent.id === agentId) ?? null;
  const manager = state.role === "comex";
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("metier");
  const [picking, setPicking] = useState(false);
  const [mode, setMode] = useState<null | "metier" | "hybride" | "impersonator" | "team">(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [simId, setSimId] = useState<string | null>(null);
  const list = state.agents.filter((agent) => tab === "all" || agent.kind === tab);
  const editing = state.agents.find((agent) => agent.id === editingId) ?? null;

  function openCreate(next: NonNullable<typeof mode>) {
    setEditingId(null);
    setSimId(null);
    setPicking(false);
    setMode(next);
  }

  if (focus) {
    return (
      <div className="flex flex-col gap-5">
        <AgentFocus agent={focus} dossierId={dossierId} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink">Agents</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Ajoutez un agent qui n’est pas dans la liste. Le type se choisit ensuite : métier, hybride, impersonator ou équipe.
          </p>
        </div>
      </div>

      <Panel className={manager ? undefined : "bg-paper"}>
        <p className="text-sm font-medium">{manager ? "Création et modification ouvertes." : "Consultation seule."}</p>
        <p className="mt-1 text-sm text-muted">
          {manager
            ? "Une fiche existante se modifie sans en créer une autre. Le consentement reste exigé pour un profil personnifié."
            : "Créer ou modifier un agent est réservé au COMEX. Passez en COMEX pour ouvrir les formulaires."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setMode(null);
              setEditingId(null);
              setSimId(null);
              setPicking((open) => !open);
            }}
          >
            Ajouter un agent
          </Button>
          {!manager ? <Button variant="secondary" onClick={() => setRole("comex")}>Passer en COMEX</Button> : null}
        </div>
      </Panel>

      {picking && !mode ? (
        manager ? (
          <TypeChoice onPick={openCreate} onClose={() => setPicking(false)} />
        ) : (
          <Panel>
            <h2 className="text-sm font-medium">Choix du type</h2>
            <p className="mt-1 text-sm text-muted">Créer un agent est réservé au COMEX. Passez en COMEX, puis choisissez le type.</p>
            <Button className="mt-3" onClick={() => setRole("comex")}>Passer en COMEX</Button>
          </Panel>
        )
      ) : null}

      {mode === "metier" && manager && !editing ? (
        <MetierForm onClose={() => setMode(null)} onCreate={createAgent} onUpdate={updateAgent} />
      ) : null}
      {mode && mode !== "metier" && manager && !editing ? (
        <Composer
          key={mode}
          mode={mode}
          onClose={() => setMode(null)}
          onAgent={createAgent}
          onUpdate={updateAgent}
          onTeam={createImpersonatorTeam}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button key={item.id} type="button" onClick={() => setTab(item.id)} className={cn("min-h-10 rounded-full px-3 text-sm", tab === item.id ? "bg-ink text-surface" : "bg-surface text-ink-soft")}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3">
        {list.map((agent) =>
          editing?.id === agent.id && manager ? (
            agent.kind === "metier" ? (
              <MetierForm
                key={agent.id}
                existing={agent}
                onClose={() => setEditingId(null)}
                onCreate={createAgent}
                onUpdate={updateAgent}
              />
            ) : (
            <Composer
              key={agent.id}
              mode={agent.kind}
              existing={agent}
              onClose={() => setEditingId(null)}
              onAgent={createAgent}
              onUpdate={updateAgent}
              onTeam={createImpersonatorTeam}
            />
            )
          ) : simId === agent.id && agent.kind === "metier" ? (
            <MetierSim key={agent.id} agent={agent} onClose={() => setSimId(null)} />
          ) : (
            <Panel key={agent.id} className={agent.enabled ? undefined : "opacity-60"}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <AgentMark agent={agent} />
                  <div>
                  <p className="text-xs text-muted">{agent.department} · {agent.kind} · {agent.provider}</p>
                  <h2 className="text-lg font-medium">{agent.name}</h2>
                  <p className="text-sm text-ink-soft">{agent.role}{agent.veto ? " · droit de veto" : ""}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={!manager}
                    onClick={() => {
                      setMode(null);
                      setSimId(null);
                      setEditingId(agent.id);
                    }}
                  >
                    Modifier
                  </Button>
                  {agent.kind === "metier" ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setMode(null);
                        setEditingId(null);
                        setSimId(agent.id);
                      }}
                    >
                      Simuler
                    </Button>
                  ) : null}
                  <button
                    type="button"
                    disabled={!manager}
                    aria-pressed={agent.enabled}
                    onClick={() => setAgentEnabled(agent.id, !agent.enabled)}
                    className="min-h-11 rounded-lg border border-line px-3 text-sm disabled:opacity-50"
                  >
                    {agent.enabled ? "Actif" : "Inactif"}
                  </button>
                </div>
              </div>
              <p className="mt-3 text-sm">{agent.mission}</p>
              {agent.kind === "metier" && agent.brief ? <p className="mt-2 text-sm text-ink-soft">{agent.brief}</p> : null}
              {agent.consented ? (
                <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-sm">
                  Simulation étiquetée. Indices : {agent.clues || "saisie manuelle"}. Pas de décision matérielle.
                </p>
              ) : null}
            </Panel>
          ),
        )}
      </div>
      <p className="text-sm text-muted">
        Crystal Knows : jeton serveur absent. L’API n’est pas appelée. Un export JSON autorisé ou un type DISC peut servir d’indice, avec consentement. Aucun profil LinkedIn n’est visité.
      </p>
    </div>
  );
}

const AGENT_TYPES: { id: "metier" | "hybride" | "impersonator" | "team"; label: string; hint: string; color: string; soft: string }[] = [
  { id: "metier", label: "Métier", hint: "Une fonction. Personne n’est personnifiée.", color: "#0f766e", soft: "#e6f4f2" },
  { id: "hybride", label: "Hybride", hint: "Métier plus un profil consenti.", color: "#0176d3", soft: "#eaf5fe" },
  { id: "impersonator", label: "Impersonator", hint: "Persona simulée, toujours étiquetée.", color: "#5b4cdb", soft: "#eeecfb" },
  { id: "team", label: "Équipe", hint: "De 2 à 12 personas, un panel.", color: "#8a6d1a", soft: "#f8f1dc" },
];

function TypeChoice({ onPick, onClose }: { onPick: (kind: (typeof AGENT_TYPES)[number]["id"]) => void; onClose: () => void }) {
  return (
    <Panel>
      <h2 className="text-sm font-medium">Choisissez le type d’agent</h2>
      <p className="mt-1 text-sm text-muted">Il n’a pas besoin d’être déjà dans le registre.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {AGENT_TYPES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item.id)}
            className="rounded-xl border border-line px-3 py-3 text-left"
            style={{ background: item.soft, borderLeft: `4px solid ${item.color}` }}
          >
            <span className="text-xs font-bold uppercase tracking-[0.08em]" style={{ color: item.color }}>{item.label}</span>
            <span className="mt-1 block text-sm text-ink-soft">{item.hint}</span>
          </button>
        ))}
      </div>
      <Button className="mt-3" variant="ghost" onClick={onClose}>Annuler</Button>
    </Panel>
  );
}

function MetierSim({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [question, setQuestion] = useState("Faut-il lancer le pilote de 90 jours sans plancher de marge écrit ?");
  const [result, setResult] = useState<ReturnType<typeof simulateMetier> | null>(null);

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted">Simulation de fonction · {agent.provider}</p>
          <h2 className="text-lg font-medium">{agent.name}</h2>
          <p className="text-sm text-ink-soft">{agent.role} · {agent.department}. Aucune personne n’est jouée.</p>
        </div>
        <Button variant="ghost" onClick={onClose}>Fermer</Button>
      </div>
      {!agent.enabled ? (
        <p className="mt-3 text-sm text-hold">Cet agent est inactif dans les collectifs. La simulation ne le réactive pas.</p>
      ) : null}
      <Field label="Question à instruire">
        <TextArea className="mt-3" value={question} onChange={(event) => setQuestion(event.target.value)} />
      </Field>
      <Button className="mt-3" onClick={() => setResult(simulateMetier(agent, question))} disabled={question.trim().length < 3}>
        Lancer la simulation
      </Button>
      {result?.status === "clarify" ? (
        <p className="mt-4 rounded-lg bg-info-soft px-3 py-3 text-sm text-info" role="status">{result.ask}</p>
      ) : null}
      {result?.status === "ready" ? (
        <div className="mt-4 grid gap-3 rounded-lg bg-paper px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <VerdictPill verdict={result.contribution.verdict} />
            <span className="text-xs text-muted">{result.provider} · {result.contribution.metric}</span>
          </div>
          {result.contribution.strengths.map((item) => <p key={item} className="text-sm">{item}</p>)}
          {result.contribution.objections.map((item) => <p key={item} className="text-sm text-ink-soft">{item}</p>)}
          {result.contribution.conditions.length ? (
            <ul className="list-disc pl-5 text-sm">
              {result.contribution.conditions.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
          <p className="text-xs text-muted">Avis consultatif. Ce n’est pas un arbitrage.</p>
        </div>
      ) : null}
    </Panel>
  );
}

function MetierForm({
  existing,
  onClose,
  onCreate,
  onUpdate,
}: {
  existing?: Agent;
  onClose: () => void;
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
  }) => { ok: boolean; reason?: string };
  onUpdate: (id: string, agent: {
    name: string;
    role: string;
    department: string;
    mission: string;
    veto: boolean;
    enabled: boolean;
    consented: boolean;
    simulation: boolean;
    clues: string;
    brief?: string;
  }) => { ok: boolean; reason?: string };
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [role, setRole] = useState(existing?.role ?? "");
  const [department, setDepartment] = useState(existing?.department ?? "");
  const [mission, setMission] = useState(existing?.mission ?? "");
  const [brief, setBrief] = useState(existing?.brief ?? "");
  const [veto, setVeto] = useState(existing?.veto ?? false);
  const [error, setError] = useState("");

  function save() {
    if (!name.trim() || !role.trim() || !department.trim() || !mission.trim()) {
      setError("Nom, fonction, service et mission sont requis.");
      return;
    }
    const draft = {
      name: name.trim(),
      role: role.trim(),
      department: department.trim(),
      mission: mission.trim(),
      brief: brief.trim(),
      veto,
      enabled: existing?.enabled ?? true,
      consented: false,
      simulation: false,
      clues: "",
    };
    const result = existing ? onUpdate(existing.id, draft) : onCreate({ ...draft, kind: "metier" });
    if (!result.ok) setError(result.reason ?? "Refusé");
    else onClose();
  }

  return (
    <Panel>
      <h2 className="text-sm font-medium">{existing ? `Modifier ${existing.name}` : "Nouvel agent métier"}</h2>
      <p className="mt-1 text-sm text-muted">Fiche de fonction. Aucune personne n’est simulée.</p>
      <div className="mt-4 grid gap-4">
        <Field label="Nom">
          <input className={controlClass} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fonction">
            <input className={controlClass} value={role} onChange={(event) => setRole(event.target.value)} />
          </Field>
          <Field label="Service">
            <input className={controlClass} value={department} onChange={(event) => setDepartment(event.target.value)} />
          </Field>
        </div>
        <Field label="Mission" hint="Ce que cet agent défend dans une décision.">
          <TextArea value={mission} onChange={(event) => setMission(event.target.value)} />
        </Field>
        <Field label="Consignes" hint="Comment il instruit. Ce n’est pas un profil de personne.">
          <TextArea value={brief} onChange={(event) => setBrief(event.target.value)} />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 size-4" checked={veto} onChange={(event) => setVeto(event.target.checked)} />
          <span>Droit de veto dans un collectif qui l’autorise.</span>
        </label>
        {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
        <div className="flex gap-2">
          <Button onClick={save}>{existing ? "Enregistrer les modifications" : "Créer l’agent métier"}</Button>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
        </div>
      </div>
    </Panel>
  );
}

function Composer({
  mode,
  existing,
  onClose,
  onAgent,
  onUpdate,
  onTeam,
}: {
  mode: "metier" | "hybride" | "impersonator" | "team";
  existing?: Agent;
  onClose: () => void;
  onAgent: (agent: {
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
  }) => { ok: boolean; reason?: string };
  onUpdate: (id: string, agent: {
    name: string;
    role: string;
    department: string;
    mission: string;
    veto: boolean;
    enabled: boolean;
    consented: boolean;
    simulation: boolean;
    clues: string;
  }) => { ok: boolean; reason?: string };
  onTeam: (names: string[], clues: string) => { ok: boolean; reason?: string };
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [role, setRole] = useState(existing?.role ?? (mode === "metier" ? "Contrôle de gestion" : "Persona simulée"));
  const [department, setDepartment] = useState(existing?.department ?? (mode === "metier" ? "Support" : "Simulation"));
  const [mission, setMission] = useState(existing?.mission ?? "");
  const [clues, setClues] = useState(existing?.clues ?? "");
  const [veto, setVeto] = useState(existing?.veto ?? false);
  const [consent, setConsent] = useState(existing?.consented ?? false);
  const [guards, setGuards] = useState<boolean[]>(GUARDRAILS.map(() => Boolean(existing?.consented)));
  const [team, setTeam] = useState("Camille Achats\nJordan Achats\nAlex Risque");
  const [source, setSource] = useState<"manuel" | "json" | "disc" | "api">("manuel");
  const [disc, setDisc] = useState("Di");
  const [error, setError] = useState("");
  const personal = mode !== "metier";

  function save() {
    if (mode === "team") {
      if (source === "api") {
        setError("CRYSTALKNOWS_API_TOKEN absent. Aucun appel. L’équipe n’est pas créée.");
        return;
      }
      if (!consent || guards.some((item) => !item)) {
        setError("Cochez le consentement et les cinq garde-fous avant d’ouvrir le panel.");
        return;
      }
      const result = onTeam(team.split("\n"), source === "disc" ? `DISC ${disc}` : clues);
      if (!result.ok) setError(result.reason ?? "Refusé");
      else onClose();
      return;
    }
    if (personal && source === "api") {
      setError("CRYSTALKNOWS_API_TOKEN absent. Aucun appel. Utilisez un export JSON ou un type DISC.");
      return;
    }
    if (personal && (!consent || guards.some((item) => !item))) {
      setError("Cochez le consentement et les cinq garde-fous avant d’enregistrer.");
      return;
    }
    const clueText = source === "json"
      ? clues.trim() || "Export JSON Crystal autorisé"
      : source === "disc"
        ? `DISC ${disc} · saisie autorisée, pas d’appel API`
        : clues;
    const draft = {
      name: name.trim(),
      role,
      department,
      mission: mission.trim() || "Instruit dans son périmètre.",
      veto: mode === "metier" && veto,
      enabled: existing?.enabled ?? true,
      consented: personal && consent,
      simulation: personal && consent,
      clues: clueText,
    };
    const result = existing
      ? onUpdate(existing.id, draft)
      : onAgent({ ...draft, kind: mode });
    if (!result.ok) setError(result.reason ?? "Refusé");
    else onClose();
  }

  const title = existing
    ? `Modifier ${existing.name}`
    : mode === "team"
      ? "Nouvelle équipe d’impersonators"
      : mode === "hybride"
        ? "Nouvel agent hybride"
        : mode === "impersonator"
          ? "Nouvel impersonator"
          : "Nouvel agent métier";

  return (
    <Panel>
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="mt-4 grid gap-4">
        {mode === "team" ? (
          <Field label="Personas, une par ligne" hint="Entre 2 et 12. Le collectif du panel est ouvert et sélectionné si votre quota le permet.">
            <TextArea value={team} onChange={(event) => setTeam(event.target.value)} />
          </Field>
        ) : (
          <>
            <Field label="Nom">
              <input className={controlClass} value={name} onChange={(event) => setName(event.target.value)} required />
            </Field>
            <Field label="Rôle">
              <input className={controlClass} value={role} onChange={(event) => setRole(event.target.value)} />
            </Field>
            <Field label="Service">
              <input className={controlClass} value={department} onChange={(event) => setDepartment(event.target.value)} />
            </Field>
            <Field label="Mission">
              <TextArea value={mission} onChange={(event) => setMission(event.target.value)} />
            </Field>
            {mode === "metier" ? (
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 size-4" checked={veto} onChange={(event) => setVeto(event.target.checked)} />
                <span>Droit de veto dans un collectif qui l’autorise.</span>
              </label>
            ) : null}
          </>
        )}
        {personal ? (
          <>
            <Field label="Source du profil" hint="L’API Crystal n’est pas appelée sans jeton serveur.">
              <select className={controlClass} value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
                <option value="manuel">Saisie manuelle</option>
                <option value="json">Export JSON autorisé</option>
                <option value="disc">Type DISC</option>
                <option value="api">API Crystal Knows</option>
              </select>
            </Field>
            {source === "disc" ? (
              <Field label="Type DISC">
                <select className={controlClass} value={disc} onChange={(event) => setDisc(event.target.value)}>
                  {["D", "I", "S", "C", "Di", "Sc"].map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
            ) : source === "api" ? (
              <p className="rounded-lg bg-hold-soft px-3 py-2 text-sm text-hold">Jeton serveur absent. Ce choix ne peut pas être enregistré.</p>
            ) : (
              <Field label="Indices autorisés" hint="Export, entretien consenti, ou saisie. Pas d’URL à visiter.">
                <TextArea value={clues} onChange={(event) => setClues(event.target.value)} />
              </Field>
            )}
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 size-4" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span>Je confirme un consentement explicite. Sans cette case, rien n’est enregistré.</span>
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Garde-fous</legend>
              {GUARDRAILS.map((rule, index) => (
                <label key={rule} className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4"
                    checked={guards[index]}
                    onChange={() => setGuards((current) => current.map((item, i) => (i === index ? !item : item)))}
                  />
                  <span>{rule}</span>
                </label>
              ))}
            </fieldset>
          </>
        ) : null}
        {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
        <div className="flex gap-2">
          <Button onClick={save} disabled={mode !== "team" && !name.trim()}>{existing ? "Enregistrer les modifications" : "Créer"}</Button>
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
        </div>
      </div>
    </Panel>
  );
}
