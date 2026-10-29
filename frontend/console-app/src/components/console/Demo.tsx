import { useState } from "react";
import { Button, Panel } from "./ui";
import { t } from "@/lib/i18n";

const STEPS = [
  {
    get title() { return t("Carte sémantique"); },
    get body() { return t("Les signaux du brief sont lus comme une carte : sujet, tension, horizon. Le format est accepté. Rien n’est évalué comme du code."); },
  },
  {
    get title() { return t("Signaux qualifiés"); },
    get body() { return t("Le bruit est écarté. Il reste une question comparable, pas une liste brute."); },
  },
  {
    get title() { return t("Ponts"); },
    get body() { return t("Deux domaines se croisent. Le pont est une hypothèse, pas un fait."); },
  },
  {
    get title() { return t("Scénarios"); },
    get body() { return t("Trois issues : tenir, conditionner, arrêter. Chacune a un coût."); },
  },
  {
    get title() { return t("Écarts"); },
    get body() { return t("Ce qui manque pour trancher est nommé : preuve, délai, responsable."); },
  },
  {
    get title() { return t("Contradiction"); },
    get body() { return t("Finance, technique et juridique ne disent pas la même chose. Les objections restent visibles."); },
  },
  {
    get title() { return t("Verdict de démo"); },
    get body() { return t("GO conditionnel, préenregistré. Provider : démo. Ce n’est pas un appel modèle, et ce n’est pas un mock silencieux."); },
  },
  {
    get title() { return t("Sortie"); },
    get body() { return t("Le parcours s’arrête sur le verdict. L’arbitrage humain reste dans la console, pas dans cette démo."); },
  },
];

export function Demo() {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const done = step >= STEPS.length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-ink">{t("Démo publique")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t(
          "Huit étapes. La première passe. Le provider affiché est la démo préenregistrée."
        )}</p>
      </div>
      <p className="text-sm text-muted">{done ? "8/8" : `${step + 1}/8`}</p>
      <ol className="grid grid-cols-4 gap-1 sm:grid-cols-8">
        {STEPS.map((item, index) => (
          <li key={item.title} className={`rounded-lg px-2 py-2 text-xs ${index < step ? "bg-accent-soft text-ink" : index === step && !done ? "bg-ink text-surface" : "bg-surface text-muted"}`}>
            0{index + 1}
          </li>
        ))}
      </ol>
      <Panel>
        {done ? (
          <>
            <h2 className="text-lg font-medium">{t("Parcours terminé")}</h2>
            <p className="mt-2 text-sm text-ink-soft">{t(
              "Étape 8/8. Verdict de démo : GO conditionnel. Provider : démo préenregistrée."
            )}</p>
            <Button className="mt-4" variant="secondary" onClick={() => setStep(0)}>{t("Recommencer")}</Button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted">{t("Étape")}{" "}{step + 1}</p>
            <h2 className="mt-1 text-lg font-medium">{current.title}</h2>
            <p className="mt-2 text-sm text-ink-soft">{current.body}</p>
            <div className="mt-4 flex gap-2">
              {step > 0 ? <Button variant="secondary" onClick={() => setStep((value) => value - 1)}>{t("Retour")}</Button> : null}
              <Button onClick={() => setStep((value) => value + 1)}>{step === STEPS.length - 1 ? "Terminer" : "Continuer"}</Button>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
