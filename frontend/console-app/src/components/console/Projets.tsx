import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, Pencil, Trash2, UserPlus } from "lucide-react";
import { useConsole } from "@/lib/console/store";
import { api } from "@/lib/console/api";
import type { GraphSpec, Project, Stakeholder, StakeholderRole } from "@/lib/console/live";
import { STAKEHOLDER_ROLES } from "@/lib/console/roles";
import { formatWhen } from "@/lib/console/model";
import { Button, Empty, Section, StatusPill, VerdictPill, controlClass } from "./ui";
import { ProjectGraph, defaultSpec } from "./ProjectGraph";
import { GraphEditor } from "./GraphEditor";
import { go } from "./Shell";
import { t, tc } from "@/lib/i18n";

export { STAKEHOLDER_ROLES };

type ProjectView = Pick<Project, "id" | "name" | "goal" | "session_ids" | "thread_ids" | "stakeholders"> & { company_id?: string; graph?: GraphSpec | null; demo?: boolean };
type Layer = { level: "societe" | "projet" | "noeud"; items: { id: string; name: string; kind: string; content: string }[] };
type Notification = { id: string; to: string; name: string; subject: string; status: "sent" | "queued" | "failed"; created_at: string; error?: string };

const LEVEL: Record<Layer["level"], () => string> = { societe: () => t("Société"), projet: () => t("Projet"), noeud: () => t("Nœud") };
const NOTIF: Record<Notification["status"], () => string> = { sent: () => t("Envoyé"), queued: () => t("En file (SMTP absent)"), failed: () => t("Échec") };

/** Projets : graphe de décision (lecture ou édition), contexte en cascade, parties prenantes, notifications, dossiers. */
export function Projets() {
  const { live, state, workspace, saveItem, permissions } = useConsole();
  const canManage = permissions.includes("manage");
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
  const [draft, setDraft] = useState<GraphSpec | null>(null);
  const [selected, setSelected] = useState("");
  const [graphError, setGraphError] = useState("");
  useEffect(() => { setDraft(null); setSelected(""); setGraphError(""); }, [project?.id]);

  if (!projects.length) {
    return <Empty title={t("Aucun projet")} body={t("Ajoutez un projet et rattachez-y un collectif : ses dossiers apparaîtront ici.")} action={<Button onClick={() => go("societe")}>{t("Aller à la société")}</Button>} />;
  }

  const spec = draft ?? project?.graph ?? null;
  const editable = Boolean(project && !project.demo && canManage);
  const saveGraph = async () => {
    if (!project || !draft) return;
    const res = await saveItem("projects", project.id, { graph: draft });
    if (res.ok) { setDraft(null); setSelected(""); setGraphError(""); } else setGraphError(res.reason ?? t("Refusé"));
  };

  return (
    <div className="flex flex-col gap-4">
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
          <Section id="projet-graphe" title={t("Graphe de décision")} summary={draft ? t("Modification en cours") : spec ? t("Graphe personnalisé") : t("Graphe standard")} actions={
            <>
              {threads.length > 1 ? (
                <select aria-label={t("Dossier affiché")} className={`${controlClass} max-w-xs`} value={thread?.id ?? ""} onChange={(e) => setThreadId(e.target.value)}>
                  {threads.map((th) => <option key={th.id} value={th.id}>{th.question.slice(0, 60)}</option>)}
                </select>
              ) : null}
              {editable && !draft ? <Button variant="secondary" onClick={() => setDraft(structuredClone(project.graph ?? defaultSpec(collective)))}><Pencil size={14} aria-hidden /> {t("Modifier le graphe")}</Button> : null}
              {draft ? (
                <>
                  <Button onClick={() => void saveGraph()}>{t("Enregistrer le graphe")}</Button>
                  <Button variant="ghost" onClick={() => { setDraft(null); setSelected(""); setGraphError(""); }}>{t("Annuler")}</Button>
                  {project.graph ? <Button variant="ghost" onClick={() => setDraft(defaultSpec(collective))}>{t("Revenir au graphe standard")}</Button> : null}
                </>
              ) : null}
            </>
          }>
            <div className="grid gap-3">
              <ProjectGraph thread={thread} collective={collective} agents={state.agents} stakeholders={project.stakeholders} spec={spec}
                selected={selected} onSelect={draft ? setSelected : live && !project.demo ? setSelected : undefined} />
              {draft ? <GraphEditor spec={draft} onChange={setDraft} selected={selected} onSelect={setSelected} agents={state.agents} collectives={state.collectives} /> : null}
              {graphError ? <p className="text-xs text-stop" role="alert">{graphError}</p> : null}
            </div>
          </Section>
          {!project.demo ? <ContextCascade project={project} nodeId={selected} /> : null}
          <Stakeholders project={project} onSave={project.demo || !canManage ? undefined : (list) => saveItem("projects", project.id, { stakeholders: list })} />
          {!project.demo ? <Notifications project={project} threadId={thread?.id} canSend={canManage} /> : null}
          <Section id="projet-dossiers" title={t("Dossiers du projet")} summary={t("{{n}} dossiers", { n: threads.length })}>
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
          </Section>
        </>
      ) : null}
    </div>
  );
}

/** Contexte hérité : société → projet → nœud sélectionné dans le graphe. */
function ContextCascade({ project, nodeId }: { project: ProjectView; nodeId: string }) {
  const { workspace } = useConsole();
  const [layers, setLayers] = useState<Layer[]>([]);
  useEffect(() => {
    let alive = true;
    api.projectContext(project.id, nodeId).then((res) => { if (alive) setLayers(res.layers as Layer[]); }).catch(() => { if (alive) setLayers([]); });
    return () => { alive = false; };
  }, [project.id, nodeId, workspace.contexts]);
  const total = layers.reduce((n, l) => n + l.items.length, 0);
  return (
    <Section id="projet-contexte" title={t("Contexte en cascade")} summary={t("{{n}} sources héritées", { n: total })}>
      <p className="mb-3 text-xs text-muted">{t("Les sources de la société s’appliquent au projet, puis au nœud choisi dans le graphe. Ajoutez-les depuis Bibliothèque → Skills et contexte.")}</p>
      <ol className="grid gap-2 sm:grid-cols-3" data-testid="context-cascade">
        {(["societe", "projet", "noeud"] as const).map((level) => {
          const layer = layers.find((l) => l.level === level);
          return (
            <li key={level} className="rounded-lg border border-line p-3" data-level={level}>
              <p className="text-sm font-medium">{LEVEL[level]()}{level === "noeud" ? <span className="text-muted"> · {nodeId || t("aucun nœud choisi")}</span> : null}</p>
              {layer?.items.length ? (
                <ul className="mt-1 grid gap-1 text-sm">{layer.items.map((c) => <li key={c.id} className="truncate" title={c.content}>{c.name}</li>)}</ul>
              ) : <p className="mt-1 text-xs text-muted">—</p>}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function Notifications({ project, threadId, canSend }: { project: ProjectView; threadId?: string; canSend: boolean }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(() => api.projectNotifications(project.id).then((r) => setItems(r.notifications as Notification[])).catch(() => setItems([])), [project.id]);
  useEffect(() => { void load(); }, [load]);
  const informed = project.stakeholders.filter((s) => s.role === "informe");
  return (
    <Section id="projet-notifications" title={t("Notifications aux informés")} summary={t("{{n}} envois", { n: items.length })} actions={canSend ? (
      <Button variant="secondary" disabled={!informed.some((s) => s.email)} onClick={async () => {
        try { await api.notifyProject(project.id, threadId); setError(""); await load(); } catch (e) { setError((e as Error).message); }
      }}><Mail size={14} aria-hidden /> {t("Notifier les informés")}</Button>
    ) : null}>
      <p className="mb-2 text-xs text-muted">{t("Chaque arbitrage envoie automatiquement la décision par e-mail aux parties prenantes « Informé » qui ont une adresse.")}</p>
      {!informed.length ? <p className="text-sm text-muted">{t("Aucune partie prenante « Informé ».")}</p> : null}
      {items.length ? (
        <ul className="grid gap-1 text-sm" data-testid="notifications">
          {items.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">{formatWhen(n.created_at)}</span>
              <span>{n.name || n.to} &lt;{n.to}&gt;</span>
              <span className={`rounded px-1.5 text-[11px] ${n.status === "sent" ? "bg-go-soft text-go" : n.status === "failed" ? "bg-stop-soft text-stop" : "bg-hold-soft text-hold"}`}>{NOTIF[n.status]()}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-2 text-xs text-stop" role="alert">{error}</p> : null}
    </Section>
  );
}

function Stakeholders({ project, onSave }: { project: ProjectView; onSave?: (list: Stakeholder[]) => Promise<{ ok: boolean; reason?: string }> }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StakeholderRole>("decideur");
  const [error, setError] = useState("");
  const save = async (list: Stakeholder[]) => {
    if (!onSave) return false;
    const res = await onSave(list);
    setError(res.ok ? "" : res.reason ?? t("Échec"));
    return res.ok;
  };
  return (
    <Section id="projet-parties-prenantes" title={t("Parties prenantes")} summary={t("{{n}} personnes", { n: project.stakeholders.length })}>
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
                      <span className="min-w-0 flex-1 truncate" title={s.email}>{s.name}{s.title ? <span className="text-muted"> · {s.title}</span> : null}{s.email ? <Mail size={11} className="ml-1 inline text-muted" aria-label={s.email} /> : null}</span>
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
          void save([...project.stakeholders, { name: name.trim(), title: title.trim(), role, email: email.trim() }]).then((ok) => { if (ok) { setName(""); setTitle(""); setEmail(""); } });
        }}>
          <input aria-label={t("Nom")} placeholder={t("Nom")} className={`${controlClass} max-w-[180px]`} value={name} onChange={(e) => setName(e.target.value)} />
          <input aria-label={t("Fonction")} placeholder={t("Fonction")} className={`${controlClass} max-w-[160px]`} value={title} onChange={(e) => setTitle(e.target.value)} />
          <input aria-label={t("E-mail")} placeholder={t("E-mail")} type="email" className={`${controlClass} max-w-[220px]`} value={email} onChange={(e) => setEmail(e.target.value)} />
          <select aria-label={t("Rôle")} className={`${controlClass} max-w-[160px]`} value={role} onChange={(e) => setRole(e.target.value as StakeholderRole)}>
            {STAKEHOLDER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <Button type="submit"><UserPlus size={14} aria-hidden /> {t("Ajouter")}</Button>
        </form>
      ) : <p className="mt-3 text-xs text-muted">{project.demo ? t("Connectez-vous à l’API pour enregistrer.") : t("Votre rôle ne permet pas de modifier le projet.")}</p>}
      {error ? <p className="mt-2 text-xs text-stop" role="alert">{error}</p> : null}
    </Section>
  );
}
