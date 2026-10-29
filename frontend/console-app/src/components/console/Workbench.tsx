import { useState } from "react";
import { useConsole } from "@/lib/console/store";
import { FOREIGN_SESSION, refuseForeign } from "@/lib/console/model";
import { Button, Field, Panel, TextArea } from "./ui";
import { go } from "./Shell";
import { t, tc } from "@/lib/i18n";

export function Workbench() {
  const { state, startMission, selectCollective } = useConsole();
  const [question, setQuestion] = useState(t(
    "Le pilote de 90 jours tient-il sans remise, avec un point de sortie écrit ?"
  ));
  const [refusal, setRefusal] = useState("");
  const collective = state.collectives.find((item) => item.id === state.selectedCollectiveId) ?? state.collectives[0];
  const leaked = state.collectives.some((item) => item.name === FOREIGN_SESSION);

  function launch() {
    if (!collective || question.trim().length < 3) return;
    selectCollective(collective.id);
    const id = startMission({
      question,
      collectiveId: collective.id,
      profile: state.defaultProfile,
      useCase: "general",
      evidence: [],
    });
    go("dossiers", id);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-ink">Workbench</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t(
          "Le poste de mission. La session active est celle que vous venez de choisir. Le dossier s’ouvre dès le lancement."
        )}</p>
      </div>

      <Panel>
        <h2 className="text-sm font-medium">{t("Collectif actif")}</h2>
        {state.collectives.length === 0 ? (
          <p className="mt-2 text-sm">{t("Aucun collectif sur ce compte. Créez-en un avant de lancer.")}</p>
        ) : (
          <div className="mt-3 grid gap-2">
            {state.collectives.map((item) => (
              <label key={item.id} className={`flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm ${item.id === collective?.id ? "border-accent bg-accent-soft" : "border-line"}`}>
                <input type="radio" name="wb" checked={item.id === collective?.id} onChange={() => selectCollective(item.id)} />
                {tc(item.name)}
                <span className="text-muted">{t("{{count}} agents", { count: item.agentIds.length })}</span>
              </label>
            ))}
          </div>
        )}
        <p className="mt-3 text-sm text-muted">
          {leaked ? t("Fuite : une session étrangère est visible.") : t("« {{FOREIGN_SESSION}} » n’est pas dans cette liste.", {
            FOREIGN_SESSION
          })}
        </p>
        <Field label={t("Question")}>
          <TextArea className="mt-3" value={question} onChange={(event) => setQuestion(event.target.value)} />
        </Field>
        <Button className="mt-3" onClick={launch} disabled={!collective}>{t("Lancer dans ce collectif")}</Button>
      </Panel>

      <Panel>
        <h2 className="text-sm font-medium">{t("Écriture sur un autre compte")}</h2>
        <p className="mt-1 text-sm text-muted">{t(
          "Le tenant contient une session qui n’est pas la vôtre. Lancer une mission ou répondre dans son fil est refusé avant tout enregistrement."
        )}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setRefusal(refuseForeign("run").reason)}>{t("Tenter /run")}</Button>
          <Button variant="secondary" onClick={() => setRefusal(refuseForeign("message").reason)}>{t("Tenter /messages")}</Button>
        </div>
        {refusal ? <p className="mt-3 text-sm text-stop" role="alert">{refusal}</p> : null}
      </Panel>
    </div>
  );
}
