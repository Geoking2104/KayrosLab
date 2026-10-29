// Client minimal de l'API KayrosLab pour la console (auth e-mail/mot de passe existante : POST /v1/auth/login).
import type { Pipeline } from "./live";
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

/** Prévient le store console qu’il doit basculer entre mode démo et mode connecté. */
export const AUTH_EVENT = "kayros:auth";
function authChanged() { try { window.dispatchEvent(new Event(AUTH_EVENT)); } catch { /* hors navigateur */ } }

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* stockage indisponible */ } authChanged(); },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* idem */ } authChanged(); },
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

/** Enrichissement d’un profil impersonator (cf. core/profile-enrichment.mjs). */
export type EnrichRequest = {
  assigned_name?: string;
  crystal_public_url?: string;
  crystal_public_html?: string;
  linkedin_export?: Record<string, string>;
  emails?: Array<string | { from?: string; body: string }>;
  email_address?: string;
  x_username?: string;
  x_posts?: string[];
  x_archive?: string;
};
export type EnrichedProfile = {
  assigned_name?: string;
  avatar_url?: string;
  disc_type?: string;
  behavioral_archetype?: string;
  professional_context?: { headline?: string; current_role?: string; company?: string; skills?: string[]; qualities?: string[] };
  descriptif?: { disc_type?: string; archetype?: string; disc_intensity?: number | null; disc_degrees?: number | null; overview?: string; qualities?: string[]; traits?: Record<string, number>; sections?: Record<string, string[]>; source?: string };
  [key: string]: unknown;
};
export type EnrichResult = {
  profile: EnrichedProfile;
  evidence: Array<{ source: string; mode: string; samples?: number; disc_type?: string; confidence?: number; url?: string }>;
  warnings: string[];
  limits: string[];
  estimate: null | { disc_type: string; confidence: number };
};

export const api = {
  login: (email: string, password: string) => call<{ token: string; user: LiveUser }>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => call<{ user: LiveUser }>("/v1/auth/me"),
  inviteInfo: (token: string) => call<{ email: string; name: string; role: string; invited_by: string | null; account_exists: boolean }>(`/v1/auth/invite/${encodeURIComponent(token)}`),
  acceptInvite: (body: { token: string; password: string; name?: string }) => call<{ token: string; user: LiveUser; account_created: boolean }>("/v1/auth/invite/accept", { method: "POST", body: JSON.stringify(body) }),
  startPipeline: (projectId: string, body: { question: string; profile?: string; pause_between?: boolean }) => call<{ pipeline: Pipeline }>(`/v1/console/projects/${encodeURIComponent(projectId)}/pipelines`, { method: "POST", body: JSON.stringify(body) }),
  pipelines: (projectId: string) => call<{ pipelines: Pipeline[] }>(`/v1/console/projects/${encodeURIComponent(projectId)}/pipelines`),
  resumePipeline: (id: string, justification: string) => call<{ pipeline: Pipeline }>(`/v1/console/pipelines/${encodeURIComponent(id)}/resume`, { method: "POST", body: JSON.stringify({ justification }) }),
  approvePipeline: (id: string, nodeId?: string, comment?: string) => call<{ pipeline: Pipeline }>(`/v1/console/pipelines/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ node_id: nodeId, comment }) }),
  cancelPipeline: (id: string) => call<{ pipeline: Pipeline }>(`/v1/console/pipelines/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  logout: () => call<{ ok: boolean }>("/v1/auth/logout", { method: "POST" }),
  connectors: () => call<{ connectors: LiveConnector[]; encrypted_storage: boolean }>("/v1/console/connectors"),
  agents: () => call<{ agents: any[] }>("/v1/console/agents"),
  enrichProfile: (body: EnrichRequest) => call<EnrichResult>("/v1/console/personality/enrich", { method: "POST", body: JSON.stringify({ ...body, consent_confirmed: true }) }),
  createImpersonator: (body: Record<string, unknown>) => call<{ agent: any; enrichment_error: string | null }>("/v1/console/impersonators", { method: "POST", body: JSON.stringify({ ...body, consent_confirmed: true }) }),
  createAgent: (body: Record<string, unknown>) => call<{ agent: any }>("/v1/console/agents", { method: "POST", body: JSON.stringify(body) }),
  updateAgent: (id: string, body: Record<string, unknown>) => call<{ agent: any }>(`/v1/console/agents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  sessions: () => call<{ sessions: any[] }>("/v1/console/sessions"),
  createSession: (body: Record<string, unknown>) => call<{ session: any }>("/v1/console/sessions", { method: "POST", body: JSON.stringify(body) }),
  updateCollective: (id: string, body: { add_agent_ids?: string[]; remove_agent_ids?: string[] }) => call<{ session: any }>(`/v1/console/sessions/${encodeURIComponent(id)}/collective`, { method: "PATCH", body: JSON.stringify(body) }),
  run: (sessionId: string, body: { question: string; context?: string; profile?: string }) => call<{ thread?: any; thread_id?: string }>(`/v1/console/sessions/${encodeURIComponent(sessionId)}/run`, { method: "POST", body: JSON.stringify(body) }),
  threads: () => call<{ threads: any[] }>("/v1/console/threads"),
  reply: (threadId: string, text: string) => call<{ thread?: any }>(`/v1/console/threads/${encodeURIComponent(threadId)}/messages`, { method: "POST", body: JSON.stringify({ text }) }),
  arbitrate: (threadId: string, body: { action: string; justification?: string; decision?: string }) => call<{ thread: any }>(`/v1/console/threads/${encodeURIComponent(threadId)}/arbitrate`, { method: "POST", body: JSON.stringify(body) }),
  list: <K extends WorkspaceKind>(kind: K, query = "") => call<Record<K, any[]>>(`/v1/console/${kind}${query}`),
  createItem: (kind: WorkspaceKind, body: Record<string, unknown>) => call<{ item: any }>(`/v1/console/${kind}`, { method: "POST", body: JSON.stringify(body) }),
  updateItem: (kind: WorkspaceKind, id: string, body: Record<string, unknown>) => call<{ item: any }>(`/v1/console/${kind}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteItem: (kind: WorkspaceKind, id: string) => call<{ ok: boolean }>(`/v1/console/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  inviteMember: (body: { email: string; name?: string; role: string }) => call<{ item: any; delivery: { status: string; error: string } }>("/v1/console/members/invite", { method: "POST", body: JSON.stringify(body) }),
  mailStatus: () => call<{ smtp: boolean; from: string | null }>("/v1/console/mail/status"),
  retryNotifications: (id: string) => call<{ notifications: any[] }>(`/v1/console/projects/${encodeURIComponent(id)}/notifications/retry`, { method: "POST", body: "{}" }),
  memberMe: () => call<{ email: string; role: string; permissions: string[]; member: any }>("/v1/console/members/me"),
  restoreSkill: (id: string, version: number) => call<{ item: any }>(`/v1/console/skills/${encodeURIComponent(id)}/restore`, { method: "POST", body: JSON.stringify({ version }) }),
  projectContext: (id: string, nodeId = "") => call<{ layers: { level: "societe" | "projet" | "noeud"; items: any[] }[]; text: string }>(`/v1/console/projects/${encodeURIComponent(id)}/context${nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : ""}`),
  projectNotifications: (id: string) => call<{ notifications: any[] }>(`/v1/console/projects/${encodeURIComponent(id)}/notifications`),
  notifyProject: (id: string, threadId?: string) => call<{ notifications: any[] }>(`/v1/console/projects/${encodeURIComponent(id)}/notify`, { method: "POST", body: JSON.stringify({ thread_id: threadId }) }),
  dashboard: (companyId?: string) => call<any>(`/v1/console/dashboard${companyId ? `?company_id=${encodeURIComponent(companyId)}` : ""}`),
  connect: (platform: LivePlatform) => call<{ url: string; mode: string }>(`/v1/console/connectors/${platform}/connect`, { method: "POST" }),
};

export type WorkspaceKind = "companies" | "projects" | "skills" | "contexts" | "members";
