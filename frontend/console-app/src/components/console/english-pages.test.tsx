import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { ConsoleApp } from "./Shell";
import { FOREIGN_SESSION } from "@/lib/console/model";
import { i18next } from "@/lib/i18n";

const PAGES = [
  "overview",
  "dossiers",
  "dossiers?thread=dos-helia",
  "dossiers?thread=dos-pilote",
  "dossiers?thread=dos-vague",
  "dossiers?thread=dos-qinode",
  "collectifs",
  "agents",
  "connexions",
  "espace",
  "instruire",
  "workbench",
  "demo",
];
const FRENCH = /[éèêàùçôîûœ]|\b(le|la|les|des|une|du|pas|est|sur|pour|avec|dans|aucun|vous|votre|et)\b/i;
/** Noms propres et libellé du sélecteur de langue, volontairement non traduits. */
const ALLOWED = [FOREIGN_SESSION, "Français"];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("console en anglais", () => {
  it.each(PAGES)("n’affiche pas de texte français sur #%s", async (page) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await i18next.changeLanguage("en");
    window.location.hash = page;
    const { container } = render(<ConsoleApp />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const hits: string[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim() ?? "";
      if (text && FRENCH.test(text) && !ALLOWED.some((item) => text.includes(item))) hits.push(text);
    }
    container.querySelectorAll("[aria-label],[placeholder],[title]").forEach((element) => {
      for (const name of ["aria-label", "placeholder", "title"]) {
        const value = element.getAttribute(name);
        if (value && FRENCH.test(value) && !ALLOWED.includes(value)) hits.push(`@${name}: ${value}`);
      }
    });
    expect(hits).toEqual([]);
  });
});
