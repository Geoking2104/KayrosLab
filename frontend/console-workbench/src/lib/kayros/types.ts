export type Locale = "fr" | "en";

export type ViewId =
  | "board"
  | "inbox"
  | "guide"
  | "matrix"
  | "cycle"
  | "portfolio"
  | "memory"
  | "governance"
  | "novelty"
  | "positioner"
  | "swarms"
  | "oracle"
  | "forecast"
  | "connectors"
  | "mcp"
  | "studio"
  | "specs"
  | "result";

export type StageId =
  | "recueillir"
  | "ecouter"
  | "cartographier"
  | "construire"
  | "positionner"
  | "eprouver"
  | "arbitrer"
  | "projeter"
  | "realiser";

export type StatusId =
  | "nouveau"
  | "en_revue"
  | "discussion"
  | "en_developpement"
  | "termine"
  | "non_poursuivi"
  | "consideration_future"
  | "en_pause";

export type GateDecision = "approve" | "reject" | "revise";
export type OracleVerdict = "GO" | "CONDITIONAL_GO" | "NO_GO";
export type MemoryLayer = "L0" | "L1" | "L2" | "L3";
export type ConnectorPlatform = "slack" | "teams" | "discord";
export type ConnectorStatus = "missing" | "configured" | "tested" | "connected" | "error" | "disabled";

export interface StepDef {
  id: StageId;
  n: string;
  fr: string;
  en: string;
  roleFr: string;
  roleEn: string;
  outputFr: string;
  outputEn: string;
  agentId: string;
  enabled: boolean;
  durationMs: number;
}

export interface TechnicalScores {
  global: number;
  velocite: number;
  divergence: number;
  fiabilite: number;
  impact: number;
  originalite: number;
}

export interface StrategicScores {
  fitStrategique: number;
  desirabilite: number;
  faisabilite: number;
  viabilite: number;
  adaptabilite: number;
}

export interface KIWeights {
  fitStrategique: Partial<Record<keyof TechnicalScores, number>>;
  desirabilite: Partial<Record<keyof TechnicalScores, number>>;
  faisabilite: Partial<Record<keyof TechnicalScores, number>>;
  viabilite: Partial<Record<keyof TechnicalScores, number>>;
  adaptabilite: Partial<Record<keyof TechnicalScores, number>>;
}

export interface KI {
  technical: TechnicalScores;
  strategic: StrategicScores;
  global: number;
}

export interface Collision {
  id: string;
  framework: string;
  mechanism: string;
  proposal: string;
  bridge: string;
  signature: string;
  novelty: number;
  noveltyScore: number;
  noveltyBreakdown: { batch: number; memory: number; input: number };
  nearDuplicate: boolean;
}

export interface Signal {
  id: string;
  text: string;
  weight: number;
  source: string;
}

export interface OntologyNode {
  id: string;
  label: string;
  kind: "idea" | "competitor" | "concept" | "gap" | "bridge";
  x: number;
  y: number;
}

export interface OntologyEdge {
  id: string;
  from: string;
  to: string;
  rel: string;
}

export interface Attack {
  id: string;
  agent: string;
  claim: string;
  risk: string;
  mitigation: string;
  severity: number;
}

export interface Vote {
  agentId: string;
  weight: number;
  verdict: OracleVerdict;
  reason: string;
}

export interface Gate {
  id: string;
  ideaId: string;
  status: "open" | "resolved";
  openedAt: string;
  votes: Vote[];
  decision?: GateDecision;
  reason?: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface Milestone {
  id: string;
  title: string;
  week: number;
  owner: string;
  done: boolean;
}

export interface KpiPoint {
  t: string;
  value: number;
}

export interface Forecast {
  kpi: string;
  history: KpiPoint[];
  horizon: number;
  p10: number[];
  p50: number[];
  p90: number[];
  actuals: number[];
  labelled: "SIMULATION";
  uncertaintyRatio: number;
  needsReview: boolean;
}

export interface Idea {
  id: string;
  title: string;
  brief: string;
  constraints: string[];
  category: string;
  author: string;
  stage: StageId;
  status: StatusId;
  ki: KI;
  signals: Signal[];
  collisions: Collision[];
  ontology: { nodes: OntologyNode[]; edges: OntologyEdge[] };
  attacks: Attack[];
  votes: Vote[];
  gateId?: string;
  roadmap: Milestone[];
  forecast: Forecast;
  kpis: { name: string; target: number; actual: number; unit: string }[];
  dormant: boolean;
  createdAt: string;
  updatedAt: string;
  history: { ts: string; type: string; detail: string }[];
}

export interface Agent {
  id: string;
  displayName: string;
  role: string;
  department: string;
  seniority: "intern" | "junior" | "senior" | "executive";
  mission: string;
  instructions: string;
  constraints: string[];
  rules: string[];
  tools: string[];
  connectors: string[];
  provider: string;
  model: string;
  quant: string;
  enabled: boolean;
  vetoPower: boolean;
  kind: "system" | "custom" | "hybrid";
  consent: boolean;
  personality?: {
    source: "linkedin" | "crystal" | "structured";
    provenance: string;
    disc?: string;
    notes: string;
  };
}

export type VotingThreshold = "unanimous" | "majority" | "veto_power_csuite";
export type SwarmRunStatus =
  | "pending_human_arbitration"
  | "approved_human"
  | "rejected_human"
  | "conditional_human"
  | "overridden_human"
  | "reevaluation_requested";

export interface SwarmRun {
  labelled: "SIMULATION";
  question: string;
  votes: Vote[];
  verdict: OracleVerdict;
  vetoPath: string[];
  rationale: string;
  threshold: VotingThreshold;
  status: SwarmRunStatus;
  human?: { action: string; by: string; justification: string; at: string };
}

export interface Swarm {
  id: string;
  name: string;
  agentIds: string[];
  purpose: string;
  votingThreshold: VotingThreshold;
  personalityEnabled: boolean;
  lastRunAt?: string;
  lastVerdict?: OracleVerdict;
  lastRun?: SwarmRun;
}

export interface MemoryFact {
  id: string;
  layer: MemoryLayer;
  text: string;
  source: string;
  ideaId?: string;
  createdAt: string;
}

export interface Connector {
  platform: ConnectorPlatform;
  status: ConnectorStatus;
  enabled: boolean;
  rooms: number;
  fields: Record<string, string>;
  webhook: string;
  lastTest?: string;
}

export interface McpTool {
  id: string;
  name: string;
  scope: string;
  description: string;
  enabled: boolean;
}

export interface OracleCase {
  id: string;
  name: string;
  useCase: "comex_decision" | "rfp" | "renewal" | "negotiation";
  question: string;
  committee: { agentId: string; veto: boolean }[];
  evidence: string[];
  result?: {
    verdict: OracleVerdict;
    labelled: "SIMULATION";
    vetoPath: string[];
    objections: string[];
    evidenceGaps: string[];
    conditions: string[];
  };
}

export interface CycleEvent {
  id: string;
  ts: string;
  type:
    | "meta"
    | "start"
    | "recall"
    | "positionning"
    | "trace"
    | "distill"
    | "synthesis"
    | "gate"
    | "final"
    | "done";
  stage?: StageId;
  agent?: string;
  text: string;
}

export interface CycleRun {
  id: string;
  ideaId: string;
  status: "idle" | "running" | "gated" | "done";
  currentStage?: StageId;
  events: CycleEvent[];
  startedAt?: string;
  finishedAt?: string;
}

export interface FeatureFlags {
  sseLive: boolean;
  layeredMemory: boolean;
  noveltyEngine: boolean;
  kayrosSignature: boolean;
  positioner: boolean;
  quantLlm: boolean;
  specializedSwarms: boolean;
  personality: boolean;
  salesOracle: boolean;
  mcpPortal: boolean;
  chatConnectors: boolean;
  portfolioUx: boolean;
  timesfm: boolean;
  adaptersV16: boolean;
}

export interface SpecSection {
  id: string;
  kind: "functional" | "technical";
  titleFr: string;
  titleEn: string;
  bodyFr: string;
  bodyEn: string;
  linkedView?: ViewId;
}

export interface Workspace {
  tenantName: string;
  locale: Locale;
  view: ViewId;
  selectedIdeaId: string | null;
  selectedAgentId: string | null;
  selectedGateId: string | null;
  selectedFactId: string | null;
  inspectorOpen: boolean;
  editEverything: boolean;
  guideDismissed: boolean;
  steps: StepDef[];
  ideas: Idea[];
  agents: Agent[];
  swarms: Swarm[];
  memory: MemoryFact[];
  gates: Gate[];
  connectors: Connector[];
  mcpTools: McpTool[];
  oracleCases: OracleCase[];
  cycle: CycleRun | null;
  kiWeights: KIWeights;
  flags: FeatureFlags;
  specs: SpecSection[];
  adapters: { id: string; name: string; enabled: boolean; note: string }[];
}
