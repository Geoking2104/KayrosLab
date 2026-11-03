import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuickImpersonator } from "./QuickImpersonator";
import { parsePublicSources } from "@/lib/console/model";

afterEach(cleanup);
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("QuickImpersonator", () => {
  it("source publique : crée sans consentement avec les URLs", () => {
    const onCreate = vi.fn(() => ({ ok: true }));
    render(<QuickImpersonator onCreate={onCreate} onClose={() => {}} />);
    fill("Name", "Alex Martin");
    fill("Public URLs", "https://example.com/alex\nhttps://example.com/alex");
    fireEvent.click(screen.getByText("I have read the five guardrails."));
    fireEvent.click(screen.getByText("Create persona"));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "Alex Martin", kind: "impersonator", consented: false, veto: true, publicSources: ["https://example.com/alex"] }));
  });
  it("source publique sans URL : refus", () => {
    const onCreate = vi.fn(() => ({ ok: true }));
    render(<QuickImpersonator onCreate={onCreate} onClose={() => {}} />);
    fill("Name", "Alex");
    fireEvent.click(screen.getByText("I have read the five guardrails."));
    fireEvent.click(screen.getByText("Create persona"));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/public URL/);
  });
  it("indices manuels : consentement exigé", () => {
    const onCreate = vi.fn(() => ({ ok: true }));
    render(<QuickImpersonator onCreate={onCreate} onClose={() => {}} />);
    fill("Name", "Alex");
    fill("Source", "manual");
    fireEvent.click(screen.getByText("I have read the five guardrails."));
    fireEvent.click(screen.getByText("Create persona"));
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("The person has given explicit consent."));
    fireEvent.click(screen.getByText("Create persona"));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ consented: true, publicSources: undefined }));
  });
  it("garde-fous à reconnaître avant création ; modèle pré-remplit", () => {
    const onCreate = vi.fn(() => ({ ok: true }));
    render(<QuickImpersonator onCreate={onCreate} onClose={() => {}} />);
    fill("Template (optional)", "daf-sceptique");
    expect((screen.getByLabelText("Function") as HTMLInputElement).value).toBe("Directeur administratif et financier");
    fill("Name", "Alex");
    fill("Public URLs", "https://example.com/a");
    fireEvent.click(screen.getByText("Create persona"));
    expect(onCreate).not.toHaveBeenCalled();
  });
  it("parsePublicSources", () => {
    expect(parsePublicSources("https://a.fr foo http://b.fr")).toEqual({ urls: ["https://a.fr", "http://b.fr"], invalid: ["foo"] });
  });
});
