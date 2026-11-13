import { useState } from "react";
import {
  ArrowRight,
  CheckCheck,
  CircleHelp,
  Clock3,
  Gavel,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useConsole } from "@/lib/console/store";
import { formatWhen, type ThreadStatus } from "@/lib/console/model";
import { decisionPriority, nextDecisionAction } from "@/lib/console/journey";
import { t, tc } from "@/lib/i18n";
import {
  Button,
  Empty,
  Panel,
  ProgressBar,
  StatusPill,
  VerdictPill,
  controlClass,
} from "./ui";
import { DecisionGuide } from "./DecisionGuide";
import { go } from "./Shell";
import { cn } from "@/lib/cn";

export function Today({ approvals = false }: { approvals?: boolean }) {
  const { state, live, permissions, workspace } = useConsole();
  const [filter, setFilter] = useState<"active" | "all" | ThreadStatus>(
    approvals ? "awaiting_arbitration" : "active",
  );
  const [search, setSearch] = useState("");
  const canArbitrate = permissions.includes("arbitrate");
  const count = (status: ThreadStatus) =>
    state.threads.filter((x) => x.status === status).length;
  const queue = state.threads
    .filter((x) => {
      const inView =
        filter === "all" ||
        (filter === "active" ? x.status !== "resolved" : x.status === filter);
      return (
        inView &&
        `${tc(x.question)} ${tc(state.collectives.find((c) => c.id === x.collectiveId)?.name)}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase())
      );
    })
    .sort(
      (a, b) =>
        decisionPriority(a) - decisionPriority(b) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  const metrics = [
    {
      id: "awaiting_arbitration" as const,
      label: t("À arbitrer"),
      icon: Gavel,
      hint: t("Décision humaine attendue"),
      color: "text-hold",
    },
    {
      id: "needs_clarification" as const,
      label: t("À préciser"),
      icon: CircleHelp,
      hint: t("Une information manque"),
      color: "text-info",
    },
    {
      id: "running" as const,
      label: t("En instruction"),
      icon: Clock3,
      hint: t("Le comité travaille"),
      color: "text-accent",
    },
    {
      id: "resolved" as const,
      label: t("Décisions actées"),
      icon: CheckCheck,
      hint: t("Arbitrage enregistré"),
      color: "text-go",
    },
  ];
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">
            {approvals ? t("Comité humain") : t("Votre espace de décision")}
          </p>
          <h1 className="page-title">
            {approvals ? t("Arbitrages") : t("Ce qui vous attend")}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {approvals
              ? t(
                  "Examinez les preuves, les objections et les conditions avant de trancher.",
                )
              : t("Chaque décision avance avec une prochaine action claire.")}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-muted">
          <ShieldCheck size={14} className="text-accent" />
          {t("L’humain garde la main")}
        </span>
      </div>
      {!approvals && (
        <section className="welcome-panel">
          <div>
            <span className="eyebrow text-accent">
              {t("DE LA QUESTION À LA DÉCISION")}
            </span>
            <h2 className="mt-2 text-xl leading-tight">
              {t("Quelle décision voulez-vous éclairer ?")}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-muted">
              {t(
                "Posez la question. Confrontez les points de vue. Arrivez au comité avec un dossier prêt à arbitrer.",
              )}
            </p>
          </div>
          <Button
            onClick={() => go("instruire")}
            disabled={!permissions.includes("run")}
            className="shrink-0"
          >
            {t("Préparer une décision")}
            <ArrowRight size={16} />
          </Button>
        </section>
      )}
      {!live && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Sparkles size={14} />
          {t(
            "Espace de démonstration · données d’exemple, aucun appel IA réel.",
          )}
        </p>
      )}
      {!permissions.includes("run") && (
        <p className="rounded-lg bg-info-soft p-3 text-sm text-info">
          {t(
            "Votre accès est en lecture seule. Vous pouvez consulter les dossiers et préparer votre comité.",
          )}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metrics.map((metric) => (
          <button
            key={metric.id}
            onClick={() => setFilter(metric.id)}
            aria-pressed={filter === metric.id}
            className={cn(
              "metric-card",
              filter === metric.id && "border-accent ring-1 ring-accent",
            )}
          >
            <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted">
              {metric.label}
              <metric.icon size={16} className={metric.color} />
            </span>
            <strong className="mt-3 block text-3xl font-semibold tabular-nums">
              {count(metric.id)}
            </strong>
            <span className="mt-1 block text-xs text-muted">{metric.hint}</span>
          </button>
        ))}
      </div>
      <div
        className={cn(
          "grid items-start gap-5",
          !approvals && "xl:grid-cols-[minmax(0,1fr)_300px]",
        )}
      >
        <section className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
            <h2 className="text-sm">
              {t("Mes dossiers")}{" "}
              <span className="ml-1 text-muted">{queue.length}</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <label className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-3.5 text-muted"
                />
                <input
                  aria-label={t("Rechercher une décision")}
                  placeholder={t("Rechercher une décision")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={cn(controlClass, "max-w-56 pl-9")}
                />
              </label>
              <select
                aria-label={t("Filtrer les décisions")}
                value={filter}
                onChange={(e) => setFilter(e.target.value as typeof filter)}
                className={cn(controlClass, "w-auto")}
              >
                <option value="active">{t("En cours")}</option>
                <option value="all">{t("Tous")}</option>
                {metrics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                <option value="failed">{t("Échec")}</option>
              </select>
            </div>
          </div>
          {queue.length ? (
            <ul className="divide-y divide-line">
              {queue.map((thread) => (
                <li key={thread.id}>
                  <button
                    className="group grid w-full gap-3 p-4 text-left transition-colors hover:bg-paper md:p-5"
                    onClick={() =>
                      go(approvals ? "arbitrages" : "overview", thread.id)
                    }
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={thread.status} />
                      {thread.gates?.status === "blocked" && (
                        <span className="text-xs font-medium text-stop">
                          {t("Porte bloquée")}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-muted">
                        {formatWhen(thread.updatedAt)}
                      </span>
                    </div>
                    <p className="text-sm font-semibold leading-6">
                      {tc(thread.question)}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>
                        {tc(
                          state.collectives.find(
                            (c) => c.id === thread.collectiveId,
                          )?.name,
                        )}
                      </span>
                      <span aria-hidden>·</span>
                      <span>
                        {thread.evidence.length === 1 ? t("1 élément de contexte") : t("{{count}} éléments de contexte", {
                          count: thread.evidence.length,
                        })}
                      </span>
                      {thread.verdict && (
                        <VerdictPill verdict={thread.verdict} />
                      )}
                    </div>
                    {thread.status === "running" && (
                      <ProgressBar
                        done={thread.progress.done}
                        total={thread.progress.total}
                        active
                      />
                    )}
                    <span className="flex items-center justify-between text-xs font-medium text-accent">
                      {nextDecisionAction(thread, canArbitrate)}
                      <ArrowRight
                        size={15}
                        className="transition-transform group-hover:translate-x-1"
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              title={t("Aucune décision dans cette vue")}
              body={
                search
                  ? t("Essayez une autre recherche ou un autre statut.")
                  : t(
                      "Préparez une décision pour constituer votre premier dossier.",
                    )
              }
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  {t("Voir tous les dossiers")}
                </Button>
              }
            />
          )}
        </section>
        {!approvals && (
          <aside className="grid gap-4">
            <DecisionGuide compact />
            <Panel>
              <h2 className="text-sm">{t("Votre comité, vos règles")}</h2>
              <p className="mt-2 text-xs leading-5 text-muted">
                {t(
                  "L’avis des agents est consultatif. Les rôles, les votes et les éventuels vetos restent visibles avant l’arbitrage.",
                )}
              </p>
              <button
                className="mt-3 inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-accent"
                onClick={() => go("collectifs")}
              >
                {t("Voir les comités")}
                <ArrowRight size={14} />
              </button>
            </Panel>
          </aside>
        )}
      </div>
      {!approvals && live && workspace.projects.length > 0 && (
        <Panel>
          <h2 className="text-sm">{t("Projets en cours")}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {workspace.projects
              .filter((p) => p.status !== "closed")
              .map((project) => (
                <Button
                  key={project.id}
                  variant="secondary"
                  onClick={() => go("projets")}
                >
                  {project.name}
                  <ArrowRight size={14} />
                </Button>
              ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
