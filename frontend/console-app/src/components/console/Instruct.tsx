import { useState } from "react";
import { useConsole } from "@/lib/console/store";
import { PROFILES, USE_CASES, type Profile, type UseCase } from "@/lib/console/model";
import { cn } from "@/lib/cn";
import { Button, Field, Panel, TextArea, controlClass } from "./ui";
import { go } from "./Shell";

const EVIDENCE_TYPES = ["RFP / exigences", "Proposition", "Contrat", "Sécurité", "Finance", "Notes", "Autre"];

export function Instruct() {
  const { state, startMission } = useConsole();
  const [step, setStep] = useState(0);
  const [question, setQuestion] = useState("Faut-il accorder 90 jours d’essai au cabinet Nord, sans remise, avec un point de sortie écrit ?");
  const [useCase, setUseCase] = useState<UseCase>("general");
  const [profile, setProfile] = useState<Profile>(state.defaultProfile);
  const [collectiveId, setCollectiveId] = useState(state.selectedCollectiveId);
  const [files, setFiles] = useState<{ name: string; type: string }[]>([]);
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState(EVIDENCE_TYPES[0]);
  const oracle = USE_CASES.find((item) => item.id === useCase)?.oracle ?? false;
  const collective = state.collectives.find((item) => item.id === collectiveId) ?? state.collectives[0];

  function launch() {
    if (!collective) return;
    const id = startMission({
      question,
      collectiveId: collective.id,
      profile,
      useCase,
      evidence: files,
    });
    go("dossiers", id);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink">Instruire une décision</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Trois préparations, puis le dossier. L’instruction, la lecture et l’arbitrage ne changent pas d’écran.
        </p>
      </div>
      <ol className="grid grid-cols-3 gap-2 text-sm">
        {["Décision", "Collectif", "Preuves"].map((label, index) => (
          <li key={label} className={cn("rounded-lg px-3 py-2", index === step ? "bg-ink text-surface" : index < step ? "bg-accent-soft text-ink" : "bg-surface text-muted")}>
            0{index + 1} {label}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <Panel>
          <Field label="La question" hint="Une phrase comparable : objet, écart, échéance. Moins de six mots, le collectif demandera une précision au lieu d’inventer un verdict.">
            <TextArea value={question} onChange={(event) => setQuestion(event.target.value)} />
          </Field>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              "Faut-il lancer ce projet maintenant, et à quelles conditions ?",
              "Devons-nous accepter la remise de 15 % demandée par ce client ?",
              "On y va ?",
            ].map((sample) => (
              <button key={sample} type="button" className="rounded-full bg-paper px-3 py-2 text-left text-xs text-ink-soft" onClick={() => setQuestion(sample)}>
                {sample}
              </button>
            ))}
          </div>
          <fieldset className="mt-5">
            <legend className="text-sm font-medium">Nature</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {USE_CASES.map((item) => (
                <label key={item.id} className={cn("flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm", useCase === item.id ? "border-accent bg-accent-soft" : "border-line")}>
                  <input type="radio" name="usecase" checked={useCase === item.id} onChange={() => setUseCase(item.id)} />
                  {item.label}
                  {item.oracle ? <span className="text-xs text-muted">oracle</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-5">
            <legend className="text-sm font-medium">Profil d’exécution</legend>
            <div className="mt-2 grid gap-2">
              {PROFILES.map((item) => (
                <label key={item.id} className={cn("rounded-lg border px-3 py-3 text-sm", profile === item.id ? "border-accent bg-accent-soft" : "border-line")}>
                  <span className="flex items-center gap-2 font-medium">
                    <input type="radio" name="profile" checked={profile === item.id} onChange={() => setProfile(item.id)} />
                    {item.label}
                    <span className="font-normal text-muted">· {item.provider}</span>
                  </span>
                  <span className="mt-1 block pl-6 text-xs text-muted">{item.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Button className="mt-5" disabled={question.trim().length < 3} onClick={() => setStep(1)}>
            Continuer
          </Button>
        </Panel>
      ) : null}

      {step === 1 ? (
        <Panel>
          <h2 className="text-sm font-medium">Quel collectif instruit</h2>
          <p className="mt-1 text-sm text-muted">Celui que vous venez de créer est déjà sélectionné. Pas d’alerte du navigateur si la liste est vide : le message est ici.</p>
          {state.collectives.length === 0 ? (
            <p className="mt-4 text-sm">Aucun collectif sur votre compte. Créez-en un, il sera pris pour cette question.</p>
          ) : (
            <div className="mt-4 grid gap-2">
              {state.collectives.map((item) => (
                <label key={item.id} className={cn("rounded-lg border px-3 py-3 text-sm", collectiveId === item.id ? "border-accent bg-accent-soft" : "border-line")}>
                  <span className="flex items-center gap-2 font-medium">
                    <input type="radio" name="col" checked={collectiveId === item.id} onChange={() => setCollectiveId(item.id)} />
                    {item.name}
                  </span>
                  <span className="mt-1 block pl-6 text-xs text-muted">
                    {item.agentIds.length} agents{item.personality ? " · personnalités simulées" : ""}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setStep(0)}>Retour</Button>
            <Button onClick={() => setStep(2)} disabled={!collective}>Continuer</Button>
            <a href="#collectifs" className="inline-flex min-h-11 items-center px-2 text-sm text-accent-strong">Créer un collectif</a>
          </div>
        </Panel>
      ) : null}

      {step === 2 ? (
        <Panel>
          <h2 className="text-sm font-medium">Preuves</h2>
          <p className="mt-1 text-sm text-muted">
            {oracle
              ? "Oracle commercial : le corpus (RFP, contrat, notes) rend le verdict opposable. Facultatif pour lancer, recommandé avant l’arbitrage."
              : "Facultatif. Les fichiers restent attachés au dossier. En production, l’empreinte est calculée dans le navigateur puis l’envoi est signé."}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Field label="Document">
              <input className={controlClass} value={fileName} onChange={(event) => setFileName(event.target.value)} placeholder="avenant.pdf" />
            </Field>
            <Field label="Rôle">
              <select className={controlClass} value={fileType} onChange={(event) => setFileType(event.target.value)}>
                {EVIDENCE_TYPES.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </Field>
            <Button
              variant="secondary"
              disabled={!fileName.trim()}
              onClick={() => {
                setFiles((current) => [...current, { name: fileName.trim(), type: fileType }]);
                setFileName("");
              }}
            >
              Ajouter
            </Button>
          </div>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {files.length === 0 ? <li className="text-muted">Aucune preuve ajoutée.</li> : files.map((file) => (
              <li key={file.name} className="flex justify-between rounded-lg bg-paper px-3 py-2">
                <span>{file.name}</span>
                <span className="text-muted">{file.type}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setStep(1)}>Retour</Button>
            <Button onClick={launch} disabled={!collective || question.trim().length < 3}>Lancer l’instruction</Button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
