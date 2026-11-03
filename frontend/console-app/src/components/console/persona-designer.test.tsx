import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PersonaDesigner } from "./PersonaDesigner";

afterEach(cleanup);
const proposal = (valid = true) => ({
  reply: "Draft ready", valid, issues: valid ? [] : ["impersonator: persona_name requis"], requires_approval: true as const, source: "model" as const,
  guardrails: valid ? [{ rule_id: "IMP_01_LABEL", rule_text: "x" }] : [],
  draft: { name: valid ? "Alex Martin" : "", role: "CFO", source: "public" as const, public_sources: ["https://example.com/alex"], clues: [], purpose: "idea_test" },
});

describe("PersonaDesigner", () => {
  it("n’enregistre qu’après approbation humaine", async () => {
    const turn = vi.fn(async () => proposal());
    const save = vi.fn(async () => ({}));
    render(<PersonaDesigner onClose={() => {}} turn={turn} save={save} />);
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "Persona: Alex Martin https://example.com/alex" } });
    fireEvent.click(screen.getByText("Send"));
    await screen.findByText("Draft ready");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Approve and save"));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: "Alex Martin", source: "public" })));
    await screen.findByText("Persona saved.");
  });
  it("brouillon invalide : approbation impossible", async () => {
    const save = vi.fn(async () => ({}));
    render(<PersonaDesigner onClose={() => {}} turn={async () => proposal(false)} save={save} />);
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "hello" } });
    fireEvent.click(screen.getByText("Send"));
    await screen.findByText(/persona_name/);
    expect((screen.getByText("Approve and save") as HTMLButtonElement).disabled).toBe(true);
  });
});
