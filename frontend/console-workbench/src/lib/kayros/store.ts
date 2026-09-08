import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { uid } from "@/lib/utils";
import { laneToStatus, type BoardLane } from "./board";
import {
  aggregateVerdict,
  applyGate,
  bisociate,
  challenge,
  computeKI,
  forecastSeries,
  listenSignals,
  mapOntology,
  measuredKpis,
  nextStage,
  projectRoadmap,
  reactivateIdea,
  runOracle,
  scoreNovelty,
  swarmConsensus,
  weightedVotes,
} from "./engine";
import { SEED } from "./seed";
import { SPECS } from "./specs";
import type {
  Agent,
  CycleEvent,
  FeatureFlags,
  GateDecision,
  Idea,
  KIWeights,
  Locale,
  MemoryLayer,
  StageId,
  StatusId,
  Swarm,
  TechnicalScores,
  ViewId,
  Workspace,
} from "./types";

function enrich(w: Workspace): Workspace {
  const ideas = w.ideas.map((idea) => {
    if (idea.collisions.length && idea.ontology.nodes.length) return idea;
    const collisions = scoreNovelty(
      idea.collisions.length ? idea.collisions : bisociate(idea, 4),
      `${idea.title} ${idea.brief}`,
      w.memory.map((m) => m.text),
    );
    const withCol = { ...idea, collisions };
    return {
      ...withCol,
      signals: idea.signals.length ? idea.signals : listenSignals(idea),
      ontology: idea.ontology.nodes.length ? idea.ontology : mapOntology(withCol, w.memory),
      attacks: idea.attacks.length ? idea.attacks : challenge(idea),
    };
  });
  return { ...w, ideas, specs: w.specs.length ? w.specs : SPECS };
}

const INITIAL = enrich(SEED);

type KayrosState = Workspace & {
  hydrated: boolean;
  setHydrated: () => void;
  setView: (view: ViewId) => void;
  setLocale: (locale: Locale) => void;
  setTenant: (name: string) => void;
  toggleEdit: () => void;
  dismissGuide: () => void;
  selectIdea: (id: string | null) => void;
  selectAgent: (id: string | null) => void;
  updateIdea: (id: string, patch: Partial<Idea>) => void;
  updateIdeaKi: (id: string, technical: TechnicalScores) => void;
  addIdea: () => void;
  setIdeaStage: (id: string, stage: StageId) => void;
  setIdeaStatus: (id: string, status: StatusId) => void;
  assignLane: (id: string, lane: BoardLane) => boolean;
  reactivate: (id: string) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  addAgent: () => void;
  updateStep: (id: StageId, patch: Partial<Workspace["steps"][number]>) => void;
  updateFact: (id: string, text: string) => void;
  addFact: (layer: MemoryLayer, text: string) => void;
  promoteFact: (id: string) => void;
  removeFact: (id: string) => void;
  resolveGate: (id: string, decision: GateDecision, reason: string) => void;
  setFlag: (key: keyof FeatureFlags, value: boolean) => void;
  setKiWeights: (weights: KIWeights) => void;
  setSpec: (id: string, patch: { titleFr?: string; bodyFr?: string; titleEn?: string; bodyEn?: string }) => void;
  updateConnector: (platform: Workspace["connectors"][number]["platform"], patch: Partial<Workspace["connectors"][number]>) => void;
  testConnector: (platform: Workspace["connectors"][number]["platform"]) => void;
  toggleMcp: (id: string) => void;
  toggleAdapter: (id: string) => void;
  runOracleCase: (id: string) => void;
  runSwarm: (id: string, question?: string) => void;
  arbitrateSwarm: (id: string, action: "accept_consensus" | "override_veto" | "reevaluate", justification: string) => void;
  toggleSwarmMember: (swarmId: string, agentId: string) => void;
  updateSwarm: (id: string, patch: Partial<Swarm>) => void;
  advanceCycle: () => void;
  startCycle: () => void;
  resetCycle: () => void;
  applyCollisions: (ideaId: string, collisions: Idea["collisions"]) => void;
  exportJson: () => string;
  importJson: (raw: string) => void;
  resetSeed: () => void;
};

function ideaBy(state: Workspace, id: string | null) {
  return state.ideas.find((i) => i.id === (id || state.selectedIdeaId)) ?? state.ideas[0];
}

function pushEvent(state: KayrosState, ev: Omit<CycleEvent, "id" | "ts">): CycleEvent {
  return { id: uid("ev"), ts: new Date().toISOString(), ...ev };
}

export const useKayros = create<KayrosState>()(
  persist(
    (set, get) => ({
      ...INITIAL,
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      setView: (view) => set({ view }),
      setLocale: (locale) => set({ locale }),
      setTenant: (tenantName) => set({ tenantName }),
      toggleEdit: () => set({ editEverything: !get().editEverything }),
      dismissGuide: () => set({ guideDismissed: true }),
      selectIdea: (selectedIdeaId) => set({ selectedIdeaId, inspectorOpen: true }),
      selectAgent: (selectedAgentId) => set({ selectedAgentId, view: "swarms" }),
      updateIdea: (id, patch) =>
        set({
          ideas: get().ideas.map((i) => (i.id === id ? { ...i, ...patch, updatedAt: new Date().toISOString() } : i)),
        }),
      updateIdeaKi: (id, technical) => {
        const ki = computeKI(technical, get().kiWeights);
        get().updateIdea(id, { ki });
      },
      addIdea: () => {
        const id = uid("idea");
        const idea: Idea = {
          id,
          title: "Nouvelle idée",
          brief: "Signal faible à structurer.",
          constraints: ["Arbitrage humain"],
          category: "general",
          author: "Console",
          stage: "recueillir",
          status: "nouveau",
          ki: computeKI({ global: 5, velocite: 5, divergence: 5, fiabilite: 5, impact: 5, originalite: 5 }, get().kiWeights),
          signals: [],
          collisions: [],
          ontology: { nodes: [], edges: [] },
          attacks: [],
          votes: [],
          roadmap: [],
          forecast: forecastSeries([10, 11, 12, 12, 13, 14, 15, 16, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29], 8, 2),
          kpis: [],
          dormant: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: [{ ts: new Date().toISOString(), type: "created", detail: "Créée depuis la console" }],
        };
        set({ ideas: [idea, ...get().ideas], selectedIdeaId: id, view: "board" });
      },
      setIdeaStage: (id, stage) => get().updateIdea(id, { stage }),
      setIdeaStatus: (id, status) =>
        get().updateIdea(id, {
          status,
          dormant: status === "en_pause" || status === "consideration_future" || status === "non_poursuivi",
        }),
      assignLane: (id, lane) => {
        const idea = get().ideas.find((i) => i.id === id);
        if (!idea) return false;
        if (lane === "done" && idea.kpis.length === 0 && idea.status !== "termine") {
          return false;
        }
        const status = laneToStatus(lane, idea);
        const dormant = lane === "backlog" ? idea.dormant : false;
        get().updateIdea(id, { status, dormant });
        set({ selectedIdeaId: id });
        return true;
      },
      reactivate: (id) =>
        set({
          ideas: get().ideas.map((i) => (i.id === id ? reactivateIdea(i) : i)),
          selectedIdeaId: id,
        }),
      updateAgent: (id, patch) =>
        set({
          agents: get().agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        }),
      addAgent: () => {
        const id = uid("agent");
        set({
          agents: [
            ...get().agents,
            {
              id,
              displayName: "Nouvel expert",
              role: "Expert",
              department: "Métier",
              seniority: "senior",
              mission: "Apporter un regard expert.",
              instructions: "",
              constraints: [],
              rules: [],
              tools: [],
              connectors: ["console"],
              provider: "ollama",
              model: "llama3.1:8b-instruct",
              quant: "q4_K_M",
              enabled: true,
              vetoPower: false,
              kind: "custom",
              consent: false,
            },
          ],
          selectedAgentId: id,
        });
      },
      updateStep: (id, patch) =>
        set({
          steps: get().steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        }),
      updateFact: (id, text) =>
        set({ memory: get().memory.map((m) => (m.id === id ? { ...m, text } : m)) }),
      addFact: (layer, text) =>
        set({
          memory: [
            {
              id: uid("mem"),
              layer,
              text,
              source: "console",
              ideaId: get().selectedIdeaId ?? undefined,
              createdAt: new Date().toISOString(),
            },
            ...get().memory,
          ],
        }),
      promoteFact: (id) => {
        const order: MemoryLayer[] = ["L0", "L1", "L2", "L3"];
        set({
          memory: get().memory.map((m) => {
            if (m.id !== id) return m;
            const i = order.indexOf(m.layer);
            return { ...m, layer: order[Math.min(i + 1, 3)] };
          }),
        });
      },
      removeFact: (id) => set({ memory: get().memory.filter((m) => m.id !== id) }),
      resolveGate: (id, decision, reason) => {
        const gate = get().gates.find((g) => g.id === id);
        if (!gate) return;
        const ideas = get().ideas.map((idea) =>
          idea.id === gate.ideaId ? applyGate(idea, gate, decision, reason) : idea,
        );
        set({
          ideas,
          gates: get().gates.map((g) =>
            g.id === id
              ? {
                  ...g,
                  status: "resolved",
                  decision,
                  reason,
                  resolvedAt: new Date().toISOString(),
                  resolvedBy: "humain",
                }
              : g,
          ),
          cycle: get().cycle
            ? {
                ...get().cycle!,
                status: decision === "approve" ? "running" : decision === "revise" ? "running" : "done",
                currentStage: decision === "approve" ? "projeter" : decision === "revise" ? "eprouver" : get().cycle!.currentStage,
                events: [
                  ...get().cycle!.events,
                  pushEvent(get(), { type: "final", text: `Porte ${decision} · ${reason}` }),
                ],
              }
            : get().cycle,
          view: decision === "approve" ? "board" : "inbox",
        });
        if (decision === "approve") {
          const idea = ideas.find((i) => i.id === gate.ideaId);
          if (idea) get().setIdeaStage(idea.id, "projeter");
        }
      },
      setFlag: (key, value) => set({ flags: { ...get().flags, [key]: value } }),
      setKiWeights: (kiWeights) => {
        set({ kiWeights });
        set({
          ideas: get().ideas.map((idea) => ({
            ...idea,
            ki: computeKI(idea.ki.technical, kiWeights),
          })),
        });
      },
      setSpec: (id, patch) =>
        set({
          specs: get().specs.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        }),
      updateConnector: (platform, patch) =>
        set({
          connectors: get().connectors.map((c) => (c.platform === platform ? { ...c, ...patch } : c)),
        }),
      testConnector: (platform) =>
        set({
          connectors: get().connectors.map((c) =>
            c.platform === platform
              ? { ...c, status: "connected", lastTest: new Date().toISOString(), enabled: true }
              : c,
          ),
        }),
      toggleMcp: (id) =>
        set({
          mcpTools: get().mcpTools.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)),
        }),
      toggleAdapter: (id) =>
        set({
          adapters: get().adapters.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)),
        }),
      runOracleCase: (id) => {
        const state = get();
        const cas = state.oracleCases.find((c) => c.id === id);
        const idea = ideaBy(state, state.selectedIdeaId);
        if (!cas || !idea) return;
        const committeeAgents = cas.committee
          .map((c) => state.agents.find((a) => a.id === c.agentId))
          .filter(Boolean) as Agent[];
        const votes = weightedVotes(idea, committeeAgents);
        set({
          oracleCases: state.oracleCases.map((c) => (c.id === id ? runOracle({ ...c }, votes) : c)),
          ideas: state.ideas.map((i) => (i.id === idea.id ? { ...i, votes } : i)),
          view: "oracle",
        });
      },
      updateSwarm: (id, patch) =>
        set({
          swarms: get().swarms.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        }),
      toggleSwarmMember: (swarmId, agentId) => {
        set({
          swarms: get().swarms.map((s) => {
            if (s.id !== swarmId) return s;
            const has = s.agentIds.includes(agentId);
            if (has && s.agentIds.length <= 1) return s;
            return {
              ...s,
              agentIds: has ? s.agentIds.filter((id) => id !== agentId) : [...s.agentIds, agentId],
            };
          }),
        });
      },
      runSwarm: (id, question) => {
        const state = get();
        const swarm = state.swarms.find((s) => s.id === id);
        const idea = ideaBy(state, state.selectedIdeaId);
        if (!swarm || !idea) return;
        const members = swarm.agentIds
          .map((agentId) => state.agents.find((a) => a.id === agentId))
          .filter((a): a is Agent => Boolean(a?.enabled));
        const votes = weightedVotes(idea, members);
        const agg = swarmConsensus(votes, members, swarm.votingThreshold ?? "majority");
        const lastRun = {
          labelled: "SIMULATION" as const,
          question: question?.trim() || idea.title,
          votes,
          verdict: agg.verdict,
          vetoPath: agg.vetoPath,
          rationale: agg.rationale,
          threshold: swarm.votingThreshold ?? "majority",
          status: "pending_human_arbitration" as const,
        };
        set({
          swarms: state.swarms.map((s) =>
            s.id === id
              ? { ...s, lastRunAt: new Date().toISOString(), lastVerdict: agg.verdict, lastRun }
              : s,
          ),
          ideas: state.ideas.map((i) => (i.id === idea.id ? { ...i, votes } : i)),
          view: "swarms",
        });
      },
      arbitrateSwarm: (id, action, justification) => {
        const state = get();
        const swarm = state.swarms.find((s) => s.id === id);
        const run = swarm?.lastRun;
        if (!swarm || !run || run.status !== "pending_human_arbitration") return;
        if (action === "override_veto" && !justification.trim()) return;
        const human = {
          action,
          by: "humain",
          justification: justification.trim(),
          at: new Date().toISOString(),
        };
        let status: NonNullable<Swarm["lastRun"]>["status"] = run.status;
        let verdict = run.verdict;
        if (action === "reevaluate") {
          status = "reevaluation_requested";
        } else if (action === "override_veto") {
          status = "overridden_human";
          verdict = verdict === "NO_GO" ? "CONDITIONAL_GO" : "GO";
        } else {
          status =
            run.verdict === "GO" ? "approved_human" : run.verdict === "NO_GO" ? "rejected_human" : "conditional_human";
        }
        set({
          swarms: state.swarms.map((s) =>
            s.id === id
              ? {
                  ...s,
                  lastVerdict: action === "reevaluate" ? s.lastVerdict : verdict,
                  lastRun: { ...run, verdict, status, human },
                }
              : s,
          ),
        });
      },
      startCycle: () => {
        const state = get();
        const idea = ideaBy(state, state.selectedIdeaId);
        if (!idea) return;
        const first = state.steps.find((s) => s.enabled)?.id ?? "recueillir";
        const ev = pushEvent(state, {
          type: "start",
          stage: first,
          text: `Cycle ouvert · ${idea.title}`,
        });
        set({
          cycle: {
            id: uid("run"),
            ideaId: idea.id,
            status: "running",
            currentStage: first,
            events: [
              pushEvent(state, { type: "meta", text: `tenant ${state.tenantName}` }),
              ev,
              pushEvent(state, {
                type: "recall",
                text: `Recall L1–L3 · ${state.memory.length} faits`,
              }),
            ],
            startedAt: new Date().toISOString(),
          },
          selectedIdeaId: idea.id,
          view: "board",
          ideas: state.ideas.map((i) =>
            i.id === idea.id
              ? {
                  ...i,
                  stage: first,
                  status: i.status === "nouveau" ? "en_revue" : i.status,
                  history: [...i.history, { ts: new Date().toISOString(), type: "cycle", detail: "start" }],
                }
              : i,
          ),
        });
      },
      advanceCycle: () => {
        const state = get();
        const cycle = state.cycle;
        if (!cycle || cycle.status === "done" || cycle.status === "gated") return;
        const idea = ideaBy(state, cycle.ideaId);
        if (!idea) return;
        const stage = cycle.currentStage ?? "recueillir";
        const step = state.steps.find((s) => s.id === stage);
        const agent = state.agents.find((a) => a.id === step?.agentId);
        let nextIdea = { ...idea };
        const events: CycleEvent[] = [];

        if (stage === "ecouter") {
          nextIdea.signals = listenSignals(idea);
          events.push(pushEvent(state, { type: "trace", stage, agent: agent?.displayName, text: `${nextIdea.signals.length} signaux qualifiés` }));
        } else if (stage === "construire") {
          const raw = bisociate(idea, 4);
          nextIdea.collisions = scoreNovelty(
            raw,
            `${idea.title} ${idea.brief}`,
            state.memory.map((m) => m.text),
          );
          events.push(pushEvent(state, { type: "trace", stage, agent: agent?.displayName, text: `${nextIdea.collisions.length} collisions + signatures` }));
        } else if (stage === "cartographier" || stage === "positionner") {
          nextIdea.ontology = mapOntology(nextIdea, state.memory);
          events.push(
            pushEvent(state, {
              type: stage === "positionner" ? "positionning" : "trace",
              stage,
              agent: agent?.displayName,
              text: `${nextIdea.ontology.nodes.length} nœuds · faits L1 injectés`,
            }),
          );
        } else if (stage === "eprouver") {
          nextIdea.attacks = challenge(idea);
          events.push(pushEvent(state, { type: "trace", stage, agent: agent?.displayName, text: `${nextIdea.attacks.length} attaques` }));
        } else if (stage === "arbitrer") {
          const voters = state.agents.filter((a) => a.enabled && (a.vetoPower || a.id === "synthesizer" || a.id === "cfo" || a.id === "critic"));
          nextIdea.votes = weightedVotes(idea, voters);
          const agg = aggregateVerdict(nextIdea.votes);
          const gateId = uid("gate");
          nextIdea.gateId = gateId;
          events.push(pushEvent(state, { type: "synthesis", stage, text: `Consensus ${agg.verdict}` }));
          events.push(pushEvent(state, { type: "gate", stage, text: "Porte humaine ouverte" }));
          set({
            gates: [
              {
                id: gateId,
                ideaId: idea.id,
                status: "open",
                openedAt: new Date().toISOString(),
                votes: nextIdea.votes,
              },
              ...state.gates,
            ],
            cycle: {
              ...cycle,
              status: "gated",
              events: [...cycle.events, ...events],
              currentStage: stage,
            },
            ideas: state.ideas.map((i) => (i.id === idea.id ? { ...nextIdea, status: "en_revue" } : i)),
            view: "inbox",
          });
          return;
        } else if (stage === "projeter") {
          nextIdea.roadmap = projectRoadmap(idea);
          nextIdea.forecast = forecastSeries(
            idea.forecast.history.map((h) => h.value),
            8,
            idea.title.length,
          );
          events.push(pushEvent(state, { type: "trace", stage, text: `Roadmap ${nextIdea.roadmap.length} jalons · forecast ${nextIdea.forecast.labelled}` }));
        } else if (stage === "realiser") {
          const fc = idea.forecast.p50.length
            ? idea.forecast
            : forecastSeries(
                idea.forecast.history.map((h) => h.value),
                8,
                4,
              );
          nextIdea.forecast = fc;
          nextIdea.kpis = measuredKpis(nextIdea, fc);
          nextIdea.status = "termine";
          events.push(pushEvent(state, { type: "final", stage, text: "Impact mesuré" }));
          events.push(pushEvent(state, { type: "done", stage, text: "Cycle clos · feedback KPI → Écouter" }));
          set({
            ideas: state.ideas.map((i) => (i.id === idea.id ? nextIdea : i)),
            cycle: {
              ...cycle,
              status: "done",
              currentStage: "realiser",
              finishedAt: new Date().toISOString(),
              events: [...cycle.events, ...events],
            },
            memory: [
              {
                id: uid("mem"),
                layer: "L2",
                text: `Scénario mesuré · KI ${nextIdea.ki.global} · hit ${nextIdea.kpis.find((k) => k.name.includes("Hit"))?.actual ?? "—"}`,
                source: "execute",
                ideaId: idea.id,
                createdAt: new Date().toISOString(),
              },
              ...state.memory,
            ],
            view: "result",
          });
          return;
        } else {
          events.push(pushEvent(state, { type: "trace", stage, agent: agent?.displayName, text: step ? (state.locale === "fr" ? step.roleFr : step.roleEn) : stage }));
        }

        let nxt = nextStage(stage);
        while (nxt && !state.steps.find((s) => s.id === nxt)?.enabled) nxt = nextStage(nxt);
        set({
          ideas: state.ideas.map((i) => (i.id === idea.id ? { ...nextIdea, stage: nxt ?? stage } : i)),
          cycle: {
            ...cycle,
            currentStage: nxt ?? stage,
            status: nxt ? "running" : "done",
            events: [...cycle.events, ...events],
            finishedAt: nxt ? cycle.finishedAt : new Date().toISOString(),
          },
        });
      },
      resetCycle: () => set({ cycle: null }),
      applyCollisions: (ideaId, collisions) => {
        const state = get();
        const scored = scoreNovelty(
          collisions,
          ideaBy(state, ideaId)?.title ?? "",
          state.memory.map((m) => m.text),
        );
        get().updateIdea(ideaId, { collisions: scored });
      },
      exportJson: () => {
        const s = get();
        const { hydrated: _h, ...rest } = s;
        const dump: Record<string, unknown> = {};
        (Object.keys(SEED) as (keyof Workspace)[]).forEach((k) => {
          dump[k] = rest[k];
        });
        return JSON.stringify(dump, null, 2);
      },
      importJson: (raw) => {
        const parsed = JSON.parse(raw) as Workspace;
        if (!parsed.ideas || !parsed.steps) throw new Error("Workspace invalide");
        set({ ...enrich({ ...SEED, ...parsed }), hydrated: true });
      },
      resetSeed: () => set({ ...enrich(SEED), cycle: null, hydrated: true }),
    }),
    {
      name: "kayros-console-v4",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => {
        const out: Partial<Workspace> = {};
        (Object.keys(SEED) as (keyof Workspace)[]).forEach((k) => {
          (out as Record<string, unknown>)[k] = s[k];
        });
        return out as Workspace;
      },
    },
  ),
);

export function currentIdea(state: Workspace) {
  return ideaBy(state, state.selectedIdeaId);
}
