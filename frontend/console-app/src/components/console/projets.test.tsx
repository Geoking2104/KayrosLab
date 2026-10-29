import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConsoleApp } from "./Shell";
import { i18next } from "@/lib/i18n";
import { buildGraph } from "./ProjectGraph";
import { fromApiThread } from "@/lib/console/live";

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
const PROJECT: any = { id: "prj_1", company_id: "co_1", name: "Renouvellement Helia", goal: "Signer avant décembre", owner: "", status: "active", due_date: "", session_ids: ["room_1"], thread_ids: [], stakeholders: [{ name: "Camille Renaud", role: "decideur", title: "DG", email: "" }] };
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
    if (path === "/v1/console/projects" && method === "GET") return json({ projects: [PROJECT] });
    if (path.startsWith("/v1/console/projects/") && method === "PATCH") { const b = JSON.parse(String(init?.body)); PROJECT.stakeholders = b.stakeholders; return json({ item: PROJECT }); }
    if (path === "/v1/console/skills") return json({ skills: [{ id: "skl_1", name: "Analyse TCO", description: "", instructions: "", tools: [], agent_ids: ["achats"], session_ids: [] }] });
    if (path === "/v1/console/contexts") return json({ contexts: [] });
    if (path === "/v1/console/dashboard") return json({ company: { id: "co_1", name: "Atelier Renaud", sector: "Industrie", description: "" }, projects: [{ id: "prj_1", company_id: "co_1", name: "Renouvellement Helia", goal: "", owner: "", status: "active", due_date: "", session_ids: ["room_1"], thread_ids: [], stakeholders: [], counts: { awaiting_arbitration: 1 }, threads: [{ thread_id: "thread_1", session_id: "room_1", question: "Faut-il signer le contrat Helia ?", status: "awaiting_arbitration", verdict: "CONDITIONAL_GO" }] }], widgets: { projects_active: 1, decisions: { awaiting_arbitration: 1 }, pending_arbitrations: [], sessions: 1, skills: 1, contexts: 0 } });
    return json({ error: "inconnu" }, 404);
  }));
}

beforeEach(async () => {
  localStorage.clear();
  calls.length = 0;
  PROJECT.stakeholders = [{ name: "Camille Renaud", role: "decideur", title: "DG", email: "" }];
  await i18next.changeLanguage("fr");
});
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await i18next.changeLanguage("en"); });

describe("graphe de projet", () => {
  it("relie question, collectif, agents, porte et arbitrage avec leur statut", () => {
    const thread = fromApiThread(THREAD);
    const { nodes, edges } = buildGraph(thread, { id: "room_1", name: "Comité", agentIds: ["achats"], voting: "veto_csuite", personality: false, createdAt: "" }, [], [{ name: "Camille", role: "decideur", title: "", email: "" }]);
    expect(nodes.map((n) => n.id)).toEqual(["question", "collective", "agent:achats", "gate", "arbitration", "decision"]);
    expect(nodes.find((n) => n.id === "arbitration")).toMatchObject({ tone: "wait", title: "Camille" });
    expect(nodes.find((n) => n.id === "gate")?.tone).toBe("wait");
    expect(edges).toContainEqual({ from: "agent:achats", to: "gate" });
  });
  it("sans dossier, les nœuds restent inactifs", () => {
    const { nodes } = buildGraph(undefined, undefined, [], []);
    expect(nodes.every((n) => n.tone === "idle")).toBe(true);
  });
});

describe("navigation à 4 entrées", () => {
  it("range les anciennes pages sous Société, Projets, Bibliothèque et Réglages", async () => {
    window.location.hash = "agents";
    render(<ConsoleApp />);
    const nav = (await screen.findAllByRole("navigation"))[0];
    expect(nav.querySelectorAll("a").length).toBe(4);
    await waitFor(() => expect(nav.querySelector('[aria-current="page"]')?.textContent).toContain("Bibliothèque"));
    expect(screen.getByRole("navigation", { name: "Sous-sections" }).textContent).toContain("Collectifs");
  });
  it("ouvre un dossier dans un panneau latéral sans quitter la liste", async () => {
    window.location.hash = "dossiers";
    render(<ConsoleApp />);
    await screen.findAllByText(/./);
    act(() => { window.location.hash = "dossiers?thread=__absent__"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    const panel = await screen.findByTestId("dossier-panel");
    expect(panel.textContent).toContain("Dossier introuvable");
    fireEvent.click(screen.getAllByRole("button", { name: "Fermer le dossier" })[1]);
    await waitFor(() => expect(screen.queryByTestId("dossier-panel")).toBeNull());
  });
});

describe("projets connectés", () => {
  it("affiche le graphe, le décideur et enregistre une partie prenante", async () => {
    localStorage.setItem("kayroslab.console.token", "tok");
    mockApi();
    window.location.hash = "projets";
    render(<ConsoleApp />);
    const graph = await screen.findByTestId("project-graph");
    await waitFor(() => expect(graph.querySelector('[data-node="arbitration"]')?.getAttribute("data-tone")).toBe("wait"));
    expect(graph.querySelector('[data-node="arbitration"]')?.textContent).toContain("Camille Renaud");
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Léa Martin" } });
    fireEvent.change(screen.getByLabelText("Rôle"), { target: { value: "sponsor" } });
    fireEvent.click(screen.getByRole("button", { name: /Ajouter/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.url.includes("/projects/prj_1"))).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.body.stakeholders).toEqual([{ name: "Camille Renaud", role: "decideur", title: "DG", email: "" }, { name: "Léa Martin", role: "sponsor", title: "", email: "" }]);
    fireEvent.click(within(document.querySelector('[data-section="projet-dossiers"]') as HTMLElement).getByRole("button", { name: /Faut-il signer le contrat Helia/ }));
    expect(await screen.findByTestId("dossier-panel")).toBeTruthy();
  });
});
