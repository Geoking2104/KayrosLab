import { useState, type FormEvent } from "react";
import { useConsole } from "@/lib/console/store";
import { FOREIGN_SESSION, HEALTH, hybridCount, registerAccount, SESSION_QUOTA, WORKSPACE_EMAIL, WORKSPACE_NAME } from "@/lib/console/model";
import { Button, Field, Panel, controlClass } from "./ui";

export function Espace() {
  const { state, setRole, resetDemo, replayGuide } = useConsole();
  const hybrids = hybridCount(state.agents);
  const [email, setEmail] = useState("nouveau@atelier.fr");
  const [tenantId, setTenantId] = useState("tenant-client");
  const [signup, setSignup] = useState("");

  function submitSignup(event: FormEvent) {
    event.preventDefault();
    const result = registerAccount(email, tenantId);
    if (!result.ok) {
      setSignup(result.reason);
      return;
    }
    setSignup(
      result.ignored
        ? `Compte ${result.email} créé sur le tenant « ${result.tenant} ». Le tenantId « ${result.ignored} » envoyé par le client est ignoré.`
        : `Compte ${result.email} créé sur le tenant « ${result.tenant} ».`,
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Espace</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Identité, quota et ce que le serveur sait faire. Rien ici ne lance une mission.
        </p>
      </div>

      <Panel>
        <p className="text-xs text-muted">Compte</p>
        <h2 className="text-lg font-medium">{WORKSPACE_NAME}</h2>
        <p className="text-sm text-muted">{WORKSPACE_EMAIL}</p>
        <p className="mt-4 text-sm font-medium">Rôle affiché</p>
        <p className="mt-1 text-sm text-muted">
          Le même espace, deux politiques. Contributeur : instruire et préciser. COMEX : arbitrer et tenir le registre. Le serveur reste le juge ; l’interface ne propose pas le geste interdit.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant={state.role === "contributeur" ? "primary" : "secondary"} onClick={() => setRole("contributeur")}>Contributeur</Button>
          <Button variant={state.role === "comex" ? "primary" : "secondary"} onClick={() => setRole("comex")}>COMEX</Button>
        </div>
      </Panel>

      <Panel>
        <h2 className="text-sm font-medium">Inscription</h2>
        <p className="mt-1 text-sm text-muted">Le tenant est choisi côté serveur. Un tenantId collé dans le formulaire ne change pas l’espace.</p>
        <form className="mt-3 grid gap-3" onSubmit={submitSignup}>
          <Field label="E-mail">
            <input className={controlClass} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
          </Field>
          <Field label="tenantId (refusé)" hint="Présent seulement pour montrer qu’il est ignoré.">
            <input className={controlClass} value={tenantId} onChange={(event) => setTenantId(event.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" className="w-fit">Créer le compte</Button>
        </form>
        {signup ? <p className="mt-3 text-sm" role="status">{signup}</p> : null}
      </Panel>

      <Panel>
        <h2 className="text-sm font-medium">Quota</h2>
        <p className="mt-2 text-sm">
          {state.collectives.length} collectif{state.collectives.length > 1 ? "s" : ""} sur {SESSION_QUOTA}, comptés pour ce compte.
        </p>
        <p className="mt-2 text-sm text-muted">
          La limite n’est pas celle du tenant. « {FOREIGN_SESSION} » peut exister chez quelqu’un d’autre : elle n’entre pas dans ce quota et n’est pas listée. L’essai d’écriture est dans le workbench.
        </p>
      </Panel>

      <Panel>
        <h2 className="text-sm font-medium">Provider par composant</h2>
        <p className="mt-1 text-sm text-muted">Annoncé par la santé du serveur. Le swarm n’est pas laissé sur un modèle local absent.</p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-4">
          {HEALTH.map(([name, provider]) => (
            <div key={name} className="rounded-lg bg-paper px-3 py-3">
              <dt className="text-xs text-muted">{name}</dt>
              <dd className="text-sm font-medium">{provider}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel>
        <h2 className="text-sm font-medium">Ce que le serveur annonce</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Profils hybrides</dt>
            <dd>{hybrids} avec consentement, simulation active en mission.</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Crystal Knows</dt>
            <dd>Jeton serveur absent. L’API n’est pas appelée. Un export ou un DISC reste possible depuis un agent hybride.</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Coffre connecteurs</dt>
            <dd>Chiffrement actif. Les secrets ne reviennent pas au navigateur.</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Mot de passe</dt>
            <dd>smtp.configured est faux. Aucun lien de réinitialisation n’est affiché, aucun e-mail n’est promis.</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="#workbench" className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium">Ouvrir le workbench</a>
          <a href="#demo" className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium">Lancer la démo 1/8</a>
        </div>
      </Panel>

      <Panel>
        <h2 className="text-sm font-medium">Revue du parcours</h2>
        <p className="mt-2 text-sm text-muted">
          Lots en place dans cet espace : isolation, quota par compte, verdict conditionnel vers l’arbitrage, rôles avant la saisie, démo, workbench, Crystal sans jeton, connecteurs honnêtes.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { replayGuide(); location.hash = "overview"; }}>
            Revoir l’introduction
          </Button>
          <Button variant="ghost" onClick={resetDemo}>Réinitialiser l’espace de revue</Button>
        </div>
      </Panel>
    </div>
  );
}