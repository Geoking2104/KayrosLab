import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConsoleApp } from "./Shell";
import { i18next } from "@/lib/i18n";
import { fromApiThread, toApiAgent } from "@/lib/console/live";
import { defaultSettings } from "@/lib/console/model";

const AGENT = {
  agent_id: "achats", display_name: "Acheteur senior", role_name: "Acheteur", department: "Achats", seniority: "senior",
  primary_focus: "Coût total", mission: "Négocier", instructions: "", constraints: ["Pas de remise > 12 %"], tools: ["tco"],
  connectors: ["console"], provider: "mistral", model: "mistral-large", veto_power: false, enabled: true, metadata: {},
  rule_configuration: { system_proposed_rules: [{ rule_id: "R1", rule_text: "Toujours chiffrer.", status: "active" }], user_added_rules: ["Comparer 3 offres."] },
};
const SESSION = { session_id: "room_1", name: "Comité achats", created_at: "2026-10-29T10:00:00Z", collective: { active_agents: ["achats"], voting_threshold: "veto_power_csuite" } };
const THREAD = {
  thread_id: "thread_1", room_id: "room_1", status: "awaiting_arbitration", question: "Faut-il signer le contrat Helia ?",
  created_at: "2026-10-29T10:00:00Z", updated_at: "2026-10-29T10:01:00Z", clarification_questions: [],
  messages: [{ role: "human", kind: "question", text: "Faut-il signer ?", created_at: "2026-10-29T10:00:00Z" },
    { role: "collective", kind: "run", created_at: "2026-10-29T10:01:00Z", run: { consensus: { verdict: "CONDITIONAL_GO" }, configuration: { active_agents: ["achats"] },
      analyses: [{ agent_id: "achats", verdict: "CONDITIONAL_GO", strengths_opportunities: ["Volume"], critical_risks: ["Marge"], required_mitigations: ["Plafonner"], metrics: [] }] } }],
};
const calls: { url: string; method: string; body?: any }[] = [];

function mockApi() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const path = url.replace(/^.*\/v1/, "/v1").split("?")[0];
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (path === "/v1/auth/me") return json({ user: { id: "u1", email: "comex@atelier.fr", role: "comex" } });
    if (path === "/v1/console/agents" && method === "GET") return json({ agents: [AGENT] });
    if (path.startsWith("/v1/console/agents/") && method === "PATCH") return json({ agent: AGENT });
    if (path === "/v1/console/sessions") return json({ sessions: [SESSION] });
    if (path === "/v1/console/threads") return json({ threads: [THREAD] });
    if (path === "/v1/console/companies") return json({ companies: [{ id: "co_1", name: "Atelier Renaud", sector: "Industrie", description: "" }] });
    if (path === "/v1/console/projects") return json({ projects: [] });
    if (path === "/v1/console/skills") return json({ skills: [{ id: "skl_1", name: "Analyse TCO", description: "", instructions: "", tools: [], agent_ids: ["achats"], session_ids: [] }] });
    if (path === "/v1/console/contexts") return json({ contexts: [] });
    if (path === "/v1/console/dashboard") return json({ company: { id: "co_1", name: "Atelier Renaud", sector: "Industrie", description: "" }, projects: [{ id: "prj_1", company_id: "co_1", name: "Renouvellement Helia", goal: "", owner: "", status: "active", due_date: "", session_ids: ["room_1"], thread_ids: [], stakeholders: [], counts: { awaiting_arbitration: 1 }, threads: [{ thread_id: "thread_1", session_id: "room_1", question: "Faut-il signer le contrat Helia ?", status: "awaiting_arbitration", verdict: "CONDITIONAL_GO" }] }], widgets: { projects_active: 1, decisions: { awaiting_arbitration: 1 }, pending_arbitrations: [], sessions: 1, skills: 1, contexts: 0 } });
    return json({ error: "inconnu" }, 404);
  }));
}

beforeEach(async () => {
  localStorage.clear();
  calls.length = 0;
  await i18next.changeLanguage("fr");
});
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await i18next.changeLanguage("en"); });

describe("mappers API", () => {
  it("convertit un fil serveur en dossier", () => {
    const thread = fromApiThread(THREAD);
    expect(thread.status).toBe("awaiting_arbitration");
    expect(thread.verdict).toBe("CONDITIONAL_GO");
    expect(thread.contributions[0].objections).toEqual(["Marge"]);
    expect(thread.conditions).toEqual(["Plafonner"]);
  });
  it("envoie tous les champs agent acceptés par l’API", () => {
    const body = toApiAgent({ name: "A", role: "R", department: "D", mission: "M", veto: true, enabled: true, brief: "B",
      settings: { ...defaultSettings(), constraints: ["c"], tools: ["t"], channels: ["slack"], provider: "mistral", model: "m", seniority: "executive", rules: ["r"] } });
    expect(body).toMatchObject({ constraints: ["c"], tools: ["t"], connectors: ["slack"], provider: "mistral", model: "m", seniority: "executive", instructions: "B", veto_power: true, rule_configuration: { user_added_rules: ["r"] } });
  });
});

describe("mode connecté", () => {
  it("ouvre sur le tableau de bord société avec les projets en cours", async () => {
    localStorage.setItem("kayroslab.console.token", "tok");
    mockApi();
    window.location.hash = "";
    render(<ConsoleApp />);
    expect(await screen.findByText("Renouvellement Helia")).toBeTruthy();
    expect(screen.getAllByText("Atelier Renaud").length).toBeGreaterThan(0);
    expect(screen.getByTestId("live-badge").textContent).toContain("comex@atelier.fr");
  });

  it("affiche les agents de l’API et enregistre le paramétrage complet", async () => {
    localStorage.setItem("kayroslab.console.token", "tok");
    mockApi();
    window.location.hash = "agents";
    render(<ConsoleApp />);
    expect(await screen.findByText("Acheteur senior")).toBeTruthy();
    expect(screen.queryByText("Direction financière")).toBeNull();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Modifier/ })[0]); });
    expect(screen.getByTestId("agent-settings")).toBeTruthy();
    expect(screen.getByTestId("agent-library").textContent).toContain("Analyse TCO");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" })); });
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.body).toMatchObject({ constraints: ["Pas de remise > 12 %"], tools: ["tco"], provider: "mistral", model: "mistral-large", connectors: ["console"], rule_configuration: { user_added_rules: ["Comparer 3 offres."], system_proposed_rules: [{ rule_id: "R1", rule_text: "Toujours chiffrer.", status: "active" }] } });
  });

  it("garde l’état local de démo sans jeton", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    window.location.hash = "agents";
    render(<ConsoleApp />);
    expect((await screen.findAllByText("Direction financière")).length).toBeGreaterThan(0);
  });
});
