import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConsoleApp } from "./Shell";
import { i18next } from "@/lib/i18n";
import { defaultSpec, layoutSpec } from "./ProjectGraph";
import { addNode, wouldLoop } from "./GraphEditor";

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
const MEMBERS: any[] = [];
const NOTIFS: any[] = [];
const ME_ROLE = { value: "admin" };
const calls: { url: string; method: string; body?: any }[] = [];

function mockApi() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const path = url.replace(/^.*\/v1/, "/v1").split("?")[0];
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (path === "/v1/console/members/me") return json({ email: "comex@atelier.fr", role: ME_ROLE.value, permissions: ME_ROLE.value === "admin" ? ["read", "run", "arbitrate", "manage", "members"] : ["read"], member: null });
    if (path === "/v1/console/members" && method === "GET") return json({ members: MEMBERS });
    if (path === "/v1/console/members" && method === "POST") { const b = JSON.parse(String(init?.body)); const m = { id: "mbr_2", ...b }; MEMBERS.push(m); return json({ item: m }, 201); }
    if (path === "/v1/console/skills/skl_1/restore") return json({ item: {} });
    if (path === "/v1/console/projects/prj_1/context") return json({ layers: [{ level: "societe", items: [{ id: "c1", name: "Charte achats", kind: "policy", content: "" }] }, { level: "projet", items: [] }], text: "" });
    if (path === "/v1/console/projects/prj_1/notifications") return json({ notifications: NOTIFS });
    if (path === "/v1/console/projects/prj_1/notify") { NOTIFS.push({ id: "n1", to: "lea@atelier.fr", name: "Léa", subject: "s", status: "queued", created_at: "2026-10-29T10:00:00Z" }); return json({ notifications: NOTIFS }); }
    if (path === "/v1/auth/me") return json({ user: { id: "u1", email: "comex@atelier.fr", role: "comex" } });
    if (path === "/v1/console/agents" && method === "GET") return json({ agents: [AGENT] });
    if (path.startsWith("/v1/console/agents/") && method === "PATCH") return json({ agent: AGENT });
    if (path === "/v1/console/sessions") return json({ sessions: [SESSION] });
    if (path === "/v1/console/threads") return json({ threads: [THREAD] });
    if (path === "/v1/console/companies") return json({ companies: [{ id: "co_1", name: "Atelier Renaud", sector: "Industrie", description: "" }] });
    if (path === "/v1/console/projects" && method === "GET") return json({ projects: [PROJECT] });
    if (path.startsWith("/v1/console/projects/") && method === "PATCH") { Object.assign(PROJECT, JSON.parse(String(init?.body))); return json({ item: PROJECT }); }
    if (path === "/v1/console/skills") return json({ skills: [{ id: "skl_1", name: "Analyse TCO", description: "", instructions: "v2", tools: [], agent_ids: ["achats"], session_ids: [], version: 2, versions: [{ version: 1, instructions: "v1", name: "Analyse TCO", description: "", tools: [] }] }] });
    if (path === "/v1/console/contexts") return json({ contexts: [] });
    if (path === "/v1/console/dashboard") return json({ company: { id: "co_1", name: "Atelier Renaud", sector: "Industrie", description: "" }, projects: [{ id: "prj_1", company_id: "co_1", name: "Renouvellement Helia", goal: "", owner: "", status: "active", due_date: "", session_ids: ["room_1"], thread_ids: [], stakeholders: [], counts: { awaiting_arbitration: 1 }, threads: [{ thread_id: "thread_1", session_id: "room_1", question: "Faut-il signer le contrat Helia ?", status: "awaiting_arbitration", verdict: "CONDITIONAL_GO" }] }], widgets: { projects_active: 1, decisions: { awaiting_arbitration: 1 }, pending_arbitrations: [], sessions: 1, skills: 1, contexts: 0 } });
    return json({ error: "inconnu" }, 404);
  }));
}

beforeEach(async () => {
  localStorage.clear();
  calls.length = 0; MEMBERS.length = 0; NOTIFS.length = 0; ME_ROLE.value = "admin";
  PROJECT.graph = null;
  PROJECT.stakeholders = [{ name: "Léa", role: "informe", title: "", email: "lea@atelier.fr" }];
  await i18next.changeLanguage("fr");
});
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await i18next.changeLanguage("en"); });

const live = (hash: string) => { localStorage.setItem("kayroslab.console.token", "tok"); mockApi(); window.location.hash = hash; render(<ConsoleApp />); };

describe("graphe éditable (logique)", () => {
  it("ajoute un nœud relié, refuse les boucles et applique le seuil de la porte", () => {
    const spec = defaultSpec({ id: "room_1", name: "C", agentIds: ["achats"], voting: "majority", personality: false, createdAt: "" });
    expect(wouldLoop(spec, "decision", "question")).toBe(true);
    expect(wouldLoop(spec, "question", "decision")).toBe(false);
    const { spec: next, id } = addNode(spec, "porte", "porte");
    expect(id).toBe("porte-1");
    expect(next.edges).toContainEqual({ from: "porte", to: "porte-1" });
    next.nodes.find((n) => n.id === "porte-1")!.config.min_go = 100;
    const thread = { id: "t", question: "Q", collectiveId: "room_1", status: "awaiting_arbitration", verdict: "CONDITIONAL_GO", profile: "demo", provider: "", useCase: "general", stage: "arbitrer", agentIds: ["achats"],
      contributions: [{ agentId: "achats", verdict: "NO_GO", strengths: [], objections: [], conditions: [], metric: "" }], conditions: [], questions: [], evidence: [], progress: { done: 1, total: 1 }, createdAt: "", updatedAt: "", events: [] } as any;
    const laid = layoutSpec(next, thread, undefined, [], []);
    const gate = laid.nodes.find((n) => n.id === "porte-1")!;
    expect(gate.tone).toBe("stop");
    expect(gate.detail).toContain("seuil 100 %");
    expect(gate.col).toBeGreaterThan(laid.nodes.find((n) => n.id === "porte")!.col);
  });
});

describe("P3 en mode connecté", () => {
  it("édite le graphe : ajoute une porte, la configure et enregistre", async () => {
    live("projets");
    fireEvent.click(await screen.findByRole("button", { name: /Modifier le graphe/ }));
    const editor = await screen.findByTestId("graph-editor");
    fireEvent.change(within(editor).getByLabelText("Type de nœud"), { target: { value: "porte" } });
    fireEvent.click(within(editor).getByRole("button", { name: /Ajouter un nœud/ }));
    const config = await screen.findByTestId("node-config");
    fireEvent.change(within(config).getByLabelText("Seuil d’avis favorables (%)"), { target: { value: "70" } });
    fireEvent.click(within(config).getByLabelText("Veto bloquant"));
    fireEvent.change(within(config).getByLabelText("Relier vers"), { target: { value: "arbitrage" } });
    fireEvent.click(within(config).getByRole("button", { name: /^Relier$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le graphe" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.body?.graph)).toBe(true));
    const graph = calls.find((c) => c.body?.graph)!.body.graph;
    expect(graph.nodes.find((n: any) => n.id === "porte-1").config).toMatchObject({ min_go: 70, veto: true, threshold: "majority" });
    expect(graph.edges).toContainEqual({ from: "porte-1", to: "arbitrage" });
  });

  it("montre le contexte en cascade et notifie les informés", async () => {
    live("projets");
    const cascade = await screen.findByTestId("context-cascade");
    await waitFor(() => expect(cascade.querySelector('[data-level="societe"]')?.textContent).toContain("Charte achats"));
    fireEvent.click(screen.getByRole("button", { name: /Notifier les informés/ }));
    expect((await screen.findByTestId("notifications")).textContent).toContain("lea@atelier.fr");
  });

  it("replie une section et s’en souvient", async () => {
    live("projets");
    const toggle = await screen.findByRole("button", { name: /Parties prenantes/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(localStorage.getItem("kayroslab.section.projet-parties-prenantes")).toBe("0");
  });

  it("gère les membres et affiche le rôle réel", async () => {
    live("membres");
    expect((await screen.findByTestId("member-role")).textContent).toContain("Admin");
    fireEvent.change(await screen.findByLabelText("E-mail du membre"), { target: { value: "lea@atelier.fr" } });
    fireEvent.change(screen.getByLabelText("Rôle du nouveau membre"), { target: { value: "lecteur" } });
    fireEvent.click(screen.getByRole("button", { name: /Ajouter le membre/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/v1/console/members"))).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/members"))!.body).toMatchObject({ email: "lea@atelier.fr", role: "lecteur" });
  });

  it("un lecteur ne peut ni modifier le graphe ni gérer les membres", async () => {
    ME_ROLE.value = "lecteur";
    live("projets");
    await screen.findByTestId("project-graph");
    await waitFor(() => expect(screen.getByTestId("member-role").textContent).toContain("Lecteur"));
    expect(screen.queryByRole("button", { name: /Modifier le graphe/ })).toBeNull();
    expect(screen.getByText("Votre rôle ne permet pas de modifier le projet.")).toBeTruthy();
  });

  it("restaure une version antérieure d’un skill", async () => {
    live("bibliotheque");
    expect((await screen.findByTestId("skill-version")).textContent).toBe("v2");
    fireEvent.click(screen.getByRole("button", { name: /Historique des versions/ }));
    fireEvent.click(screen.getByRole("button", { name: "Restaurer v1" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/skills/skl_1/restore") && c.body?.version === 1)).toBe(true));
  });
});

describe("mode démo", () => {
  it("remplace le bouton Contributeur/COMEX par un membre de démo", async () => {
    window.location.hash = "societe";
    render(<ConsoleApp />);
    const select = (await screen.findAllByLabelText("Membre de démo")).find((el) => el.tagName === "SELECT") as HTMLSelectElement;
    expect(select.options.length).toBe(2);
    expect(screen.queryByRole("button", { name: "COMEX" })).toBeNull();
  });
});
