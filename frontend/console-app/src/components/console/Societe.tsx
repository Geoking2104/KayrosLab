import { useEffect, useState } from "react";
import { Building2, FolderKanban, Gavel, Library, Loader, MessageCircleQuestion, Users } from "lucide-react";
import { useConsole } from "@/lib/console/store";
import { api } from "@/lib/console/api";
import type { Project } from "@/lib/console/live";
import type { ThreadStatus, Verdict } from "@/lib/console/model";
import { Button, Empty, Field, Panel, StatusPill, TextArea, VerdictPill, controlClass } from "./ui";
import { go } from "./Shell";
import { t, tc } from "@/lib/i18n";

type DashThread = { thread_id: string; session_id: string; question: string; status: ThreadStatus; verdict?: Verdict | null };
type DashProject = Project & { counts: Record<string, number>; threads: DashThread[] };
type Dashboard = {
  company: { id: string; name: string; sector: string; description: string } | null;
  projects: DashProject[];
  widgets: { projects_active: number; decisions: Record<string, number>; pending_arbitrations: DashThread[]; sessions: number; skills: number; contexts: number };
};

const PROJECT_STATUS: Record<Project["status"], string> = {
  get draft() { return t("Brouillon"); },
  get active() { return t("En cours"); },
  get paused() { return t("En pause"); },
  get closed() { return t("Clos"); },
};

function Widget({ icon: Icon, label, value, onClick }: { icon: typeof Users; label: string; value: number | string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-4 text-left hover:bg-paper" disabled={!onClick}>
      <Icon className="size-5 text-accent" aria-hidden />
      <span>
        <span className="block text-2xl font-semibold tabular-nums">{value}</span>
        <span className="block text-xs text-muted">{label}</span>
      </span>
    </button>
  );
}

/** Tableau de bord société : page d’entrée de la console. */
export function Societe() {
  const { live, state, workspace, saveItem } = useConsole();
  const [companyId, setCompanyId] = useState("");
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState<"" | "company" | "project">("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!live) return;
    let stop = false;
    api.dashboard(companyId || undefined).then((data) => { if (!stop) { setDash(data); setError(""); } }).catch((e) => !stop && setError(e.message));
    return () => { stop = true; };
  }, [live, companyId, tick, workspace, state.threads]);

  if (!live) {
    const counts = { awaiting: state.threads.filter((x) => x.status === "awaiting_arbitration").length, running: state.threads.filter((x) => x.status === "running").length };
    return (
      <div className="grid gap-4">
        <Panel>
          <h2 className="text-base font-medium">{t("Tableau de bord société")}</h2>
          <p className="mt-1 text-sm text-muted">{t("Sociétés et projets sont enregistrés côté API. Connectez-vous depuis Connexions pour les créer ; la démo reste disponible.")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => go("connexions")}>{t("Se connecter à l’API")}</Button>
            <Button variant="secondary" onClick={() => go("overview")}>{t("Continuer en démo")}</Button>
          </div>
        </Panel>
        <div className="grid gap-3 sm:grid-cols-3">
          <Widget icon={Gavel} label={t("À arbitrer (démo)")} value={counts.awaiting} onClick={() => go("dossiers")} />
          <Widget icon={Loader} label={t("En cours (démo)")} value={counts.running} onClick={() => go("dossiers")} />
          <Widget icon={Users} label={t("Collectifs (démo)")} value={state.collectives.length} onClick={() => go("collectifs")} />
        </div>
      </div>
    );
  }

  const company = dash?.company ?? null;
  const refresh = () => setTick((n) => n + 1);

  return (
    <div className="grid gap-4">
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <Building2 className="size-5 text-accent" aria-hidden />
          {workspace.companies.length > 1 ? (
            <select aria-label={t("Société")} className={controlClass + " max-w-xs"} value={company?.id ?? ""} onChange={(e) => setCompanyId(e.target.value)}>
              {workspace.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <h2 className="text-base font-medium">{company?.name ?? t("Aucune société")}</h2>
          )}
          {company?.sector ? <span className="text-sm text-muted">{company.sector}</span> : null}
          <span className="ml-auto flex gap-2">
            {company ? <Button onClick={() => setCreating("project")}>{t("Nouveau projet")}</Button> : null}
            <Button variant="secondary" onClick={() => setCreating("company")}>{t("Nouvelle société")}</Button>
          </span>
        </div>
        {company?.description ? <p className="mt-2 text-sm text-ink-soft">{company.description}</p> : null}
        {error ? <p className="mt-2 text-sm text-stop" role="alert">{error}</p> : null}
      </Panel>

      {creating === "company" ? <CompanyForm onClose={() => setCreating("")} onSaved={(id) => { setCompanyId(id); refresh(); }} save={saveItem} /> : null}
      {creating === "project" && company ? <ProjectForm companyId={company.id} onClose={() => setCreating("")} onSaved={refresh} save={saveItem} /> : null}

      {dash ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Widget icon={FolderKanban} label={t("Projets en cours")} value={dash.widgets.projects_active} />
          <Widget icon={Gavel} label={t("À arbitrer")} value={dash.widgets.decisions.awaiting_arbitration ?? 0} onClick={() => go("dossiers")} />
          <Widget icon={Loader} label={t("En instruction")} value={dash.widgets.decisions.running ?? 0} onClick={() => go("dossiers")} />
          <Widget icon={MessageCircleQuestion} label={t("Précision attendue")} value={dash.widgets.decisions.needs_clarification ?? 0} onClick={() => go("dossiers")} />
          <Widget icon={Users} label={t("Collectifs")} value={dash.widgets.sessions} onClick={() => go("collectifs")} />
          <Widget icon={Library} label={t("Skills et contextes")} value={dash.widgets.skills + dash.widgets.contexts} onClick={() => go("bibliotheque")} />
        </div>
      ) : null}

      {!company ? (
        <Empty title={t("Créez votre première société")} body={t("Une société regroupe des projets ; chaque projet suit ses collectifs et ses dossiers de décision.")} action={<Button onClick={() => setCreating("company")}>{t("Nouvelle société")}</Button>} />
      ) : dash && !dash.projects.length ? (
        <Empty title={t("Aucun projet")} body={t("Ajoutez un projet et rattachez-y un collectif : ses dossiers apparaîtront ici.")} action={<Button onClick={() => setCreating("project")}>{t("Nouveau projet")}</Button>} />
      ) : null}

      {dash?.projects.map((project) => (
        <Panel key={project.id}>
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-medium">{project.name}</h3>
            <span className="rounded-full bg-paper-2 px-2 py-0.5 text-xs">{PROJECT_STATUS[project.status]}</span>
            {project.owner ? <span className="text-xs text-muted">{t("Porteur : {{v}}", { v: project.owner })}</span> : null}
            {project.due_date ? <span className="text-xs text-muted">{t("Échéance : {{v}}", { v: project.due_date })}</span> : null}
            <span className="ml-auto text-xs text-muted">
              {t("{{a}} à arbitrer · {{r}} en cours · {{d}} clos", { a: project.counts.awaiting_arbitration ?? 0, r: project.counts.running ?? 0, d: project.counts.resolved ?? 0 })}
            </span>
          </div>
          {project.goal ? <p className="mt-1 text-sm text-ink-soft">{project.goal}</p> : null}
          <p className="mt-2 text-xs text-muted">
            {t("Collectifs : {{v}}", { v: project.session_ids.map((id) => tc(state.collectives.find((c) => c.id === id)?.name) || id).join(", ") || "—" })}
          </p>
          {project.threads.length ? (
            <ul className="mt-3 grid gap-2">
              {project.threads.map((thread) => (
                <li key={thread.thread_id}>
                  <button type="button" className="flex w-full items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-sm hover:bg-paper" onClick={() => go("dossiers", thread.thread_id)}>
                    <span className="min-w-0 flex-1 truncate">{thread.question}</span>
                    {thread.verdict ? <VerdictPill verdict={thread.verdict} /> : null}
                    <StatusPill status={thread.status === ("arbitrated" as ThreadStatus) ? "resolved" : thread.status} />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-muted">{t("Aucun dossier pour ce projet.")}</p>}
        </Panel>
      ))}
    </div>
  );
}

type Save = ReturnType<typeof useConsole>["saveItem"];

function CompanyForm({ onClose, onSaved, save }: { onClose: () => void; onSaved: (id: string) => void; save: Save }) {
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  return (
    <Panel>
      <h3 className="text-sm font-medium">{t("Nouvelle société")}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={t("Nom")}><input className={controlClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t("Secteur")}><input className={controlClass} value={sector} onChange={(e) => setSector(e.target.value)} /></Field>
      </div>
      <div className="mt-3"><Field label={t("Description")}><TextArea value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div>
      {error ? <p className="mt-2 text-sm text-stop" role="alert">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button onClick={async () => {
          if (!name.trim()) { setError(t("Le nom est requis.")); return; }
          const res = await save("companies", null, { name: name.trim(), sector: sector.trim(), description: description.trim() });
          if (!res.ok) setError(res.reason ?? t("Refusé")); else { onSaved(res.id ?? ""); onClose(); }
        }}>{t("Créer la société")}</Button>
        <Button variant="ghost" onClick={onClose}>{t("Annuler")}</Button>
      </div>
    </Panel>
  );
}

function ProjectForm({ companyId, onClose, onSaved, save }: { companyId: string; onClose: () => void; onSaved: () => void; save: Save }) {
  const { state } = useConsole();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [sessions, setSessions] = useState<string[]>([]);
  const [error, setError] = useState("");
  return (
    <Panel>
      <h3 className="text-sm font-medium">{t("Nouveau projet")}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label={t("Nom")}><input className={controlClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t("Porteur")}><input className={controlClass} value={owner} onChange={(e) => setOwner(e.target.value)} /></Field>
        <Field label={t("Échéance")}><input type="date" className={controlClass} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      </div>
      <div className="mt-3"><Field label={t("Objectif")}><TextArea value={goal} onChange={(e) => setGoal(e.target.value)} /></Field></div>
      <fieldset className="mt-3">
        <legend className="text-sm font-medium">{t("Collectifs suivis")}</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {state.collectives.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={sessions.includes(c.id)} onChange={(e) => setSessions(e.target.checked ? [...sessions, c.id] : sessions.filter((id) => id !== c.id))} />
              {tc(c.name)}
            </label>
          ))}
          {!state.collectives.length ? <span className="text-sm text-muted">{t("Aucun collectif : créez-en un dans Collectifs.")}</span> : null}
        </div>
      </fieldset>
      {error ? <p className="mt-2 text-sm text-stop" role="alert">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button onClick={async () => {
          if (!name.trim()) { setError(t("Le nom est requis.")); return; }
          const res = await save("projects", null, { company_id: companyId, name: name.trim(), goal: goal.trim(), owner: owner.trim(), due_date: due, session_ids: sessions });
          if (!res.ok) setError(res.reason ?? t("Refusé")); else { onSaved(); onClose(); }
        }}>{t("Créer le projet")}</Button>
        <Button variant="ghost" onClick={onClose}>{t("Annuler")}</Button>
      </div>
    </Panel>
  );
}
