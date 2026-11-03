import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PERSONA_TEMPLATES, parseTemplates, toTemplate } from "@/lib/console/persona-templates";
import { TemplatePicker } from "./TemplatePicker";

describe("persona templates", () => {
  it("embarque le catalogue personas/catalog/", () => {
    expect(PERSONA_TEMPLATES.map((tpl) => tpl.id)).toEqual(
      expect.arrayContaining(["daf-sceptique", "dsi-architecte", "rssi-conformite", "acheteur-negociateur", "sponsor-metier"]),
    );
    for (const tpl of PERSONA_TEMPLATES) {
      expect(tpl.title).toBeTruthy();
      expect(tpl.clues.length).toBeGreaterThan(0);
    }
  });
  it("refuse un modèle qui désigne une personne ou sans titre", () => {
    expect(toTemplate({ id: "x", template_title: "X", name: "Jean Dupont" })).toBeNull();
    expect(toTemplate({ id: "x" })).toBeNull();
    expect(parseTemplates({ "a.yaml": "id: a\ntemplate_title: A\nveto_power: false", "b.yaml": ": : :" })).toHaveLength(1);
  });
  it("veto activé par défaut, purpose inconnu ramené à idea_test", () => {
    const tpl = toTemplate({ id: "a", template_title: "A", purpose: "hiring" })!;
    expect(tpl.veto).toBe(true);
    expect(tpl.purpose).toBe("idea_test");
  });
  it("TemplatePicker transmet le modèle choisi", () => {
    const onPick = vi.fn();
    render(<TemplatePicker onPick={onPick} onClose={() => {}} />);
    fireEvent.click(screen.getByText("DAF sceptique"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "daf-sceptique" }));
  });
});
