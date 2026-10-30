import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { i18next } from "@/lib/i18n";
import { ContextComposer, type ComposerValue } from "./ContextComposer";

vi.mock("@/lib/console/store", () => ({ useConsole: () => ({ refreshLive: async () => {} }) }));
import { PreLaunchBriefs } from "./Projets";

const calls: { path: string; method: string; body?: any }[] = [];
function mockFetch(handler: (path: string, method: string, body: any) => unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || "GET"; const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.replace(/^.*\/v1/, "/v1").split("?")[0];
    calls.push({ path, method, body });
    const out = handler(path, method, body);
    return new Response(JSON.stringify(out ?? {}), { status: out === undefined ? 404 : 200, headers: { "content-type": "application/json" } });
  }));
}
beforeEach(async () => { await i18next.changeLanguage("fr"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); calls.length = 0; });

function Harness({ onValidate, onSaveDraft }: { onValidate: (v: ComposerValue) => void; onSaveDraft: (v: ComposerValue) => void }) {
  const [v, setV] = useState<ComposerValue>({ mode: "rfp", raw_input: "", structured: {}, content: "" });
  return <ContextComposer mode="rfp" value={v} onChange={setV} onValidate={onValidate} onSaveDraft={onSaveDraft} />;
}

describe("ContextComposer", () => {
  it("reformule, laisse éditer, puis valide la version corrigée", async () => {
    mockFetch((path) => path === "/v1/console/context/rephrase" ? { type: "rfp", source: "model", structured: { equipe_decision: "DSI + achats" }, brief: "Ma compréhension : refonte du portail.", missing: [], questions: ["Quel calendrier ?"] } : undefined);
    const onValidate = vi.fn();
    render(<Harness onValidate={onValidate} onSaveDraft={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Saisie libre"), { target: { value: "AO portail fournisseurs" } });
    fireEvent.click(screen.getByText("Reformuler / confirmer la compréhension"));
    await waitFor(() => expect((screen.getByLabelText("Compréhension à valider") as HTMLTextAreaElement).value).toMatch(/Ma compréhension/));
    expect(calls[0].body).toMatchObject({ type: "rfp", raw: "AO portail fournisseurs" });
    expect(screen.getByTestId("rephrase-questions").textContent).toContain("Quel calendrier");
    expect((screen.getByLabelText("Équipe qui décide") as HTMLTextAreaElement).value).toBe("DSI + achats");
    fireEvent.change(screen.getByLabelText("Compréhension à valider"), { target: { value: "Ma compréhension corrigée." } });
    fireEvent.click(screen.getByText("Valider cette compréhension"));
    expect(onValidate).toHaveBeenCalledWith(expect.objectContaining({ content: "Ma compréhension corrigée.", raw_input: "AO portail fournisseurs", mode: "rfp" }));
  });

  it("échec de reformulation : le brouillon est conservé et peut être gardé", async () => {
    mockFetch((path) => path === "/v1/console/context/rephrase" ? { type: "rfp", source: "draft", structured: { demande_client: "AO brut" }, brief: "Demande initiale du client : AO brut", missing: [], questions: [], error: "timeout" } : undefined);
    const onSaveDraft = vi.fn();
    render(<Harness onValidate={vi.fn()} onSaveDraft={onSaveDraft} />);
    fireEvent.change(screen.getByLabelText("Saisie libre"), { target: { value: "AO brut" } });
    fireEvent.click(screen.getByText("Reformuler / confirmer la compréhension"));
    await screen.findByRole("status");
    fireEvent.click(screen.getByText("Garder en brouillon"));
    expect(onSaveDraft).toHaveBeenCalledWith(expect.objectContaining({ raw_input: "AO brut" }));
  });
});

describe("PreLaunchBriefs", () => {
  it("montre les briefs validés, puis reformule et valide un brouillon", async () => {
    const draft = { id: "ctx_2", name: "Brief AO", mode: "rfp", status: "draft", raw_input: "AO v2", content: "ancien brief", structured: {} };
    let validated = false;
    mockFetch((path, method, body) => {
      if (path === "/v1/console/projects/prj_1/context") return { layers: [{ level: "projet", items: [{ id: "ctx_1", name: "Charte", content: "Brief validé", kind: "note" }, ...(validated ? [draft] : [])] }], text: "", pending: validated ? [] : [draft] };
      if (path === "/v1/console/context/rephrase") return { type: "rfp", source: "model", structured: {}, brief: "Ma compréhension v2", missing: [], questions: [] };
      if (path === "/v1/console/contexts/ctx_2" && method === "PATCH") { Object.assign(draft, body); if (body.status === "validated") validated = true; return { item: draft }; }
      return undefined;
    });
    render(<PreLaunchBriefs projectId="prj_1" />);
    await screen.findByText("Brief validé");
    fireEvent.click(await screen.findByText("Reformuler à nouveau"));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.body.content === "Ma compréhension v2" && c.body.status === "draft")).toBe(true));
    fireEvent.click(screen.getByText("Valider"));
    await waitFor(() => expect(screen.queryByTestId("pending-brief")).toBeNull());
    expect(calls.some((c) => c.method === "PATCH" && c.body.status === "validated")).toBe(true);
  });
});
