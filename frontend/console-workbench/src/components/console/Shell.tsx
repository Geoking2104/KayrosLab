import { useEffect, useState } from "react";
import {
  BookOpen,
  BoxSelect,
  Cable,
  ChevronDown,
  CircuitBoard,
  Columns3,
  Compass,
  Cpu,
  FileText,
  GitBranch,
  Hexagon,
  Inbox,
  Layers,
  LayoutGrid,
  PanelRight,
  Radar,
  Scale,
  Settings2,
  Target,
  Users,
} from "lucide-react";
import { Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { STAGES } from "@/lib/kayros/engine";
import { currentIdea, useKayros } from "@/lib/kayros/store";
import type { ViewId } from "@/lib/kayros/types";
import { cn } from "@/lib/utils";
import { BoardView } from "./Board";
import { GuideView } from "./Guide";
import { Inspector } from "./Inspector";
import { ForecastView, NoveltyView, OracleView, PositionerView, SwarmView } from "./IntelViews";
import { Matrix } from "./Matrix";
import { ConnectorsView, McpView, SpecsView, StudioView } from "./SystemViews";
import {
  CycleView,
  GovernanceView,
  InboxView,
  MemoryView,
  PortfolioView,
  ResultView,
} from "./WorkViews";
import { t } from "./bits";

type NavItem = { id: ViewId; fr: string; en: string; icon: typeof LayoutGrid };

const PRIMARY: NavItem[] = [
  { id: "board", fr: "Tableau", en: "Board", icon: Columns3 },
  { id: "inbox", fr: "Inbox", en: "Inbox", icon: Inbox },
  { id: "swarms", fr: "Essaims", en: "Swarms", icon: Users },
  { id: "guide", fr: "Guide", en: "Guide", icon: BookOpen },
];

const ATELIER: NavItem[] = [
  { id: "matrix", fr: "Matrice 3×3", en: "3×3 matrix", icon: LayoutGrid },
  { id: "cycle", fr: "Fil d'événements", en: "Event stream", icon: GitBranch },
  { id: "result", fr: "Résultat", en: "Result", icon: CircuitBoard },
  { id: "memory", fr: "Mémoire L0–L3", en: "Memory L0–L3", icon: Layers },
  { id: "novelty", fr: "Novelty", en: "Novelty", icon: Hexagon },
  { id: "positioner", fr: "Positioner", en: "Positioner", icon: Compass },
  { id: "oracle", fr: "Oracle", en: "Oracle", icon: Target },
  { id: "forecast", fr: "Forecast", en: "Forecast", icon: Radar },
  { id: "governance", fr: "Portes (détail)", en: "Gates (detail)", icon: Scale },
  { id: "portfolio", fr: "Statuts", en: "Statuses", icon: BoxSelect },
];

const SYSTEM: NavItem[] = [
  { id: "connectors", fr: "Connecteurs", en: "Connectors", icon: Cable },
  { id: "mcp", fr: "MCP", en: "MCP", icon: Cpu },
  { id: "studio", fr: "Studio", en: "Studio", icon: Settings2 },
  { id: "specs", fr: "Specs", en: "Specs", icon: FileText },
];

function ViewBody() {
  const view = useKayros((s) => s.view);
  switch (view) {
    case "board":
      return <BoardView />;
    case "inbox":
      return <InboxView />;
    case "guide":
      return <GuideView />;
    case "matrix":
      return <Matrix />;
    case "cycle":
      return <CycleView />;
    case "portfolio":
      return <PortfolioView />;
    case "memory":
      return <MemoryView />;
    case "governance":
      return <GovernanceView />;
    case "novelty":
      return <NoveltyView />;
    case "positioner":
      return <PositionerView />;
    case "swarms":
      return <SwarmView />;
    case "oracle":
      return <OracleView />;
    case "forecast":
      return <ForecastView />;
    case "connectors":
      return <ConnectorsView />;
    case "mcp":
      return <McpView />;
    case "studio":
      return <StudioView />;
    case "specs":
      return <SpecsView />;
    case "result":
      return <ResultView />;
  }
}

function NavButton({ item, active, badge }: { item: NavItem; active: boolean; badge?: number }) {
  const locale = useKayros((s) => s.locale);
  const setView = useKayros((s) => s.setView);
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => setView(item.id)}
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm",
        active ? "bg-raised text-accent" : "text-muted hover:bg-raised hover:text-ink",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
      <span className="flex-1 text-left">{locale === "fr" ? item.fr : item.en}</span>
      {badge ? (
        <span className="grid min-w-5 place-items-center rounded-full bg-warning/20 px-1.5 font-mono text-micro text-warning">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function CycleStrip() {
  const locale = useKayros((s) => s.locale);
  const steps = useKayros((s) => s.steps);
  const cycle = useKayros((s) => s.cycle);
  const idea = useKayros(currentIdea);
  const current = cycle?.currentStage ?? idea?.stage;
  const idx = current ? STAGES.indexOf(current) : -1;
  if (!cycle || cycle.status === "idle") return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-4 py-2">
      {steps.map((s) => {
        const i = STAGES.indexOf(s.id);
        const active = s.id === current;
        const done = cycle.status !== "idle" && i < idx;
        return (
          <span
            key={s.id}
            className={cn(
              "inline-flex h-8 shrink-0 items-center rounded-full px-2.5 font-mono text-micro",
              active && "bg-accent text-accent-ink",
              done && "bg-positive/15 text-positive",
              !active && !done && "bg-raised text-faint",
            )}
            title={locale === "fr" ? s.fr : s.en}
          >
            {s.n}
          </span>
        );
      })}
    </div>
  );
}

export function ConsoleApp() {
  const locale = useKayros((s) => s.locale);
  const setLocale = useKayros((s) => s.setLocale);
  const view = useKayros((s) => s.view);
  const setView = useKayros((s) => s.setView);
  const tenant = useKayros((s) => s.tenantName);
  const setTenant = useKayros((s) => s.setTenant);
  const edit = useKayros((s) => s.editEverything);
  const toggleEdit = useKayros((s) => s.toggleEdit);
  const ideas = useKayros((s) => s.ideas);
  const idea = useKayros(currentIdea);
  const selectIdea = useKayros((s) => s.selectIdea);
  const cycle = useKayros((s) => s.cycle);
  const startCycle = useKayros((s) => s.startCycle);
  const advanceCycle = useKayros((s) => s.advanceCycle);
  const addIdea = useKayros((s) => s.addIdea);
  const steps = useKayros((s) => s.steps);
  const gates = useKayros((s) => s.gates);
  const swarms = useKayros((s) => s.swarms);
  const [inspect, setInspect] = useState(false);

  const inboxCount =
    gates.filter((g) => g.status === "open").length +
    swarms.filter((s) => s.lastRun?.status === "pending_human_arbitration").length;

  useEffect(() => {
    void Promise.resolve(useKayros.persist.rehydrate()).then(() => {
      useKayros.getState().setHydrated();
    });
  }, []);

  useEffect(() => {
    if (!cycle || cycle.status !== "running") return;
    const step = steps.find((s) => s.id === cycle.currentStage);
    const tmr = window.setTimeout(() => advanceCycle(), step?.durationMs ?? 600);
    return () => window.clearTimeout(tmr);
  }, [advanceCycle, cycle, cycle?.currentStage, cycle?.events.length, cycle?.status, steps]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        addIdea();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addIdea]);

  const showInspector = view === "board" || view === "matrix" || view === "cycle" || view === "result";
  const atelierOpen = ATELIER.some((i) => i.id === view);
  const systemOpen = SYSTEM.some((i) => i.id === view);

  function onPrimary() {
    if (cycle?.status === "running") {
      advanceCycle();
      return;
    }
    if (cycle?.status === "gated") {
      setView("inbox");
      return;
    }
    if (cycle?.status === "done") {
      setView("result");
      return;
    }
    startCycle();
    setView("board");
  }

  const primaryLabel =
    cycle?.status === "running"
      ? t(locale, "Avancer", "Advance")
      : cycle?.status === "gated"
        ? t(locale, "Ouvrir la porte", "Open gate")
        : cycle?.status === "done"
          ? t(locale, "Voir le résultat", "See result")
          : t(locale, "Lancer le cycle", "Run cycle");

  return (
    <div className="min-h-dvh overflow-x-clip bg-paper text-ink">
      <Toaster theme="dark" />
      <div className="flex min-h-dvh flex-col lg:flex-row">
        <aside className="border-b border-line lg:flex lg:w-56 lg:shrink-0 lg:flex-col lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-3 px-4 py-3 lg:block">
            <div className="min-w-0">
              <p className="font-display text-lg tracking-tight">KayrosLab</p>
              <input
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                className="w-full bg-transparent text-micro text-muted outline-none"
                suppressHydrationWarning
              />
            </div>
            <div className="flex gap-1 lg:mt-3">
              <Button size="sm" variant={locale === "fr" ? "default" : "ghost"} onClick={() => setLocale("fr")}>
                FR
              </Button>
              <Button size="sm" variant={locale === "en" ? "default" : "ghost"} onClick={() => setLocale("en")}>
                EN
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1 px-3 pb-3 lg:hidden">
            {PRIMARY.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              const badge = item.id === "inbox" ? inboxCount : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={cn(
                    "relative flex min-h-11 flex-col items-center justify-center rounded-md text-micro",
                    active ? "bg-raised text-accent" : "text-muted",
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.75} />
                  <span>{locale === "fr" ? item.fr : item.en}</span>
                  {badge > 0 && (
                    <span className="absolute right-1 top-1 size-1.5 rounded-full bg-warning" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="px-3 pb-3 lg:hidden">
            <label className="sr-only" htmlFor="kayros-view">
              {t(locale, "Atelier", "Studio")}
            </label>
            <select
              id="kayros-view"
              value={PRIMARY.some((i) => i.id === view) ? "" : view}
              onChange={(e) => {
                if (e.target.value) setView(e.target.value as ViewId);
              }}
              className="h-11 w-full rounded-md border border-line bg-surface px-3 text-sm"
              suppressHydrationWarning
            >
              <option value="">{t(locale, "Atelier & système…", "Studio & system…")}</option>
              {[...ATELIER, ...SYSTEM].map((item) => (
                <option key={item.id} value={item.id}>
                  {locale === "fr" ? item.fr : item.en}
                </option>
              ))}
            </select>
          </div>

          <nav className="hidden gap-1 overflow-y-auto px-2 pb-4 lg:flex lg:flex-1 lg:flex-col">
            {PRIMARY.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={view === item.id}
                badge={item.id === "inbox" ? inboxCount : undefined}
              />
            ))}
            <details className="mt-3" open={atelierOpen}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-micro uppercase tracking-wider text-faint">
                {t(locale, "Atelier", "Studio")}
                <ChevronDown className="ml-auto size-3.5" />
              </summary>
              <div className="grid gap-1 pt-1">
                {ATELIER.map((item) => (
                  <NavButton key={item.id} item={item} active={view === item.id} />
                ))}
              </div>
            </details>
            <details open={systemOpen}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-micro uppercase tracking-wider text-faint">
                {t(locale, "Système", "System")}
                <ChevronDown className="ml-auto size-3.5" />
              </summary>
              <div className="grid gap-1 pt-1">
                {SYSTEM.map((item) => (
                  <NavButton key={item.id} item={item} active={view === item.id} />
                ))}
              </div>
            </details>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <select
              value={idea?.id ?? ""}
              onChange={(e) => selectIdea(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm md:max-w-sm"
              suppressHydrationWarning
            >
              {ideas.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={toggleEdit}>
              {edit ? t(locale, "Édition on", "Edit on") : t(locale, "Édition off", "Edit off")}
            </Button>
            {showInspector && (
              <Button
                variant={inspect ? "default" : "ghost"}
                className="lg:hidden"
                onClick={() => setInspect((v) => !v)}
              >
                <PanelRight className="size-4" />
                {t(locale, "Fiche", "Sheet")}
              </Button>
            )}
            {inboxCount > 0 && view !== "inbox" && (
              <Button variant="secondary" onClick={() => setView("inbox")}>
                <Inbox className="size-4" />
                {inboxCount}
              </Button>
            )}
            <Button onClick={onPrimary}>{primaryLabel}</Button>
          </header>

          <CycleStrip />

          <div className="flex flex-1 flex-col gap-4 p-4 lg:flex-row lg:p-6">
            <main className="min-w-0 flex-1">
              <ViewBody />
            </main>
            {showInspector && (
              <div
                className={cn(
                  "lg:sticky lg:top-4 lg:block lg:self-start",
                  inspect ? "block" : "hidden lg:block",
                )}
              >
                <Inspector />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
