import { describe, expect, it } from "vitest";
import { stepLevels } from "./Projets";
import type { PipelineStep } from "@/lib/console/live";

const step = (node_id: string, deps?: string[]): PipelineStep => ({ node_id, label: node_id, session_id: `s-${node_id}`, deps, status: "pending", thread_id: null, verdict: null });

describe("stepLevels", () => {
  it("regroupe les branches parallèles puis la jonction", () => {
    const levels = stepLevels([step("a", []), step("b", []), step("j", ["a", "b"]), step("z", ["j"])]);
    expect(levels.map((l) => l.map((s) => s.node_id))).toEqual([["a", "b"], ["j"], ["z"]]);
  });
  it("garde la séquence pour un ancien enchaînement sans dépendances", () => {
    expect(stepLevels([step("a"), step("b")]).map((l) => l.map((s) => s.node_id))).toEqual([["a"], ["b"]]);
  });
});
