import { describe, expect, it } from "vitest";
import { fromApiThread } from "./live";

describe("fromApiThread · persona", () => {
  it("porte la provenance du DISC et la source de la voix dans la contribution", () => {
    const thread = fromApiThread({ thread_id: "t1", question: "q", room_id: "r", status: "completed", messages: [{ run: { analyses: [
      { agent_id: "imp", verdict: "GO", persona_confidence: { kind: "estimate", label: "Estimation… pas une fiche CrystalKnows", confidence: 0.4, sources: ["email"], disc_type: "D", archetype: null }, simulated_stakeholder_feedback: "Simulation — Go.", persona_voice_fallback: true, persona_voice_score: { score: 0.9 } },
      { agent_id: "cfo", verdict: "GO" },
    ] } }] });
    expect(thread.contributions[0].persona).toMatchObject({ voiceSource: "deterministic", feedback: "Simulation — Go.", score: 0.9 });
    expect(thread.contributions[0].persona?.confidence.kind).toBe("estimate");
    expect(thread.contributions[1].persona).toBeUndefined();
  });
});
