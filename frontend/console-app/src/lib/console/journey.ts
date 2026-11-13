import { t } from "@/lib/i18n";
import type { Thread } from "./model";

/** One vocabulary shared by the home queue, approvals and the case companion. */
export function nextDecisionAction(thread: Thread, canArbitrate: boolean) {
  if (thread.status === "failed") return t("Examiner l’échec");
  if (thread.status === "needs_clarification")
    return t("Apporter une précision");
  if (thread.status === "awaiting_arbitration") {
    if (thread.gates?.status === "blocked") return t("Examiner le blocage");
    return canArbitrate
      ? t("Préparer mon arbitrage")
      : t("Lire avant le comité");
  }
  if (thread.status === "running") return t("Suivre l’instruction");
  return t("Relire la décision");
}

export function decisionPriority(thread: Thread) {
  if (thread.gates?.status === "blocked" && thread.status !== "resolved")
    return 0;
  return {
    needs_clarification: 1,
    awaiting_arbitration: 2,
    failed: 3,
    running: 4,
    resolved: 5,
  }[thread.status];
}

export function decisionStage(thread: Thread) {
  if (thread.status === "resolved") return 4;
  if (thread.status === "awaiting_arbitration") return 3;
  if (thread.status === "needs_clarification") return 1;
  return 2;
}
