import { getSalonToken, SALON_API } from "../sso";
import type { Engagement, XBinding } from "./types";

const X_BINDING_KEY = "kayros-salon-x-binding";

export const X_SCOPES_READ = ["tweet.read", "users.read", "offline.access"] as const;
export const X_SCOPES_WRITE = ["tweet.read", "users.read", "tweet.write", "offline.access"] as const;

function requestHeaders() {
  const headers = new Headers({ "content-type": "application/json" });
  const token = getSalonToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export function readLocalBinding(): XBinding | null {
  try {
    const raw = localStorage.getItem(X_BINDING_KEY);
    return raw ? (JSON.parse(raw) as XBinding) : null;
  } catch {
    return null;
  }
}

export function writeLocalBinding(binding: XBinding | null) {
  try {
    if (!binding) localStorage.removeItem(X_BINDING_KEY);
    else localStorage.setItem(X_BINDING_KEY, JSON.stringify(binding));
  } catch {
    /* quota */
  }
}

export async function fetchXBinding(): Promise<XBinding | null> {
  if (!getSalonToken()) return readLocalBinding();
  try {
    const res = await fetch(`${SALON_API}/v1/salon/x/binding`, { headers: requestHeaders() });
    if (!res.ok) return readLocalBinding();
    const body = (await res.json()) as { binding?: XBinding };
    if (body.binding) writeLocalBinding(body.binding);
    return body.binding ?? readLocalBinding();
  } catch {
    return readLocalBinding();
  }
}

export function xOauthRedirectUri() {
  return `${location.origin}/salon/flux/callback`;
}

export async function startXOauth(mode: "read" | "write") {
  if (!getSalonToken()) throw new Error("SSO Salon requis avant de lier le compte X de l’hôte.");
  const redirectUri = xOauthRedirectUri();
  const scopes = mode === "write" ? [...X_SCOPES_WRITE] : [...X_SCOPES_READ];
  const res = await fetch(`${SALON_API}/v1/salon/x/oauth/start`, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify({ redirectUri, scopes }),
  });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error || "liaison X indisponible");
  location.assign(body.url);
}

export async function consumeXCallback(): Promise<XBinding | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get("x_code") || params.get("code");
  const state = params.get("x_state") || params.get("state");
  if (!code || !getSalonToken()) return fetchXBinding();
  try {
    const res = await fetch(`${SALON_API}/v1/salon/x/oauth/callback`, {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({ code, state }),
    });
    const body = (await res.json().catch(() => ({}))) as { binding?: XBinding };
    if (body.binding) writeLocalBinding(body.binding);
    history.replaceState({}, "", location.pathname);
    return body.binding ?? null;
  } catch {
    return null;
  }
}

export async function unlinkX() {
  if (getSalonToken()) {
    try {
      await fetch(`${SALON_API}/v1/salon/x/binding`, { method: "DELETE", headers: requestHeaders() });
    } catch {
      /* ignore */
    }
  }
  writeLocalBinding(null);
}

export async function setEngagement(engagement: Engagement) {
  const current = (await fetchXBinding()) ?? { scopes: [], engagement: "off" as const };
  const next = { ...current, engagement };
  writeLocalBinding(next);
  if (!getSalonToken()) return next;
  try {
    await fetch(`${SALON_API}/v1/salon/x/binding`, {
      method: "PATCH",
      headers: requestHeaders(),
      body: JSON.stringify({ engagement }),
    });
  } catch {
    /* local only */
  }
  return next;
}

export function canApiReply(binding: XBinding | null, mentionedHandles: string[]) {
  if (!binding?.handle) return false;
  if (!binding.scopes.includes("tweet.write")) return false;
  const mine = binding.handle.replace(/^@/, "").toLowerCase();
  return mentionedHandles.some((h) => h.toLowerCase() === mine);
}
