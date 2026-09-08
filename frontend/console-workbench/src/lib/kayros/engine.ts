import { clamp, hashString, uid } from "@/lib/utils";
import type {
  Attack,
  Collision,
  Forecast,
  Gate,
  Idea,
  KI,
  KIWeights,
  MemoryFact,
  OntologyEdge,
  OntologyNode,
  OracleCase,
  Signal,
  StageId,
  StrategicScores,
  TechnicalScores,
  Vote,
} from "./types";

export const STAGES: StageId[] = [
  "recueillir",
  "ecouter",
  "cartographier",
  "construire",
  "positionner",
  "eprouver",
  "arbitrer",
  "projeter",
  "realiser",
];

export const DEFAULT_WEIGHTS: KIWeights = {
  fitStrategique: { global: 0.5, impact: 0.5 },
  desirabilite: { impact: 0.6, originalite: 0.4 },
  faisabilite: { fiabilite: 0.7, velocite: 0.3 },
  viabilite: { global: 0.4, fiabilite: 0.6 },
  adaptabilite: { divergence: 0.5, originalite: 0.5 },
};

export const FRAMEWORKS = [
  { name: "Comité d'achat", mechanism: "Veto séquentiel par fonction" },
  { name: "Stage-gate", mechanism: "Porte pondérée, vote instruit, veto décide" },
  { name: "Mémoire stratifiée", mechanism: "Faits atomiques promus vers normes" },
  { name: "DePIN énergétique", mechanism: "Preuve de livraison pair-à-pair" },
  { name: "Observatoire sémantique", mechanism: "Graphe d'ontologie + distances" },
  { name: "Red team", mechanism: "Attaque contradictoire avant arbitrage" },
  { name: "Forecast isolé", mechanism: "Bandes P10–P90 labellisées SIMULATION" },
  { name: "Atelier gouverné", mechanism: "Essaim d'agents à règles explicites" },
];

export function embed(text: string, dim = 24): number[] {
  const v = new Array(dim).fill(0);
  const tokens = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9àâäéèêëïîôùûüç]+/i)
    .filter(Boolean);
  for (const t of tokens) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
    const i = Math.abs(h) % dim;
    v[i] += 1;
    v[(i + 7) % dim] += 0.35;
    v[(i + 13) % dim] += 0.15;
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export function cosine(a: number[], b: number[]) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function toStrategic(technical: TechnicalScores, weights: KIWeights = DEFAULT_WEIGHTS): StrategicScores {
  const out = {} as StrategicScores;
  (Object.keys(weights) as (keyof KIWeights)[]).forEach((dim) => {
    const w = weights[dim] || {};
    let sum = 0;
    let wsum = 0;
    (Object.entries(w) as [keyof TechnicalScores, number][]).forEach(([tech, coef]) => {
      sum += (technical[tech] ?? 0) * coef;
      wsum += coef;
    });
    out[dim] = clamp(wsum > 0 ? sum / wsum : 0, 0, 10);
  });
  return out;
}

export function strategicGlobal(s: StrategicScores) {
  const vals = Object.values(s);
  return clamp(vals.reduce((a, b) => a + b, 0) / vals.length, 0, 10);
}

export function computeKI(technical: TechnicalScores, weights: KIWeights = DEFAULT_WEIGHTS): KI {
  const strategic = toStrategic(technical, weights);
  return { technical, strategic, global: +strategicGlobal(strategic).toFixed(2) };
}

export function scoreNovelty(
  collisions: Collision[],
  inputText: string,
  memoryTexts: string[],
  weights = { batch: 0.4, memory: 0.4, input: 0.2 },
): Collision[] {
  const items = collisions.map((c) => ({
    ...c,
    embedding: embed(`${c.framework} ${c.mechanism} ${c.proposal} ${c.bridge}`),
  }));
  const inputEmbedding = embed(inputText);
  const memoryHits = memoryTexts.map((t) => embed(t));

  const scored = items.map((item, idx) => {
    let maxBatch = 0;
    items.forEach((other, j) => {
      if (j === idx) return;
      maxBatch = Math.max(maxBatch, cosine(item.embedding, other.embedding));
    });
    const D_batch = 1 - maxBatch;
    let maxMem = 0;
    memoryHits.forEach((m) => {
      maxMem = Math.max(maxMem, cosine(item.embedding, m));
    });
    const D_memory = memoryHits.length ? 1 - maxMem : 0.5;
    const D_input = 1 - cosine(item.embedding, inputEmbedding);
    const novelty = clamp(weights.batch * D_batch + weights.memory * D_memory + weights.input * D_input, 0, 1);
    return {
      ...item,
      novelty,
      noveltyScore: Math.round(novelty * 100),
      noveltyBreakdown: {
        batch: +D_batch.toFixed(3),
        memory: +D_memory.toFixed(3),
        input: +D_input.toFixed(3),
      },
      nearDuplicate: maxBatch >= 0.82,
    };
  });

  return scored
    .sort((a, b) => b.novelty - a.novelty)
    .map(({ embedding: _e, ...rest }) => rest);
}

export function makeSignature(framework: string, mechanism: string, target: string) {
  return `${mechanism} de « ${framework} » transféré vers ${target}`;
}

export function bisociate(idea: Idea, count = 4): Collision[] {
  const seed = hashString(idea.id + idea.title);
  const target = idea.title;
  const used = new Set<number>();
  const out: Collision[] = [];
  for (let i = 0; i < count; i++) {
    let idx = (seed + i * 7) % FRAMEWORKS.length;
    while (used.has(idx)) idx = (idx + 1) % FRAMEWORKS.length;
    used.add(idx);
    const fw = FRAMEWORKS[idx];
    const alt = FRAMEWORKS[(idx + 3) % FRAMEWORKS.length];
    const proposal = `${idea.title} : appliquer « ${fw.mechanism} » comme le ferait ${fw.name}, croisé avec ${alt.name}.`;
    const bridge = makeSignature(fw.name, fw.mechanism, target);
    out.push({
      id: uid("col"),
      framework: fw.name,
      mechanism: fw.mechanism,
      proposal,
      bridge,
      signature: bridge,
      novelty: 0,
      noveltyScore: 0,
      noveltyBreakdown: { batch: 0, memory: 0, input: 0 },
      nearDuplicate: false,
    });
  }
  return out;
}

export function listenSignals(idea: Idea): Signal[] {
  const raw = [idea.brief, ...idea.constraints, idea.category];
  return raw.filter(Boolean).map((text, i) => ({
    id: uid("sig"),
    text,
    weight: clamp(8 - i * 1.2 + (hashString(text) % 20) / 10, 1, 10),
    source: i === 0 ? "brief" : "contrainte",
  }));
}

export function mapOntology(idea: Idea, memory: MemoryFact[]): { nodes: OntologyNode[]; edges: OntologyEdge[] } {
  const nodes: OntologyNode[] = [
    { id: "idea", label: idea.title, kind: "idea", x: 50, y: 48 },
  ];
  const edges: OntologyEdge[] = [];
  const competitors = ["Brightidea", "Wazoku", "Qmarkets", "Hype"];
  competitors.forEach((c, i) => {
    const ang = (Math.PI * 2 * i) / competitors.length - Math.PI / 2;
    nodes.push({
      id: `c${i}`,
      label: c,
      kind: "competitor",
      x: 50 + Math.cos(ang) * 32,
      y: 48 + Math.sin(ang) * 34,
    });
    edges.push({ id: `e-c${i}`, from: "idea", to: `c${i}`, rel: "veille" });
  });
  idea.collisions.slice(0, 3).forEach((col, i) => {
    nodes.push({
      id: col.id,
      label: col.framework,
      kind: "bridge",
      x: 18 + i * 32,
      y: 82,
    });
    edges.push({ id: `e-b${i}`, from: "idea", to: col.id, rel: "signature" });
  });
  memory
    .filter((m) => m.layer === "L1")
    .slice(0, 3)
    .forEach((m, i) => {
      nodes.push({
        id: m.id,
        label: m.text.slice(0, 28),
        kind: "concept",
        x: 16 + i * 34,
        y: 16,
      });
      edges.push({ id: `e-m${i}`, from: m.id, to: "idea", rel: "fait" });
    });
  nodes.push({ id: "gap", label: "Gap gouvernance", kind: "gap", x: 84, y: 18 });
  edges.push({ id: "e-gap", from: "idea", to: "gap", rel: "opportunité" });
  return { nodes, edges };
}

export function challenge(idea: Idea): Attack[] {
  const agents = ["Critic", "Devil's Advocate", "Red Team"];
  const templates = [
    {
      claim: "Le comité réel n'a pas les mêmes règles que l'essaim simulé.",
      risk: "Fausse confiance, GO conditionnel mal calibré.",
      mitigation: "Labelliser SIMULATION et exiger l'arbitrage humain.",
    },
    {
      claim: "Les embeddings mock sous-estiment les quasi-doublons.",
      risk: "Portfolio pollué par des collisions proches.",
      mitigation: "Filtre 0.82 + revue manuelle des signatures.",
    },
    {
      claim: "TimesFM hors-ligne produit des bandes trop étroites.",
      risk: "Décision sur une incertitude sous-évaluée.",
      mitigation: "Seuil d'uncertainty ratio + revue obligatoire.",
    },
  ];
  return templates.map((t, i) => ({
    id: uid("atk"),
    agent: agents[i],
    ...t,
    severity: 6 + ((hashString(idea.id + t.claim) % 40) / 10),
  }));
}

export function weightedVotes(idea: Idea, agents: { id: string; displayName: string; vetoPower: boolean; department: string }[]): Vote[] {
  return agents.map((a) => {
    const h = hashString(idea.id + a.id);
    const score = (h % 100) / 10;
    const verdict: Vote["verdict"] = a.vetoPower && score < 4 ? "NO_GO" : score > 7 ? "GO" : "CONDITIONAL_GO";
    return {
      agentId: a.id,
      weight: a.vetoPower ? 2.5 : a.department === "Finance" ? 1.6 : 1,
      verdict,
      reason:
        verdict === "NO_GO"
          ? "Veto : preuve insuffisante sur le chemin d'objection."
          : verdict === "GO"
            ? "Fit stratégique et faisabilité alignés."
            : "GO sous conditions : evidencer le veto path avant envoi.",
    };
  });
}

export function swarmConsensus(
  votes: Vote[],
  agents: { id: string; vetoPower: boolean; seniority: string }[],
  threshold: "unanimous" | "majority" | "veto_power_csuite" = "majority",
): { verdict: Vote["verdict"]; veto: boolean; rationale: string; vetoPath: string[] } {
  if (!votes.length) {
    return { verdict: "CONDITIONAL_GO", veto: false, rationale: "Aucun agent actif.", vetoPath: [] };
  }
  const byId = new Map(agents.map((a) => [a.id, a]));
  const explicit = votes.find((v) => v.verdict === "NO_GO" && byId.get(v.agentId)?.vetoPower);
  const csuite =
    threshold === "veto_power_csuite"
      ? votes.find((v) => v.verdict === "NO_GO" && byId.get(v.agentId)?.seniority === "executive")
      : undefined;
  const blocker = explicit ?? csuite;
  if (blocker) {
    return {
      verdict: "NO_GO",
      veto: true,
      rationale: `Veto bloquant · ${blocker.agentId}`,
      vetoPath: [blocker.agentId],
    };
  }
  const go = votes.filter((v) => v.verdict === "GO").length;
  const nogo = votes.filter((v) => v.verdict === "NO_GO").length;
  const nogoPath = votes.filter((v) => v.verdict === "NO_GO").map((v) => v.agentId);
  if (threshold === "unanimous") {
    if (go === votes.length) return { verdict: "GO", veto: false, rationale: "Unanimité GO.", vetoPath: [] };
    if (nogo > 0) return { verdict: "NO_GO", veto: false, rationale: "Unanimité rompue.", vetoPath: nogoPath };
    return { verdict: "CONDITIONAL_GO", veto: false, rationale: "Unanimité conditionnelle.", vetoPath: [] };
  }
  if (go > votes.length / 2) return { verdict: "GO", veto: false, rationale: "Majorité stricte GO.", vetoPath: [] };
  if (nogo > votes.length / 2) return { verdict: "NO_GO", veto: false, rationale: "Majorité stricte NO_GO.", vetoPath: nogoPath };
  return { verdict: "CONDITIONAL_GO", veto: false, rationale: "Pas de majorité stricte · arbitrage humain.", vetoPath: [] };
}

export function aggregateVerdict(votes: Vote[]): { verdict: Vote["verdict"]; score: number; veto: boolean } {
  const veto = votes.some((v) => v.verdict === "NO_GO" && v.weight >= 2);
  if (veto) return { verdict: "NO_GO", score: 0, veto: true };
  let go = 0;
  let cond = 0;
  let total = 0;
  votes.forEach((v) => {
    total += v.weight;
    if (v.verdict === "GO") go += v.weight;
    if (v.verdict === "CONDITIONAL_GO") cond += v.weight;
  });
  if (go / total >= 0.55) return { verdict: "GO", score: go / total, veto: false };
  return { verdict: "CONDITIONAL_GO", score: (go + cond) / total, veto: false };
}

export function forecastSeries(history: number[], horizon = 8, seed = 1): Forecast {
  const n = history.length;
  const last = history[n - 1] ?? 0;
  const deltas = history.slice(1).map((v, i) => v - history[i]);
  const drift = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
  const resid = deltas.map((d) => d - drift);
  const std = Math.sqrt(resid.reduce((s, x) => s + x * x, 0) / Math.max(resid.length, 1)) || last * 0.08;
  const p50: number[] = [];
  const p10: number[] = [];
  const p90: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const mean = last + drift * h;
    const band = std * Math.sqrt(h) * 1.28;
    p50.push(+mean.toFixed(2));
    p10.push(+Math.max(0, mean - band).toFixed(2));
    p90.push(+(mean + band).toFixed(2));
  }
  const span = p90[p90.length - 1] - p10[p10.length - 1];
  const uncertaintyRatio = span / Math.max(p50[p50.length - 1], 1);
  const actuals = p50.map((v, i) => {
    const wobble = ((Math.sin(seed + i * 1.7) + 1) / 2) * 0.18 - 0.04;
    return +Math.max(0, v * (1 + wobble)).toFixed(2);
  });
  return {
    kpi: "adoption",
    history: history.map((value, i) => ({ t: `S-${history.length - i}`, value })),
    horizon,
    p10,
    p50,
    p90,
    actuals,
    labelled: "SIMULATION",
    uncertaintyRatio: +uncertaintyRatio.toFixed(3),
    needsReview: uncertaintyRatio > 0.45,
  };
}

export function projectRoadmap(idea: Idea) {
  return [
    { id: uid("ms"), title: "Canevas d'intake verrouillé", week: 1, owner: "Planner", done: true },
    { id: uid("ms"), title: "Essaim Sales Oracle calibré", week: 3, owner: "Comex", done: false },
    { id: uid("ms"), title: "Porte humaine + motif Slack", week: 5, owner: "Gouvernance", done: false },
    { id: uid("ms"), title: "KPI mesurés en revue", week: 8, owner: "Ops", done: false },
  ].map((m, i) => ({ ...m, title: `${idea.title.slice(0, 18)} · ${m.title}`, week: m.week + i }));
}

export function measuredKpis(idea: Idea, forecast: Forecast) {
  const lastActual = forecast.actuals[forecast.actuals.length - 1] ?? 0;
  const lastP50 = forecast.p50[forecast.p50.length - 1] ?? 1;
  const hit = lastActual / Math.max(lastP50, 1);
  return [
    { name: "KI stratégique", target: 7.5, actual: idea.ki.global, unit: "/10" },
    { name: "Novelty max", target: 70, actual: Math.max(...idea.collisions.map((c) => c.noveltyScore), 0), unit: "%" },
    { name: "Adoption (P50)", target: lastP50, actual: lastActual, unit: "idx" },
    { name: "Hit ratio forecast", target: 1, actual: +hit.toFixed(2), unit: "×" },
  ];
}

export function applyGate(idea: Idea, gate: Gate, decision: Gate["decision"], reason: string): Idea {
  const status =
    decision === "approve" ? "en_developpement" : decision === "reject" ? "non_poursuivi" : "en_revue";
  const stage: StageId = decision === "approve" ? "projeter" : decision === "revise" ? "eprouver" : idea.stage;
  return {
    ...idea,
    status,
    stage,
    dormant: decision === "reject",
    updatedAt: new Date().toISOString(),
    history: [
      ...idea.history,
      { ts: new Date().toISOString(), type: "gate", detail: `${decision} · ${reason}` },
    ],
  };
}

export function reactivateIdea(idea: Idea): Idea {
  return {
    ...idea,
    status: "en_revue",
    dormant: false,
    stage: "eprouver",
    updatedAt: new Date().toISOString(),
    history: [...idea.history, { ts: new Date().toISOString(), type: "reactivate", detail: "Idée dormante réactivée" }],
  };
}

export function runOracle(cas: OracleCase, votes: Vote[]): OracleCase {
  const agg = aggregateVerdict(votes);
  const vetoPath = votes.filter((v) => v.verdict === "NO_GO").map((v) => v.agentId);
  const objections = votes.filter((v) => v.verdict !== "GO").map((v) => v.reason);
  const evidenceGaps = [
    "Preuve de veto path non citée dans le corpus",
    "Conditions de GO non chiffrées",
    cas.evidence.length < 3 ? "Corpus trop mince (< 3 sources)" : "Couverture corpus acceptable",
  ];
  const conditions =
    agg.verdict === "CONDITIONAL_GO"
      ? ["Joindre le dossier d'objections", "Arbitrage humain obligatoire", "Labelliser SIMULATION"]
      : agg.verdict === "GO"
        ? ["Conserver l'audit trail"]
        : ["Ne pas envoyer la proposition", "Revenir en Challenge"];
  return {
    ...cas,
    result: {
      verdict: agg.verdict,
      labelled: "SIMULATION",
      vetoPath,
      objections,
      evidenceGaps,
      conditions,
    },
  };
}

export function nextStage(stage: StageId): StageId | null {
  const i = STAGES.indexOf(stage);
  if (i < 0 || i >= STAGES.length - 1) return null;
  return STAGES[i + 1];
}

export function emptyTechnical(): TechnicalScores {
  return { global: 6, velocite: 6, divergence: 6, fiabilite: 6, impact: 6, originalite: 6 };
}
