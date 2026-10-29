import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConsoleApp } from "./Shell";
import { i18next } from "@/lib/i18n";

beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
  window.location.hash = "overview";
  await i18next.changeLanguage("en");
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await i18next.changeLanguage("en");
});

describe("console bilingue", () => {
  it("s’affiche en anglais puis bascule en français", async () => {
    render(<ConsoleApp />);
    expect(screen.getAllByText("Today").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Review a decision").length).toBeGreaterThan(0);
    expect(screen.queryByText("Aujourd’hui")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "fr" }));
    });
    expect(screen.getAllByText("Aujourd’hui").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Instruire une décision").length).toBeGreaterThan(0);
    expect(document.documentElement.lang).toBe("fr");
    expect(localStorage.getItem("kayroslab.lang")).toBe("fr");
    expect(screen.getByRole("button", { name: "fr" }).getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "en" }));
    });
    expect(screen.getAllByText("Today").length).toBeGreaterThan(0);
  });

  it("traduit le contenu de démonstration (dossiers semés)", async () => {
    window.location.hash = "dossiers";
    render(<ConsoleApp />);
    expect(await screen.findAllByText(/Should we accept the 18% discount requested by Helia Industrie/)).not.toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "fr" }));
    });
    expect(screen.getAllByText(/Faut-il accepter la remise de 18 % demandée par Helia Industrie/).length).toBeGreaterThan(0);
  });
});
