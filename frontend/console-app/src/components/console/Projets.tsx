import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, Pencil, Trash2, UserPlus } from "lucide-react";
import { useConsole } from "@/lib/console/store";
import { api } from "@/lib/console/api";
import type { GraphSpec, Pipeline, PipelineStep, PipelineStepStatus, Project, Stakeholder, StakeholderRole } from "@/lib/console/live";
import { STAKEHOLDER_ROLES } from "@/lib/console/roles";
import { formatWhen } from "@/lib/console/model";
import { Button, Empty, Section, StatusPill, VerdictPill, controlClass } from "./ui";
import { ProjectGraph, defaultSpec } from "./ProjectGraph";
import { GraphEditor, moveNode } from "./GraphEditor";
import { go } from "./Shell";
import { t, tc } from "@/lib/i18n";
import { BriefsPanel } from "./Briefs";

export { STAKEHOLDER_ROLES };

type ProjectView = Pick<Project, "id" | "name" | "goal" | "session_ids" | "thread_ids" | "stakeholders"> & { company_id?: string; graph?: GraphSpec | null; demo?: boolean };
type Layer = { level: "societe" | "projet" | "noeud"; items: { id: string; name: string; kind: string; content: string }[] };
type Notification = { id: string; to: string; name: string; subject: string; status: "sent" | "queued" | "failed"; created_at: string; error?: string };

const LEVEL: Record<Layer["level"], () => string> = { societe: () => t("Société"), projet: () => t("Projet"), noeud: () => t("Nœud") };
const NOTIF: Record<Notification["status"], () => string> = { sent: () => t("Envoyé"), queued: () => t("En file : SMTP non configuré"), failed: () => t("Échec") };

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
                selected={selected} onSelect={draft ? setSelected : live && !project.demo ? setSelected : undefined}
                onMove={draft ? (id, x, y) => setDraft((d) => (d ? moveNode(d, id, x, y) : d)) : undefined} />
              {draft ? <GraphEditor spec={draft} onChange={setDraft} selected={selected} onSelect={setSelected} agents={state.agents} collectives={state.collectives} /> : null}
              {graphError ? <p className="text-xs text-stop" role="alert">{graphError}</p> : null}
            </div>
          </Section>
          {!project.demo ? <ContextCascade project={project} nodeId={selected} /> : null}
          <Stakeholders project={project} onSave={project.demo || !canManage ? undefined : (list) => saveItem("projects", project.id, { stakeholders: list })} />
          {!project.demo && live ? <Pipelines project={project} canRun={permissions.includes("run")} canArbitrate={permissions.includes("arbitrate")} /> : null}
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

/** Avant le lancement d’un enchaînement : briefs du projet (cascade). */
export function PreLaunchBriefs({ projectId }: { projectId: string }) {
  const load = useCallback(() => api.projectContext(projectId).then((r) => ({
    validated: r.layers.flatMap((l) => l.items.map((c: any) => ({ ...c, level: l.level }))), pending: r.pending ?? [],
  })), [projectId]);
  return <BriefsPanel load={load} />;
}

const STEP: Record<PipelineStepStatus, () => string> = {
  pending: () => t("en attente"), running: () => t("en cours"), completed: () => t("terminé"),
  blocked: () => t("porte bloquée"), overridden: () => t("porte levée"), failed: () => t("échec"),
  awaiting_approval: () => t("validation attendue"), approved: () => t("validé"), halted: () => t("suspendu"),
};
const STEP_TONE: Record<PipelineStepStatus, string> = {
  pending: "bg-paper text-muted", running: "bg-accent-soft text-accent", completed: "bg-go-soft text-go",
  blocked: "bg-stop-soft text-stop", overridden: "bg-hold-soft text-hold", failed: "bg-stop-soft text-stop",
  awaiting_approval: "bg-hold-soft text-hold", approved: "bg-go-soft text-go", halted: "bg-paper text-muted line-through",
};

/** Niveaux d’exécution : les étapes d’un même niveau tournent en parallèle, le niveau suivant est la jonction. */
export function stepLevels(steps: PipelineStep[]): PipelineStep[][] {
  const level = new Map<string, number>();
  const byNode = new Map(steps.map((s) => [s.node_id, s]));
  const depth = (s: PipelineStep, seen = new Set<string>()): number => {
    if (level.has(s.node_id)) return level.get(s.node_id)!;
    if (seen.has(s.node_id)) return 0;
    seen.add(s.node_id);
    const d = Math.max(-1, ...(s.deps ?? []).map((id) => { const dep = byNode.get(id); return dep ? depth(dep, seen) : -1; })) + 1;
    level.set(s.node_id, d);
    return d;
  };
  // Anciens enchaînements (sans deps) : séquence stricte dans l’ordre des étapes.
  const legacy = steps.every((s) => !s.deps);
  const out: PipelineStep[][] = [];
  steps.forEach((s, i) => { const d = legacy ? i : depth(s); (out[d] ||= []).push(s); });
  return out.filter(Boolean);
}

/** Enchaînement : les collectifs du graphe traitent la question l’un après l’autre, les portes décident du passage. */
function Pipelines({ project, canRun, canArbitrate }: { project: ProjectView; canRun: boolean; canArbitrate: boolean }) {
  const [items, setItems] = useState<Pipeline[]>([]);
  const [question, setQuestion] = useState("");
  const [reason, setReason] = useState("");
  const [pause, setPause] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const steps = (project.graph?.nodes ?? []).filter((n) => n.type === "collectif" && n.config.session_id).length;
  const load = useCallback(() => api.pipelines(project.id).then((r) => setItems(r.pipelines)).catch(() => setItems([])), [project.id]);
  useEffect(() => { void load(); }, [load]);
  const running = items.some((p) => p.status === "running" || p.steps.some((s) => s.status === "running"));
  const active = items.some((p) => !["completed", "failed", "cancelled"].includes(p.status));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [running, load]);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); setError(""); await load(); } catch (e) { setError((e as Error).message); } };
  return (
    <Section id="projet-enchainement" title={t("Enchaînement des collectifs")} summary={t("{{n}} collectifs liés", { n: steps })}>
      <p className="mb-2 text-xs text-muted">{t("Chaque collectif du graphe traite la question dans l’ordre des liens ; les branches parallèles tournent en même temps et se rejoignent sur le collectif suivant, qui reçoit tous leurs verdicts. Une porte bloquée arrête l’enchaînement jusqu’à un arbitrage.")}</p>
      {canRun ? <PreLaunchBriefs projectId={project.id} /> : null}
      {canRun ? (
        <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void act(async () => { await api.startPipeline(project.id, { question, pause_between: pause }); setQuestion(""); }); }}>
          <input aria-label={t("Question de l’enchaînement")} className={`${controlClass} min-w-64 flex-1`} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t("Question soumise aux collectifs")} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={pause} onChange={(e) => setPause(e.target.checked)} />
            {t("Pause d’arbitrage entre les collectifs")}
          </label>
          <Button type="submit" disabled={steps === 0 || question.trim().length < 3 || active}>{t("Lancer l’enchaînement")}</Button>
        </form>
      ) : <p className="mb-2 text-xs text-muted">{t("Votre rôle (lecteur) ne permet pas de lancer ou relancer une mission.")}</p>}
      {steps === 0 ? <p className="text-sm text-muted">{t("Reliez au moins un nœud collectif à une session dans le graphe.")}</p> : null}
      {items.length ? (
        <ul className="grid gap-2" data-testid="pipelines">
          {items.map((p) => (
            <li key={p.id} className="rounded-md border border-line px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.question}</span>
                <span className="text-xs text-muted">{p.created_at ? formatWhen(p.created_at) : ""}</span>
              </div>
              <ol className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                {stepLevels(p.steps).map((group, i) => (
                  <li key={group[0].node_id} className="flex items-center gap-1">
                    {i ? <span aria-hidden className="text-muted">→</span> : null}
                    <span className={group.length > 1 ? "flex flex-wrap items-center gap-1 rounded border border-dashed border-line px-1" : "contents"} title={group.length > 1 ? t("Branches parallèles") : undefined} data-testid={group.length > 1 ? "parallel-group" : undefined}>
                      {group.map((s, j) => (
                        <span key={s.node_id} className="flex items-center gap-1">
                          {j ? <span aria-hidden className="text-muted">∥</span> : null}
                          <span className={`rounded px-1.5 ${STEP_TONE[s.status]}`} title={(s.gates ?? []).flatMap((g) => g.reasons).join(" · ")}>
                            {tc(s.label || s.session_id)} · {STEP[s.status]()}{s.verdict ? ` · ${s.verdict}` : ""}
                          </span>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ol>
              {p.status === "blocked" && canArbitrate ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input aria-label={t("Motif de levée de la porte")} className={`${controlClass} min-w-56 flex-1`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Motif (obligatoire)")} />
                  <Button variant="secondary" disabled={reason.trim().length < 3} onClick={() => void act(async () => { await api.resumePipeline(p.id, reason); setReason(""); })}>{t("Lever la porte et continuer")}</Button>
                </div>
              ) : null}
              {canArbitrate && p.status !== "cancelled" && p.steps.some((s) => s.status === "awaiting_approval") ? (
                <div className="mt-2 flex flex-wrap gap-2" data-testid="approvals">
                  <input aria-label={t("Commentaire de validation")} className={`${controlClass} min-w-56 flex-1`} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("Commentaire (facultatif)")} />
                  {/* Une validation par branche : les autres branches restent en attente. */}
                  {p.steps.filter((s) => s.status === "awaiting_approval").map((s, _i, waiting) => (
                    <Button key={s.node_id} variant="secondary" onClick={() => void act(async () => { await api.approvePipeline(p.id, s.node_id, comment); setComment(""); })}>
                      {waiting.length > 1 ? t("Valider « {{label}} » et continuer", { label: tc(s.label || s.session_id) }) : t("Valider et continuer")}
                    </Button>
                  ))}
                </div>
              ) : null}
              {p.status === "blocked" && p.steps.some((s) => s.status === "halted") ? (
                <p className="mt-1 text-xs text-muted">{t("Les branches en cours ont été suspendues par la porte bloquée ; elles repartiront à sa levée.")}</p>
              ) : null}
              {["running", "blocked", "awaiting_approval"].includes(p.status) && canRun ? (
                <Button variant="ghost" className="mt-1" onClick={() => void act(() => api.cancelPipeline(p.id))}>{t("Arrêter l’enchaînement")}</Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-2 text-xs text-stop" role="alert">{error}</p> : null}
    </Section>
  );
}

function Notifications({ project, threadId, canSend }: { project: ProjectView; threadId?: string; canSend: boolean }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState("");
  const [smtp, setSmtp] = useState<boolean | null>(null);
  const load = useCallback(() => api.projectNotifications(project.id).then((r) => setItems(r.notifications as Notification[])).catch(() => setItems([])), [project.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.mailStatus().then((r) => setSmtp(r.smtp)).catch(() => setSmtp(null)); }, []);
  const waiting = items.filter((n) => n.status !== "sent").length;
  const informed = project.stakeholders.filter((s) => s.role === "informe");
  return (
    <Section id="projet-notifications" title={t("Notifications aux informés")} summary={t("{{n}} envois", { n: items.length })} actions={canSend ? (
      <Button variant="secondary" disabled={!informed.some((s) => s.email)} onClick={async () => {
        try { await api.notifyProject(project.id, threadId); setError(""); await load(); } catch (e) { setError((e as Error).message); }
      }}><Mail size={14} aria-hidden /> {t("Notifier les informés")}</Button>
    ) : null}>
      <p className="mb-2 text-xs text-muted">{t("Chaque arbitrage envoie automatiquement la décision par e-mail aux parties prenantes « Informé » qui ont une adresse.")}</p>
      {smtp === false ? (
        <p className="mb-2 rounded-md border border-hold/40 bg-hold-soft px-3 py-2 text-xs text-ink" role="status" data-testid="smtp-missing">
          {t("L’envoi d’e-mails n’est pas configuré sur le serveur (SMTP). Les notifications sont gardées « en file » et pourront être relancées une fois le SMTP configuré.")}
        </p>
      ) : null}
      {canSend && smtp && waiting ? (
        <Button variant="secondary" className="mb-2" onClick={async () => {
          try { await api.retryNotifications(project.id); setError(""); await load(); } catch (e) { setError((e as Error).message); }
        }}>{t("Relancer {{n}} envois en attente", { n: waiting })}</Button>
      ) : null}
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
