// Client minimal de l'API KayrosLab pour la console (auth e-mail/mot de passe existante : POST /v1/auth/login).
export const API_BASE: string = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const TOKEN_KEY = "kayroslab.console.token";

export type LivePlatform = "slack" | "teams" | "discord";
export type LiveConnector = {
  platform: string;
  status: "not_configured" | "configured" | "disabled" | "error" | "connected" | string;
  enabled: boolean;
  source?: "environment" | "console";
  one_click?: boolean;
  connect_mode?: string | null;
  last_tested_at?: string | null;
  last_error?: string | null;
};
export type LiveUser = { id: string; email: string; role: string; tenantId?: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Variables d'environnement serveur exigées par core/connector-oauth.mjs pour la connexion en un geste. */
export const REQUIRED_ENV: Record<LivePlatform, string[]> = {
  slack: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
  teams: ["TEAMS_APP_ID", "TEAMS_BOT_PASSWORD"],
  discord: ["DISCORD_CLIENT_ID", "DISCORD_BOT_TOKEN", "DISCORD_PUBLIC_KEY"],
};

export type LiveState = "connected" | "error" | "disabled" | "configured" | "connectable" | "missing_config";

/** État affiché, dérivé uniquement de ce que le serveur renvoie. */
export function liveState(c: LiveConnector): LiveState {
  if (c.status === "connected") return "connected";
  if (c.status === "error") return "error";
  if (c.status === "disabled") return "disabled";
  if (c.status === "configured") return "configured";
  return c.one_click ? "connectable" : "missing_config";
}

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* stockage indisponible */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* idem */ } },
};

async function call<T>(path: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const token = tokenStore.get();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body) headers["content-type"] = "application/json";
  const res = await fetchImpl(`${API_BASE}${path}`, { ...init, headers });
  let data: any = null;
  try { data = await res.json(); } catch { /* corps vide */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  login: (email: string, password: string) => call<{ token: string; user: LiveUser }>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => call<{ user: LiveUser }>("/v1/auth/me"),
  logout: () => call<{ ok: boolean }>("/v1/auth/logout", { method: "POST" }),
  connectors: () => call<{ connectors: LiveConnector[]; encrypted_storage: boolean }>("/v1/console/connectors"),
  connect: (platform: LivePlatform) => call<{ url: string; mode: string }>(`/v1/console/connectors/${platform}/connect`, { method: "POST" }),
};
