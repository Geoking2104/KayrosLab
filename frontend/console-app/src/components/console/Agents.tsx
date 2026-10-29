import { useState } from "react";
import { useConsole } from "@/lib/console/store";
import { GUARDRAILS, kindLabel, simulateMetier, type Agent, type AgentKind } from "@/lib/console/model";
import { cn } from "@/lib/cn";
import { Button, Field, Panel, TextArea, VerdictPill, controlClass } from "./ui";
import { go } from "./Shell";
import { AgentMark } from "./agent-mark";
import { LinkedMark, ProfileLink, profileClue, type ProfileSource } from "./profile-link";
import { t, tc } from "@/lib/i18n";

function AgentFocus({ agent, dossierId }: { agent: Agent; dossierId: string }) {
  return (
    <div className="flex flex-col gap-5">
      <button type="button" className="w-fit text-sm text-muted" onClick={() => (dossierId ? go("dossiers", dossierId) : go("agents"))}>
        ← {dossierId ? t("Retour au dossier") : t("Tous les agents")}
      </button>
      <Panel>
        <div className="flex items-start gap-3">
          <AgentMark agent={agent} size={44} />
          <div>
            <p className="text-xs text-muted">{tc(agent.department)} · {kindLabel(agent.kind)} · {agent.provider}</p>
            <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-ink">{tc(agent.name)}</h1>
            <p className="text-sm text-ink-soft">{tc(agent.role)}{agent.veto ? t(" · droit de veto") : ""}{agent.enabled ? "" : t(" · inactif")}</p>
          </div>
        </div>
        <p className="mt-4 text-sm">{tc(agent.mission)}</p>
        {agent.brief ? <p className="mt-3 text-sm text-ink-soft">{tc(agent.brief)}</p> : null}
        <p className="mt-3 text-xs text-muted">{t("Modèle {{model}}.", { model: agent.model })} {agent.simulation ? t("Fiche de simulation.") : t("Agent de registre.")}</p>
        {agent.consented ? (
          <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-sm">{t("Simulation étiquetée. Indices : {{clues}}. Pas de décision matérielle.", { clues: tc(agent.clues) || t("saisie manuelle") })}</p>
        ) : null}
      </Panel>
    </div>
  );
}

const TABS: { id: AgentKind | "all"; label: string }[] = [
  { id: "all", get label() { return t("Tous"); } },
  { id: "metier", get label() { return t("Métier"); } },
  { id: "hybride", get label() { return t("Hybrides"); } },
  { id: "impersonator", get label() { return t("Impersonators"); } },
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
          <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-ink">{t("Agents")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t(
            "Ajoutez un agent qui n’est pas dans la liste. Le type se choisit ensuite : métier, hybride, impersonator ou équipe."
          )}</p>
        </div>
      </div>

      <Panel className={manager ? undefined : "bg-paper"}>
        <p className="text-sm font-medium">{manager ? t("Création et modification ouvertes.") : t("Consultation seule.")}</p>
        <p className="mt-1 text-sm text-muted">
          {manager
            ? t(
            "Une fiche existante se modifie sans en créer une autre. Le consentement reste exigé pour un profil personnifié."
          )
            : t(
            "Créer ou modifier un agent est réservé au COMEX. Passez en COMEX pour ouvrir les formulaires."
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setMode(null);
              setEditingId(null);
              setSimId(null);
              setPicking((open) => !open);
            }}
          >{t("Ajouter un agent")}</Button>
          {!manager ? <Button variant="secondary" onClick={() => setRole("comex")}>{t("Passer en COMEX")}</Button> : null}
        </div>
      </Panel>

      {picking && !mode ? (
        manager ? (
          <TypeChoice onPick={openCreate} onClose={() => setPicking(false)} />
        ) : (
          <Panel>
            <h2 className="text-sm font-medium">{t("Choix du type")}</h2>
            <p className="mt-1 text-sm text-muted">{t(
              "Créer un agent est réservé au COMEX. Passez en COMEX, puis choisissez le type."
            )}</p>
            <Button className="mt-3" onClick={() => setRole("comex")}>{t("Passer en COMEX")}</Button>
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
                  <p className="text-xs text-muted">{tc(agent.department)} · {kindLabel(agent.kind)} · {agent.provider}</p>
                  <h2 className="text-lg font-medium">{tc(agent.name)}</h2>
                  <p className="text-sm text-ink-soft">{tc(agent.role)}{agent.veto ? t(" · droit de veto") : ""}</p>
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
                  >{t("Modifier")}</Button>
                  {agent.kind === "metier" ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setMode(null);
                        setEditingId(null);
                        setSimId(agent.id);
                      }}
                    >{t("Simuler")}</Button>
                  ) : null}
                  <button
                    type="button"
                    disabled={!manager}
                    aria-pressed={agent.enabled}
                    onClick={() => setAgentEnabled(agent.id, !agent.enabled)}
                    className="min-h-11 rounded-lg border border-line px-3 text-sm disabled:opacity-50"
                  >
                    {agent.enabled ? t("Actif") : t("Inactif")}
                  </button>
                </div>
              </div>
              <p className="mt-3 text-sm">{tc(agent.mission)}</p>
              {agent.kind === "metier" && agent.brief ? <p className="mt-2 text-sm text-ink-soft">{tc(agent.brief)}</p> : null}
              {agent.consented ? (
                <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-sm">{t("Simulation étiquetée. Indices : {{clues}}. Pas de décision matérielle.", { clues: tc(agent.clues) || t("saisie manuelle") })}</p>
              ) : null}
            </Panel>
          ),
        )}
      </div>
      <p className="text-sm text-muted">{t(
        "Crystal Knows : jeton serveur absent, aucune fiche n’est téléchargée. Un impersonator se relie d’abord à une adresse CrystalKnows ou LinkedIn publique, conservée comme indice. Ces adresses ne sont pas visitées."
      )}</p>
    </div>
  );
}

const AGENT_TYPES: { id: "metier" | "hybride" | "impersonator" | "team"; label: string; hint: string; color: string; soft: string }[] = [
  { id: "metier", get label() { return t("Métier"); }, get hint() { return t("Une fonction. Personne n’est personnifiée."); }, color: "#0f766e", soft: "#e6f4f2" },
  { id: "hybride", get label() { return t("Hybride"); }, get hint() { return t("Métier plus un profil consenti."); }, color: "#0176d3", soft: "#eaf5fe" },
  { id: "impersonator", get label() { return t("Impersonator"); }, get hint() { return t("Reliez CrystalKnows ou LinkedIn, puis la fiche."); }, color: "#5b4cdb", soft: "#eeecfb" },
  { id: "team", get label() { return t("Équipe"); }, get hint() { return t("De 2 à 12 personas, un panel."); }, color: "#8a6d1a", soft: "#f8f1dc" },
];

function TypeChoice({ onPick, onClose }: { onPick: (kind: (typeof AGENT_TYPES)[number]["id"]) => void; onClose: () => void }) {
  return (
    <Panel>
      <h2 className="text-sm font-medium">{t("Choisissez le type d’agent")}</h2>
      <p className="mt-1 text-sm text-muted">{t("Il n’a pas besoin d’être déjà dans le registre.")}</p>
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
      <Button className="mt-3" variant="ghost" onClick={onClose}>{t("Annuler")}</Button>
    </Panel>
  );
}

function MetierSim({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [question, setQuestion] = useState(t("Faut-il lancer le pilote de 90 jours sans plancher de marge écrit ?"));
  const [result, setResult] = useState<ReturnType<typeof simulateMetier> | null>(null);

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted">{t("Simulation de fonction · {{provider}}", { provider: agent.provider })}</p>
          <h2 className="text-lg font-medium">{tc(agent.name)}</h2>
          <p className="text-sm text-ink-soft">{t("{{role}} · {{department}}. Aucune personne n’est jouée.", { role: tc(agent.role), department: tc(agent.department) })}</p>
        </div>
        <Button variant="ghost" onClick={onClose}>{t("Fermer")}</Button>
      </div>
      {!agent.enabled ? (
        <p className="mt-3 text-sm text-hold">{t(
          "Cet agent est inactif dans les collectifs. La simulation ne le réactive pas."
        )}</p>
      ) : null}
      <Field label={t("Question à instruire")}>
        <TextArea className="mt-3" value={question} onChange={(event) => setQuestion(event.target.value)} />
      </Field>
      <Button className="mt-3" onClick={() => setResult(simulateMetier(agent, question))} disabled={question.trim().length < 3}>{t("Lancer la simulation")}</Button>
      {result?.status === "clarify" ? (
        <p className="mt-4 rounded-lg bg-info-soft px-3 py-3 text-sm text-info" role="status">{result.ask}</p>
      ) : null}
      {result?.status === "ready" ? (
        <div className="mt-4 grid gap-3 rounded-lg bg-paper px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <VerdictPill verdict={result.contribution.verdict} />
            <span className="text-xs text-muted">{result.provider} · {tc(result.contribution.metric)}</span>
          </div>
          {result.contribution.strengths.map((item) => <p key={item} className="text-sm">{tc(item)}</p>)}
          {result.contribution.objections.map((item) => <p key={item} className="text-sm text-ink-soft">{tc(item)}</p>)}
          {result.contribution.conditions.length ? (
            <ul className="list-disc pl-5 text-sm">
              {result.contribution.conditions.map((item) => <li key={item}>{tc(item)}</li>)}
            </ul>
          ) : null}
          <p className="text-xs text-muted">{t("Avis consultatif. Ce n’est pas un arbitrage.")}</p>
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
  const [name, setName] = useState(tc(existing?.name));
  const [role, setRole] = useState(tc(existing?.role));
  const [department, setDepartment] = useState(tc(existing?.department));
  const [mission, setMission] = useState(tc(existing?.mission));
  const [brief, setBrief] = useState(tc(existing?.brief));
  const [veto, setVeto] = useState(existing?.veto ?? false);
  const [error, setError] = useState("");

  function save() {
    if (!name.trim() || !role.trim() || !department.trim() || !mission.trim()) {
      setError(t("Nom, fonction, service et mission sont requis."));
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
    if (!result.ok) setError(result.reason ?? t("Refusé"));
    else onClose();
  }

  return (
    <Panel>
      <h2 className="text-sm font-medium">{existing ? t("Modifier {{name}}", { name: tc(existing.name) }) : t("Nouvel agent métier")}</h2>
      <p className="mt-1 text-sm text-muted">{t("Fiche de fonction. Aucune personne n’est simulée.")}</p>
      <div className="mt-4 grid gap-4">
        <Field label={t("Nom")}>
          <input className={controlClass} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Fonction")}>
            <input className={controlClass} value={role} onChange={(event) => setRole(event.target.value)} />
          </Field>
          <Field label={t("Service")}>
            <input className={controlClass} value={department} onChange={(event) => setDepartment(event.target.value)} />
          </Field>
        </div>
        <Field label={t("Mission")} hint={t("Ce que cet agent défend dans une décision.")}>
          <TextArea value={mission} onChange={(event) => setMission(event.target.value)} />
        </Field>
        <Field label={t("Consignes")} hint={t("Comment il instruit. Ce n’est pas un profil de personne.")}>
          <TextArea value={brief} onChange={(event) => setBrief(event.target.value)} />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 size-4" checked={veto} onChange={(event) => setVeto(event.target.checked)} />
          <span>{t("Droit de veto dans un collectif qui l’autorise.")}</span>
        </label>
        {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
        <div className="flex gap-2">
          <Button onClick={save}>{existing ? t("Enregistrer les modifications") : t("Créer l’agent métier")}</Button>
          <Button variant="ghost" onClick={onClose}>{t("Annuler")}</Button>
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
  const [name, setName] = useState(tc(existing?.name));
  const [role, setRole] = useState(existing ? tc(existing.role) : (mode === "metier" ? t("Contrôle de gestion") : t("Persona simulée")));
  const [department, setDepartment] = useState(existing ? tc(existing.department) : (mode === "metier" ? "Support" : "Simulation"));
  const [mission, setMission] = useState(tc(existing?.mission));
  const [clues, setClues] = useState(tc(existing?.clues));
  const [veto, setVeto] = useState(existing?.veto ?? false);
  const [consent, setConsent] = useState(existing?.consented ?? false);
  const [guards, setGuards] = useState<boolean[]>(GUARDRAILS.map(() => Boolean(existing?.consented)));
  const [team, setTeam] = useState(t("Camille Achats\nJordan Achats\nAlex Risque"));
  const [source, setSource] = useState<"manuel" | "json" | "disc" | "api">("manuel");
  const [disc, setDisc] = useState("Di");
  const [error, setError] = useState("");
  const [link, setLink] = useState<null | { source: ProfileSource; url: string }>(null);
  const personal = mode !== "metier";
  const gate = mode === "impersonator" && !existing && !link;

  function acceptLink(next: ProfileSource, url: string) {
    setLink({ source: next, url });
    setClues(profileClue(next, url));
    setSource("manuel");
    setError("");
  }

  function save() {
    if (mode === "impersonator" && !existing && !link) {
      setError(t("Reliez CrystalKnows ou un profil public LinkedIn avant la fiche."));
      return;
    }
    if (mode === "team") {
      if (source === "api") {
        setError(t("CRYSTALKNOWS_API_TOKEN absent. Aucun appel. L’équipe n’est pas créée."));
        return;
      }
      if (!consent || guards.some((item) => !item)) {
        setError(t("Cochez le consentement et les cinq garde-fous avant d’ouvrir le panel."));
        return;
      }
      const result = onTeam(team.split("\n"), source === "disc" ? `DISC ${disc}` : clues);
      if (!result.ok) setError(result.reason ?? t("Refusé"));
      else onClose();
      return;
    }
    if (personal && source === "api") {
      setError(t(
        "CRYSTALKNOWS_API_TOKEN absent. Aucun appel. Utilisez un export JSON ou un type DISC."
      ));
      return;
    }
    if (personal && (!consent || guards.some((item) => !item))) {
      setError(t("Cochez le consentement et les cinq garde-fous avant d’enregistrer."));
      return;
    }
    const clueText = mode === "impersonator" && link
      ? (clues.trim().includes(link.url) ? clues.trim() : `${profileClue(link.source, link.url)}${clues.trim() ? ` · ${clues.trim()}` : ""}`)
      : source === "json"
        ? clues.trim() || t("Export JSON Crystal autorisé")
        : source === "disc"
          ? t("DISC {{disc}} · saisie autorisée, pas d’appel API", {
      disc
    })
          : clues;
    const draft = {
      name: name.trim(),
      role,
      department,
      mission: mission.trim() || t("Instruit dans son périmètre."),
      veto: mode === "metier" && veto,
      enabled: existing?.enabled ?? true,
      consented: personal && consent,
      simulation: personal && consent,
      clues: clueText,
    };
    const result = existing
      ? onUpdate(existing.id, draft)
      : onAgent({ ...draft, kind: mode });
    if (!result.ok) setError(result.reason ?? t("Refusé"));
    else onClose();
  }

  const title = existing
    ? t("Modifier {{name}}", { name: tc(existing.name) })
    : mode === "team"
      ? t("Nouvelle équipe d’impersonators")
      : mode === "hybride"
        ? t("Nouvel agent hybride")
        : mode === "impersonator"
          ? t("Nouvel impersonator")
          : t("Nouvel agent métier");

  if (gate) {
    return (
      <Panel>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-violet">{t("Impersonator · simulation")}</p>
        <div className="mt-3">
          <ProfileLink onContinue={acceptLink} />
        </div>
        <Button className="mt-4" variant="ghost" onClick={onClose}>{t("Annuler")}</Button>
      </Panel>
    );
  }

  return (
    <Panel>
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="mt-4 grid gap-4">
        {mode === "team" ? (
          <Field label={t("Personas, une par ligne")} hint={t(
            "Entre 2 et 12. Le collectif du panel est ouvert et sélectionné si votre quota le permet."
          )}>
            <TextArea value={team} onChange={(event) => setTeam(event.target.value)} />
          </Field>
        ) : (
          <>
            <Field label={t("Nom")}>
              <input className={controlClass} value={name} onChange={(event) => setName(event.target.value)} required />
            </Field>
            <Field label={t("Rôle")}>
              <input className={controlClass} value={role} onChange={(event) => setRole(event.target.value)} />
            </Field>
            <Field label={t("Service")}>
              <input className={controlClass} value={department} onChange={(event) => setDepartment(event.target.value)} />
            </Field>
            <Field label={t("Mission")}>
              <TextArea value={mission} onChange={(event) => setMission(event.target.value)} />
            </Field>
            {mode === "metier" ? (
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 size-4" checked={veto} onChange={(event) => setVeto(event.target.checked)} />
                <span>{t("Droit de veto dans un collectif qui l’autorise.")}</span>
              </label>
            ) : null}
          </>
        )}
        {personal ? (
          <>
            {mode === "impersonator" && link ? (
              <>
                <LinkedMark source={link.source} url={link.url} onChange={existing ? undefined : () => setLink(null)} />
                <Field label={t("Notes")} hint={t(
                  "L’adresse reste un indice. Elle n’est pas visitée, et aucune fiche n’est téléchargée."
                )}>
                  <TextArea value={clues} onChange={(event) => setClues(event.target.value)} />
                </Field>
              </>
            ) : (
              <>
                <Field label={t("Source du profil")} hint={t("L’API Crystal n’est pas appelée sans jeton serveur.")}>
                  <select className={controlClass} value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
                    <option value="manuel">{t("Saisie manuelle")}</option>
                    <option value="json">{t("Export JSON autorisé")}</option>
                    <option value="disc">{t("Type DISC")}</option>
                    <option value="api">{t("API Crystal Knows")}</option>
                  </select>
                </Field>
                {source === "disc" ? (
                  <Field label={t("Type DISC")}>
                    <select className={controlClass} value={disc} onChange={(event) => setDisc(event.target.value)}>
                      {["D", "I", "S", "C", "Di", "Sc"].map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </Field>
                ) : source === "api" ? (
                  <p className="rounded-lg bg-hold-soft px-3 py-2 text-sm text-hold">{t("Jeton serveur absent. Ce choix ne peut pas être enregistré.")}</p>
                ) : (
                  <Field label={t("Indices autorisés")} hint={t("Export, entretien consenti, ou saisie. Pas d’URL à visiter.")}>
                    <TextArea value={clues} onChange={(event) => setClues(event.target.value)} />
                  </Field>
                )}
              </>
            )}
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 size-4" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span>{t(
                "Je confirme un consentement explicite. Sans cette case, rien n’est enregistré."
              )}</span>
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{t("Garde-fous")}</legend>
              {GUARDRAILS.map((rule, index) => (
                <label key={rule} className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4"
                    checked={guards[index]}
                    onChange={() => setGuards((current) => current.map((item, i) => (i === index ? !item : item)))}
                  />
                  <span>{tc(rule)}</span>
                </label>
              ))}
            </fieldset>
          </>
        ) : null}
        {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
        <div className="flex gap-2">
          <Button onClick={save} disabled={mode !== "team" && !name.trim()}>{existing ? t("Enregistrer les modifications") : t("Créer")}</Button>
          <Button variant="ghost" onClick={onClose}>{t("Annuler")}</Button>
        </div>
      </div>
    </Panel>
  );
}
