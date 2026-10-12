import { ArrowRight } from "lucide-react";
import { useConsole } from "@/lib/console/store";
import { CYCLE, formatWhen, SESSION_QUOTA, STATUS_LABEL, useCaseLabel } from "@/lib/console/model";
import { Button, Panel, ProgressBar, StatusPill, VerdictPill } from "./ui";
import { go } from "./Shell";

export function Today() {
  const { state, dismissGuide } = useConsole();
  const queue = [...state.threads].sort((a, b) => rank(a.status) - rank(b.status) || b.updatedAt.localeCompare(a.updatedAt));
  const mine = state.collectives.length;
  const running = state.threads.filter((thread) => thread.status === "running");

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
            <li className="flex items-start justify-between gap-3">
              <span>Teams n’est pas connecté. Les identifiants d’application manquent côté serveur — ce n’est pas un échec de clic.</span>
              <a href="#connexions" className="shrink-0 font-medium text-accent-strong">
                Voir
              </a>
            </li>
            <li className="flex items-start justify-between gap-3">
              <span>Crystal Knows n’est pas configuré. L’import d’un export autorisé ou d’un DISC reste possible, sans scraping.</span>
              <a href="#agents" className="shrink-0 font-medium text-accent-strong">
                Agents
              </a>
            </li>
            <li>
              Provider annonce : <strong className="font-medium">Mistral</strong>. Le swarm utilise le même provider. Un profil démo est étiqueté comme tel, jamais comme un verdict silencieux.
            </li>
          </ul>
        </Panel>
        <Panel>
          <h2 className="text-sm font-medium">Où vit le cycle</h2>
          <p className="mt-2 text-sm text-muted">Huit temps, un seul dossier. Le menu ne les duplique pas.</p>
          <ol className="mt-4 grid grid-cols-2 gap-2 text-sm">
            {CYCLE.map((step, index) => (
              <li key={step.id} className="rounded-lg bg-paper px-3 py-2">
                <span className="text-xs text-muted">{String(index).padStart(2, "0")}</span>
                <p className="font-medium">{step.label}</p>
                <p className="text-xs text-muted">{step.hint}</p>
              </li>
            ))}
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
