import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ideaLane, LANES, type BoardLane } from "@/lib/kayros/board";
import { currentIdea, useKayros } from "@/lib/kayros/store";
import type { Idea } from "@/lib/kayros/types";
import { cn } from "@/lib/utils";
import { Kicker, Pill, t } from "./bits";

function AgentStack({ idea }: { idea: Idea }) {
  const agents = useKayros((s) => s.agents);
  const steps = useKayros((s) => s.steps);
  const ownerId = steps.find((s) => s.id === idea.stage)?.agentId;
  const owner = agents.find((a) => a.id === ownerId);
  const extras = agents.filter((a) => a.enabled && a.vetoPower).slice(0, 2);
  const shown = [owner, ...extras].filter((a): a is NonNullable<typeof a> => Boolean(a));
  const unique = shown.filter((a, i) => shown.findIndex((b) => b.id === a.id) === i).slice(0, 3);
  return (
    <div className="flex items-center -space-x-1.5">
      {unique.map((a) => (
        <span
          key={a.id}
          title={a.displayName}
          className="grid size-6 place-items-center rounded-full border border-paper bg-raised font-mono text-micro text-muted"
        >
          {a.displayName.slice(0, 1)}
        </span>
      ))}
    </div>
  );
}

function IdeaCard({
  idea,
  lane,
  onDragStart,
}: {
  idea: Idea;
  lane: BoardLane;
  onDragStart: (id: string) => void;
}) {
  const locale = useKayros((s) => s.locale);
  const selected = useKayros((s) => s.selectedIdeaId === idea.id);
  const cycle = useKayros((s) => s.cycle);
  const selectIdea = useKayros((s) => s.selectIdea);
  const startCycle = useKayros((s) => s.startCycle);
  const setView = useKayros((s) => s.setView);
  const reactivate = useKayros((s) => s.reactivate);
  const live = cycle?.ideaId === idea.id && cycle.status === "running";
  const gated = cycle?.ideaId === idea.id && cycle.status === "gated";

  function action() {
    selectIdea(idea.id);
    if (idea.dormant) {
      reactivate(idea.id);
      return;
    }
    if (lane === "gate" || gated) {
      setView("inbox");
      return;
    }
    if (lane === "done") {
      setView("result");
      return;
    }
    startCycle();
  }

  const actionLabel = idea.dormant
    ? t(locale, "Réactiver", "Reactivate")
    : lane === "gate" || gated
      ? t(locale, "Arbitrer", "Arbitrate")
      : lane === "done"
        ? t(locale, "Résultat", "Result")
        : lane === "cycle" && live
          ? t(locale, "Suivre", "Follow")
          : t(locale, "Lancer", "Run");

  return (
    <article
      draggable
      onDragStart={() => onDragStart(idea.id)}
      className={cn(
        "rounded-lg border bg-paper p-3 transition-[border-color,box-shadow] duration-150",
        selected ? "border-accent" : "border-line hover:border-accent/50",
        live && "pulse-ring",
      )}
    >
      <button type="button" className="block w-full text-left" onClick={() => selectIdea(idea.id)}>
        <strong className="block font-display text-sm leading-snug">{idea.title}</strong>
        <span className="mt-1 line-clamp-2 text-micro text-muted">{idea.brief}</span>
      </button>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Pill tone={live ? "accent" : gated ? "warning" : "muted"}>{idea.stage}</Pill>
        <Pill tone="positive">KI {idea.ki.global.toFixed(1)}</Pill>
        {idea.dormant && <Pill tone="warning">{t(locale, "en pause", "parked")}</Pill>}
        {idea.forecast.labelled && lane !== "backlog" && (
          <span className="text-micro uppercase tracking-wider text-warning">{idea.forecast.labelled}</span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <AgentStack idea={idea} />
        <Button size="sm" variant={lane === "gate" || gated ? "default" : "secondary"} onClick={action}>
          {actionLabel}
        </Button>
      </div>
    </article>
  );
}

export function BoardView() {
  const locale = useKayros((s) => s.locale);
  const ideas = useKayros((s) => s.ideas);
  const cycle = useKayros((s) => s.cycle);
  const addIdea = useKayros((s) => s.addIdea);
  const assignLane = useKayros((s) => s.assignLane);
  const guideDismissed = useKayros((s) => s.guideDismissed);
  const dismissGuide = useKayros((s) => s.dismissGuide);
  const setView = useKayros((s) => s.setView);
  const idea = useKayros(currentIdea);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<BoardLane | null>(null);

  function drop(lane: BoardLane) {
    if (!dragging) return;
    const ok = assignLane(dragging, lane);
    if (!ok) {
      toast.error(
        t(
          locale,
          "Une carte ne se mesure qu'après Réaliser — lancez le cycle.",
          "A card is measured only after Execute — run the cycle.",
        ),
      );
    }
    setDragging(null);
    setOver(null);
  }

  return (
    <div className="grid gap-4">
      {!guideDismissed && (
        <aside className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3">
          <div>
            <Kicker>{t(locale, "Premier cycle · 5 minutes", "First cycle · 5 minutes")}</Kicker>
            <p className="text-sm">
              {t(
                locale,
                "Ouvrir l'atelier → composer un essaim → déposer une idée → lancer → arbitrer.",
                "Open the workspace → compose a swarm → file an idea → run → arbitrate.",
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={dismissGuide}>
              {t(locale, "Plus tard", "Later")}
            </Button>
            <Button onClick={() => setView("guide")}>{t(locale, "Guide", "Guide")}</Button>
          </div>
        </aside>
      )}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Kicker>{t(locale, "Tableau de travail", "Work board")}</Kicker>
          <h1 className="font-display text-2xl md:text-3xl">
            {t(locale, "Les idées bougent. L'humain tranche.", "Ideas move. Humans decide.")}
          </h1>
          <p className="max-w-xl text-sm text-muted">
            {t(
              locale,
              "Quatre colonnes, un essaim, une porte. Glissez une carte — ou appuyez sur C pour en créer une.",
              "Four columns, one swarm, one gate. Drag a card — or press C to create one.",
            )}
          </p>
        </div>
        <Button onClick={addIdea}>{t(locale, "Nouvelle idée", "New idea")}</Button>
      </header>

      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 xl:mx-0 xl:grid xl:grid-cols-4 xl:overflow-visible xl:px-0">
        {LANES.map((col) => {
          const cards = ideas.filter((i) => ideaLane(i, cycle) === col.id);
          return (
            <section
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.id);
              }}
              onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                drop(col.id);
              }}
              className={cn(
                "flex min-h-64 w-[78vw] shrink-0 flex-col rounded-xl border bg-surface p-2 transition-colors duration-150 sm:w-72 xl:w-auto",
                over === col.id ? "border-accent bg-accent/5" : "border-line",
              )}
            >
              <div className="flex items-baseline justify-between px-2 py-2">
                <h2 className="font-display text-sm">{locale === "fr" ? col.fr : col.en}</h2>
                <span className="font-mono text-micro text-faint">{cards.length}</span>
              </div>
              <p className="px-2 pb-2 text-micro text-faint">{locale === "fr" ? col.hintFr : col.hintEn}</p>
              <div className="grid flex-1 content-start gap-2">
                {cards.map((card) => (
                  <IdeaCard key={card.id} idea={card} lane={col.id} onDragStart={setDragging} />
                ))}
                {cards.length === 0 && (
                  <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-micro text-faint">
                    {t(locale, "Déposez une carte", "Drop a card")}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {idea && (
        <p className="text-micro text-faint">
          {t(locale, "Sélection", "Selected")} · {idea.title} · {idea.stage} · {idea.status}
        </p>
      )}
    </div>
  );
}
