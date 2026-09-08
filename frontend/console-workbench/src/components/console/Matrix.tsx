import { STAGES } from "@/lib/kayros/engine";
import { currentIdea, useKayros } from "@/lib/kayros/store";
import { cn } from "@/lib/utils";
import { InlineEdit, Pill, t } from "./bits";

export function Matrix() {
  const locale = useKayros((s) => s.locale);
  const steps = useKayros((s) => s.steps);
  const cycle = useKayros((s) => s.cycle);
  const idea = useKayros(currentIdea);
  const updateStep = useKayros((s) => s.updateStep);
  const setIdeaStage = useKayros((s) => s.setIdeaStage);
  const setView = useKayros((s) => s.setView);
  const view = useKayros((s) => s.view);
  if (view !== "matrix" || !idea) return null;

  const current = cycle?.currentStage ?? idea.stage;
  const currentIdx = STAGES.indexOf(current);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-micro uppercase tracking-[0.18em] text-faint">
            {t(locale, "Matrice de travail", "Work matrix")}
          </p>
          <h1 className="font-display text-2xl md:text-3xl">{idea.title}</h1>
          <p className="max-w-2xl text-sm text-muted">{idea.brief}</p>
        </div>
        <div className="text-right">
          <div className="text-micro text-faint">KI</div>
          <div className="font-display text-2xl tabular text-accent">{idea.ki.global.toFixed(1)}</div>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2 md:gap-3">
        {steps.map((step) => {
          const idx = STAGES.indexOf(step.id);
          const active = current === step.id;
          const done = idx < currentIdx && cycle?.status !== "idle";
          const gated = cycle?.status === "gated" && step.id === "arbitrer";
          return (
            <article
              key={step.id}
              onClick={() => {
                setIdeaStage(idea.id, step.id);
                if (gated) setView("inbox");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setIdeaStage(idea.id, step.id);
                  if (gated) setView("inbox");
                }
              }}
              tabIndex={0}
              className={cn(
                "min-h-24 min-w-0 cursor-pointer rounded-lg border bg-surface p-2 text-left transition-colors duration-200 md:min-h-36 md:rounded-xl md:p-4",
                active ? "border-accent pulse-ring" : "border-line hover:border-accent/40",
                !step.enabled && "opacity-40",
                gated && "border-warning",
                done && !active && "border-positive/40",
              )}
            >
              <div className="flex items-start justify-between gap-1">
                <span className="font-mono text-micro text-accent">{step.n}</span>
                <Pill tone={gated ? "warning" : active ? "accent" : done ? "positive" : "muted"}>
                  {gated ? "gate" : active ? "live" : done ? "ok" : step.enabled ? "idle" : "off"}
                </Pill>
              </div>
              <InlineEdit
                value={locale === "fr" ? step.fr : step.en}
                onChange={(v) => updateStep(step.id, locale === "fr" ? { fr: v } : { en: v })}
                className="mt-1 font-display text-xs leading-tight md:mt-2 md:text-lg"
              />
              <p className="mt-1 hidden line-clamp-2 text-xs text-muted md:block">
                {locale === "fr" ? step.roleFr : step.roleEn}
              </p>
              <p className="mt-2 hidden font-mono text-micro text-faint md:block">
                {step.agentId} · {locale === "fr" ? step.outputFr : step.outputEn}
              </p>
            </article>
          );
        })}
      </div>
      <p className="text-xs text-faint">
        {t(
          locale,
          "Réaliser nourrit Écouter — la boucle KPI est le contrat de la matrice. Cliquez une cellule pour l'inspecter.",
          "Execute feeds Listen — the KPI loop is the matrix contract. Click a cell to inspect.",
        )}
      </p>
    </div>
  );
}
