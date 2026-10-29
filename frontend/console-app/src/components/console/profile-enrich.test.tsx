import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18next } from "@/lib/i18n";

const enrichProfile = vi.fn();
const speak = vi.fn();
vi.mock("@/lib/console/api", async (orig) => {
  const mod = await orig<typeof import("@/lib/console/api")>();
  return { ...mod, api: { ...mod.api, enrichProfile: (...args: unknown[]) => enrichProfile(...args), speak: (...args: unknown[]) => speak(...args) } };
});

import { ProfileEnrich, enrichedClue, splitEmails, splitPosts } from "./profile-enrich";

const result = {
  profile: {
    assigned_name: "Geoffroy de La Tournelle",
    descriptif: { disc_type: "D", archetype: "Captain", qualities: ["Assertive", "Decisive"], overview: "Rapide et direct.", sections: { emails: ["Write 3 sentences or less"] } },
  },
  evidence: [{ source: "crystalknows", mode: "public_profile_page" }, { source: "email", mode: "operator_supplied", samples: 2 }],
  warnings: ["X_BEARER_TOKEN absent"],
  limits: [],
  estimate: null,
  confidence: { kind: "crystalknows", disc_type: "D", archetype: "Captain", confidence: null, label: "Fiche CrystalKnows (DISC mesuré)", sources: ["crystalknows"] },
};

describe("ProfileEnrich", () => {
  beforeEach(async () => { await i18next.changeLanguage("fr"); });
  afterEach(async () => { cleanup(); await i18next.changeLanguage("en"); });
  it("découpe e-mails et posts", () => {
    expect(splitEmails("a\n---\nb\n")).toEqual([{ body: "a" }, { body: "b" }]);
    expect(splitEmails("De : Geo <g@x.fr>\nObjet : Go\nOn y va.\nFrom: Bob\nOK")).toEqual([{ from: "Geo <g@x.fr>", body: "On y va." }, { from: "Bob", body: "OK" }]);
    expect(splitPosts("x\n\ny")).toEqual(["x", "y"]);
    expect(enrichedClue(result.profile)).toBe("DISC D · Captain · Assertive, Decisive · Rapide et direct.");
  });

  it("refuse hors connexion sans appeler l’API", () => {
    enrichProfile.mockReset();
    render(<ProfileEnrich live={false} name="G" onResult={() => {}} />);
    fireEvent.click(screen.getByText("Construire le profil"));
    expect(screen.getByRole("alert").textContent).toMatch(/Connectez-vous/);
    expect(enrichProfile).not.toHaveBeenCalled();
  });

  it("envoie les sources et affiche la fiche type Crystal", async () => {
    enrichProfile.mockReset().mockResolvedValue(result);
    const onResult = vi.fn();
    render(<ProfileEnrich live name="Geoffroy" crystalUrl="https://www.crystalknows.com/p/geoffroy2104" onResult={onResult} />);
    fireEvent.click(screen.getByRole("tab", { name: "4. E-mails" }));
    fireEvent.change(screen.getByLabelText(/^E-mails écrits par la personne/), { target: { value: "Go.\n---\nOn tranche." } });
    fireEvent.click(screen.getByText("Construire le profil"));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(result));
    expect(enrichProfile.mock.calls[0][0]).toMatchObject({ assigned_name: "Geoffroy", crystal_public_url: "https://www.crystalknows.com/p/geoffroy2104", emails: ["Go.", "On tranche."] });
    const card = screen.getByTestId("enriched-profile");
    expect(card.textContent).toMatch(/DISC D · Captain/);
    expect(card.textContent).toMatch(/Write 3 sentences or less/);
    expect(card.textContent).toMatch(/X_BEARER_TOKEN absent/);
    expect(screen.getByTestId("confidence").dataset.kind).toBe("crystalknows");
    speak.mockReset().mockResolvedValue({ message: "Simulation — Sur « premium » : quel gain, et pour quand ?", notice: "Simulation", confidence: result.confidence });
    fireEvent.change(screen.getByLabelText(/^Ainsi je parlerais/), { target: { value: "premium" } });
    fireEvent.click(screen.getByText("Écouter la persona"));
    await waitFor(() => expect(screen.getByTestId("speak").textContent).toMatch(/quel gain/));
    expect(speak.mock.calls[0][0]).toMatchObject({ idea: "premium" });
  });

  it("compte les e-mails gardés et envoie un export JSON privé", async () => {
    enrichProfile.mockReset().mockResolvedValue({ ...result, confidence: { ...result.confidence, kind: "estimate", label: "Estimation depuis le style d’écriture (confiance 40 %) — pas une fiche CrystalKnows" } });
    render(<ProfileEnrich live name="G" onResult={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Mode CrystalKnows/), { target: { value: "export" } });
    fireEvent.change(screen.getByLabelText(/^Export JSON CrystalKnows/), { target: { value: '{"disc_type":"D"}' } });
    fireEvent.click(screen.getByRole("tab", { name: "4. E-mails" }));
    fireEvent.change(screen.getByLabelText(/^E-mails écrits/), { target: { value: "From: geo@x.fr\nGo\nFrom: bob@y.fr\nNon" } });
    fireEvent.change(screen.getByLabelText(/^Adresse de l’auteur/), { target: { value: "geo@x.fr" } });
    expect(screen.getByTestId("email-count").textContent).toMatch(/1 message\(s\) de la personne sur 2/);
    fireEvent.click(screen.getByText("Construire le profil"));
    await waitFor(() => expect(screen.getByTestId("confidence").dataset.kind).toBe("estimate"));
    expect(screen.getByTestId("confidence").textContent).toMatch(/pas une fiche CrystalKnows/);
    expect(enrichProfile.mock.calls[0][0]).toMatchObject({ crystal_export: { disc_type: "D" }, email_address: "geo@x.fr" });
  });
});
