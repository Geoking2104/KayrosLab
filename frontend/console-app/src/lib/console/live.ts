// Correspondance entre les objets de l’API console et le modèle de l’interface.
// En mode connecté, agents, collectifs (sessions) et dossiers (fils) viennent
// de l’API ; le mode Démo garde l’état local préenregistré.
import {
  defaultSettings,
  type Agent,
  type AgentSettings,
  type Collective,
  type Contribution,
  type Thread,
  type ThreadStatus,
  type Verdict,
  type Voting,
} from "./model";

export interface Company { id: string; name: string; sector: string; description: string; created_at?: string }
export interface Project {
  id: string; company_id: string; name: string; goal: string; owner: string;
  status: "draft" | "active" | "paused" | "closed"; due_date: string;
  session_ids: string[]; thread_ids: string[]; stakeholders: Stakeholder[];
  graph?: GraphSpec | null;
}
export type StakeholderRole = "decideur" | "sponsor" | "consulte" | "informe";
export interface Stakeholder { name: string; role: StakeholderRole; title: string; email: string }
export type NodeType = "question" | "collectif" | "agent" | "porte" | "arbitrage" | "notification" | "decision";
export interface GraphSpecNode {
  id: string; type: NodeType; label: string;
  config: { session_id?: string; agent_id?: string; threshold?: Voting; min_go?: number; veto?: boolean; strict?: boolean; exclude?: boolean; pause?: boolean; role?: StakeholderRole };
  /** Position libre choisie par glisser-déposer (sinon mise en page automatique). */
  x?: number; y?: number;
}
export interface GraphSpec { nodes: GraphSpecNode[]; edges: { from: string; to: string }[] }
export interface SkillVersion { version: number; at?: string; by?: string; name: string; description: string; instructions: string; tools: string[] }
export interface Skill { id: string; name: string; description: string; instructions: string; tools: string[]; agent_ids: string[]; session_ids: string[]; version?: number; versions?: SkillVersion[] }
export interface ContextSource {
  id: string; name: string; kind: "note" | "document" | "url" | "policy"; content: string; url: string; agent_ids: string[]; session_ids: string[];
  company_id?: string; project_id?: string; node_id?: string;
}
export type MemberRole = "admin" | "comex" | "contributeur" | "lecteur";
export interface Member { id: string; email: string; name: string; role: MemberRole; status?: "active" | "invited"; invite_status?: "sent" | "queued" | "failed"; invited_at?: string }
export interface Workspace { companies: Company[]; projects: Project[]; skills: Skill[]; contexts: ContextSource[]; members: Member[] }
export const EMPTY_WORKSPACE: Workspace = { companies: [], projects: [], skills: [], contexts: [], members: [] };

const VOTING_TO_API: Record<Voting, string> = { majority: "majority", unanimous: "unanimous", veto_csuite: "veto_power_csuite" };
const VOTING_FROM_API: Record<string, Voting> = { majority: "majority", unanimous: "unanimous", veto_power_csuite: "veto_csuite" };
export const votingToApi = (voting: Voting) => VOTING_TO_API[voting];

export function agentKind(a: any): Agent["kind"] {
  if (a.impersonator || a.metadata?.impersonator) return "impersonator";
  if (a.hybrid || a.human_profile) return "hybride";
  return "metier";
}

export function fromApiAgent(a: any): Agent {
  const rules = a.rule_configuration || {};
  const settings: AgentSettings = {
    ...defaultSettings(),
    seniority: a.seniority || "senior",
    primaryFocus: a.primary_focus || "",
    constraints: a.constraints || [],
    tools: a.tools || [],
    channels: a.connectors || [],
    provider: a.provider || "",
    model: a.model || "",
    rules: (rules.user_added_rules || []).map((r: any) => (typeof r === "string" ? r : r.rule_text)).filter(Boolean),
    systemRules: (rules.system_proposed_rules || []).map((r: any) => ({ id: r.rule_id, text: r.rule_text, status: r.status || "active" })),
    modifiedRules: rules.user_modified_rules || [],
  };
  return {
    id: a.agent_id,
    name: a.display_name || a.role_name || a.agent_id,
    role: a.role_name || "",
    department: a.department || "",
    mission: a.mission || a.primary_focus || "",
    kind: agentKind(a),
    veto: Boolean(a.veto_power),
    enabled: a.enabled !== false,
    provider: a.provider || "serveur",
    model: a.model || "serveur",
    consented: Boolean(a.human_profile),
    simulation: Boolean(a.impersonator || a.metadata?.impersonator),
    clues: (a.metadata?.impersonator?.clues || []).join(" · "),
    brief: a.instructions || "",
    settings,
    skillIds: (a.metadata?.skills || []).map((s: any) => s.skill_id),
    contextIds: (a.metadata?.context_sources || []).map((s: any) => s.context_id),
    humanProfile: a.human_profile || undefined,
  };
}

export function slugId(name: string): string {
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  const head = /^[a-z]/.test(base) ? base : `agent_${base}`;
  return `${head}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 64);
}

/** Corps de création ou de modification attendu par /v1/console/agents. */
export function toApiAgent(agent: Pick<Agent, "name" | "role" | "department" | "mission" | "veto" | "enabled" | "brief" | "settings">): Record<string, unknown> {
  const s = agent.settings ?? defaultSettings();
  const body: Record<string, unknown> = {
    display_name: agent.name.trim(),
    role_name: agent.role.trim() || agent.name.trim(),
    department: agent.department.trim() || "General",
    mission: agent.mission.trim(),
    instructions: agent.brief?.trim() ?? "",
    veto_power: agent.veto,
    enabled: agent.enabled,
    seniority: s.seniority,
    primary_focus: s.primaryFocus.trim() || agent.mission.trim(),
    constraints: s.constraints,
    tools: s.tools,
    connectors: s.channels,
    // L’API remplace rule_configuration en entier : on renvoie aussi les règles système.
    rule_configuration: {
      system_proposed_rules: (s.systemRules ?? []).map((r) => ({ rule_id: r.id, rule_text: r.text, status: r.status })),
      user_added_rules: s.rules,
      user_modified_rules: s.modifiedRules ?? [],
    },
  };
  if (s.provider) body.provider = s.provider;
  if (s.model.trim()) body.model = s.model.trim();
  return body;
}

export function fromApiSession(s: any): Collective {
  const c = s.collective || {};
  return {
    id: s.session_id,
    name: s.name,
    agentIds: c.active_agents || (c.agents || []).map((a: any) => a.agent_id),
    voting: VOTING_FROM_API[c.voting_threshold] || "majority",
    personality: Boolean(c.personality_simulation_enabled),
    createdAt: s.created_at,
  };
}

const STATUS: Record<string, ThreadStatus> = {
  running: "running", awaiting_arbitration: "awaiting_arbitration", needs_clarification: "needs_clarification",
  resolved: "resolved", arbitrated: "resolved", completed: "resolved", failed: "failed", cancelled: "failed",
};

function short(at: string) {
  try { return new Date(at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }); } catch { return at; }
}

export function fromApiThread(t: any): Thread {
  const messages: any[] = t.messages || [];
  const runs = messages.filter((m) => m.run);
  const run = runs.length ? runs[runs.length - 1].run : null;
  const analyses: any[] = Array.isArray(run?.analyses) ? run.analyses : [];
  const contributions: Contribution[] = analyses.map((a) => ({
    agentId: a.agent_id,
    verdict: (a.verdict || "CONDITIONAL_GO") as Verdict,
    strengths: a.strengths_opportunities || [],
    objections: a.critical_risks || [],
    conditions: a.required_mitigations || [],
    metric: a.metrics?.[0] ? `${a.metrics[0].metric} : ${a.metrics[0].value}` : "",
    ...(a.persona_confidence ? { persona: {
      confidence: a.persona_confidence,
      feedback: a.simulated_stakeholder_feedback || undefined,
      voiceSource: a.persona_voice_fallback ? "deterministic" as const : "model" as const,
      score: a.persona_voice_score?.score,
    } } : {}),
  }));
  const agentIds = run?.configuration?.active_agents || contributions.map((c) => c.agentId);
  const status = STATUS[t.status] || "running";
  const decision = run?.human_decision;
  const human = [...messages].reverse().find((m) => m.role === "human" && m.kind !== "question");
  return {
    id: t.thread_id,
    question: t.question,
    collectiveId: t.room_id,
    status,
    verdict: run?.consensus?.verdict,
    profile: t.profile || "demo",
    provider: run?.llm?.provider || analyses[0]?.llm_provider || "serveur",
    useCase: "general",
    stage: status === "running" ? "eprouver" : status === "needs_clarification" ? "ecouter" : status === "resolved" ? "projeter" : "arbitrer",
    agentIds,
    contributions,
    conditions: [...new Set(contributions.flatMap((c) => c.conditions))],
    questions: t.clarification_questions || [],
    humanReply: human?.text,
    evidence: [],
    arbitration: decision ? { action: decision.action === "override_veto" ? "override" : decision.action === "reevaluate" ? "reevaluate" : "accept", by: decision.by || decision.decided_by || "", note: decision.justification || "", at: decision.at || decision.decided_at || t.updated_at } : undefined,
    progress: t.progress ? { done: t.progress.done ?? t.progress.completed ?? 0, total: t.progress.total ?? Math.max(agentIds.length, 1) } : { done: status === "running" ? 0 : agentIds.length, total: Math.max(agentIds.length, 1) },
    gates: t.gate_evaluation ? {
      status: t.gate_evaluation.status, verdict: t.gate_evaluation.verdict,
      results: (t.gate_evaluation.results || []).map((r: any) => ({ gateId: r.gate_id, projectId: r.project_id, status: r.status, share: r.share, reasons: r.reasons || [] })),
    } : undefined,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    events: messages.map((m) => ({
      at: short(m.created_at),
      label: m.role === "human" ? (m.kind === "question" ? "Question" : "Message") : m.run ? "Verdict produit" : "Collectif",
      detail: m.text || (m.run?.consensus ? `${m.run.consensus.verdict} · ${m.run.consensus.rationale || ""}` : ""),
    })),
  };
}

/** Enchaînement de collectifs le long du graphe d'un projet. */
export type PipelineStepStatus = "pending" | "running" | "completed" | "blocked" | "overridden" | "failed" | "awaiting_approval" | "approved" | "halted";
export type PipelineStep = {
  node_id: string; label: string; session_id: string; deps?: string[]; status: PipelineStepStatus; thread_id: string | null; verdict: string | null;
  gates?: { gate_id: string; label: string; status: string; reasons: string[] }[];
  agents?: { added: string[]; removed: string[]; error: string | null } | null;
  override?: { by: string; justification: string; at: string }; approval?: { by: string; comment: string | null; at: string }; halted?: { by_gate_of?: string; by_cancel?: string; thread_id: string | null; at: string }; error?: string | null;
};
export type Pipeline = {
  id: string; project_id: string; question: string; status: "running" | "blocked" | "awaiting_approval" | "completed" | "failed" | "cancelled";
  pause_between?: boolean; current: number; steps: PipelineStep[]; created_by?: string; created_at?: string;
};
