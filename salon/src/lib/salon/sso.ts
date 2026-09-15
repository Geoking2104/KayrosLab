import type { AgentPatch, LiteraryAuthor, LiteraryWork, Passage, SalonRoom } from "./types";
import type { Locale } from "./i18n";

export const SALON_API = "https://api.kayroslab.com";
const TOKEN_KEY = "kayros-salon-token";
const SSO_KEY = "kayros-salon-sso";

export type SalonUser = { id: string; email: string; name?: string | null };

export type SalonSnapshot = {
  version?: number;
  locale?: Locale;
  rooms?: SalonRoom[];
  patches?: Record<string, AgentPatch>;
  customs?: LiteraryAuthor[];
  extraWorks?: Record<string, LiteraryWork[]>;
  extraPassages?: Record<string, Passage[]>;
  extras?: { text: string; createdAt: string; authorId: string }[];
  updatedAt?: string;
};

function randomUrlToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = "";
  buf.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = Array.from(new Uint8Array(digest));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function salonRedirectUri() {
  const path = location.pathname.replace(/index\.html$/, "");
  const normalized = `${path.endsWith("/") ? path : `${path}/`}` || "/salon/";
  const p = normalized.includes("/salon") ? normalized : "/salon/";
  return `${location.origin}${p}`;
}

export function getSalonToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setSalonToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* quota */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getSalonToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`${SALON_API}${path}`, { ...init, headers });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const err = new Error(json.error || res.statusText);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return json;
}

export async function startSalonSso() {
  const verifier = randomUrlToken(48);
  const state = randomUrlToken(16);
  const nonce = randomUrlToken(16);
  const challenge = await pkceChallenge(verifier);
  const redirectUri = salonRedirectUri();
  sessionStorage.setItem(SSO_KEY, JSON.stringify({ verifier, state, nonce, redirectUri }));
  const started = await request<{ url: string }>("/v1/auth/sso/start", {
    method: "POST",
    body: JSON.stringify({ redirectUri, state, challenge, nonce }),
  });
  location.assign(started.url);
}

export async function consumeSalonCallback(): Promise<SalonUser | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const returnedState = params.get("state");
  if (!code || !returnedState) return null;
  const stored = sessionStorage.getItem(SSO_KEY);
  history.replaceState({}, "", `${location.pathname}${location.hash}`);
  if (!stored) return null;
  let payload: { verifier: string; state: string; nonce: string; redirectUri: string };
  try {
    payload = JSON.parse(stored);
  } catch {
    return null;
  }
  sessionStorage.removeItem(SSO_KEY);
  if (payload.state !== returnedState) return null;
  const result = await request<{ token: string; user: SalonUser }>("/v1/auth/sso/callback", {
    method: "POST",
    body: JSON.stringify({
      code,
      codeVerifier: payload.verifier,
      redirectUri: payload.redirectUri,
      nonce: payload.nonce,
    }),
  });
  setSalonToken(result.token);
  return { id: result.user.id, email: result.user.email, name: result.user.name };
}

export async function restoreSalonUser(): Promise<SalonUser | null> {
  if (!getSalonToken()) return null;
  try {
    const me = await request<{ user: SalonUser }>("/v1/auth/me");
    return { id: me.user.id, email: me.user.email, name: me.user.name };
  } catch {
    setSalonToken("");
    return null;
  }
}

export async function signOutSalon() {
  const token = getSalonToken();
  if (token) {
    try {
      await request("/v1/auth/logout", { method: "POST" });
    } catch {
      /* token déjà mort */
    }
  }
  setSalonToken("");
}

export async function fetchSalonState(): Promise<SalonSnapshot | null> {
  if (!getSalonToken()) return null;
  const res = await request<{ state: SalonSnapshot }>("/v1/salon/state");
  return res.state ?? null;
}

export async function putSalonState(state: SalonSnapshot) {
  if (!getSalonToken()) return null;
  const res = await request<{ ok: boolean; state: SalonSnapshot }>("/v1/salon/state", {
    method: "PUT",
    body: JSON.stringify({ state }),
  });
  return res.state;
}

export function mergeSalonState(remote: SalonSnapshot | null | undefined, local: SalonSnapshot): SalonSnapshot {
  if (!remote) return local;
  const rooms = new Map<string, SalonRoom>();
  for (const room of [...(remote.rooms ?? []), ...(local.rooms ?? [])]) {
    const prev = rooms.get(room.id);
    if (!prev || (room.turns?.length ?? 0) >= (prev.turns?.length ?? 0)) rooms.set(room.id, room);
  }
  const customs = new Map<string, LiteraryAuthor>();
  for (const author of [...(remote.customs ?? []), ...(local.customs ?? [])]) {
    customs.set(author.id, author);
  }
  const extras = [...(remote.extras ?? [])];
  const seen = new Set(extras.map((item) => `${item.createdAt}|${item.text}`));
  for (const item of local.extras ?? []) {
    const key = `${item.createdAt}|${item.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push(item);
  }
  return {
    version: 1,
    locale: local.locale ?? remote.locale ?? "fr",
    rooms: [...rooms.values()],
    patches: { ...(remote.patches ?? {}), ...(local.patches ?? {}) },
    customs: [...customs.values()],
    extraWorks: { ...(remote.extraWorks ?? {}), ...(local.extraWorks ?? {}) },
    extraPassages: { ...(remote.extraPassages ?? {}), ...(local.extraPassages ?? {}) },
    extras,
    updatedAt: local.updatedAt ?? remote.updatedAt,
  };
}
