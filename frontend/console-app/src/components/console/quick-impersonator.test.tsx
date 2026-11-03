import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuickImpersonator } from "./QuickImpersonator";
import { canManagePersonaTools } from "@/lib/console/api";
import { parsePublicSources } from "@/lib/console/model";
import { effectiveSkillToolsPreview } from "@/lib/console/api";

afterEach(cleanup);
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("QuickImpersonator", () => {
  it("source publique : consentie par défaut, crée avec les URLs", () => {
    const onCreate = vi.fn(() => ({ ok: true }));
    render(<QuickImpersonator onCreate={onCreate} onClose={() => {}} loadSkills={null} />);
    fill("Name", "Alex Martin");
    fill("Public URLs", "https://example.com/alex\nhttps://example.com/alex");
    fireEvent.click(screen.getByText("I have read the five guardrails."));
    fireEvent.click(screen.getByText("Create persona"));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "Alex Martin", kind: "impersonator", consented: true, veto: true, publicSources: ["https://example.com/alex"] }));
  });
  it("source publique sans URL : refus", () => {
    const onCreate = vi.fn(() => ({ ok: true }));
    render(<QuickImpersonator onCreate={onCreate} onClose={() => {}} loadSkills={null} />);
    fill("Name", "Alex");
    fireEvent.click(screen.getByText("I have read the five guardrails."));
    fireEvent.click(screen.getByText("Create persona"));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/public URL/);
  });
  it("indices manuels : consentie par défaut, seul un refus explicite bloque", () => {
    const onCreate = vi.fn(() => ({ ok: true }));
    render(<QuickImpersonator onCreate={onCreate} onClose={() => {}} loadSkills={null} />);
    fill("Name", "Alex");
    fill("Source", "manual");
    fireEvent.click(screen.getByText("I have read the five guardrails."));
    fireEvent.click(screen.getByText("Consent is assumed by default. Tick if the person refuses (nothing is saved)."));
    fireEvent.click(screen.getByText("Create persona"));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/refused/);
    fireEvent.click(screen.getByText("Consent is assumed by default. Tick if the person refuses (nothing is saved)."));
    fireEvent.click(screen.getByText("Create persona"));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ consented: true, publicSources: undefined }));
  });
  it("cinq garde-fous toujours affichés ; compétences choisies envoyées avec aperçu des outils effectifs", async () => {
    const onCreate = vi.fn(() => ({ ok: true }));
    const loadSkills = async () => [{ id: "roi", name: "ROI objection", instructions: null, tools: ["estimate_resources"] }];
    render(<QuickImpersonator onCreate={onCreate} onClose={() => {}} loadSkills={loadSkills} />);
    expect(screen.getAllByRole("listitem").length).toBe(5);
    fireEvent.click(await screen.findByText("ROI objection"));
    expect(screen.getByTestId("effective-tools").textContent).toMatch(/Effective tools: none.*estimate_resources/);
    fill("Name", "Alex");
    fill("Public URLs", "https://example.com/a");
    fireEvent.click(screen.getByText("I have read the five guardrails."));
    fireEvent.click(screen.getByText("Create persona"));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ personaSkills: ["roi"] }));
  });
  it("réglage des outils masqué hors managers, affiché et envoyé pour un manager", async () => {
    const loadSkills = async () => [{ id: "roi", name: "ROI objection", instructions: null, tools: ["estimate_resources"] }];
    const loadTools = vi.fn(async () => [{ name: "estimate_resources", description: "Estimate", sideEffect: "read", gate: false, assignable: true, reason: null }]);
    const { unmount } = render(<QuickImpersonator onCreate={() => ({ ok: true })} onClose={() => {}} loadSkills={loadSkills} loadTools={loadTools} />);
    await screen.findByText("ROI objection");
    expect(screen.queryByText("Allowed tools")).toBeNull();
    expect(loadTools).not.toHaveBeenCalled();
    unmount();
    const onCreate = vi.fn(() => ({ ok: true }));
    render(<QuickImpersonator onCreate={onCreate} onClose={() => {}} loadSkills={loadSkills} loadTools={loadTools} canEditTools />);
    fireEvent.click((await screen.findByText("estimate_resources")).closest("label")!.querySelector("input")!);
    fill("Name", "Alex");
    fill("Public URLs", "https://example.com/a");
    fireEvent.click(screen.getByText("I have read the five guardrails."));
    fireEvent.click(screen.getByText("Create persona"));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ personaTools: ["estimate_resources"] }));
  });
  it("canManagePersonaTools reflète exactement la permission serveur « manage »", () => {
    expect(canManagePersonaTools(["read", "run", "arbitrate", "manage"])).toBe(true);
    expect(canManagePersonaTools(["read", "run"])).toBe(false);
    expect(canManagePersonaTools(["read"])).toBe(false);
    expect(canManagePersonaTools(undefined)).toBe(false);
  });
  it("garde-fous à reconnaître avant création ; modèle pré-remplit", () => {
    const onCreate = vi.fn(() => ({ ok: true }));
    render(<QuickImpersonator onCreate={onCreate} onClose={() => {}} loadSkills={null} />);
    fill("Template (optional)", "daf-sceptique");
    expect((screen.getByLabelText("Function") as HTMLInputElement).value).toBe("Directeur administratif et financier");
    fill("Name", "Alex");
    fill("Public URLs", "https://example.com/a");
    fireEvent.click(screen.getByText("Create persona"));
    expect(onCreate).not.toHaveBeenCalled();
  });
  it("aperçu des outils : intersection, rien n'élargit l'allowlist", () => {
    const cat = [{ id: "a", name: "A", instructions: null, tools: ["x", "y"] }, { id: "b", name: "B", instructions: null, tools: ["z"] }];
    expect(effectiveSkillToolsPreview(cat, ["a"], ["y", "z"])).toEqual({ wanted: ["x", "y"], granted: ["y"], denied: ["x"] });
    expect(effectiveSkillToolsPreview(cat, ["a", "b"]).granted).toEqual([]);
  });
  it("parsePublicSources", () => {
    expect(parsePublicSources("https://a.fr foo http://b.fr")).toEqual({ urls: ["https://a.fr", "http://b.fr"], invalid: ["foo"] });
  });
});
