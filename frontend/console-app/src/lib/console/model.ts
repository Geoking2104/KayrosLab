import { locale, t, tc, tk } from "@/lib/i18n";
export type Role = "contributeur" | "comex";
export type Page =
  | "overview"
  | "dossiers"
  | "collectifs"
  | "agents"
  | "connexions"
  | "espace"
  | "instruire"
  | "workbench"
  | "demo";
export type Verdict = "GO" | "CONDITIONAL_GO" | "NO_GO";
export type ThreadStatus =
  | "running"
  | "awaiting_arbitration"
  | "needs_clarification"
  | "resolved"
  | "failed";
export type Profile = "demo" | "fast" | "deep";
export type UseCase = "general" | "rfp" | "comex_decision" | "renewal" | "negotiation";
export type AgentKind = "metier" | "hybride" | "impersonator";
export type Voting = "majority" | "unanimous" | "veto_csuite";
export type CycleId =
  | "ecouter"
  | "cartographier"
  | "construire"
  | "positionner"
  | "eprouver"
  | "arbitrer"
  | "projeter"
  | "realiser";
export type ConnectorStatus = "connected" | "not_configured" | "error" | "disabled";
export type ConnectorId = "slack" | "teams" | "discord" | "salesforce";

export const SESSION_QUOTA = 3;
export const WORKSPACE_EMAIL = "camille.renaud@atelier.fr";
export const WORKSPACE_NAME = "Camille Renaud";

export const CYCLE: { id: CycleId; label: string; hint: string }[] = [
  { id: "ecouter", get label() { return t("Écouter"); }, get hint() { return t("Question comparable"); } },
  { id: "cartographier", get label() { return t("Cartographier"); }, get hint() { return t("Objections en tension"); } },
  { id: "construire", get label() { return t("Construire"); }, get hint() { return t("Scénarios et hypothèses"); } },
  { id: "positionner", get label() { return t("Positionner"); }, get hint() { return t("Faits et écarts"); } },
  { id: "eprouver", get label() { return t("Éprouver"); }, get hint() { return t("Avis contradictoires"); } },
  { id: "arbitrer", get label() { return t("Arbitrer"); }, get hint() { return t("Décision humaine"); } },
  { id: "projeter", get label() { return t("Projeter"); }, get hint() { return t("Conditions et suite"); } },
  { id: "realiser", get label() { return t("Réaliser"); }, get hint() { return t("Engagement tracé"); } },
];

export const PAGE_FROM_HASH: Record<string, Page> = {
  overview: "overview",
  dossiers: "dossiers",
  activity: "dossiers",
  collectifs: "collectifs",
  sessions: "collectifs",
  agents: "agents",
  connexions: "connexions",
  integrations: "connexions",
  settings: "connexions",
  espace: "espace",
  instruire: "instruire",
  workbench: "workbench",
  demo: "demo",
};

export const USE_CASES: { id: UseCase; label: string; oracle: boolean }[] = [
  { id: "general", get label() { return t("Décision générale"); }, oracle: false },
  { id: "rfp", get label() { return t("Appel d’offres"); }, oracle: true },
  { id: "comex_decision", get label() { return t("Décision de comité"); }, oracle: true },
  { id: "renewal", get label() { return t("Renouvellement"); }, oracle: true },
  { id: "negotiation", get label() { return t("Négociation"); }, oracle: true },
];

export const PROFILES: { id: Profile; label: string; hint: string; provider: string }[] = [
  { id: "demo", get label() { return t("Démo"); }, get hint() { return t("Réponses préenregistrées, moins de 5 s. Aucun appel modèle."); }, get provider() { return t("Démo préenregistrée"); } },
  { id: "fast", get label() { return t("Rapide"); }, get hint() { return t("Verdict réel en 1 à 2 min. Ici, le temps est raccourci pour la revue."); }, provider: "Mistral" },
  { id: "deep", get label() { return t("Approfondi"); }, get hint() { return t("Modèle de raisonnement, environ 12 min en production."); }, provider: "Mistral" },
];

export const VOTING: { id: Voting; label: string }[] = [
  { id: "majority", get label() { return t("Majorité"); } },
  { id: "unanimous", get label() { return t("Unanimité"); } },
  { id: "veto_csuite", get label() { return t("Veto du comité"); } },
];

export const STATUS_LABEL: Record<ThreadStatus, string> = {
  get running() { return t("Instruction en cours"); },
  get awaiting_arbitration() { return t("À arbitrer"); },
  get needs_clarification() { return t("Précision attendue"); },
  resolved: "Clos",
  get failed() { return t("Échec"); },
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  GO: "GO",
  get CONDITIONAL_GO() { return t("GO conditionnel"); },
  NO_GO: "NO-GO",
};

export const GUARDRAILS = [
  tk("La fiche est étiquetée Simulation."),
  tk("L’agent ne parle jamais à la place de la personne."),
  tk("Seuls les indices autorisés sont utilisés."),
  tk("L’usage est un test d’idée, pas une enquête."),
  tk("Aucune décision matérielle (embauche, crédit, logement, assurance)."),
];

export interface Agent {
  id: string;
  name: string;
  role: string;
  department: string;
  mission: string;
  kind: AgentKind;
  veto: boolean;
  enabled: boolean;
  provider: string;
  model: string;
  consented: boolean;
  simulation: boolean;
  clues: string;
  brief?: string;
}

export interface Collective {
  id: string;
  name: string;
  agentIds: string[];
  voting: Voting;
  personality: boolean;
  createdAt: string;
}

export interface Contribution {
  agentId: string;
  verdict: Verdict;
  strengths: string[];
  objections: string[];
  conditions: string[];
  metric: string;
}

export interface Evidence {
  name: string;
  type: string;
  text?: string;
  summary?: string;
  facts?: string[];
  questions?: string[];
}

export interface ThreadEvent {
  at: string;
  label: string;
  detail: string;
}

export interface Arbitration {
  action: "accept" | "conditions" | "reevaluate" | "override";
  by: string;
  note: string;
  at: string;
}

export interface Thread {
  id: string;
  question: string;
  collectiveId: string;
  status: ThreadStatus;
  verdict?: Verdict;
  profile: Profile;
  provider: string;
  useCase: UseCase;
  stage: CycleId;
  agentIds: string[];
  contributions: Contribution[];
  conditions: string[];
  questions: string[];
  humanReply?: string;
  evidence: Evidence[];
  arbitration?: Arbitration;
  progress: { done: number; total: number };
  createdAt: string;
  updatedAt: string;
  events: ThreadEvent[];
}

export interface Connector {
  id: ConnectorId;
  name: string;
  status: ConnectorStatus;
  enabled: boolean;
  oauthReady: boolean;
  detail: string;
  lastTest?: string;
  usersOnline?: number;
  usersTotal?: number;
  presence?: "live" | "idle" | "offline";
  options?: Record<string, string>;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  secret?: string;
  revealed: boolean;
  createdAt: string;
  collectiveIds: string[];
}

export interface Delivery {
  id: string;
  event: string;
  status: "delivered" | "failed";
  at: string;
}

export interface AppState {
  role: Role;
  agents: Agent[];
  collectives: Collective[];
  threads: Thread[];
  connectors: Connector[];
  keys: ApiKey[];
  deliveries: Delivery[];
  webhookSecret?: string;
  webhookRevealed: boolean;
  defaultProfile: Profile;
  selectedCollectiveId: string;
  guideSeen: boolean;
  guideAck: boolean[];
  notice?: { tone: "ok" | "warn" | "stop"; text: string };
}

const now = "2026-10-11T18:40:00.000Z";
const earlier = "2026-10-09T09:12:00.000Z";
const mid = "2026-10-10T14:05:00.000Z";

export const SEED_AGENTS: Agent[] = [
  {
    id: "ag-cfo",
    name: tk("Direction financière"),
    role: "CFO",
    department: "Finance",
    mission: tk("Protège la marge, la trésorerie et le plancher de prix."),
    kind: "metier",
    veto: false,
    enabled: true,
    provider: "Mistral",
    model: "serveur",
    consented: false,
    simulation: false,
    clues: "",
    brief: tk(
      "Chiffre la marge, la trésorerie et le plancher de prix. Refuse un GO si le seuil n’est pas écrit."
    ),
  },
  {
    id: "ag-legal",
    name: tk("Affaires juridiques"),
    role: "Legal",
    department: "Juridique",
    mission: tk("Bloque ce qui n’est pas opposable. Droit de veto."),
    kind: "metier",
    veto: true,
    enabled: true,
    provider: "Mistral",
    model: "serveur",
    consented: false,
    simulation: false,
    clues: "",
    brief: tk("Vérifie l’opposabilité. Veto si une clause ou une obligation manque."),
  },
  {
    id: "ag-cto",
    name: tk("Direction technique"),
    role: "CTO",
    department: tk("Ingénierie"),
    mission: tk("Juge la faisabilité, la dette et la capacité réelle."),
    kind: "metier",
    veto: false,
    enabled: true,
    provider: "Mistral",
    model: "serveur",
    consented: false,
    simulation: false,
    clues: "",
    brief: tk(
      "Juge la faisabilité, la dette et la capacité de l’équipe. Nomme ce qui ne tient pas en production."
    ),
  },
  {
    id: "ag-sales",
    name: tk("Direction commerciale"),
    role: "Sales",
    department: "Revenue",
    mission: tk("Défend la relation client et le revenu signable."),
    kind: "metier",
    veto: false,
    enabled: true,
    provider: "Mistral",
    model: "serveur",
    consented: false,
    simulation: false,
    clues: "",
    brief: tk(
      "Défend le revenu signable et la relation. Signale un prix ou un délai que le client ne tiendra pas."
    ),
  },
  {
    id: "ag-claire",
    name: "Claire Morel",
    role: tk("DAF simulée"),
    department: "Finance",
    mission: tk("Simule la lecture d’une DAF à partir d’un export autorisé."),
    kind: "hybride",
    veto: false,
    enabled: true,
    provider: "Mistral",
    model: "serveur",
    consented: true,
    simulation: true,
    clues: tk("Export Crystal autorisé · pas de scraping"),
  },
];

export function seedState(): AppState {
  return {
    role: "contributeur",
    agents: SEED_AGENTS,
    collectives: [
      {
        id: "col-deal",
        name: tk("Comité deal"),
        agentIds: ["ag-cfo", "ag-legal", "ag-cto", "ag-sales"],
        voting: "veto_csuite",
        personality: false,
        createdAt: earlier,
      },
      {
        id: "col-produit",
        name: tk("Comité produit"),
        agentIds: ["ag-cto", "ag-cfo", "ag-legal"],
        voting: "majority",
        personality: true,
        createdAt: mid,
      },
    ],
    threads: [
      {
        id: "dos-helia",
        question:
          tk(
            "Faut-il accepter la remise de 18 % demandée par Helia Industrie sur le contrat cadre 2027, contre un engagement de volume sur 24 mois ?"
          ),
        collectiveId: "col-deal",
        status: "awaiting_arbitration",
        verdict: "CONDITIONAL_GO",
        profile: "fast",
        provider: "Mistral",
        useCase: "negotiation",
        stage: "arbitrer",
        agentIds: ["ag-cfo", "ag-legal", "ag-cto", "ag-sales"],
        contributions: [
          {
            agentId: "ag-cfo",
            verdict: "CONDITIONAL_GO",
            strengths: [tk("L’engagement 24 mois sécurise le carnet.")],
            objections: [tk("18 % passe sous le plancher de marge historique (22 %).")],
            conditions: [tk("Plancher de marge à 22 % après remise, sinon refus.")],
            metric: tk("Marge après remise · 19,4 %"),
          },
          {
            agentId: "ag-legal",
            verdict: "CONDITIONAL_GO",
            strengths: [tk("Le cadre 2027 peut absorber un avenant court.")],
            objections: [tk("Sans pénalité de volume, l’engagement n’est pas opposable.")],
            conditions: [tk("Avenant signé avant facturation, pénalité si volume < 80 %.")],
            metric: tk("Veto · levé si avenant"),
          },
          {
            agentId: "ag-cto",
            verdict: "GO",
            strengths: [tk("Aucun développement spécifique. Charge d’intégration connue.")],
            objections: [tk("Le reporting volume n’est pas branché sur l’ERP.")],
            conditions: [tk("Suivi manuel accepté pendant 90 jours.")],
            metric: tk("Charge · 6 j"),
          },
          {
            agentId: "ag-sales",
            verdict: "GO",
            strengths: [tk("Helia est le compte n°2. Perdre le cadre ouvre un concurrent.")],
            objections: [tk("Une contre-offre à 12 % a déjà été refusée.")],
            conditions: [tk("Annoncer 15 % maintenant, 18 % seulement avec le volume tenu.")],
            metric: tk("ARR exposé · 240 k€"),
          },
        ],
        conditions: [
          tk("Plancher de marge à 22 % après remise."),
          tk("Avenant de volume avec pénalité sous 80 % de l’engagement."),
          tk("Signature de l’avenant avant toute facture remise."),
        ],
        questions: [],
        evidence: [
          { name: "Avenant-Helia-2027.pdf", type: "Contrat" },
          { name: "Grille-marge.xlsx", type: "Finance" },
        ],
        progress: { done: 4, total: 4 },
        createdAt: "2026-10-11T16:10:00.000Z",
        updatedAt: "2026-10-11T16:18:00.000Z",
        events: [
          { at: "2026-10-11T16:10:00.000Z", label: tk("Mission lancée"), detail: tk("Profil rapide · provider Mistral · swarm aligné") },
          { at: "2026-10-11T16:18:00.000Z", label: tk("Verdict produit"), detail: tk("GO conditionnel · en attente d’arbitrage, pas de boucle de précision") },
        ],
      },
      {
        id: "dos-pilote",
        question: tk(
          "Ouvrir un pilote B2B auprès de 12 cabinets, sur 90 jours, sans engagement commercial ?"
        ),
        collectiveId: "col-produit",
        status: "running",
        profile: "fast",
        provider: "Mistral",
        useCase: "general",
        stage: "eprouver",
        agentIds: ["ag-cto", "ag-cfo", "ag-legal"],
        contributions: [],
        conditions: [],
        questions: [],
        evidence: [],
        progress: { done: 1, total: 3 },
        createdAt: "2026-10-11T18:32:00.000Z",
        updatedAt: now,
        events: [{ at: "2026-10-11T18:32:00.000Z", label: tk("Mission lancée"), detail: tk("Comité produit · 1/3 analyses") }],
      },
      {
        id: "dos-vague",
        question: tk("On y va ?"),
        collectiveId: "col-deal",
        status: "needs_clarification",
        profile: "fast",
        provider: "Mistral",
        useCase: "general",
        stage: "ecouter",
        agentIds: ["ag-cfo", "ag-legal", "ag-sales"],
        contributions: [],
        conditions: [],
        questions: [tk(
          "Précisez l’objet, le montant ou l’écart, et l’échéance. La question n’est pas comparable."
        )],
        evidence: [],
        progress: { done: 1, total: 3 },
        createdAt: "2026-10-08T11:00:00.000Z",
        updatedAt: "2026-10-08T11:02:00.000Z",
        events: [
          { at: "2026-10-08T11:02:00.000Z", label: tk("Précision demandée"), detail: tk("Ce n’est pas un GO conditionnel. Le collectif s’arrête faute d’objet.") },
        ],
      },
      {
        id: "dos-qinode",
        question: tk(
          "Renouveler l’hébergement actuel ou basculer le nœud d’inférence sur une instance souveraine au prochain trimestre ?"
        ),
        collectiveId: "col-produit",
        status: "resolved",
        verdict: "GO",
        profile: "deep",
        provider: "Mistral",
        useCase: "comex_decision",
        stage: "realiser",
        agentIds: ["ag-cto", "ag-cfo", "ag-legal"],
        contributions: [
          {
            agentId: "ag-cto",
            verdict: "GO",
            strengths: [tk("Le chemin de bascule est déjà spécifié. Pas de réécriture du moteur.")],
            objections: [tk("La fenêtre de gel est de 4 heures.")],
            conditions: [tk("Basculer un tenant canari avant le reste.")],
            metric: tk("Fenêtre · 4 h"),
          },
          {
            agentId: "ag-cfo",
            verdict: "GO",
            strengths: [tk("Le surcoût tient dans l’enveloppe trimestre.")],
            objections: [tk("Le gain n’est pas un revenu, c’est un risque évité.")],
            conditions: [tk("Revue à 60 jours, sinon retour arrière documenté.")],
            metric: tk("Delta coût · +8 %"),
          },
          {
            agentId: "ag-legal",
            verdict: "GO",
            strengths: [tk("Le transfert reste dans l’UE. Registre à jour.")],
            objections: [],
            conditions: [],
            metric: tk("Veto · non levé contre"),
          },
        ],
        conditions: [tk("Canari sur un tenant, revue à 60 jours.")],
        questions: [],
        evidence: [{ name: "Note-souverainete.md", type: tk("Sécurité") }],
        arbitration: {
          action: "accept",
          by: "COMEX",
          note: tk("Consensus accepté. Canari d’abord."),
          at: "2026-10-10T15:40:00.000Z",
        },
        progress: { done: 3, total: 3 },
        createdAt: "2026-10-10T14:20:00.000Z",
        updatedAt: "2026-10-10T15:40:00.000Z",
        events: [
          { at: "2026-10-10T14:28:00.000Z", label: tk("Verdict produit"), detail: "GO" },
          { at: "2026-10-10T15:40:00.000Z", label: tk("Arbitrage"), detail: tk("Consensus accepté par le COMEX") },
        ],
      },
    ],
    connectors: [
      {
        id: "slack",
        name: "Slack",
        status: "connected",
        enabled: true,
        oauthReady: true,
        detail: tk(
          "Connexion en un geste. auth.test réussi. Le rattachement d’un canal se fait dans l’app de conversation, pas ici."
        ),
        lastTest: "2026-10-11T08:12:00.000Z",
        usersOnline: 12,
        usersTotal: 48,
        presence: "live",
        options: { canal: "#decisions", notify: "verdict" },
      },
      {
        id: "teams",
        name: "Microsoft Teams",
        status: "not_configured",
        enabled: false,
        oauthReady: false,
        detail: tk(
          "Exemple de démonstration. L’état réel s’affiche une fois connecté (variables serveur TEAMS_APP_ID et TEAMS_BOT_PASSWORD)."
        ),
      },
      {
        id: "discord",
        name: "Discord",
        status: "error",
        enabled: false,
        oauthReady: true,
        detail: tk(
          "Dernier test : users/@me a répondu 401. Le jeton est rejeté. Le secret n’est pas affiché."
        ),
        lastTest: "2026-10-07T19:02:00.000Z",
        presence: "offline",
        options: { serveur: "" },
      },
      {
        id: "salesforce",
        name: "Salesforce",
        status: "not_configured",
        enabled: false,
        oauthReady: false,
        detail: tk("Onboarding non terminé. Aucun secret n’est saisi dans le navigateur."),
        presence: "offline",
        options: {},
      },
    ],
    keys: [
      {
        id: "key-n8n",
        name: tk("n8n — atelier"),
        prefix: "kl_live_7f3a",
        revealed: true,
        createdAt: earlier,
        collectiveIds: ["col-deal"],
      },
    ],
    deliveries: [
      { id: "del-1", event: "mission.arbitrated", status: "delivered", at: "2026-10-10T15:41:00.000Z" },
      { id: "del-2", event: "mission.completed", status: "delivered", at: "2026-10-11T16:18:00.000Z" },
    ],
    webhookRevealed: true,
    defaultProfile: "fast",
    selectedCollectiveId: "col-deal",
    guideSeen: false,
    guideAck: [false, false, false, false],
  };
}

export function formatWhen(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function kindLabel(kind: AgentKind) {
  if (kind === "metier") return t("Métier");
  if (kind === "hybride") return t("Hybride");
  return t("Impersonator");
}

export function isManager(role: Role) {
  return role === "comex";
}

export function votingLabel(id: Voting) {
  return VOTING.find((item) => item.id === id)?.label ?? id;
}

export function useCaseLabel(id: UseCase) {
  return USE_CASES.find((item) => item.id === id)?.label ?? id;
}

export function stamp() {
  return new Date().toISOString();
}

export function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function toneOf(question: string, role: string): Verdict {
  const q = question.toLowerCase();
  if (/(abandon|renoncer|arrêter|stopper|refuser)/.test(q) && role !== "Sales") return "NO_GO";
  if (/(remise|ristourne|décote|rabais)/.test(q)) {
    if (role === "Sales" || role === "CTO") return "GO";
    return "CONDITIONAL_GO";
  }
  if (/(pilote|lancer|ouvrir|basculer|souverain)/.test(q)) return "GO";
  if (role === "Legal" || role === "CFO" || role === "DAF simulée") return "CONDITIONAL_GO";
  return "GO";
}

function briefContribution(agent: Agent, question: string): Contribution {
  const q = question.toLowerCase();
  let verdict: Verdict = "CONDITIONAL_GO";
  if (/(abandon|renoncer|arrêter|stopper|refuser)/.test(q)) verdict = "NO_GO";
  else if (/(pilote|lancer|ouvrir|basculer)/.test(q) && !agent.veto) verdict = "GO";
  const line = tc(agent.brief?.trim() || agent.mission).replace(/\.$/, "");
  return {
    agentId: agent.id,
    verdict,
    strengths: [t("{{department}} peut instruire : {{mission}}", {
      department: tc(agent.department),
      mission: tc(agent.mission)
    })],
    objections: verdict === "GO" ? [] : [t("{{role}} : {{line}}.", { role: tc(agent.role), line })],
    conditions: verdict === "CONDITIONAL_GO" ? [`${line}.`] : verdict === "NO_GO" ? [t("Ne pas engager tant que cette fonction n’a pas levé son objection.")] : [],
    metric: agent.veto && verdict !== "GO" ? t("Veto · disponible") : t("Avis · consultatif"),
  };
}

export function contributionFor(agent: Agent, question: string): Contribution {
  const verdict = toneOf(question, agent.role);
  const short = question.length > 140 ? `${question.slice(0, 136)}…` : question;
  if (agent.role === "CFO" || agent.role === "DAF simulée") {
    return {
      agentId: agent.id,
      verdict,
      strengths: [t("Le scénario est chiffrable à partir de la question posée.")],
      objections: verdict === "GO" ? [] : [t("Le gain n’est pas garanti sans plancher de marge ou revue datée.")],
      conditions: verdict === "CONDITIONAL_GO" ? [t("Fixer un plancher et une date de revue avant engagement.")] : [],
      metric: verdict === "NO_GO" ? t("Rentabilité · non tenue") : t("Revue · 60 jours"),
    };
  }
  if (agent.role === "Legal") {
    return {
      agentId: agent.id,
      verdict,
      strengths: [t("L’objet peut tenir dans un avenant, sans nouveau cadre.")],
      objections: verdict === "GO" ? [] : [t("Il manque une clause opposable (volume, délai ou réversibilité).")],
      conditions: verdict === "NO_GO" ? [t("Ne pas signer en l’état.")] : [t("Écrit opposable avant exécution.")],
      metric: agent.veto ? t("Veto · disponible") : t("Avis · consultatif"),
    };
  }
  if (agent.role === "CTO") {
    return {
      agentId: agent.id,
      verdict,
      strengths: [t("Pas de dépendance technique bloquante identifiée dans l’énoncé.")],
      objections: [t("La charge réelle n’est pas dans la question. Elle reste une hypothèse.")],
      conditions: verdict === "CONDITIONAL_GO" ? [t("Limiter le périmètre à un canari.")] : [],
      metric: t("Faisabilité · tenue"),
    };
  }
  if (agent.kind === "metier" && !["CFO", "Legal", "CTO", "Sales"].includes(agent.role)) {
    return briefContribution(agent, question);
  }
  return {
    agentId: agent.id,
    verdict,
    strengths: [t("La question est vendable telle quelle : « {{short}} »", {
      short
    })],
    objections: verdict === "NO_GO" ? [t("Le marché ne paiera pas cette version.")] : [],
    conditions: [],
    metric: t("Relation · exposée"),
  };
}

export function simulateMetier(agent: Agent, question: string) {
  const asked = question.trim();
  if (isVague(asked)) {
    return {
      status: "clarify" as const,
      ask: t(
        "Quelle décision, quel seuil, quel horizon ? {{name}} n’instruit pas une formule trop courte.",
        {
          name: tc(agent.name)
        }
      ),
    };
  }
  return {
    status: "ready" as const,
    contribution: contributionFor(agent, asked),
    provider: "Mistral" as const,
  };
}

export function isVague(question: string) {
  const words = question.trim().split(/\s+/).filter(Boolean);
  return words.length < 6;
}

export function simulateMeeting(agents: Agent[], question: string, voting: Voting, personality: boolean) {
  const asked = question.trim();
  if (isVague(asked)) {
    return {
      status: "clarify" as const,
      ask: t(
        "Quelle décision, quel seuil, quel horizon ? La réunion ne part pas sur une formule trop courte."
      ),
    };
  }
  const present = agents.filter((agent) => agent.enabled);
  if (present.length < 2) {
    return { status: "thin" as const, ask: t(
      "Une réunion compte au moins deux agents actifs. Réactivez-en un, ou complétez le collectif."
    ) };
  }
  const contributions = present.map((agent) => contributionFor(agent, asked));
  const turns = contributions.map((contribution, index) => {
    const agent = present[index];
    const previous = index > 0 ? contributions[index - 1] : undefined;
    const prevAgent = index > 0 ? present[index - 1] : undefined;
    const point = contribution.objections[0] || contribution.conditions[0] || contribution.strengths[0];
    const reply = !previous || !prevAgent
      ? point
      : previous.verdict === contribution.verdict
        ? t("D’accord avec {{role}} sur le sens. {{point}}", {
      role: tc(prevAgent.role),
      point
    })
        : t("Je ne suis pas {{role}}. {{point}}", {
      role: tc(prevAgent.role),
      point
    });
    const label = personality && agent.simulation ? t("Simulation étiquetée. ") : "";
    return {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      verdict: contribution.verdict,
      line: `${label}${reply}`,
    };
  });
  const room = settle(contributions, voting);
  return {
    status: "ready" as const,
    turns,
    verdict: room.verdict,
    conditions: room.conditions,
    absent: agents.filter((agent) => !agent.enabled).map((agent) => agent.name),
    provider: "Mistral" as const,
  };
}

export function admitToMeeting(
  meeting: Extract<ReturnType<typeof simulateMeeting>, { status: "ready" }>,
  agent: Agent,
  question: string,
  voting: Voting,
  personality: boolean,
  room: Agent[],
) {
  if (!agent.enabled) {
    return { ...meeting, absent: [...new Set([...meeting.absent, agent.name])] };
  }
  if (meeting.turns.some((turn) => turn.agentId === agent.id)) return meeting;
  const contribution = contributionFor(agent, question);
  const previous = meeting.turns[meeting.turns.length - 1];
  const point = contribution.objections[0] || contribution.conditions[0] || contribution.strengths[0];
  const reply = !previous
    ? point
    : previous.verdict === contribution.verdict
      ? t("Je rejoins la salle. D’accord avec {{role}} sur le sens. {{point}}", {
    role: tc(previous.role),
    point
  })
      : t("Je rejoins la salle. Je ne suis pas {{role}}. {{point}}", {
    role: tc(previous.role),
    point
  });
  const label = personality && agent.simulation ? t("Simulation étiquetée. ") : "";
  const turns = [
    ...meeting.turns,
    { agentId: agent.id, name: agent.name, role: agent.role, verdict: contribution.verdict, line: `${label}${reply}` },
  ];
  const present = room.filter((item) => item.enabled && turns.some((turn) => turn.agentId === item.id));
  const settled = settle(present.map((item) => contributionFor(item, question)), voting);
  return {
    ...meeting,
    turns,
    verdict: settled.verdict,
    conditions: settled.conditions,
    absent: room.filter((item) => !item.enabled).map((item) => item.name),
  };
}

export function settle(contributions: Contribution[], voting: Voting) {
  const verdicts = contributions.map((item) => item.verdict);
  const conditions = [...new Set(contributions.flatMap((item) => item.conditions))];
  const no = verdicts.filter((item) => item === "NO_GO").length;
  const go = verdicts.filter((item) => item === "GO").length;
  let verdict: Verdict = "GO";
  if (voting === "unanimous" && verdicts.some((item) => item !== "GO")) verdict = no ? "NO_GO" : "CONDITIONAL_GO";
  else if (voting === "veto_csuite" && contributions.some((item) => item.verdict === "NO_GO")) verdict = "NO_GO";
  else if (no > go) verdict = "NO_GO";
  else if (conditions.length || verdicts.includes("CONDITIONAL_GO")) verdict = "CONDITIONAL_GO";
  if (verdict === "GO") return { verdict, conditions: [] as string[] };
  if (verdict === "NO_GO") return { verdict, conditions };
  return { verdict, conditions };
}

export const HEALTH = [
  ["Moteur", "Mistral"],
  ["Orchestrateur", "Mistral"],
  ["Agents", "Mistral"],
  ["Swarm", "Mistral"],
] as const;

export const FOREIGN_SESSION = "Échange - Nietzsche";

export function registerAccount(email: string, tenantFromClient: string) {
  const clean = email.trim().toLowerCase();
  if (!clean.includes("@") || clean.startsWith("@")) {
    return { ok: false as const, reason: t("Adresse invalide. Rien n’est créé.") };
  }
  return {
    ok: true as const,
    email: clean,
    tenant: "default",
    ignored: tenantFromClient.trim(),
  };
}

export function refuseForeign(action: "run" | "message") {
  const what = action === "run" ? t("Aucune mission n’est lancée.") : t("Aucun message n’est enregistré.");
  return {
    ok: false as const,
    status: 403,
    reason: t(
      "403 — « {{FOREIGN_SESSION}} » appartient à un autre compte du tenant. {{what}}",
      {
        FOREIGN_SESSION: tc(FOREIGN_SESSION),
        what
      }
    ),
  };
}

export function hybridCount(agents: Agent[]) {
  return agents.filter((agent) => agent.consented && (agent.kind === "hybride" || agent.kind === "impersonator" || agent.simulation)).length;
}
