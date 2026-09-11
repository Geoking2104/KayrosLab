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

function applyGtmConsent(measurement: boolean) {
  const w = window as Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
  w.dataLayer = w.dataLayer || [];
  const gtag = w.gtag || function gtag(...args: unknown[]) { w.dataLayer!.push(args); };
  w.gtag = gtag;
  gtag("consent", "update", {
    analytics_storage: measurement ? "granted" : "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
}

function write(consent: Consent) {
  const payload = JSON.stringify({ ...consent, necessary: true, ts: Date.now(), v: 1 });
  try { localStorage.setItem(KEY, payload); } catch { /* ignore */ }
  document.cookie = `${KEY}=${encodeURIComponent(payload)}; Path=/; Max-Age=${60 * 60 * 24 * 395}; SameSite=Lax`;
  applyGtmConsent(consent.measurement);
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
