import { useMemo, useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { useConsole } from "@/lib/console/store";
import type { Project, Stakeholder, StakeholderRole } from "@/lib/console/live";
import { Button, Empty, Panel, StatusPill, VerdictPill, controlClass } from "./ui";
import { ProjectGraph } from "./ProjectGraph";
import { go } from "./Shell";
import { t, tc } from "@/lib/i18n";

export const STAKEHOLDER_ROLES: { id: StakeholderRole; label: string; hint: string }[] = [
  { id: "decideur", get label() { return t("Décideur"); }, get hint() { return t("Arbitre et signe la décision"); } },
  { id: "sponsor", get label() { return t("Sponsor"); }, get hint() { return t("Porte le projet et ses moyens"); } },
  { id: "consulte", get label() { return t("Consulté"); }, get hint() { return t("Donne son avis avant l’arbitrage"); } },
  { id: "informe", get label() { return t("Informé"); }, get hint() { return t("Reçoit la décision"); } },
];

type ProjectView = Pick<Project, "id" | "name" | "goal" | "session_ids" | "thread_ids" | "stakeholders"> & { demo?: boolean };

/** Projets : liste, graphe de décision en lecture seule, parties prenantes et dossiers. */
export function Projets() {
  const { live, state, workspace, saveItem } = useConsole();
  const projects: ProjectView[] = useMemo(
    () => live
      ? workspace.projects
      // En mode démo, chaque collectif fait office de projet pour montrer le graphe.
      : state.collectives.map((c) => ({ id: `demo-${c.id}`, name: tc(c.name), goal: "", session_ids: [c.id], thread_ids: [], stakeholders: [], demo: true })),
    [live, workspace.projects, state.collectives],
  );
  const [projectId, setProjectId] = useState("");
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const threads = useMemo(
    () => (project ? state.threads.filter((th) => project.session_ids.includes(th.collectiveId) || project.thread_ids.includes(th.id)) : [])
      .slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [project, state.threads],
  );
  const [threadId, setThreadId] = useState("");
  const thread = threads.find((th) => th.id === threadId) ?? threads[0];
  const collective = state.collectives.find((c) => c.id === (thread?.collectiveId ?? project?.session_ids[0]));

  if (!projects.length) {
    return <Empty title={t("Aucun projet")} body={t("Ajoutez un projet et rattachez-y un collectif : ses dossiers apparaîtront ici.")} action={<Button onClick={() => go("societe")}>{t("Aller à la société")}</Button>} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-ink">{t("Projets")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("Chaque projet montre son cycle de décision en nœuds : question, collectif, avis des agents, porte de consensus, arbitrage humain. Les statuts se mettent à jour en direct.")}</p>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("Projets")}>
        {projects.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={p.id === project?.id} onClick={() => { setProjectId(p.id); setThreadId(""); }} className={`rounded-lg border px-3 py-1.5 text-sm ${p.id === project?.id ? "border-accent bg-accent-soft font-medium" : "border-line bg-surface"}`}>
            {p.name}
          </button>
        ))}
      </div>
      {project ? (
        <>
          {project.goal ? <p className="text-sm text-ink-soft">{project.goal}</p> : null}
          <Panel>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{t("Graphe de décision")}</h2>
              {threads.length > 1 ? (
                <select aria-label={t("Dossier affiché")} className={`${controlClass} ml-auto max-w-xs`} value={thread?.id ?? ""} onChange={(e) => setThreadId(e.target.value)}>
                  {threads.map((th) => <option key={th.id} value={th.id}>{th.question.slice(0, 60)}</option>)}
                </select>
              ) : null}
            </div>
            <ProjectGraph thread={thread} collective={collective} agents={state.agents} stakeholders={project.stakeholders} />
          </Panel>
          <Stakeholders project={project} onSave={project.demo ? undefined : (list) => saveItem("projects", project.id, { stakeholders: list })} />
          <Panel>
            <h2 className="mb-2 text-sm font-semibold">{t("Dossiers du projet")}</h2>
            {threads.length ? (
              <ul className="grid gap-2">
                {threads.map((th) => (
                  <li key={th.id}>
                    <button type="button" className="flex w-full items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-sm hover:bg-paper" onClick={() => go("projets", { thread: th.id })}>
                      <span className="min-w-0 flex-1 truncate">{th.question}</span>
                      {th.verdict ? <VerdictPill verdict={th.verdict} /> : null}
                      <StatusPill status={th.status} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">{t("Aucun dossier pour ce projet.")}</p>}
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function Stakeholders({ project, onSave }: { project: ProjectView; onSave?: (list: Stakeholder[]) => Promise<{ ok: boolean; reason?: string }> }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState<StakeholderRole>("decideur");
  const [error, setError] = useState("");
  const save = async (list: Stakeholder[]) => {
    if (!onSave) return;
    const res = await onSave(list);
    setError(res.ok ? "" : res.reason ?? t("Échec"));
  };
  return (
    <Panel>
      <h2 className="text-sm font-semibold">{t("Parties prenantes")}</h2>
      <p className="mb-3 text-xs text-muted">{t("Les humains autour de la décision. Le décideur apparaît sur le nœud d’arbitrage.")}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STAKEHOLDER_ROLES.map((r) => {
          const people = project.stakeholders.filter((s) => s.role === r.id);
          return (
            <div key={r.id} className="rounded-lg border border-line p-3" data-role={r.id}>
              <p className="text-sm font-medium">{r.label}</p>
              <p className="mb-2 text-[11px] text-muted">{r.hint}</p>
              {people.length ? (
                <ul className="grid gap-1">
                  {people.map((s) => (
                    <li key={`${s.name}-${s.title}`} className="flex items-center gap-1 text-sm">
                      <span className="min-w-0 flex-1 truncate">{s.name}{s.title ? <span className="text-muted"> · {s.title}</span> : null}</span>
                      {onSave ? (
                        <button type="button" aria-label={t("Retirer {{v}}", { v: s.name })} className="rounded p-1 text-muted hover:text-stop" onClick={() => void save(project.stakeholders.filter((x) => x !== s))}>
                          <Trash2 size={13} />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted">—</p>}
            </div>
          );
        })}
      </div>
      {onSave ? (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void save([...project.stakeholders, { name: name.trim(), title: title.trim(), role, email: "" }]).then(() => { setName(""); setTitle(""); });
        }}>
          <input aria-label={t("Nom")} placeholder={t("Nom")} className={`${controlClass} max-w-[200px]`} value={name} onChange={(e) => setName(e.target.value)} />
          <input aria-label={t("Fonction")} placeholder={t("Fonction")} className={`${controlClass} max-w-[200px]`} value={title} onChange={(e) => setTitle(e.target.value)} />
          <select aria-label={t("Rôle")} className={`${controlClass} max-w-[160px]`} value={role} onChange={(e) => setRole(e.target.value as StakeholderRole)}>
            {STAKEHOLDER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <Button type="submit"><UserPlus size={14} aria-hidden /> {t("Ajouter")}</Button>
        </form>
      ) : <p className="mt-3 text-xs text-muted">{t("Connectez-vous à l’API pour enregistrer.")}</p>}
      {error ? <p className="mt-2 text-xs text-stop" role="alert">{error}</p> : null}
    </Panel>
  );
}
