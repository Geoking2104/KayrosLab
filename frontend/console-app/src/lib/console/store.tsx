import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  contributionFor,
  hybridCount,
  isVague,
  seedState,
  SESSION_QUOTA,
  settle,
  stamp,
  uid,
  WORKSPACE_EMAIL,
  type Agent,
  type AppState,
  type Collective,
  type Evidence,
  type Profile,
  type Role,
  type Thread,
  type UseCase,
  type Voting,
} from "./model";

const KEY = "kayros-console-cx-v1";

type DraftMission = {
  question: string;
  collectiveId: string;
  profile: Profile;
  useCase: UseCase;
  evidence: Evidence[];
  agentIds?: string[];
};

type Store = {
  state: AppState;
  setRole: (role: Role) => void;
  dismissGuide: () => void;
  ackGuide: (index: number, checked: boolean) => void;
  replayGuide: () => void;
  clearNotice: () => void;
  selectCollective: (id: string) => void;
  createCollective: (input: { name: string; agentIds: string[]; voting: Voting; personality: boolean }) => { ok: true; id: string } | { ok: false; reason: string };
  addAgentToCollective: (collectiveId: string, agentId: string) => void;
  updateCollective: (id: string, patch: { name?: string; voting?: Voting; personality?: boolean; removeAgentId?: string }) => { ok: boolean; reason?: string };
  setAgentEnabled: (agentId: string, enabled: boolean) => { ok: boolean; reason?: string };
  createAgent: (agent: Omit<Agent, "id" | "provider" | "model">) => { ok: boolean; reason?: string; id?: string };
  updateAgent: (id: string, agent: Omit<Agent, "id" | "provider" | "model" | "kind">) => { ok: boolean; reason?: string };
  createImpersonatorTeam: (names: string[], clues: string) => { ok: boolean; reason?: string; collectiveId?: string };
  startMission: (draft: DraftMission) => string;
  addAgentToThread: (threadId: string, agentId: string) => { ok: boolean; reason?: string };
  removeAgentFromThread: (threadId: string, agentId: string) => { ok: boolean; reason?: string };
  deleteThread: (threadId: string) => { ok: boolean; reason?: string };
  attachReading: (threadId: string, file: Evidence) => { ok: boolean; reason?: string };
  poseQuestion: (threadId: string, question: string) => { ok: boolean; reason?: string };
  replyClarification: (threadId: string, reply: string) => void;
  arbitrate: (threadId: string, action: "accept" | "conditions" | "reevaluate" | "override", note: string) => { ok: boolean; reason?: string };
  testConnector: (id: AppState["connectors"][number]["id"]) => void;
  toggleConnector: (id: AppState["connectors"][number]["id"]) => void;
  configureConnector: (id: AppState["connectors"][number]["id"], options: Record<string, string>, connect: boolean) => { ok: boolean; reason?: string };
  createKey: (name: string, collectiveIds: string[]) => void;
  dismissKey: (id: string) => void;
  revealWebhook: () => void;
  pingWebhook: () => void;
  setDefaultProfile: (profile: Profile) => void;
  linkChat: (token: string) => { ok: boolean; reason?: string };
  resetDemo: () => void;
};

const Ctx = createContext<Store | null>(null);

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed.threads || !parsed.collectives || !parsed.agents) return seedState();
    const base = seedState();
    const agents = parsed.agents.map((agent) => {
      const seed = base.agents.find((item) => item.id === agent.id);
      if (!seed) return agent;
      return { ...seed, ...agent, brief: agent.brief || seed.brief };
    });
    const connectors = [
      ...base.connectors.map((seed) => {
        const saved = parsed.connectors?.find((item) => item.id === seed.id);
        return saved ? { ...seed, ...saved, options: { ...seed.options, ...saved.options } } : seed;
      }),
      ...(parsed.connectors ?? []).filter((item) => !base.connectors.some((seed) => seed.id === item.id)),
    ];
    const guideAck = Array.isArray(parsed.guideAck) && parsed.guideAck.length === 4
      ? parsed.guideAck.map((item) => Boolean(item))
      : base.guideAck;
    return { ...base, ...parsed, agents, connectors, guideAck, notice: undefined };
  } catch {
    return seedState();
  }
}

function finishRunning(state: AppState, thread: Thread): Thread {
  const collective = state.collectives.find((item) => item.id === thread.collectiveId);
  const agents = thread.agentIds
    .map((id) => state.agents.find((agent) => agent.id === id))
    .filter((agent): agent is Agent => Boolean(agent));
  const at = stamp();
  if (isVague(thread.question)) {
    return {
      ...thread,
      status: "needs_clarification",
      stage: "ecouter",
      verdict: undefined,
      questions: ["Précisez l’objet, le montant ou l’écart, et l’échéance. Sans cela le collectif ne produit pas de verdict."],
      progress: { done: 1, total: thread.progress.total },
      updatedAt: at,
      events: [...thread.events, { at, label: "Précision demandée", detail: "Question trop courte pour un verdict. Ce n’est pas un GO conditionnel." }],
    };
  }
  const contributions = agents.map((agent) => contributionFor(agent, thread.question));
  const voting = collective?.voting ?? "majority";
  const settled = settle(contributions, voting);
  return {
    ...thread,
    status: "awaiting_arbitration",
    verdict: settled.verdict,
    conditions: settled.conditions,
    questions: [],
    contributions,
    stage: "arbitrer",
    progress: { done: thread.progress.total, total: thread.progress.total },
    updatedAt: at,
    provider: thread.profile === "demo" ? "Démo préenregistrée" : "Mistral",
    events: [
      ...thread.events,
      {
        at,
        label: "Verdict produit",
        detail: `${settled.verdict === "CONDITIONAL_GO" ? "GO conditionnel envoyé à l’arbitrage" : settled.verdict} · provider ${thread.profile === "demo" ? "démo" : "Mistral"} · swarm aligné`,
      },
    ],
  };
}

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(seedState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setState(load());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const { notice: _notice, ...persist } = state;
    localStorage.setItem(KEY, JSON.stringify(persist));
  }, [state, ready]);

  useEffect(() => {
    if (!state.threads.some((thread) => thread.status === "running")) return;
    const timer = window.setTimeout(() => {
      setState((current) => ({
        ...current,
        threads: current.threads.map((thread) => {
          if (thread.status !== "running") return thread;
          const done = thread.progress.done + 1;
          if (done < thread.progress.total) {
            return {
              ...thread,
              progress: { done, total: thread.progress.total },
              stage: "eprouver",
              updatedAt: stamp(),
            };
          }
          return finishRunning(current, thread);
        }),
      }));
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [state.threads]);

  const api = useMemo<Store>(() => {
    const notify = (text: string, tone: "ok" | "warn" | "stop" = "ok") => {
      setState((current) => ({ ...current, notice: { text, tone } }));
    };
    return {
      state,
      setRole: (role) => setState((current) => ({ ...current, role })),
      dismissGuide: () => setState((current) => ({ ...current, guideSeen: true, guideAck: [true, true, true, true] })),
      ackGuide: (index, checked) => setState((current) => {
        const previous = current.guideAck?.length === 4 ? current.guideAck : [false, false, false, false];
        const guideAck = previous.map((item, i) => (i === index ? checked : item));
        return { ...current, guideAck, guideSeen: guideAck.every(Boolean) };
      }),
      replayGuide: () => setState((current) => ({ ...current, guideSeen: false, guideAck: [false, false, false, false] })),
      clearNotice: () => setState((current) => ({ ...current, notice: undefined })),
      selectCollective: (id) => setState((current) => ({ ...current, selectedCollectiveId: id })),
      createCollective: (input) => {
        if (state.collectives.length >= SESSION_QUOTA) {
          return { ok: false, reason: `3 collectifs maximum pour votre compte (${WORKSPACE_EMAIL}). Le tenant peut en contenir davantage : ils ne comptent pas dans votre quota.` };
        }
        if (!input.name.trim() || input.agentIds.length < 2) {
          return { ok: false, reason: "Nommez le collectif et choisissez au moins deux agents actifs." };
        }
        const id = uid("col");
        const collective: Collective = {
          id,
          name: input.name.trim(),
          agentIds: input.agentIds,
          voting: input.voting,
          personality: input.personality,
          createdAt: stamp(),
        };
        setState((current) => ({
          ...current,
          collectives: [collective, ...current.collectives],
          selectedCollectiveId: id,
          notice: { tone: "ok", text: `« ${collective.name} » est sélectionné. Vous pouvez l’instruire tout de suite.` },
        }));
        return { ok: true, id };
      },
      addAgentToCollective: (collectiveId, agentId) => {
        setState((current) => ({
          ...current,
          collectives: current.collectives.map((collective) =>
            collective.id === collectiveId && !collective.agentIds.includes(agentId)
              ? { ...collective, agentIds: [...collective.agentIds, agentId] }
              : collective,
          ),
        }));
      },
      updateCollective: (id, patch) => {
        const existing = state.collectives.find((item) => item.id === id);
        if (!existing) return { ok: false, reason: "Ce collectif n’est plus là." };
        if (patch.name !== undefined && !patch.name.trim()) return { ok: false, reason: "Le nom est requis." };
        if (patch.removeAgentId && existing.agentIds.length <= 2) {
          return { ok: false, reason: "Un collectif garde au moins deux agents." };
        }
        setState((current) => ({
          ...current,
          collectives: current.collectives.map((item) => {
            if (item.id !== id) return item;
            return {
              ...item,
              name: patch.name?.trim() || item.name,
              voting: patch.voting ?? item.voting,
              personality: patch.personality ?? item.personality,
              agentIds: patch.removeAgentId ? item.agentIds.filter((agentId) => agentId !== patch.removeAgentId) : item.agentIds,
            };
          }),
          notice: { tone: "ok", text: patch.removeAgentId ? "Agent retiré du collectif. Les dossiers déjà ouverts gardent leur composition." : "Collectif mis à jour." },
        }));
        return { ok: true };
      },
      setAgentEnabled: (agentId, enabled) => {
        if (state.role !== "comex") return { ok: false, reason: "Réservé aux rôles COMEX ou admin." };
        setState((current) => ({
          ...current,
          agents: current.agents.map((agent) => (agent.id === agentId ? { ...agent, enabled } : agent)),
        }));
        return { ok: true };
      },
      updateAgent: (id, agent) => {
        if (state.role !== "comex") return { ok: false, reason: "Réservé aux rôles COMEX ou admin." };
        const existing = state.agents.find((item) => item.id === id);
        if (!existing) return { ok: false, reason: "Cet agent n’est plus au registre." };
        if (!agent.name.trim()) return { ok: false, reason: "Le nom est requis." };
        if ((existing.kind === "hybride" || existing.kind === "impersonator") && !agent.consented) {
          return { ok: false, reason: "Consentement explicite requis pour conserver ce profil." };
        }
        const name = agent.name.trim();
        setState((current) => ({
          ...current,
          agents: current.agents.map((item) =>
            item.id === id
              ? {
                  ...item,
                  name,
                  role: agent.role.trim() || item.role,
                  department: agent.department.trim() || item.department,
                  mission: agent.mission.trim() || item.mission,
                  veto: existing.kind === "metier" ? agent.veto : false,
                  enabled: agent.enabled,
                  consented: existing.kind === "metier" ? false : agent.consented,
                  simulation: existing.kind !== "metier" && agent.consented,
                  clues: agent.clues.trim(),
                  brief: agent.brief?.trim() ?? "",
                }
              : item,
          ),
          notice: { tone: "ok", text: `${name} est mis à jour. Les collectifs qui l’utilisent voient la nouvelle fiche.` },
        }));
        return { ok: true };
      },
      createAgent: (agent) => {
        if (state.role !== "comex") return { ok: false, reason: "Réservé aux rôles COMEX ou admin. Le formulaire n’est pas ouvert." };
        if (!agent.name.trim()) return { ok: false, reason: "Le nom est requis." };
        if (agent.kind === "metier" && (!agent.role.trim() || !agent.department.trim() || !agent.mission.trim())) {
          return { ok: false, reason: "Fonction, service et mission sont requis pour un agent métier." };
        }
        if ((agent.kind === "hybride" || agent.kind === "impersonator") && !agent.consented) {
          return { ok: false, reason: "Consentement explicite requis avant d’enregistrer un profil personnifié." };
        }
        const created: Agent = { ...agent, id: uid("ag"), provider: "Mistral", model: "serveur", simulation: agent.consented || agent.simulation };
        setState((current) => ({
          ...current,
          agents: [created, ...current.agents],
          notice: {
            tone: "ok",
            text: created.simulation
              ? `${created.name} est au registre. La simulation de personnalité est active. Profils hybrides : ${hybridCount([created, ...current.agents])}.`
              : `${created.name} est au registre.`,
          },
        }));
        return { ok: true, id: created.id };
      },
      createImpersonatorTeam: (names, clues) => {
        if (state.role !== "comex") return { ok: false, reason: "Réservé aux rôles COMEX ou admin." };
        const clean = names.map((name) => name.trim()).filter(Boolean);
        if (clean.length < 2 || clean.length > 12) return { ok: false, reason: "Une équipe compte entre 2 et 12 personas." };
        if (!clues.trim()) return { ok: false, reason: "Indiquez les indices autorisés. Aucun scraping n’est lancé." };
        if (state.collectives.length >= SESSION_QUOTA) {
          return { ok: false, reason: "Quota de collectifs atteint pour votre compte. L’équipe n’est pas créée, pour ne pas ouvrir une session refusée ensuite." };
        }
        const agents: Agent[] = clean.map((name) => ({
          id: uid("ag"),
          name,
          role: "Persona simulée",
          department: "Simulation",
          mission: "Teste une idée contre cette persona. Ne parle pas à sa place.",
          kind: "impersonator",
          veto: false,
          enabled: true,
          provider: "Mistral",
          model: "serveur",
          consented: true,
          simulation: true,
          clues: clues.trim(),
        }));
        const id = uid("col");
        setState((current) => ({
          ...current,
          agents: [...agents, ...current.agents],
          collectives: [
            {
              id,
              name: `Panel · ${clean.slice(0, 2).join(", ")}${clean.length > 2 ? "…" : ""}`,
              agentIds: agents.map((agent) => agent.id),
              voting: "majority",
              personality: true,
              createdAt: stamp(),
            },
            ...current.collectives,
          ],
          selectedCollectiveId: id,
          notice: { tone: "ok", text: "Équipe créée et collectif sélectionné. Les cinq garde-fous sont inscrits sur chaque persona." },
        }));
        return { ok: true, collectiveId: id };
      },
      startMission: (draft) => {
        const id = uid("dos");
        const collective = state.collectives.find((item) => item.id === draft.collectiveId) ?? state.collectives[0];
        const chosen = (draft.agentIds ?? []).filter((agentId) => state.agents.some((agent) => agent.id === agentId && agent.enabled));
        const agentIds = chosen.length
          ? chosen
          : (collective?.agentIds ?? []).filter((agentId) => state.agents.some((agent) => agent.id === agentId && agent.enabled));
        const at = stamp();
        const thread: Thread = {
          id,
          question: draft.question.trim(),
          collectiveId: collective?.id ?? "",
          status: "running",
          profile: draft.profile,
          provider: draft.profile === "demo" ? "Démo préenregistrée" : "Mistral",
          useCase: draft.useCase,
          stage: "construire",
          agentIds,
          contributions: [],
          conditions: [],
          questions: [],
          evidence: draft.evidence,
          progress: { done: 0, total: Math.max(agentIds.length, 1) },
          createdAt: at,
          updatedAt: at,
          events: [{ at, label: "Mission lancée", detail: `${collective?.name ?? "Collectif"} · profil ${draft.profile}` }],
        };
        setState((current) => ({
          ...current,
          selectedCollectiveId: collective?.id ?? current.selectedCollectiveId,
          threads: [thread, ...current.threads],
        }));
        return id;
      },
      addAgentToThread: (threadId, agentId) => {
        const thread = state.threads.find((item) => item.id === threadId);
        const agent = state.agents.find((item) => item.id === agentId);
        if (!thread) return { ok: false, reason: "Dossier introuvable." };
        if (!agent) return { ok: false, reason: "Agent introuvable." };
        if (!agent.enabled) return { ok: false, reason: "Cet agent est inactif." };
        if (thread.agentIds.includes(agentId)) return { ok: false, reason: "Cet agent est déjà dans le dossier." };
        setState((current) => ({
          ...current,
          threads: current.threads.map((item) => {
            if (item.id !== threadId) return item;
            const at = stamp();
            const agentIds = [...item.agentIds, agentId];
            if (item.status === "running") {
              return {
                ...item,
                agentIds,
                progress: { done: item.progress.done, total: item.progress.total + 1 },
                updatedAt: at,
                events: [...item.events, { at, label: "Agent ajouté", detail: `${agent.name} rejoint la file. Le collectif n’est pas modifié.` }],
              };
            }
            const contribution = contributionFor(agent, item.question);
            const contributions = [...item.contributions, contribution];
            const voting = current.collectives.find((collective) => collective.id === item.collectiveId)?.voting ?? "majority";
            const settled = settle(contributions, voting);
            const locked = item.status === "resolved";
            return {
              ...item,
              agentIds,
              contributions,
              verdict: locked ? item.verdict : settled.verdict,
              conditions: locked ? item.conditions : settled.conditions,
              progress: { done: Math.min(item.progress.done + 1, item.progress.total + 1), total: item.progress.total + 1 },
              updatedAt: at,
              events: [
                ...item.events,
                {
                  at,
                  label: "Agent ajouté",
                  detail: locked
                    ? `${agent.name} a déposé un avis. La décision humaine déjà prise reste inscrite.`
                    : `${agent.name} a instruit. Lecture recalculée : ${settled.verdict}. Le collectif n’est pas modifié.`,
                },
              ],
            };
          }),
          notice: { tone: "ok", text: `${agent.name} est dans ce dossier, pas dans le collectif.` },
        }));
        return { ok: true };
      },
      removeAgentFromThread: (threadId, agentId) => {
        const thread = state.threads.find((item) => item.id === threadId);
        const agent = state.agents.find((item) => item.id === agentId);
        if (!thread) return { ok: false, reason: "Dossier introuvable." };
        if (!thread.agentIds.includes(agentId)) return { ok: false, reason: "Cet agent n’est pas dans le dossier." };
        if (thread.agentIds.length <= 1) return { ok: false, reason: "Un dossier garde au moins un agent." };
        const name = agent?.name ?? agentId;
        setState((current) => ({
          ...current,
          threads: current.threads.map((item) => {
            if (item.id !== threadId) return item;
            const at = stamp();
            const agentIds = item.agentIds.filter((id) => id !== agentId);
            const contributions = item.contributions.filter((entry) => entry.agentId !== agentId);
            if (item.status === "running") {
              return {
                ...item,
                agentIds,
                progress: { done: Math.min(item.progress.done, agentIds.length), total: agentIds.length },
                updatedAt: at,
                events: [...item.events, { at, label: "Agent retiré", detail: `${name} quitte la file. Le collectif n’est pas modifié.` }],
              };
            }
            const locked = item.status === "resolved";
            const voting = current.collectives.find((collective) => collective.id === item.collectiveId)?.voting ?? "majority";
            const settled = !locked && contributions.length ? settle(contributions, voting) : null;
            return {
              ...item,
              agentIds,
              contributions,
              verdict: locked ? item.verdict : settled?.verdict,
              conditions: locked ? item.conditions : settled?.conditions ?? [],
              updatedAt: at,
              events: [...item.events, { at, label: "Agent retiré", detail: locked ? `${name} est retiré. La décision humaine reste inscrite.` : `${name} est retiré. Lecture recalculée.` }],
            };
          }),
          notice: { tone: "ok", text: `${name} n’instruit plus ce dossier. Le collectif n’est pas modifié.` },
        }));
        return { ok: true };
      },
      deleteThread: (threadId) => {
        if (!state.threads.some((item) => item.id === threadId)) return { ok: false, reason: "Dossier introuvable." };
        setState((current) => ({
          ...current,
          threads: current.threads.filter((item) => item.id !== threadId),
          notice: { tone: "ok", text: "Dossier supprimé. Le collectif et les autres dossiers restent." },
        }));
        return { ok: true };
      },
      attachReading: (threadId, file) => {
        if (!state.threads.some((item) => item.id === threadId)) return { ok: false, reason: "Dossier introuvable." };
        if (!file.text?.trim()) return { ok: false, reason: "Rien à attacher." };
        setState((current) => ({
          ...current,
          threads: current.threads.map((item) => {
            if (item.id !== threadId) return item;
            const at = stamp();
            const evidence = [file, ...item.evidence.filter((entry) => entry.name !== file.name)];
            return {
              ...item,
              evidence,
              updatedAt: at,
              events: [...item.events, { at, label: "Document lu", detail: `${file.name} · ${file.questions?.length ?? 0} questions proposées. Moteur local.` }],
            };
          }),
          notice: { tone: "ok", text: "Lecture attachée au dossier. Aucune question n’est encore posée au comité." },
        }));
        return { ok: true };
      },
      poseQuestion: (threadId, question) => {
        const asked = question.trim();
        if (asked.length < 8) return { ok: false, reason: "Choisissez une question de la liste." };
        if (!state.threads.some((item) => item.id === threadId)) return { ok: false, reason: "Dossier introuvable." };
        setState((current) => ({
          ...current,
          threads: current.threads.map((item) => {
            if (item.id !== threadId) return item;
            const at = stamp();
            return {
              ...item,
              question: asked,
              status: "running",
              stage: "ecouter",
              verdict: undefined,
              conditions: [],
              questions: [],
              contributions: [],
              arbitration: undefined,
              humanReply: undefined,
              progress: { done: 0, total: Math.max(item.agentIds.length, 1) },
              updatedAt: at,
              events: [...item.events, { at, label: "Question posée au comité", detail: asked }],
            };
          }),
          notice: { tone: "ok", text: "Le comité instruit cette question. La lecture du document reste dans le dossier." },
        }));
        return { ok: true };
      },
      replyClarification: (threadId, reply) => {
        const text = reply.trim();
        if (text.length < 12) {
          notify("La réponse est encore trop courte pour relancer le collectif.", "warn");
          return;
        }
        setState((current) => ({
          ...current,
          threads: current.threads.map((thread) => {
            if (thread.id !== threadId) return thread;
            const at = stamp();
            return {
              ...thread,
              question: `${thread.question} — précision : ${text}`,
              humanReply: text,
              status: "running",
              stage: "eprouver",
              questions: [],
              contributions: [],
              progress: { done: 0, total: thread.agentIds.length },
              updatedAt: at,
              events: [...thread.events, { at, label: "Précision reçue", detail: "Même collectif, même dossier, historique conservé." }],
            };
          }),
        }));
      },
      arbitrate: (threadId, action, note) => {
        if (state.role !== "comex") {
          return { ok: false, reason: "Rôle COMEX ou admin requis. L’action n’est pas envoyée." };
        }
        if (action === "override" && note.trim().length < 12) {
          return { ok: false, reason: "Une dérogation au veto exige une justification." };
        }
        setState((current) => ({
          ...current,
          threads: current.threads.map((thread) => {
            if (thread.id !== threadId) return thread;
            const at = stamp();
            if (action === "reevaluate") {
              return {
                ...thread,
                status: "running",
                stage: "eprouver",
                arbitration: undefined,
                contributions: [],
                progress: { done: 0, total: thread.agentIds.length },
                updatedAt: at,
                events: [...thread.events, { at, label: "Réévaluation demandée", detail: note.trim() || "Même collectif, nouvel instruction." }],
              };
            }
            const stage = action === "accept" && thread.verdict === "GO" ? "realiser" : "projeter";
            const label =
              action === "accept" ? "Consensus accepté" : action === "conditions" ? "Passé sous conditions" : "Veto levé par dérogation";
            return {
              ...thread,
              status: "resolved",
              stage,
              updatedAt: at,
              arbitration: { action, by: "COMEX · Camille Renaud", note: note.trim(), at },
              events: [...thread.events, { at, label: "Arbitrage", detail: label }],
            };
          }),
          notice: { tone: "ok", text: "Arbitrage enregistré dans le dossier. Le fil reste auditable." },
        }));
        return { ok: true };
      },
      testConnector: (id) => {
        setState((current) => ({
          ...current,
          connectors: current.connectors.map((connector) => {
            if (connector.id !== id) return connector;
            const at = stamp();
            if (connector.id === "teams") {
              return { ...connector, lastTest: at, status: "not_configured", detail: "Test non lancé : autorisation d’admin impossible sans identifiants d’application côté serveur." };
            }
            if (connector.id === "discord") {
              return { ...connector, lastTest: at, status: "error", detail: "users/@me · 401. Le jeton reste rejeté. Aucun secret affiché." };
            }
            if (connector.id === "salesforce" && connector.status !== "connected") {
              return { ...connector, lastTest: at, status: "not_configured", detail: "Test refusé : terminez l’onboarding avant de pinguer l’org." };
            }
            if (connector.id === "salesforce") {
              return { ...connector, lastTest: at, status: "connected", enabled: true, detail: "Ping org réussi. Aucun secret renvoyé au navigateur." };
            }
            return { ...connector, lastTest: at, status: "connected", enabled: true, detail: "auth.test réussi à l’instant. Secret inchangé, non renvoyé au navigateur." };
          }),
        }));
      },
      toggleConnector: (id) => {
        setState((current) => ({
          ...current,
          connectors: current.connectors.map((connector) => {
            if (connector.id !== id || connector.status === "not_configured") return connector;
            const enabled = !connector.enabled;
            return { ...connector, enabled, status: enabled ? (connector.status === "disabled" ? "connected" : connector.status) : "disabled" };
          }),
        }));
      },
      configureConnector: (id, options, connect) => {
        const current = state.connectors.find((item) => item.id === id);
        if (!current) return { ok: false, reason: "Canal inconnu." };
        if (id === "teams") return { ok: false, reason: "Identifiants d’application absents côté serveur. Rien n’est enregistré." };
        if (id === "salesforce" && connect && ["environment", "object", "stage", "direction", "writeback"].some((key) => !options[key])) {
          return { ok: false, reason: "Choisissez l’environnement, l’objet, l’étape, le sens et l’écriture du verdict." };
        }
        setState((snapshot) => ({
          ...snapshot,
          connectors: snapshot.connectors.map((connector) => {
            if (connector.id !== id) return connector;
            if (id === "salesforce" && connect) {
              return {
                ...connector,
                status: "connected",
                enabled: true,
                oauthReady: true,
                options,
                usersOnline: 7,
                usersTotal: 24,
                presence: "live",
                detail: `Org ${options.environment}. ${options.object} à l’étape ${options.stage}. Verdict en ${options.writeback === "task" ? "tâche" : "champ"}. Secret tenu côté serveur.`,
              };
            }
            return { ...connector, options: { ...connector.options, ...options } };
          }),
          notice: { tone: "ok", text: connect ? `${current.name} est intégré.` : `${current.name} est mis à jour.` },
        }));
        return { ok: true };
      },
      createKey: (name, collectiveIds) => {
        const secret = `kl_live_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
        setState((current) => ({
          ...current,
          keys: [
            {
              id: uid("key"),
              name: name.trim() || "Clé sans nom",
              prefix: secret.slice(0, 12),
              secret,
              revealed: false,
              createdAt: stamp(),
              collectiveIds,
            },
            ...current.keys,
          ],
        }));
      },
      dismissKey: (id) => {
        setState((current) => ({
          ...current,
          keys: current.keys.map((key) => (key.id === id ? { ...key, secret: undefined, revealed: true } : key)),
        }));
      },
      revealWebhook: () => {
        setState((current) => ({
          ...current,
          webhookSecret: current.webhookSecret ?? `whsec_${Math.random().toString(36).slice(2, 14)}`,
          webhookRevealed: false,
        }));
      },
      pingWebhook: () => {
        setState((current) => ({
          ...current,
          deliveries: [
            { id: uid("del"), event: "ping", status: "delivered", at: stamp() },
            ...current.deliveries,
          ],
          notice: { tone: "ok", text: "Ping signé HMAC accepté par le journal de livraison." },
        }));
      },
      setDefaultProfile: (profile) => setState((current) => ({ ...current, defaultProfile: profile })),
      linkChat: (token) => {
        if (state.role !== "comex") return { ok: false, reason: "Seuls COMEX et admin peuvent arbitrer depuis le chat, donc lier un compte." };
        if (!token.trim().startsWith("link_")) return { ok: false, reason: "Le jeton doit commencer par link_ et provenir du bot (15 minutes)." };
        setState((current) => ({
          ...current,
          notice: { tone: "ok", text: `Compte ${token.trim()} lié à ${WORKSPACE_EMAIL}. L’arbitrage depuis le chat reste réservé au COMEX.` },
        }));
        return { ok: true };
      },
      resetDemo: () => {
        localStorage.removeItem(KEY);
        setState(seedState());
      },
    };
  }, [state]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useConsole() {
  const value = useContext(Ctx);
  if (!value) throw new Error("Console hors provider");
  return value;
}
