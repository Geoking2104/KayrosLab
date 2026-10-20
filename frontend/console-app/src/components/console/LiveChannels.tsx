import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, liveState, REQUIRED_ENV, tokenStore, type LiveConnector, type LivePlatform, type LiveUser } from "@/lib/console/api";
import { Panel, controlClass } from "./ui";
import { cn } from "@/lib/cn";

const LANG = typeof navigator !== "undefined" && !/^fr/i.test(navigator.language || "fr") ? "en" : "fr";
const T = {
  fr: {
    title: "Canaux réels de votre espace", demoBadge: "Démo",
    loggedOut: "Vous n’êtes pas connecté : les canaux ci-dessous sont une démonstration, pas l’état de votre espace.",
    login: "Se connecter", email: "E-mail", password: "Mot de passe", loggingIn: "Connexion…",
    loading: "Chargement de l’état des canaux…", apiError: "L’API ne répond pas comme prévu", retry: "Réessayer",
    logout: "Se déconnecter", signedAs: "Connecté en tant que",
    connected: "Connecté", error: "Erreur de test", disabled: "Désactivé", configured: "Configuré", connectable: "Prêt à connecter", missing_config: "Configuration serveur manquante",
    missing: "Le serveur ne propose pas la connexion en un geste. Variables requises côté serveur :",
    connect: "Connecter", connecting: "Ouverture…", env: "via variables d’environnement du serveur",
    managerOnly: "Seul un COMEX peut connecter un canal.", sessionExpired: "Session expirée, reconnectez-vous.",
    lastTest: "Dernier test",
  },
  en: {
    title: "Your workspace’s real channels", demoBadge: "Demo",
    loggedOut: "You are not signed in: the channels below are a demonstration, not your workspace’s state.",
    login: "Sign in", email: "E-mail", password: "Password", loggingIn: "Signing in…",
    loading: "Loading channel status…", apiError: "The API did not respond as expected", retry: "Retry",
    logout: "Sign out", signedAs: "Signed in as",
    connected: "Connected", error: "Test error", disabled: "Disabled", configured: "Configured", connectable: "Ready to connect", missing_config: "Server configuration missing",
    missing: "The server does not offer one-click connection. Required server variables:",
    connect: "Connect", connecting: "Opening…", env: "via server environment variables",
    managerOnly: "Only a COMEX member can connect a channel.", sessionExpired: "Session expired, please sign in again.",
    lastTest: "Last test",
  },
}[LANG];

const NAMES: Record<string, string> = { slack: "Slack", teams: "Microsoft Teams", discord: "Discord" };
const COLORS: Record<string, string> = { slack: "#4a154b", teams: "#4b53bc", discord: "#5865f2" };

type Phase = "checking" | "logged_out" | "loading" | "ready" | "api_error";

export function LiveChannels({ onSession }: { onSession?: (live: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>(tokenStore.get() ? "checking" : "logged_out");
  const [user, setUser] = useState<LiveUser | null>(null);
  const [items, setItems] = useState<LiveConnector[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const signOut = useCallback((message = "") => {
    tokenStore.clear(); setUser(null); setItems([]); setError(message); setPhase("logged_out");
  }, []);

  const load = useCallback(async () => {
    setPhase((p) => (p === "checking" ? p : "loading")); setError("");
    try {
      const me = await api.me();
      setUser(me.user);
      const res = await api.connectors();
      setItems(res.connectors.filter((c) => c.platform in NAMES));
      setPhase("ready");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return signOut(T.sessionExpired);
      setError(e instanceof Error ? e.message : String(e)); setPhase("api_error");
    }
  }, [signOut]);

  useEffect(() => { if (tokenStore.get()) void load(); }, [load]);
  useEffect(() => { onSession?.(phase === "ready" || phase === "loading" || phase === "checking" || (phase === "api_error" && !!user)); }, [phase, user, onSession]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy("login"); setError("");
    try {
      const res = await api.login(email.trim(), password);
      tokenStore.set(res.token); setPassword(""); setPhase("loading"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  async function connect(platform: LivePlatform) {
    setBusy(platform); setError("");
    try { const res = await api.connect(platform); window.location.assign(res.url); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) return signOut(T.sessionExpired);
      setError(e instanceof ApiError && e.status === 403 ? T.managerOnly : e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  if (phase === "logged_out") {
    return (
      <Panel className="border-l-4 border-l-hold" >
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-hold px-2.5 py-0.5 text-xs font-semibold text-white" data-testid="demo-badge">{T.demoBadge}</span>
          <p className="text-sm text-ink-soft">{T.loggedOut}</p>
        </div>
        <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={submit} aria-label={T.login}>
          <label className="grid gap-1 text-xs text-muted">{T.email}
            <input className={controlClass} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs text-muted">{T.password}
            <input className={controlClass} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" disabled={busy === "login"} className="min-h-11 rounded-[10px] bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">
            {busy === "login" ? T.loggingIn : T.login}
          </button>
        </form>
        {error ? <p className="mt-2 text-sm text-stop" role="alert">{error}</p> : null}
      </Panel>
    );
  }

  if (phase === "checking" || phase === "loading") return <Panel><p className="text-sm text-muted" role="status">{T.loading}</p></Panel>;

  if (phase === "api_error") {
    return (
      <Panel className="border-l-4 border-l-stop">
        <p className="text-sm font-medium text-stop" role="alert">{T.apiError} : {error}</p>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => void load()} className="min-h-10 rounded-[10px] border border-line bg-white px-3 text-sm font-semibold">{T.retry}</button>
          <button type="button" onClick={() => signOut()} className="min-h-10 rounded-[10px] border border-line bg-white px-3 text-sm">{T.logout}</button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{T.title}</h2>
        <p className="text-xs text-muted">{T.signedAs} {user?.email} ·{" "}
          <button type="button" className="underline" onClick={() => { void api.logout().catch(() => undefined); signOut(); }}>{T.logout}</button>
        </p>
      </div>
      {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
      {items.map((c) => {
        const state = liveState(c);
        const platform = c.platform as LivePlatform;
        return (
          <Panel key={c.platform} className="border-l-4" style={{ borderLeftColor: COLORS[c.platform] }}>
            <div className="flex flex-wrap items-start justify-between gap-3" data-testid={`live-${c.platform}`}>
              <div className="flex items-start gap-3">
                <img src={`${import.meta.env?.BASE_URL ?? "/"}brands/${c.platform}.svg`} alt="" width={36} height={36} className="size-9 rounded-[9px] bg-white" />
                <div>
                  <p className={cn("text-xs font-semibold", state === "connected" ? "text-go" : state === "error" || state === "missing_config" ? "text-stop" : "text-hold")}>{T[state]}</p>
                  <h3 className="text-lg font-medium">{NAMES[c.platform]}</h3>
                </div>
              </div>
              {state === "connectable" || (state === "error" && c.one_click) ? (
                <button type="button" disabled={busy === platform} onClick={() => void connect(platform)} className="min-h-11 rounded-[10px] bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">
                  {busy === platform ? T.connecting : T.connect}
                </button>
              ) : null}
            </div>
            {state === "missing_config" ? (
              <p className="mt-3 text-sm text-ink-soft">{T.missing}{" "}
                {REQUIRED_ENV[platform].map((v, i) => <span key={v}>{i ? ", " : ""}<code className="rounded bg-surface px-1 font-mono text-xs">{v}</code></span>)}
              </p>
            ) : null}
            {c.source === "environment" ? <p className="mt-2 text-xs text-muted">{T.env}</p> : null}
            {c.last_error ? <p className="mt-2 text-xs text-stop">{c.last_error}</p> : null}
            {c.last_tested_at ? <p className="mt-1 text-xs text-muted">{T.lastTest} {new Date(c.last_tested_at).toLocaleString(LANG)}</p> : null}
          </Panel>
        );
      })}
    </div>
  );
}
