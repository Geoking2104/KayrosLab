/**
 * Console i18n (i18next).
 *
 * Source language is French: every user-facing string is written in French
 * in the code and wrapped in `t("…")` (gettext style, natural keys). The
 * English catalog `locales/en.json` maps each French key to its English text.
 * A missing English entry falls back to the French key, and the test
 * `i18n.test.ts` fails the build when a key has no English translation.
 *
 * - `t(key, vars)`: translate now (components re-render on language change).
 * - `tk(key)`: mark seed/demo content stored in French (state, localStorage);
 *   it is rendered through `tc()` so it follows the active language.
 * - `tc(text)`: translate stored content if it is a known key, else keep it
 *   unchanged (user-written content is never altered).
 *
 * Language detection, aligned with the website (index.html = EN,
 * index.fr.html = FR): `?lang=` in the URL, then the saved choice, then the
 * browser language, then English.
 */
import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import en from "./locales/en.json";

export type Lang = "fr" | "en";
export const LANGS: Lang[] = ["en", "fr"];
export const LANG_STORAGE_KEY = "kayroslab.lang";

function asLang(value: string | null | undefined): Lang | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v.startsWith("fr")) return "fr";
  if (v.startsWith("en")) return "en";
  return null;
}

export function detectLanguage(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    const fromQuery = asLang(new URLSearchParams(window.location.search).get("lang"));
    if (fromQuery) return fromQuery;
  } catch {
    /* URL indisponible */
  }
  try {
    const saved = asLang(window.localStorage.getItem(LANG_STORAGE_KEY));
    if (saved) return saved;
  } catch {
    /* stockage indisponible */
  }
  const nav = typeof navigator !== "undefined" ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
  for (const item of nav) {
    const lang = asLang(item);
    if (lang) return lang;
  }
  return "en";
}

function applyDocument(lang: Lang) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
}

void i18next.use(initReactI18next).init({
  lng: detectLanguage(),
  fallbackLng: false,
  supportedLngs: LANGS,
  resources: { en: { translation: en as Record<string, string> }, fr: { translation: {} } },
  keySeparator: false,
  nsSeparator: false,
  returnNull: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  initImmediate: false,
  showSupportNotice: false,
});
applyDocument(currentLang());
i18next.on("languageChanged", (lng) => applyDocument(asLang(lng) ?? "en"));

export function currentLang(): Lang {
  return asLang(i18next.language) ?? "en";
}

/** BCP 47 locale for dates and numbers. */
export function locale(): string {
  return currentLang() === "fr" ? "fr-FR" : "en-GB";
}

export function setLanguage(lang: Lang) {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* stockage indisponible */
  }
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", lang);
      window.history.replaceState(null, "", url.toString());
    }
  } catch {
    /* URL indisponible */
  }
  return i18next.changeLanguage(lang);
}

export function t(key: string, vars?: Record<string, unknown>): string {
  return i18next.t(key, vars ?? {}) as string;
}

/** Marks a French source string stored as content (seed data). Identity at runtime. */
export function tk(key: string): string {
  return key;
}

/** Translates stored content only when it is a known catalog key. */
export function tc(text: string | undefined | null): string {
  if (!text) return text ?? "";
  if (currentLang() === "fr") return text;
  return i18next.exists(text) ? t(text) : text;
}

export function useLang(): Lang {
  const { i18n } = useTranslation();
  return asLang(i18n.language) ?? "en";
}

export { i18next };
