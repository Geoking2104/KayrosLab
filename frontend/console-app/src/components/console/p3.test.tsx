import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConsoleApp } from "./Shell";
import { i18next } from "@/lib/i18n";
import { defaultSpec, layoutSpec } from "./ProjectGraph";
import { addNode, moveNode, wouldLoop } from "./GraphEditor";

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
const MAIL = { smtp: false };
const GATES: { value: any } = { value: null };
const PIPES: any[] = [];
const calls: { url: string; method: string; body?: any }[] = [];

function mockApi() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const path = url.replace(/^.*\/v1/, "/v1").split("?")[0];
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (path === "/v1/console/members/me") return json({ email: "comex@atelier.fr", role: ME_ROLE.value, permissions: ME_ROLE.value === "admin" ? ["read", "run", "arbitrate", "manage", "members"] : ["read"], member: null });
    if (path === "/v1/console/members/invite") { const b = JSON.parse(String(init?.body)); const m = { id: "mbr_9", ...b, status: "invited", invite_status: MAIL.smtp ? "sent" : "queued" }; MEMBERS.push(m); return json({ item: m, delivery: { status: m.invite_status, error: "" } }, 201); }
    if (path === "/v1/console/projects/prj_1/pipelines" && method === "POST") { PIPES.unshift({ id: "ppl_1", project_id: "prj_1", question: JSON.parse(String(init?.body)).question, status: "blocked", current: 0, created_at: "2026-10-29T10:00:00Z", steps: [{ node_id: "c", label: "Finance", session_id: "room_1", status: "blocked", thread_id: "t1", verdict: "CONDITIONAL_GO", gates: [{ gate_id: "p", label: "", status: "blocked", reasons: ["majorité non atteinte"] }] }, { node_id: "c2", label: "Juridique", session_id: "room_1", status: "pending", thread_id: null, verdict: null }] }); return json({ pipeline: PIPES[0] }, 202); }
    if (path === "/v1/console/projects/prj_1/pipelines") return json({ pipelines: PIPES });
    if (path === "/v1/console/pipelines/ppl_1/resume") { PIPES[0].status = "completed"; PIPES[0].steps[0].status = "overridden"; PIPES[0].steps[1].status = "completed"; return json({ pipeline: PIPES[0] }); }
    if (path === "/v1/console/mail/status") return json({ smtp: MAIL.smtp, from: null });
    if (path === "/v1/console/projects/prj_1/notifications/retry") { NOTIFS.forEach((n) => { n.status = "sent"; }); return json({ notifications: NOTIFS }); }
    if (path === "/v1/console/threads/thread_1/arbitrate") return json({ thread: THREAD });
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
    if (path === "/v1/console/threads") return json({ threads: [{ ...THREAD, gate_evaluation: GATES.value }] });
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
  calls.length = 0; PIPES.length = 0; MEMBERS.length = 0; NOTIFS.length = 0; ME_ROLE.value = "admin"; MAIL.smtp = false; GATES.value = null;
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
    fireEvent.click(screen.getByRole("button", { name: /Ajouter sans e-mail/ }));
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

const BLOCKED = { status: "blocked", verdict: "NO_GO", consensus_verdict: "CONDITIONAL_GO", results: [{ gate_id: "porte", project_id: "prj_1", status: "blocked", share: 0, reasons: ["0 % d'avis favorables, seuil 50 %"] }] };

// jsdom n'expose pas clientX sur PointerEvent : on s'appuie sur MouseEvent.
class TestPointerEvent extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; } }

describe("suite P3 : portes, rôles, invitations, glisser-déposer", () => {
  it("déplace un nœud au clavier et au glisser-déposer, puis enregistre sa position", async () => {
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    const spec = defaultSpec(undefined);
    expect(moveNode(spec, "porte", 400, 120).nodes.find((n) => n.id === "porte")).toMatchObject({ x: 400, y: 120 });
    live("projets");
    fireEvent.click(await screen.findByRole("button", { name: /Modifier le graphe/ }));
    const graph = await screen.findByTestId("project-graph");
    const node = graph.querySelector('[data-node="porte"]') as HTMLElement;
    const x0 = Number(node.dataset.x), y0 = Number(node.dataset.y);
    fireEvent.keyDown(node, { key: "ArrowRight" });
    await waitFor(() => expect(Number((graph.querySelector('[data-node="porte"]') as HTMLElement).dataset.x)).toBe(x0 + 10));
    const moved = graph.querySelector('[data-node="porte"]') as HTMLElement;
    fireEvent.pointerDown(moved, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(moved, { clientX: 160, clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(moved, { clientX: 160, clientY: 140, pointerId: 1 });
    await waitFor(() => expect(Number((graph.querySelector('[data-node="porte"]') as HTMLElement).dataset.y)).toBe(y0 + 40));
    expect(screen.getByRole("button", { name: "Disposition automatique" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le graphe" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.body?.graph)).toBe(true));
    expect(calls.find((c) => c.body?.graph)!.body.graph.nodes.find((n: any) => n.id === "porte")).toMatchObject({ x: x0 + 70, y: y0 + 40 });
  });

  it("une porte bloquée s’affiche sur le graphe et verrouille l’acceptation", async () => {
    GATES.value = BLOCKED;
    PROJECT.graph = defaultSpec({ id: "room_1", name: "C", agentIds: ["achats"], voting: "majority", personality: false, createdAt: "" });
    live("dossiers?thread=thread_1");
    expect((await screen.findByTestId("gate-blocked")).textContent).toContain("seuil 50 %");
    expect((screen.getByRole("button", { name: "Accepter le consensus" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Demander une réévaluation" }) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    live("projets");
    const gate = await waitFor(() => { const el = screen.getByTestId("project-graph").querySelector('[data-node="porte"]') as HTMLElement; expect(el.dataset.tone).toBe("stop"); return el; });
    expect(gate.textContent).toContain("Bloquée");
  });

  it("invite un membre par e-mail et signale l’absence de SMTP", async () => {
    live("membres");
    fireEvent.change(await screen.findByLabelText("E-mail du membre"), { target: { value: "nina@atelier.fr" } });
    fireEvent.change(screen.getByLabelText("Rôle du nouveau membre"), { target: { value: "comex" } });
    fireEvent.click(screen.getByRole("button", { name: /Inviter par e-mail/ }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/members/invite"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/members/invite"))!.body).toMatchObject({ email: "nina@atelier.fr", role: "comex" });
    expect((await screen.findByRole("status")).textContent).toContain("SMTP");
    expect((await screen.findByTestId("invite-nina@atelier.fr")).textContent).toContain("en file");
  });

  it("explique la file sans SMTP, puis relance une fois le SMTP prêt", async () => {
    NOTIFS.push({ id: "n1", to: "lea@atelier.fr", name: "Léa", subject: "s", status: "queued", created_at: "2026-10-29T10:00:00Z" });
    live("projets");
    expect((await screen.findByTestId("smtp-missing")).textContent).toContain("SMTP");
    cleanup();
    MAIL.smtp = true;
    live("projets");
    fireEvent.click(await screen.findByRole("button", { name: /Relancer 1 envois en attente/ }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/notifications/retry"))).toBe(true));
  });

  it("un lecteur ne lance pas de mission", async () => {
    ME_ROLE.value = "lecteur";
    live("dossiers?thread=thread_1");
    await waitFor(() => expect(screen.getByTestId("member-role").textContent).toContain("Lecteur"));
    expect(calls.some((c) => c.method === "POST" && /\/run/.test(c.url))).toBe(false);
  });

  it("lance un enchaînement de collectifs, affiche la porte bloquée puis la lève", async () => {
    PROJECT.graph = { nodes: [{ id: "c", type: "collectif", label: "Finance", config: { session_id: "room_1" } }, { id: "p", type: "porte", label: "", config: {} }, { id: "c2", type: "collectif", label: "Juridique", config: { session_id: "room_1" } }], edges: [{ from: "c", to: "p" }, { from: "p", to: "c2" }] };
    live("projets");
    fireEvent.change(await screen.findByLabelText("Question de l’enchaînement"), { target: { value: "Faut-il signer ?" } });
    fireEvent.click(screen.getByRole("button", { name: "Lancer l’enchaînement" }));
    const list = await screen.findByTestId("pipelines");
    await waitFor(() => expect(list.textContent).toContain("porte bloquée"));
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/projects/prj_1/pipelines"))!.body).toEqual({ question: "Faut-il signer ?" });
    fireEvent.change(screen.getByLabelText("Motif de levée de la porte"), { target: { value: "Risque accepté" } });
    fireEvent.click(screen.getByRole("button", { name: "Lever la porte et continuer" }));
    await waitFor(() => expect(screen.getByTestId("pipelines").textContent).toContain("porte levée"));
    expect(calls.find((c) => c.url.endsWith("/resume"))!.body).toEqual({ justification: "Risque accepté" });
  });

  it("le membre de démo choisi est conservé", async () => {
    window.location.hash = "societe";
    const first = render(<ConsoleApp />);
    const select = (await screen.findAllByLabelText("Membre de démo")).find((el) => el.tagName === "SELECT") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "contributeur" } });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    first.unmount();
    render(<ConsoleApp />);
    const again = (await screen.findAllByLabelText("Membre de démo")).find((el) => el.tagName === "SELECT") as HTMLSelectElement;
    expect(again.value).toBe("contributeur");
  });
});

