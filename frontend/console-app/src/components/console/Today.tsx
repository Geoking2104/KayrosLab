import {
  BadgeCheck,
  Blocks,
  Crosshair,
  Ear,
  Flag,
  Gavel,
  ListChecks,
  Map,
  MessageCircleQuestion,
  Milestone,
  Scale,
  Telescope,
  Users,
  ArrowRight,
} from "lucide-react";
import { useConsole } from "@/lib/console/store";
import { CYCLE, formatWhen, SESSION_QUOTA, STATUS_LABEL, useCaseLabel, type CycleId } from "@/lib/console/model";
import { Panel, ProgressBar, StatusPill, VerdictPill } from "./ui";
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
    logo: "brands/teams.svg",
    logoClass: "h-8 w-8",
  },
  {
    id: "crystal",
    title: "CrystalKnows",
    body: "Crystal Knows n’est pas configuré. L’import d’un export autorisé ou d’un DISC reste possible, sans scraping.",
    label: "Configurer",
    page: "agents" as const,
    color: "#01293D",
    soft: "#eeecfb",
    logo: "brands/crystalknows.svg",
    logoClass: "h-6 w-auto max-w-[128px]",
  },
  {
    id: "provider",
    title: "Mistral",
    body: "Provider annoncé : Mistral. Le swarm utilise le même provider. Un profil démo est étiqueté comme tel, jamais comme un verdict silencieux.",
    label: "Voir l’annonce",
    page: "espace" as const,
    color: "#FA520F",
    soft: "#fff1e8",
    logo: "brands/mistral.svg",
    logoClass: "h-8 w-8",
  },
];

const GUIDE = [
  { title: "La question", hint: "Vous posez la décision.", icon: MessageCircleQuestion, color: "#0176d3", soft: "#eaf5fe" },
  { title: "Le collectif", hint: "Il l’instruit.", icon: Users, color: "#0f766e", soft: "#e6f4f2" },
  { title: "Le verdict", hint: "Il reste consultatif.", icon: Scale, color: "#5b4cdb", soft: "#eeecfb" },
  { title: "Votre arbitrage", hint: "Un humain tranche.", icon: BadgeCheck, color: "#157347", soft: "#e7f4ec" },
];

const STEP_TONE = [
  { color: "#0f766e", soft: "#e6f4f2", icon: Ear },
  { color: "#0176d3", soft: "#eaf5fe", icon: Map },
  { color: "#5b4cdb", soft: "#eeecfb", icon: Blocks },
  { color: "#b45309", soft: "#fdf3e4", icon: Crosshair },
  { color: "#8a6d1a", soft: "#f8f1dc", icon: Scale },
  { color: "#157347", soft: "#e7f4ec", icon: Gavel },
  { color: "#00a1e0", soft: "#e7f6fd", icon: Telescope },
  { color: "#0a0c10", soft: "#eef1f4", icon: Flag },
];

export function Today() {
  const { state, ackGuide } = useConsole();
  const queue = [...state.threads].sort((a, b) => rank(a.status) - rank(b.status) || b.updatedAt.localeCompare(a.updatedAt));
  const mine = state.collectives.length;
  const running = state.threads.filter((thread) => thread.status === "running");
  const ack = state.guideAck.length === 4 ? state.guideAck : [false, false, false, false];
  const guideOpen = ack.some((item) => !item);

  function openStage(stage: CycleId) {
    const match = [...state.threads].filter((thread) => thread.stage === stage).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (match) go("dossiers", match.id);
    else go("dossiers");
  }

  return (
    <div className="flex flex-col gap-6">
      {guideOpen ? (
        <Panel>
          <p className="text-sm font-semibold text-ink">Le parcours</p>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Vous posez une décision. Un collectif l’instruit. Le verdict reste consultatif tant qu’un humain ne l’a pas arbitré.
          </p>
          <ol className="mt-4 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {GUIDE.map((step, index) => {
              const Icon = step.icon;
              return (
                <li key={step.title} className="bg-surface px-3 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="grid size-8 place-items-center rounded-lg" style={{ background: step.soft, color: step.color }}>
                      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <span className="text-[11px] font-semibold tabular-nums text-muted">0{index + 1}</span>
                  </div>
                  <p className="mt-2 font-semibold text-ink">{step.title}</p>
                  <p className="text-xs text-muted">{step.hint}</p>
                  <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="checkbox"
                      className="size-4 rounded accent-accent"
                      checked={ack[index]}
                      onChange={(event) => ackGuide(index, event.target.checked)}
                    />
                    J’ai compris
                  </label>
                </li>
              );
            })}
          </ol>
        </Panel>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-ink">Ce qui vous attend</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Les dossiers ouverts, dans l’ordre où vous pouvez agir.
          </p>
        </div>
        <dl className="flex gap-4 text-sm">
          <div>
            <dt className="text-[11px] font-medium text-muted">Collectifs</dt>
            <dd className="font-semibold tabular-nums text-ink">{mine}/{SESSION_QUOTA}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-muted">Agents actifs</dt>
            <dd className="font-semibold tabular-nums text-ink">{state.agents.filter((agent) => agent.enabled).length}</dd>
          </div>
        </dl>
      </div>

      <Panel className="overflow-hidden p-0 md:p-0">
        <div className="divide-y divide-line">
          {queue.filter((thread) => thread.status !== "resolved").map((thread) => {
            const collective = state.collectives.find((item) => item.id === thread.collectiveId);
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => go("dossiers", thread.id)}
                className="w-full px-4 py-4 text-left transition-colors duration-150 hover:bg-paper md:px-5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={thread.status} />
                  <VerdictPill verdict={thread.verdict} />
                  <span className="text-xs text-muted">{useCaseLabel(thread.useCase)}</span>
                </div>
                <p className="mt-2 text-[15px] font-semibold leading-snug text-ink">{thread.question}</p>
                {thread.status === "running" ? (
                  <div className="mt-3">
                    <ProgressBar done={thread.progress.done} total={thread.progress.total} active />
                  </div>
                ) : null}
                <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                  {collective?.name ?? "Collectif"} · {why(thread.status, state.role)}
                  <ArrowRight size={14} className="ml-auto text-ink-soft" aria-hidden="true" />
                </p>
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ListChecks size={16} className="text-accent" aria-hidden="true" />
            Prochaine action utile
          </h2>
          <ul className="mt-4 flex flex-col gap-3 text-sm">
            {ACTIONS.map((action) => (
              <li key={action.id} className="rounded-xl border border-line bg-surface p-3">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 min-w-10 shrink-0 place-items-center rounded-lg border border-line bg-white px-1.5">
                    <img src={`${import.meta.env.BASE_URL}${action.logo}`} alt="" className={action.logoClass} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{action.title}</p>
                    <p className="mt-0.5 text-sm text-muted">{action.body}</p>
                    <button
                      type="button"
                      onClick={() => go(action.page)}
                      className="mt-3 inline-flex min-h-10 items-center rounded-[10px] px-3.5 text-sm font-semibold text-white"
                      style={{ background: action.color }}
                    >
                      {action.label}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Milestone size={16} className="text-teal" aria-hidden="true" />
            Où vit le cycle
          </h2>
          <p className="mt-1 text-sm text-muted">Huit temps. Une étape ouvre le dossier qui s’y trouve.</p>
          <ol className="mt-2 divide-y divide-line">
            {CYCLE.map((step, index) => {
              const tone = STEP_TONE[index] ?? STEP_TONE[0];
              const Icon = tone.icon;
              const match = state.threads.find((thread) => thread.stage === step.id);
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => openStage(step.id)}
                    className="flex w-full items-center gap-3 py-2.5 text-left"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: tone.soft, color: tone.color }}>
                      <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">{step.label}</span>
                      <span className="block truncate text-xs text-muted">{step.hint}</span>
                    </span>
                    <span className="shrink-0 text-xs font-medium" style={{ color: tone.color }}>{match ? "Ouvrir" : "Dossiers"}</span>
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