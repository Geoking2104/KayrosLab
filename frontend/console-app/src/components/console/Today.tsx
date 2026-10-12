import { ArrowRight } from "lucide-react";
import { useConsole } from "@/lib/console/store";
import { CYCLE, formatWhen, SESSION_QUOTA, STATUS_LABEL, useCaseLabel, type CycleId } from "@/lib/console/model";
import { Button, Panel, ProgressBar, StatusPill, VerdictPill } from "./ui";
import { go } from "./Shell";

const ACTIONS = [
  {
    id: "teams",
    title: "Teams",
    body: "Teams n’est pas connecté. Les identifiants d’application manquent côté serveur — ce n’est pas un échec de clic.",
    label: "Connecter",
    page: "connexions" as const,
    color: "#5b5fc7",
    soft: "#eef0fb",
  },
  {
    id: "crystal",
    title: "Crystal Knows",
    body: "Crystal Knows n’est pas configuré. L’import d’un export autorisé ou d’un DISC reste possible, sans scraping.",
    label: "Configurer",
    page: "agents" as const,
    color: "#5b4cdb",
    soft: "#eeecfb",
  },
  {
    id: "provider",
    title: "Provider",
    body: "Provider annoncé : Mistral. Le swarm utilise le même provider. Un profil démo est étiqueté comme tel, jamais comme un verdict silencieux.",
    label: "Voir l’annonce",
    page: "espace" as const,
    color: "#0176d3",
    soft: "#eaf5fe",
  },
];

const STEP_TONE = [
  { color: "#0f766e", soft: "#e6f4f2" },
  { color: "#0176d3", soft: "#eaf5fe" },
  { color: "#5b4cdb", soft: "#eeecfb" },
  { color: "#b45309", soft: "#fdf3e4" },
  { color: "#8a6d1a", soft: "#f8f1dc" },
  { color: "#157347", soft: "#e7f4ec" },
  { color: "#00a1e0", soft: "#e7f6fd" },
  { color: "#0a0c10", soft: "#eef1f4" },
];

export function Today() {
  const { state, dismissGuide } = useConsole();
  const queue = [...state.threads].sort((a, b) => rank(a.status) - rank(b.status) || b.updatedAt.localeCompare(a.updatedAt));
  const mine = state.collectives.length;
  const running = state.threads.filter((thread) => thread.status === "running");

  function openStage(stage: CycleId) {
    const match = [...state.threads].filter((thread) => thread.stage === stage).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (match) go("dossiers", match.id);
    else go("dossiers");
  }

  return (
    <div className="flex flex-col gap-6">
      {!state.guideSeen ? (
        <Panel className="bg-accent-soft">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Le parcours tient en une phrase</p>
              <p className="mt-1 max-w-xl text-sm text-ink-soft">
                Vous posez une décision. Un collectif l’instruit. Le verdict reste consultatif tant qu’un humain ne l’a pas arbitré.
              </p>
            </div>
            <Button variant="secondary" onClick={dismissGuide}>
              Compris
            </Button>
          </div>
          <ol className="mt-4 grid gap-3 sm:grid-cols-4">
            {["La question", "Le collectif", "Le verdict", "Votre arbitrage"].map((step, index) => (
              <li key={step} className="rounded-lg bg-surface px-3 py-3 text-sm">
                <span className="text-xs text-muted">0{index + 1}</span>
                <p className="font-medium">{step}</p>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink">Ce qui vous attend</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Pas un mur d’indicateurs. Les dossiers ouverts, dans l’ordre où vous pouvez agir. Le cycle stratégique vit dans chaque dossier.
          </p>
        </div>
        <p className="text-sm text-muted">
          {mine}/{SESSION_QUOTA} collectifs sur votre compte · {state.agents.filter((agent) => agent.enabled).length} agents actifs
        </p>
      </div>

      <div className="grid gap-3">
        {queue.filter((thread) => thread.status !== "resolved").map((thread) => {
          const collective = state.collectives.find((item) => item.id === thread.collectiveId);
          return (
            <button
              key={thread.id}
              type="button"
              onClick={() => go("dossiers", thread.id)}
              className="rounded-3xl border border-line bg-surface p-4 text-left shadow-card transition duration-150 hover:-translate-y-0.5 hover:shadow-md md:p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={thread.status} />
                <VerdictPill verdict={thread.verdict} />
                <span className="text-xs text-muted">{useCaseLabel(thread.useCase)}</span>
              </div>
              <p className="mt-3 text-base font-medium leading-snug">{thread.question}</p>
              {thread.status === "running" ? (
                <div className="mt-3">
                  <ProgressBar done={thread.progress.done} total={thread.progress.total} active />
                </div>
              ) : null}
              <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                {collective?.name ?? "Collectif"} · {why(thread.status, state.role)}
                <ArrowRight size={14} className="ml-auto" aria-hidden="true" />
              </p>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="text-sm font-medium">Prochaine action utile</h2>
          <ul className="mt-3 flex flex-col gap-3 text-sm">
            {ACTIONS.map((action) => (
              <li key={action.id} className="rounded-xl border border-line border-l-4 px-3 py-3" style={{ borderLeftColor: action.color, background: action.soft }}>
                <p className="text-xs font-bold uppercase tracking-[0.08em]" style={{ color: action.color }}>{action.title}</p>
                <p className="mt-1 text-ink-soft">{action.body}</p>
                <button
                  type="button"
                  onClick={() => go(action.page)}
                  className="mt-3 inline-flex min-h-11 items-center rounded-[10px] px-4 text-sm font-semibold text-white"
                  style={{ background: action.color }}
                >
                  {action.label}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <h2 className="text-sm font-medium">Où vit le cycle</h2>
          <p className="mt-2 text-sm text-muted">Huit temps, un seul dossier. Cliquez une étape pour ouvrir le dossier qui y est.</p>
          <ol className="mt-4 grid grid-cols-2 gap-2 text-sm">
            {CYCLE.map((step, index) => {
              const tone = STEP_TONE[index] ?? STEP_TONE[0];
              const match = state.threads.find((thread) => thread.stage === step.id);
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => openStage(step.id)}
                    className="h-full w-full rounded-xl border border-transparent px-3 py-2 text-left hover:border-line"
                    style={{ background: tone.soft }}
                  >
                    <span className="text-xs font-bold" style={{ color: tone.color }}>{String(index).padStart(2, "0")}</span>
                    <p className="font-semibold text-ink">{step.label}</p>
                    <p className="text-xs text-muted">{step.hint}</p>
                    <p className="mt-1 text-[11px] font-semibold" style={{ color: tone.color }}>{match ? "Ouvrir le dossier" : "Voir les dossiers"}</p>
                  </button>
                </li>
              );
            })}
          </ol>
        </Panel>
      </div>

      {running.length ? (
        <p className="text-xs text-muted">
          {running.length} instruction{running.length > 1 ? "s" : ""} en cours, mise à jour sur cette page. Dernier mouvement : {formatWhen(running[0]?.updatedAt)}.
        </p>
      ) : null}
      <p className="text-xs text-muted">Statuts suivis : {Object.values(STATUS_LABEL).join(" · ")}.</p>
    </div>
  );
}

function rank(status: string) {
  if (status === "needs_clarification") return 0;
  if (status === "awaiting_arbitration") return 1;
  if (status === "running") return 2;
  if (status === "failed") return 3;
  return 4;
}

function why(status: string, role: string) {
  if (status === "needs_clarification") return "Une précision est vraiment attendue";
  if (status === "awaiting_arbitration") return role === "comex" ? "Vous pouvez arbitrer" : "Arbitrage réservé au COMEX";
  if (status === "running") return "Le collectif instruit";
  return "Clos";
}