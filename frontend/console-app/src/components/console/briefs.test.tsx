import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18next } from "@/lib/i18n";
import { wordDiff } from "@/lib/console/word-diff";

vi.mock("@/lib/console/store", () => ({ useConsole: () => ({ refreshLive: async () => {} }) }));
import { SessionBriefs } from "./Briefs";

const calls: { path: string; method: string; body?: any }[] = [];
beforeEach(async () => { await i18next.changeLanguage("fr"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); calls.length = 0; });

describe("wordDiff", () => {
  it("marque ajouts et suppressions", () => {
    const d = wordDiff("refonte du portail", "refonte complète du portail B2B");
    expect(d.filter((p) => p.op === "add").map((p) => p.text.trim()).join(" ")).toContain("complète");
    expect(d.filter((p) => p.op === "del")).toHaveLength(0);
    expect(wordDiff("a b", "a").some((p) => p.op === "del")).toBe(true);
  });
});

describe("SessionBriefs (Instruct)", () => {
  it("affiche validés + brouillons, diff avant revalidation, invalidation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method || "GET"; const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const path = url.replace(/^.*\/v1/, "/v1").split("?")[0];
      calls.push({ path, method, body });
      let out: unknown = {};
      if (path === "/v1/console/sessions/room_1/briefs") out = {
        validated: [{ id: "c1", name: "Cadre", mode: "rfp", content: "Cadre validé" }],
        pending: [{ id: "c2", name: "AO", mode: "rfp", status: "draft", content: "refonte du portail", validated_content: "refonte du portail", raw_input: "AO", invalidated_reason: "skill modifié : Veille" }],
      };
      if (path === "/v1/console/context/rephrase") out = { type: "rfp", source: "model", structured: {}, brief: "refonte complète du portail", missing: [], questions: [] };
      return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
    }));
    render(<SessionBriefs sessionId="room_1" />);
    await waitFor(() => expect(screen.getByTestId("pending-brief")).toBeTruthy());
    expect(screen.getByText("Cadre")).toBeTruthy();
    expect(screen.getByTestId("invalidated-reason").textContent).toContain("skill modifié");
    fireEvent.click(screen.getByText("Reformuler à nouveau"));
    await waitFor(() => expect(screen.getByTestId("brief-diff")).toBeTruthy());
    expect(screen.getByTestId("brief-diff").querySelector('[data-op="add"]')?.textContent).toContain("complète");
    fireEvent.click(screen.getByText("Valider la nouvelle version"));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.path === "/v1/console/contexts/c2")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ content: "refonte complète du portail", status: "validated" });
    fireEvent.click(screen.getByText("Invalider"));
    await waitFor(() => expect(calls.some((c) => c.path === "/v1/console/contexts/c1/invalidate" && c.method === "POST")).toBe(true));
  });
});
