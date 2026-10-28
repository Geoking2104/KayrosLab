import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import en from "./locales/en.json";
import { LANG_STORAGE_KEY, detectLanguage, i18next, locale, setLanguage, t, tc, tk } from "./index";

const SRC = resolve(process.cwd(), "src");
/** Keys passed through a variable (t(step.kind)) and therefore invisible to the static scan. */
const DYNAMIC_KEYS = ["Document", "Agent", "Canal", "Modèle", "Humain"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && path !== join(SRC, "lib/i18n/index.ts") ? [path] : [];
  });
}

function sourceKeys() {
  const keys = new Map<string, string>();
  const call = /(?<![\w.])(?:t|tk)\(\s*("(?:[^"\\\n]|\\.)*")/g;
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(call)) {
      const key = JSON.parse(match[1]) as string;
      if (!keys.has(key)) keys.set(key, relative(SRC, file));
    }
  }
  return keys;
}

const catalog = en as Record<string, string>;
const placeholders = (value: string) => [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

afterEach(async () => {
  localStorage.clear();
  window.history.replaceState(null, "", "/console/");
  await i18next.changeLanguage("en");
});

describe("catalogue anglais", () => {
  const keys = sourceKeys();

  it("trouve bien les chaînes du code", () => {
    expect(keys.size).toBeGreaterThan(500);
  });

  it("traduit chaque clé t()/tk() du code", () => {
    const missing = [...keys].filter(([key]) => !(key in catalog)).map(([key, file]) => `${file}: ${key}`);
    expect(missing).toEqual([]);
  });

  it("ne garde pas de traduction orpheline", () => {
    const orphans = Object.keys(catalog).filter((key) => !keys.has(key) && !DYNAMIC_KEYS.includes(key));
    expect(orphans).toEqual([]);
  });

  it("conserve les variables d’interpolation et ne laisse aucune traduction vide", () => {
    const broken = Object.entries(catalog).filter(([key, value]) => !value.trim() || placeholders(key).join() !== placeholders(value).join());
    expect(broken).toEqual([]);
  });
});

describe("détection de la langue", () => {
  it("suit ?lang= en premier, comme index.html / index.fr.html", () => {
    localStorage.setItem(LANG_STORAGE_KEY, "en");
    window.history.replaceState(null, "", "/console/?lang=fr");
    expect(detectLanguage()).toBe("fr");
  });

  it("reprend ensuite le choix enregistré", () => {
    localStorage.setItem(LANG_STORAGE_KEY, "fr");
    expect(detectLanguage()).toBe("fr");
  });

  it("retombe sur la langue du navigateur, puis l’anglais", () => {
    // jsdom annonce en-US
    expect(detectLanguage()).toBe("en");
    window.history.replaceState(null, "", "/console/?lang=de");
    expect(detectLanguage()).toBe("en");
  });
});

describe("traduction", () => {
  it("traduit en anglais et garde le français source", async () => {
    await i18next.changeLanguage("en");
    expect(t("Aujourd’hui")).toBe("Today");
    expect(locale()).toBe("en-GB");
    await i18next.changeLanguage("fr");
    expect(t("Aujourd’hui")).toBe("Aujourd’hui");
    expect(locale()).toBe("fr-FR");
  });

  it("interpole aussi en français, sans catalogue", async () => {
    await i18next.changeLanguage("fr");
    expect(t("Modifier {{name}}", { name: "DAF" })).toBe("Modifier DAF");
    await i18next.changeLanguage("en");
    expect(t("Modifier {{name}}", { name: "DAF" })).toBe("Edit DAF");
  });

  it("traduit le contenu de démonstration, jamais le texte saisi", async () => {
    await i18next.changeLanguage("en");
    expect(tc(tk("Direction financière"))).toBe("Finance");
    expect(tc("Ma question à moi")).toBe("Ma question à moi");
    expect(tc(undefined)).toBe("");
  });

  it("enregistre le choix, met à jour <html lang> et ?lang", async () => {
    window.history.replaceState(null, "", "/console/?lang=en#overview");
    await setLanguage("fr");
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
    expect(window.location.search).toBe("?lang=fr");
    expect(window.location.hash).toBe("#overview");
  });
});
