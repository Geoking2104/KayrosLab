import {
  ArrowRight,
  BookOpen,
  FileText,
  Gavel,
  Lightbulb,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useConsole } from "@/lib/console/store";
import { t } from "@/lib/i18n";
import { Button, Panel } from "./ui";
import { go } from "./Shell";

export function DecisionGuide({ compact = false }: { compact?: boolean }) {
  const { live, permissions, state } = useConsole();
  const steps = [
    {
      icon: Lightbulb,
      title: t("Cadrer la décision"),
      text: t(
        "Formulez le choix, les options, les contraintes et la date à laquelle trancher.",
      ),
      page: "instruire" as const,
    },
    {
      icon: FileText,
      title: t("Rassembler les preuves"),
      text: t(
        "Ajoutez les faits et leurs sources. Les hypothèses restent identifiées comme telles.",
      ),
      page: "bibliotheque" as const,
    },
    {
      icon: Users,
      title: t("Confronter les avis"),
      text: t(
        "Choisissez un comité d’agents aux missions complémentaires et vérifiez ses règles de vote.",
      ),
      page: "collectifs" as const,
    },
    {
      icon: Gavel,
      title: t("Arbitrer et tracer"),
      text: t(
        "Un membre habilité accepte, conditionne ou demande une réévaluation. Le motif reste au dossier.",
      ),
      page: "arbitrages" as const,
    },
  ];
  return (
    <div className="grid gap-5">
      {!compact && (
        <div>
          <p className="eyebrow">{t("Prise en main")}</p>
          <h1 className="page-title">
            {t("Votre première décision, pas à pas")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            {t(
              "L’IA prépare et confronte. Le comité humain garde la décision.",
            )}
          </p>
        </div>
      )}
      <Panel>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BookOpen size={17} className="text-accent" />
          {t("Un parcours, un dossier")}
        </h2>
        <ol
          className={
            compact ? "mt-5 grid gap-5" : "mt-5 grid gap-5 sm:grid-cols-2"
          }
        >
          {steps.map((step, i) => (
            <li key={step.page} className="flex gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                <step.icon size={16} />
              </span>
              <div>
                <p className="text-sm font-semibold">
                  {i + 1}. {step.title}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <Button
          className="mt-5 w-full"
          onClick={() => go("instruire")}
          disabled={!permissions.includes("run")}
        >
          {t("Préparer une décision")}
          <ArrowRight size={15} />
        </Button>
      </Panel>
      {!compact && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Panel>
              <h2 className="flex items-center gap-2 text-sm">
                <Sparkles size={17} className="text-accent" />
                {t("Ce que fait l’IA")}
              </h2>
              <p className="mt-3 text-sm text-muted">
                {t(
                  "Elle instruit la question avec les agents du comité, expose les objections et produit un avis consultatif. Vous pouvez demander une précision depuis le même dossier.",
                )}
              </p>
            </Panel>
            <Panel>
              <h2 className="flex items-center gap-2 text-sm">
                <ShieldCheck size={17} className="text-accent" />
                {t("Ce que vous contrôlez")}
              </h2>
              <p className="mt-3 text-sm text-muted">
                {t(
                  "Les sources partagées, la composition du comité, ses règles et l’arbitrage. Une réponse de l’IA ne vaut jamais approbation humaine.",
                )}
              </p>
            </Panel>
          </div>
          <Panel>
            <h2 className="text-sm">{t("Préparer votre espace")}</h2>
            <p className="mt-2 text-sm text-muted">
              {live
                ? t(
                    "Votre espace est connecté. Vérifiez les membres, les comités et le contexte avant votre première instruction.",
                  )
                : t(
                    "Explorez les exemples en démo, puis connectez votre espace pour travailler sur vos décisions réelles.",
                  )}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {!live && (
                <Button variant="secondary" onClick={() => go("connexions")}>
                  {t("Connecter mon espace")}
                </Button>
              )}
              <Button variant="secondary" onClick={() => go("collectifs")}>
                {t("Voir les comités")} ({state.collectives.length})
              </Button>
              <Button variant="secondary" onClick={() => go("membres")}>
                {t("Membres et habilitations")}
              </Button>
              <Button variant="ghost" onClick={() => go("projets")}>
                {t("Parcours avancés et graphes")}
              </Button>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
