import { useEffect, useState, type ButtonHTMLAttributes } from "react";
import { useConsole } from "@/lib/console/store";
import { formatWhen, PROFILES, type Connector, type ConnectorId } from "@/lib/console/model";
import { Field, Panel, controlClass } from "./ui";
import { LiveChannels } from "./LiveChannels";
import { cn } from "@/lib/cn";

const TABS = [
  { id: "canaux", label: "Canaux" },
  { id: "salesforce", label: "Salesforce" },
  { id: "cles", label: "Clés" },
  { id: "webhook", label: "Webhook" },
  { id: "chat", label: "Liaison" },
  { id: "guides", label: "Guides" },
] as const;

const TONE: Record<ConnectorId, { color: string; soft: string }> = {
  slack: { color: "#4a154b", soft: "#f6eef6" },
  teams: { color: "#4b53bc", soft: "#eef0fb" },
  discord: { color: "#5865f2", soft: "#eeeefe" },
  salesforce: { color: "#0b5cab", soft: "#e7f2fb" },
};

const STEPS: Record<string, string[]> = {
  n8n: ["Créez une clé nommée pour le flux.", "Importez le workflow fourni.", "Mappez l’opportunité vers la question.", "Le verdict revient signé dans votre outil."],
  zapier: ["Webhook sortant vers POST /v1/public/missions.", "Profil rapide ou démo selon l’enjeu.", "Récupérez le dossier par l’identifiant renvoyé."],
  salesforce: ["Choisissez l’org et l’objet.", "L’étape Proposal déclenche la question.", "Le verdict revient en tâche ou en champ."],
  api: ["Clé kl_live_ montrée une fois.", "POST /missions répond 202.", "60 requêtes/min, 200 missions/jour."],
};

const SALESFORCE_CHECKS = [
  "J’ai un administrateur Salesforce pour cette org.",
  "L’application connectée est créée côté serveur, pas dans cette page.",
  "Les objets choisis sont autorisés pour cet utilisateur d’intégration.",
];

export function Connexions({ legacy }: { legacy: string }) {
  const { state, testConnector, toggleConnector, configureConnector, createKey, dismissKey, revealWebhook, pingWebhook, setDefaultProfile, linkChat } = useConsole();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>(legacy === "settings" ? "cles" : "canaux");
  const [tool, setTool] = useState<keyof typeof STEPS>("salesforce");
  const [open, setOpen] = useState<ConnectorId | null>(null);
  const [tick, setTick] = useState(0);
  const [keyName, setKeyName] = useState("n8n — Salesforce");
  const [checked, setChecked] = useState<string[]>([]);
  const [token, setToken] = useState("");
  const [linkError, setLinkError] = useState("");
  const manager = state.role === "comex";
  const [live, setLive] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 3000);
    return () => window.clearInterval(timer);
  }, []);

  const visible = tab === "salesforce" || live ? state.connectors.filter((item) => item.id === "salesforce") : state.connectors;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-ink">Connexions</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Chaque canal s’intègre ou s’édite ici. Un canal connecté montre qui est en ligne. Aucun secret n’est collé dans la page.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((item) => {
          const on = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(item.id)}
              className={cn("min-h-11 rounded-full px-4 text-sm font-semibold", on ? "bg-accent text-white shadow-cta" : "border border-line bg-white text-ink-soft")}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === "canaux" || tab === "salesforce" ? (
        <div className="grid gap-3">
          {tab === "canaux" ? <LiveChannels onSession={setLive} /> : null}
          {visible.map((connector) => (
            <Channel
              key={connector.id}
              connector={connector}
              tick={tick}
              editing={tab === "salesforce" || open === connector.id}
              pinned={tab === "salesforce"}
              onEdit={() => setOpen(connector.id)}
              onClose={() => setOpen(null)}
              onTest={() => testConnector(connector.id)}
              onToggle={() => toggleConnector(connector.id)}
              onSave={(options, connect) => configureConnector(connector.id, options, connect)}
            />
          ))}
        </div>
      ) : null}

      {tab === "cles" ? (
        <div className="grid gap-3">
          <Panel>
            <h2 className="text-sm font-medium">Profil de mission par défaut</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {PROFILES.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setDefaultProfile(profile.id)}
                  className={`rounded-lg border px-3 py-3 text-left text-sm ${state.defaultProfile === profile.id ? "border-accent bg-accent-soft" : "border-line"}`}
                >
                  <span className="font-medium">{profile.label}</span>
                  <span className="mt-1 block text-xs text-muted">{profile.hint}</span>
                </button>
              ))}
            </div>
          </Panel>
          <Panel>
            <h2 className="text-sm font-medium">Clés d’API</h2>
            <p className="mt-1 text-sm text-muted">Montrée une fois. Le secret complet ne reste pas affiché après confirmation.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <Field label="Nom de la clé">
                <input className={controlClass} value={keyName} onChange={(event) => setKeyName(event.target.value)} />
              </Field>
              <Action tone="integrate" onClick={() => createKey(keyName, checked)}>Créer la clé</Action>
            </div>
            <fieldset className="mt-3">
              <legend className="text-xs text-muted">Collectifs autorisés — aucun coché, tous les vôtres</legend>
              <div className="mt-2 flex flex-col gap-2">
                {state.collectives.map((collective) => (
                  <label key={collective.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked.includes(collective.id)}
                      onChange={() => setChecked((current) => current.includes(collective.id) ? current.filter((id) => id !== collective.id) : [...current, collective.id])}
                    />
                    {collective.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <ul className="mt-4 flex flex-col gap-3">
              {state.keys.map((key) => (
                <li key={key.id} className="rounded-lg bg-paper px-3 py-3 text-sm">
                  <p className="font-medium">{key.name}</p>
                  <p className="font-mono text-xs">{key.secret && !key.revealed ? key.secret : `${key.prefix}…`}</p>
                  {key.secret && !key.revealed ? (
                    <Action tone="edit" className="mt-2" onClick={() => dismissKey(key.id)}>J’ai copié la clé</Action>
                  ) : (
                    <p className="mt-1 text-xs text-muted">Créée le {formatWhen(key.createdAt)}. Secret masqué.</p>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      ) : null}

      {tab === "webhook" ? (
        <Panel>
          <h2 className="text-sm font-medium">Webhook signé</h2>
          <p className="mt-1 text-sm text-muted">HMAC-SHA256. Le secret ne revient pas dans les journaux.</p>
          <p className="mt-2 font-mono text-xs">https://api.kayroslab.com/v1/hooks/atelier</p>
          {state.webhookSecret && !state.webhookRevealed ? (
            <p className="mt-3 rounded-lg bg-hold-soft px-3 py-2 font-mono text-xs text-hold">{state.webhookSecret}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Action tone="edit" onClick={revealWebhook}>Révéler le secret</Action>
            <Action tone="test" onClick={pingWebhook}>Envoyer un ping</Action>
          </div>
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {state.deliveries.map((delivery) => (
              <li key={delivery.id} className="flex justify-between gap-3">
                <span>{delivery.event}</span>
                <span className="text-muted">{delivery.status === "delivered" ? "livré" : "abandonné"} · {formatWhen(delivery.at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {tab === "chat" ? (
        <Panel>
          <h2 className="text-sm font-medium">Lier un compte de chat</h2>
          <p className="mt-1 text-sm text-muted">Pour arbitrer depuis Slack, Teams ou Discord. Jeton à usage unique, 15 minutes, remis par le bot.</p>
          {manager ? (
            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                const result = linkChat(token);
                setLinkError(result.ok ? "" : result.reason ?? "Refusé");
                if (result.ok) setToken("");
              }}
            >
              <input className={controlClass} value={token} onChange={(event) => setToken(event.target.value)} placeholder="link_…" aria-label="Jeton de liaison" />
              <Action tone="integrate" type="submit">Lier</Action>
            </form>
          ) : (
            <p className="mt-3 rounded-lg bg-paper px-3 py-3 text-sm">Réservé au COMEX. Le champ n’est pas proposé.</p>
          )}
          {linkError ? <p className="mt-2 text-sm text-stop" role="alert">{linkError}</p> : null}
        </Panel>
      ) : null}

      {tab === "guides" ? (
        <Panel>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(STEPS) as (keyof typeof STEPS)[]).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setTool(id)}
                className={cn("min-h-10 rounded-full px-3 text-sm font-semibold", tool === id ? "bg-accent text-white shadow-cta" : "border border-line bg-white text-ink-soft")}
              >
                {id}
              </button>
            ))}
          </div>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
            {STEPS[tool].map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Panel>
      ) : null}
    </div>
  );
}

function Channel({
  connector,
  tick,
  editing,
  pinned,
  onEdit,
  onClose,
  onTest,
  onToggle,
  onSave,
}: {
  connector: Connector;
  tick: number;
  editing: boolean;
  pinned: boolean;
  onEdit: () => void;
  onClose: () => void;
  onTest: () => void;
  onToggle: () => void;
  onSave: (options: Record<string, string>, connect: boolean) => { ok: boolean; reason?: string };
}) {
  const tone = TONE[connector.id];
  const connected = connector.status === "connected" && connector.enabled;
  const [error, setError] = useState("");

  return (
    <Panel className="border-l-4" style={{ borderLeftColor: tone.color }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Mark id={connector.id} />
          <div>
            <p className="flex items-center gap-2 text-xs font-medium" style={{ color: tone.color }}>
              <span className="rounded-full bg-hold px-2 py-0.5 text-[11px] font-semibold text-white">Démo</span>
              {statusLabel(connector.status)}
            </p>
            <h2 className="text-lg font-medium">{connector.name}</h2>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {pinned ? null : connected ? (
            <Action tone="edit" onClick={() => (editing ? onClose() : onEdit())}>{editing ? "Fermer" : "Éditer"}</Action>
          ) : (
            <Action tone="integrate" onClick={() => (editing ? onClose() : onEdit())}>{editing ? "Fermer" : "Intégrer"}</Action>
          )}
          <Action tone="test" onClick={onTest} disabled={!connector.oauthReady && connector.status === "not_configured" && connector.id !== "salesforce"}>
            Tester
          </Action>
          <Action tone={connector.enabled ? "off" : "on"} onClick={onToggle} disabled={connector.status === "not_configured"}>
            {connector.enabled ? "Désactiver" : "Activer"}
          </Action>
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-soft">{connector.detail}</p>
      <p className="mt-2 text-xs text-muted">{connector.lastTest ? `Dernier test ${formatWhen(connector.lastTest)}` : "Jamais testé"} · données de démonstration</p>
      <Presence connector={connector} tick={tick} />
      {editing ? <Editor connector={connector} onSave={onSave} onDone={onClose} error={error} setError={setError} /> : null}
    </Panel>
  );
}

function Presence({ connector, tick }: { connector: Connector; tick: number }) {
  if (connector.status !== "connected" || !connector.enabled) return null;
  const base = connector.usersOnline ?? 6;
  const online = Math.max(1, base + ((tick + connector.name.length) % 5) - 2);
  const total = connector.usersTotal ?? online + 20;
  const calm = online < base;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-surface px-3 py-2">
      <span className={cn("size-2.5 rounded-full", calm ? "bg-hold" : "bg-go")} aria-hidden="true" />
      <p className="text-sm">
        <span className="font-medium">{online}</span>
        <span className="text-muted"> / {total} utilisateurs</span>
      </p>
      <span className={cn("text-xs font-semibold", calm ? "text-hold" : "text-go")}>{calm ? "Calme" : "Actif"}</span>
      <span className="text-xs text-muted">présence simulée (démo)</span>
    </div>
  );
}

function Editor({
  connector,
  onSave,
  onDone,
  error,
  setError,
}: {
  connector: Connector;
  onSave: (options: Record<string, string>, connect: boolean) => { ok: boolean; reason?: string };
  onDone: () => void;
  error: string;
  setError: (value: string) => void;
}) {
  const [environment, setEnvironment] = useState(connector.options?.environment || "sandbox");
  const [object, setObject] = useState(connector.options?.object || "Opportunity");
  const [stage, setStage] = useState(connector.options?.stage || "Proposal");
  const [direction, setDirection] = useState(connector.options?.direction || "both");
  const [writeback, setWriteback] = useState(connector.options?.writeback || "task");
  const [canal, setCanal] = useState(connector.options?.canal || "#decisions");
  const [notify, setNotify] = useState(connector.options?.notify || "verdict");
  const [serveur, setServeur] = useState(connector.options?.serveur || "");
  const [checks, setChecks] = useState<boolean[]>(SALESFORCE_CHECKS.map(() => connector.status === "connected"));

  function save(connect: boolean) {
    if (connector.id === "salesforce" && connect && checks.some((item) => !item)) {
      setError("Cochez les trois conditions d’onboarding.");
      return;
    }
    const options: Record<string, string> = connector.id === "salesforce"
      ? { environment, object, stage, direction, writeback }
      : connector.id === "discord"
        ? { serveur }
        : { canal, notify };
    const result = onSave(options, connect);
    setError(result.ok ? "" : result.reason ?? "Refusé");
    if (result.ok) onDone();
  }

  if (connector.id === "teams") {
    return (
      <div className="mt-4 rounded-lg bg-surface px-3 py-3 text-sm">
        <p className="font-medium">Démo</p>
        <p className="mt-1 text-ink-soft">Connectez-vous pour voir l’état réel de Teams. Côté serveur, la connexion en un geste exige <code>TEAMS_APP_ID</code> et <code>TEAMS_BOT_PASSWORD</code>.</p>
      </div>
    );
  }

  if (connector.id === "salesforce") {
    return (
      <div className="mt-4 grid gap-3 rounded-lg bg-surface p-3">
        <p className="text-sm font-medium">Onboarding Salesforce</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Environnement">
            <select className={controlClass} value={environment} onChange={(event) => setEnvironment(event.target.value)}>
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </Field>
          <Field label="Objet">
            <select className={controlClass} value={object} onChange={(event) => setObject(event.target.value)}>
              {["Opportunity", "Account", "Case", "Lead"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Étape déclencheur">
            <select className={controlClass} value={stage} onChange={(event) => setStage(event.target.value)}>
              {["Proposal", "Negotiation", "Closed Won"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Sens">
            <select className={controlClass} value={direction} onChange={(event) => setDirection(event.target.value)}>
              <option value="inbound">Salesforce vers KayrosLab</option>
              <option value="both">Les deux sens</option>
            </select>
          </Field>
          <Field label="Écriture du verdict">
            <select className={controlClass} value={writeback} onChange={(event) => setWriteback(event.target.value)}>
              <option value="task">Tâche sur l’enregistrement</option>
              <option value="field">Champ personnalisé</option>
            </select>
          </Field>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Avant d’intégrer</legend>
          {SALESFORCE_CHECKS.map((rule, index) => (
            <label key={rule} className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 size-4" checked={checks[index]} onChange={() => setChecks((current) => current.map((item, i) => (i === index ? !item : item)))} />
              <span>{rule}</span>
            </label>
          ))}
        </fieldset>
        {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Action tone="integrate" onClick={() => save(true)}>Terminer l’intégration</Action>
          <Action tone="edit" onClick={() => save(false)}>Enregistrer les options</Action>
        </div>
      </div>
    );
  }

  if (connector.id === "discord") {
    return (
      <div className="mt-4 grid gap-3 rounded-lg bg-surface p-3">
        <Field label="Serveur" hint="Le test reste en 401 tant que le jeton serveur est rejeté.">
          <input className={controlClass} value={serveur} onChange={(event) => setServeur(event.target.value)} placeholder="Nom du serveur" />
        </Field>
        {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
        <Action tone="edit" onClick={() => save(false)}>Enregistrer</Action>
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-3 rounded-lg bg-surface p-3">
      <Field label="Canal par défaut">
        <input className={controlClass} value={canal} onChange={(event) => setCanal(event.target.value)} />
      </Field>
      <Field label="Notification">
        <select className={controlClass} value={notify} onChange={(event) => setNotify(event.target.value)}>
          <option value="verdict">À chaque verdict</option>
          <option value="thread">Quand un dossier attend</option>
          <option value="none">Aucune</option>
        </select>
      </Field>
      {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
      <Action tone="edit" onClick={() => save(false)}>Enregistrer</Action>
    </div>
  );
}

function Mark({ id }: { id: ConnectorId }) {
  return <img src={`${import.meta.env.BASE_URL}brands/${id}.svg`} alt="" width={36} height={36} className="size-9 shrink-0 rounded-[9px] bg-white" />;
}

function Action({
  tone,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone: "integrate" | "edit" | "test" | "on" | "off" }) {
  const tones = {
    integrate: "bg-accent text-white shadow-cta",
    edit: "border border-line bg-white text-ink",
    test: "border border-line bg-white text-ink-soft",
    on: "bg-go text-white",
    off: "bg-hold text-white",
  };
  return (
    <button
      className={cn("inline-flex min-h-11 items-center justify-center rounded-[10px] px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45", tones[tone], className)}
      {...props}
    />
  );
}

function statusLabel(status: string) {
  if (status === "connected") return "Connecté";
  if (status === "not_configured") return "À intégrer";
  if (status === "error") return "Erreur de test";
  return "Désactivé";
}
