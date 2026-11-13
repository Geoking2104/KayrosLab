import type { Evidence, Profile, UseCase } from "./model";

export const CONTEXT_LIMIT = 22_000;
export interface DecisionDraft {
  version: 1;
  step: number;
  question: string;
  goal: string;
  deadline: string;
  context: string;
  evidence: Evidence[];
  collectiveId: string;
  profile: Profile;
  useCase: UseCase;
}
export function emptyDecisionDraft(
  collectiveId: string,
  profile: Profile,
): DecisionDraft {
  return {
    version: 1,
    step: 0,
    question: "",
    goal: "",
    deadline: "",
    context: "",
    evidence: [],
    collectiveId,
    profile,
    useCase: "comex_decision",
  };
}
export function readDecisionDraft(
  key: string,
  fallback: DecisionDraft,
): DecisionDraft {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!value || value.version !== 1) return fallback;
    if (
      !["question", "goal", "deadline", "context", "collectiveId"].every(
        (k) => typeof value[k] === "string",
      )
    )
      return fallback;
    if (
      !["demo", "fast", "deep"].includes(value.profile) ||
      !["general", "rfp", "comex_decision", "renewal", "negotiation"].includes(
        value.useCase,
      )
    )
      return fallback;
    if (!Number.isInteger(value.step) || value.step < 0 || value.step > 4)
      return fallback;
    if (
      !Array.isArray(value.evidence) ||
      value.evidence.length > 6 ||
      value.evidence.some(
        (e: Evidence) =>
          !e ||
          typeof e.name !== "string" ||
          typeof e.text !== "string" ||
          typeof e.type !== "string",
      )
    )
      return fallback;
    if (
      value.question.length > 2000 ||
      value.goal.length > 1000 ||
      value.context.length > 8000 ||
      evidenceLength(value) > CONTEXT_LIMIT
    )
      return fallback;
    return { ...fallback, ...value };
  } catch {
    return fallback;
  }
}
export function evidenceLength(draft: DecisionDraft) {
  return (
    draft.context.length +
    draft.goal.length +
    draft.deadline.length +
    draft.evidence.reduce(
      (n, e) => n + e.name.length + (e.text?.length ?? 0) + 3,
      0,
    ) +
    100
  );
}
