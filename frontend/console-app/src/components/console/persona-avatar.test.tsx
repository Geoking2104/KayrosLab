import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PersonaAvatar, PersonaComplianceLabel, PersonaContextPanel, personaInitials } from "./persona-avatar";
import { AgentMark } from "./agent-mark";
import { fromApiAgent } from "@/lib/console/live";
import type { PersonaCompliance } from "@/lib/console/model";

afterEach(cleanup);

const compliance: PersonaCompliance = {
  rules_version: "v4-2026-11-11",
  legal_basis: "legitimate_interest",
  controller: "tenant",
  verification_status: "estimated",
  label: "Simulation · Estimé",
  portrait_url: null,
  profile_sources: [
    { type: "crystalknows", label: "CrystalKnows", url: "https://www.crystalknows.com/p/claire", mode: "public_profile_page", imported_at: null, verified: false },
    { type: "email", label: "Textes fournis", url: null, mode: "pasted", imported_at: null, verified: false },
    { type: "web", label: "Page publique", url: "https://exemple.fr/blog", mode: "public_visit", imported_at: null, verified: false, visited: false },
  ],
};

describe("PersonaAvatar", () => {
  it("affiche les initiales et le badge K, avec le libellé de simulation", () => {
    render(<PersonaAvatar name="Claire Martin" size={40} />);
    expect(screen.getByRole("img", { name: "KayrosLab simulation of Claire Martin" }).textContent).toBe("CM");
    const badge = screen.getByTestId("persona-k-badge");
    expect(badge.getAttribute("width")).toBe("16");
  });

  it("affiche le portrait, puis retombe sur les initiales si l'image échoue ; badge toujours présent, au moins 12 px", () => {
    render(<PersonaAvatar name="Claire Martin" portraitUrl="https://avatars.example/c.png" size={24} />);
    const img = screen.getByAltText("KayrosLab simulation of Claire Martin");
    expect(screen.getByTestId("persona-k-badge").getAttribute("width")).toBe("12");
    fireEvent.error(img);
    expect(screen.getByRole("img", { name: "KayrosLab simulation of Claire Martin" }).textContent).toBe("CM");
    expect(screen.getByTestId("persona-k-badge")).toBeTruthy();
  });

  it("initiales robustes", () => {
    expect(personaInitials("Claire")).toBe("CL");
    expect(personaInitials("jean-paul de la tour")).toBe("JT");
    expect(personaInitials("  ")).toBe("?");
  });
});

describe("Libellé et contexte de l'agent", () => {
  it("libellé Estimé / Vérifié par la personne, sans pourcentage", () => {
    const { rerender, container } = render(<PersonaComplianceLabel compliance={compliance} />);
    expect(screen.getByTestId("persona-compliance-label").textContent).toBe("Simulation · Estimated");
    rerender(<PersonaComplianceLabel compliance={{ ...compliance, verification_status: "verified" }} />);
    expect(screen.getByTestId("persona-compliance-label").textContent).toBe("Simulation · Verified by the person");
    expect(container.textContent).not.toMatch(/%/);
  });

  it("panneau des sources : provenance listée, aucune adresse de texte fourni", () => {
    render(<PersonaContextPanel compliance={compliance} />);
    const panel = screen.getByTestId("persona-context-panel");
    expect(panel.textContent).toContain("CrystalKnows");
    expect(panel.textContent).toContain("Provided texts");
    expect(panel.textContent).toContain("https://exemple.fr/blog");
    expect(panel.textContent).toContain("not visited");
    expect(panel.textContent).not.toMatch(/mailto:|@/);
  });
});

describe("AgentMark (drapeau serveur)", () => {
  const base = { agent_id: "imp_claire", display_name: "Claire Martin", role_name: "DAF", department: "Finance", metadata: { impersonator: { clues: [] } }, human_profile: { assigned_name: "Claire Martin" } };

  it("sans vue de conformité (drapeau désactivé) : icône inchangée, pas de badge K", () => {
    const agent = fromApiAgent(base);
    expect(agent.compliance).toBeUndefined();
    render(<AgentMark agent={agent} />);
    expect(screen.queryByTestId("persona-k-badge")).toBeNull();
  });

  it("avec vue de conformité : portrait ou initiales + badge K", () => {
    const agent = fromApiAgent({ ...base, persona_compliance: compliance });
    expect(agent.compliance?.verification_status).toBe("estimated");
    render(<AgentMark agent={agent} size={44} />);
    expect(screen.getByRole("img", { name: "KayrosLab simulation of Claire Martin" })).toBeTruthy();
    expect(screen.getByTestId("persona-k-badge")).toBeTruthy();
  });

  it("agent métier : jamais de badge K", () => {
    render(<AgentMark agent={fromApiAgent({ agent_id: "cfo", role_name: "CFO", department: "Finance", persona_compliance: compliance })} />);
    expect(screen.queryByTestId("persona-k-badge")).toBeNull();
  });
});
