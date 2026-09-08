import type { CycleRun, Idea, StatusId } from "./types";

export type BoardLane = "backlog" | "cycle" | "gate" | "done";

export const LANES: { id: BoardLane; fr: string; en: string; hintFr: string; hintEn: string }[] = [
  {
    id: "backlog",
    fr: "À traiter",
    en: "Backlog",
    hintFr: "Idées nouvelles ou en pause. Déposez, ou créez-en une.",
    hintEn: "New or parked ideas. Drop here, or create one.",
  },
  {
    id: "cycle",
    fr: "En cycle",
    en: "In cycle",
    hintFr: "L'essaim travaille. Le jeton avance de Recueillir à Éprouver.",
    hintEn: "The swarm is working. The token moves Intake → Challenge.",
  },
  {
    id: "gate",
    fr: "À arbitrer",
    en: "Review",
    hintFr: "Porte humaine. Vote instruit, veto décide.",
    hintEn: "Human gate. Vote instructs, veto decides.",
  },
  {
    id: "done",
    fr: "Mesuré",
    en: "Measured",
    hintFr: "Cycle clos. KPI observé, pas une slide.",
    hintEn: "Cycle closed. Observed KPI, not a slide.",
  },
];

export function ideaLane(idea: Idea, cycle: CycleRun | null): BoardLane {
  if (idea.status === "termine") return "done";
  if (
    idea.dormant ||
    idea.status === "en_pause" ||
    idea.status === "non_poursuivi" ||
    idea.status === "consideration_future"
  ) {
    return "backlog";
  }
  if (cycle?.ideaId === idea.id && cycle.status === "gated") return "gate";
  if (idea.status === "en_revue") return "gate";
  if (cycle?.ideaId === idea.id && cycle.status === "running") return "cycle";
  if (idea.status === "en_developpement" || idea.status === "discussion") return "cycle";
  return "backlog";
}

export function laneToStatus(lane: BoardLane, idea: Idea): StatusId {
  if (lane === "backlog") {
    if (idea.dormant) return idea.status;
    return "nouveau";
  }
  if (lane === "cycle") return "en_developpement";
  if (lane === "gate") return "en_revue";
  return "termine";
}
