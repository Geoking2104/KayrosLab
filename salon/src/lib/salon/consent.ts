const KEY = "c15t";

export type Consent = { necessary: true; measurement: boolean; ts?: number };

function read(): Consent | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Consent;
    return { necessary: true, measurement: Boolean(parsed.measurement), ts: parsed.ts };
  } catch {
    return null;
  }
}

function write(consent: Consent) {
  const payload = JSON.stringify({ ...consent, necessary: true, ts: Date.now(), v: 1 });
  try { localStorage.setItem(KEY, payload); } catch { /* ignore */ }
  document.cookie = `${KEY}=${encodeURIComponent(payload)}; Path=/; Max-Age=${60 * 60 * 24 * 395}; SameSite=Lax`;
}

export function hasConsented() {
  return Boolean(read()?.ts);
}

export function currentConsent(): Consent {
  return read() ?? { necessary: true, measurement: false };
}

export function saveConsent(mode: "all" | "necessary") {
  write({ necessary: true, measurement: mode === "all" });
}

export function clearConsent() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  document.cookie = `${KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
}
