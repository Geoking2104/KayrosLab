import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PersonaOverview } from "./PersonaOverview";

afterEach(cleanup);
const data = {
  read_only: true as const,
  persona: { agent_id: "imp_alex", display_name: "Alex", role_name: "CFO", veto_power: true, tools: [], skills: [], source: "public", consent_confirmed: true },
  activity: [{ run_id: "r1", question: "Premium offer", verdict: "NO_GO", primary_reason: "No ROI", consensus: "NO_GO", status: "rejected_human", at: "2026-11-01T10:00:00Z" }],
  vetoes: [{ run_id: "r1", question: "Premium offer", reason: "No ROI", at: "2026-11-01T10:00:00Z" }],
  decisionsTimeline: [{ seq: 1, decision: "NO_GO", by: "ceo@x", reason: "", run_id: "r1", ts: "2026-11-01T11:00:00Z" }],
  memory: { public_sources: ["https://example.com/a"], public_evidence: [{ url: "https://example.com/a", status: 200, title: "Alex blog", excerpt: "E", fetched_at: "2026-11-03T10:00:00Z" }], profile_summary: [], recent_reasons: ["No ROI"] },
  counts: { runs: 1, vetoes: 1, decisions: 1 },
};

describe("PersonaOverview", () => {
  it("affiche activité, vetos, décisions et mémoire en lecture seule", async () => {
    const load = vi.fn(async () => data);
    render(<PersonaOverview agentId="imp_alex" onClose={() => {}} load={load} />);
    await screen.findByText("Alex blog");
    expect(load).toHaveBeenCalledWith("imp_alex");
    expect(screen.getByText("Vetoes (1)")).toBeTruthy();
    expect(screen.getByText("Human decisions (1)")).toBeTruthy();
    expect(screen.queryByText("Save")).toBeNull();
  });

  it("manager : règle les outils autorisés depuis le registre et met à jour les outils effectifs", async () => {
    const load = vi.fn(async () => data);
    const loadTools = vi.fn(async () => [
      { name: "estimate_resources", description: "Estimate", sideEffect: "read", gate: false, assignable: true, reason: null },
      { name: "send_email", description: "Send", sideEffect: "write", gate: true, assignable: false, reason: "écriture interdite aux personas" },
    ]);
    const saveTools = vi.fn(async (_id: string, tools: string[]) => ({ granted: tools.map((tool) => ({ tool })), denied: [] }));
    render(<PersonaOverview agentId="imp_alex" onClose={() => {}} load={load} canEditTools loadTools={loadTools} saveTools={saveTools} />);
    const box = (await screen.findByText("estimate_resources")).closest("label")!.querySelector("input")!;
    const write = screen.getByText("send_email").closest("label")!.querySelector("input")!;
    expect(write.disabled).toBe(true);
    fireEvent.click(box);
    fireEvent.click(screen.getByText("Save tools"));
    await screen.findByText("Tools saved.");
    expect(saveTools).toHaveBeenCalledWith("imp_alex", ["estimate_resources"]);
    expect(screen.getByTestId("persona-effective-tools").textContent).toContain("estimate_resources");
  });

  it("non-manager : outils en lecture seule", async () => {
    render(<PersonaOverview agentId="imp_alex" onClose={() => {}} load={async () => data} />);
    await screen.findByText("No allowed tools.");
    expect(screen.queryByText("Save tools")).toBeNull();
  });
});
