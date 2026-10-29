import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api as http, ApiError, AUTH_EVENT, tokenStore, type LiveUser, type WorkspaceKind } from "./api";
import { EMPTY_WORKSPACE, fromApiAgent, fromApiSession, fromApiThread, slugId, toApiAgent, votingToApi, type MemberRole, type Workspace } from "./live";
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
import { t, tc, tk } from "@/lib/i18n";

const KEY = "kayros-console-cx-v1";

type DraftMission = {
  question: string;
  collectiveId: string;
  profile: Profile;
  useCase: UseCase;
  evidence: Evidence[];
  agentIds?: string[];
};

type Result = { ok: boolean; reason?: string };
type LiveData = { agents: Agent[]; collectives: Collective[]; threads: Thread[] };

export const PERMISSIONS: Record<MemberRole, string[]> = {
  admin: ["read", "run", "arbitrate", "manage", "members"],
  comex: ["read", "run", "arbitrate", "manage"],
  contributeur: ["read", "run"],
  lecteur: ["read"],
};

type Store = {
  state: AppState;
  /** Vrai quand la console est connectée à l’API (hors mode Démo). */
  live: boolean;
  liveUser: LiveUser | null;
  syncing: boolean;
  refreshLive: () => Promise<void>;
  workspace: Workspace;
  /** Rôle réel du membre (admin, comex, contributeur, lecteur) et ses permissions. */
  memberRole: MemberRole;
  permissions: string[];
  saveItem: (kind: WorkspaceKind, id: string | null, body: Record<string, unknown>) => Promise<Result & { id?: string }>;
  deleteItem: (kind: WorkspaceKind, id: string) => Promise<Result>;
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
      questions: [t(
        "Précisez l’objet, le montant ou l’écart, et l’échéance. Sans cela le collectif ne produit pas de verdict."
      )],
      progress: { done: 1, total: thread.progress.total },
      updatedAt: at,
      events: [...thread.events, { at, label: tk("Précision demandée"), detail: t("Question trop courte pour un verdict. Ce n’est pas un GO conditionnel.") }],
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
    provider: thread.profile === "demo" ? t("Démo préenregistrée") : "Mistral",
    events: [
      ...thread.events,
      {
        at,
        label: tk("Verdict produit"),
        detail: t("{{v}} · provider {{v1}} · swarm aligné", {
          v: settled.verdict === "CONDITIONAL_GO" ? t("GO conditionnel envoyé à l’arbitrage") : settled.verdict,
          v1: thread.profile === "demo" ? t("démo") : "Mistral"
        }),
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

  // --- Mode connecté : agents, collectifs, dossiers et Bibliothèque via l’API.
  const [liveUser, setLiveUser] = useState<LiveUser | null>(null);
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>(EMPTY_WORKSPACE);
  const [syncing, setSyncing] = useState(false);
  const [membership, setMembership] = useState<{ role: MemberRole; permissions: string[] } | null>(null);
  const pending = useRef(new Map<string, Thread>());

  const refreshLive = useCallback(async () => {
    if (!tokenStore.get()) { setLiveUser(null); setLiveData(null); setWorkspace(EMPTY_WORKSPACE); return; }
    setSyncing(true);
    try {
      const me = liveUser ?? (await http.me()).user;
      const [agents, sessions, threads, companies, projects, skills, contexts, members, membership] = await Promise.all([
        http.agents(), http.sessions(), http.threads(),
        http.list("companies"), http.list("projects"), http.list("skills"), http.list("contexts"),
        http.list("members").catch(() => ({ members: [] })),
        http.memberMe().catch(() => null),
      ]);
      setMembership(membership ? { role: membership.role as MemberRole, permissions: membership.permissions } : null);
      const mapped = threads.threads.map(fromApiThread);
      setLiveUser(me);
      setLiveData({
        agents: agents.agents.map(fromApiAgent),
        collectives: sessions.sessions.map(fromApiSession),
        threads: [...pending.current.values(), ...mapped],
      });
      setWorkspace({ companies: companies.companies, projects: projects.projects, skills: skills.skills, contexts: contexts.contexts, members: members.members ?? [] });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { tokenStore.clear(); return; }
      setState((current) => ({ ...current, notice: { tone: "warn", text: t("API indisponible : {{v}}", { v: (error as Error).message }) } }));
    } finally {
      setSyncing(false);
    }
  }, [liveUser]);

  useEffect(() => {
    const onAuth = () => { setLiveUser(null); void refreshLive(); };
    window.addEventListener(AUTH_EVENT, onAuth);
    if (tokenStore.get()) void refreshLive();
    return () => window.removeEventListener(AUTH_EVENT, onAuth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suivi des dossiers en cours côté serveur.
  useEffect(() => {
    if (!liveData?.threads.some((thread) => thread.status === "running")) return;
    const timer = window.setTimeout(() => { void refreshLive(); }, 2500);
    return () => window.clearTimeout(timer);
  }, [liveData, refreshLive]);

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
          return { ok: false, reason: t(
            "3 collectifs maximum pour votre compte ({{WORKSPACE_EMAIL}}). Le tenant peut en contenir davantage : ils ne comptent pas dans votre quota.",
            {
              WORKSPACE_EMAIL
            }
          ) };
        }
        if (!input.name.trim() || input.agentIds.length < 2) {
          return { ok: false, reason: t("Nommez le collectif et choisissez au moins deux agents actifs.") };
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
          notice: { tone: "ok", text: t("« {{name}} » est sélectionné. Vous pouvez l’instruire tout de suite.", {
            name: tc(collective.name)
          }) },
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
        if (!existing) return { ok: false, reason: t("Ce collectif n’est plus là.") };
        if (patch.name !== undefined && !patch.name.trim()) return { ok: false, reason: t("Le nom est requis.") };
        if (patch.removeAgentId && existing.agentIds.length <= 2) {
          return { ok: false, reason: t("Un collectif garde au moins deux agents.") };
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
          notice: { tone: "ok", text: patch.removeAgentId ? t(
            "Agent retiré du collectif. Les dossiers déjà ouverts gardent leur composition."
          ) : t("Collectif mis à jour.") },
        }));
        return { ok: true };
      },
      setAgentEnabled: (agentId, enabled) => {
        if (state.role !== "comex") return { ok: false, reason: t("Réservé aux rôles COMEX ou admin.") };
        setState((current) => ({
          ...current,
          agents: current.agents.map((agent) => (agent.id === agentId ? { ...agent, enabled } : agent)),
        }));
        return { ok: true };
      },
      updateAgent: (id, agent) => {
        if (state.role !== "comex") return { ok: false, reason: t("Réservé aux rôles COMEX ou admin.") };
        const existing = state.agents.find((item) => item.id === id);
        if (!existing) return { ok: false, reason: t("Cet agent n’est plus au registre.") };
        if (!agent.name.trim()) return { ok: false, reason: t("Le nom est requis.") };
        if ((existing.kind === "hybride" || existing.kind === "impersonator") && !agent.consented) {
          return { ok: false, reason: t("Consentement explicite requis pour conserver ce profil.") };
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
                  settings: agent.settings ?? item.settings,
                }
              : item,
          ),
          notice: { tone: "ok", text: t(
            "{{name}} est mis à jour. Les collectifs qui l’utilisent voient la nouvelle fiche.",
            {
              name
            }
          ) },
        }));
        return { ok: true };
      },
      createAgent: (agent) => {
        if (state.role !== "comex") return { ok: false, reason: t("Réservé aux rôles COMEX ou admin. Le formulaire n’est pas ouvert.") };
        if (!agent.name.trim()) return { ok: false, reason: t("Le nom est requis.") };
        if (agent.kind === "metier" && (!agent.role.trim() || !agent.department.trim() || !agent.mission.trim())) {
          return { ok: false, reason: t("Fonction, service et mission sont requis pour un agent métier.") };
        }
        if ((agent.kind === "hybride" || agent.kind === "impersonator") && !agent.consented) {
          return { ok: false, reason: t("Consentement explicite requis avant d’enregistrer un profil personnifié.") };
        }
        const created: Agent = { ...agent, id: uid("ag"), provider: "Mistral", model: "serveur", simulation: agent.consented || agent.simulation };
        setState((current) => ({
          ...current,
          agents: [created, ...current.agents],
          notice: {
            tone: "ok",
            text: created.simulation
              ? t(
              "{{name}} est au registre. La simulation de personnalité est active. Profils hybrides : {{hybridCount}}.",
              {
                name: created.name,
                hybridCount: hybridCount([created, ...current.agents])
              }
            )
              : t("{{name}} est au registre.", {
              name: created.name
            }),
          },
        }));
        return { ok: true, id: created.id };
      },
      createImpersonatorTeam: (names, clues) => {
        if (state.role !== "comex") return { ok: false, reason: t("Réservé aux rôles COMEX ou admin.") };
        const clean = names.map((name) => name.trim()).filter(Boolean);
        if (clean.length < 2 || clean.length > 12) return { ok: false, reason: t("Une équipe compte entre 2 et 12 personas.") };
        if (!clues.trim()) return { ok: false, reason: t("Indiquez les indices autorisés. Aucun scraping n’est lancé.") };
        if (state.collectives.length >= SESSION_QUOTA) {
          return { ok: false, reason: t(
            "Quota de collectifs atteint pour votre compte. L’équipe n’est pas créée, pour ne pas ouvrir une session refusée ensuite."
          ) };
        }
        const agents: Agent[] = clean.map((name) => ({
          id: uid("ag"),
          name,
          role: t("Persona simulée"),
          department: "Simulation",
          mission: t("Teste une idée contre cette persona. Ne parle pas à sa place."),
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
          notice: { tone: "ok", text: t(
            "Équipe créée et collectif sélectionné. Les cinq garde-fous sont inscrits sur chaque persona."
          ) },
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
          provider: draft.profile === "demo" ? t("Démo préenregistrée") : "Mistral",
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
          events: [{ at, label: tk("Mission lancée"), detail: t("{{collective}} · profil {{profile}}", { collective: tc(collective?.name) || t("Collectif"), profile: draft.profile }) }],
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
        if (!thread) return { ok: false, reason: t("Dossier introuvable.") };
        if (!agent) return { ok: false, reason: t("Agent introuvable.") };
        if (!agent.enabled) return { ok: false, reason: t("Cet agent est inactif.") };
        if (thread.agentIds.includes(agentId)) return { ok: false, reason: t("Cet agent est déjà dans le dossier.") };
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
                events: [...item.events, { at, label: tk("Agent ajouté"), detail: t("{{name}} rejoint la file. Le collectif n’est pas modifié.", {
                  name: tc(agent.name)
                }) }],
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
                  label: tk("Agent ajouté"),
                  detail: locked
                    ? t(
                    "{{name}} a déposé un avis. La décision humaine déjà prise reste inscrite.",
                    {
                      name: tc(agent.name)
                    }
                  )
                    : t(
                    "{{name}} a instruit. Lecture recalculée : {{verdict}}. Le collectif n’est pas modifié.",
                    {
                      name: tc(agent.name),
                      verdict: settled.verdict
                    }
                  ),
                },
              ],
            };
          }),
          notice: { tone: "ok", text: t("{{name}} est dans ce dossier, pas dans le collectif.", {
            name: tc(agent.name)
          }) },
        }));
        return { ok: true };
      },
      removeAgentFromThread: (threadId, agentId) => {
        const thread = state.threads.find((item) => item.id === threadId);
        const agent = state.agents.find((item) => item.id === agentId);
        if (!thread) return { ok: false, reason: t("Dossier introuvable.") };
        if (!thread.agentIds.includes(agentId)) return { ok: false, reason: t("Cet agent n’est pas dans le dossier.") };
        if (thread.agentIds.length <= 1) return { ok: false, reason: t("Un dossier garde au moins un agent.") };
        const name = tc(agent?.name) || agentId;
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
                events: [...item.events, { at, label: tk("Agent retiré"), detail: t("{{name}} quitte la file. Le collectif n’est pas modifié.", {
                  name
                }) }],
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
              events: [...item.events, { at, label: tk("Agent retiré"), detail: locked ? t("{{name}} est retiré. La décision humaine reste inscrite.", {
                name
              }) : t("{{name}} est retiré. Lecture recalculée.", {
                name
              }) }],
            };
          }),
          notice: { tone: "ok", text: t("{{name}} n’instruit plus ce dossier. Le collectif n’est pas modifié.", {
            name
          }) },
        }));
        return { ok: true };
      },
      deleteThread: (threadId) => {
        if (!state.threads.some((item) => item.id === threadId)) return { ok: false, reason: t("Dossier introuvable.") };
        setState((current) => ({
          ...current,
          threads: current.threads.filter((item) => item.id !== threadId),
          notice: { tone: "ok", text: t("Dossier supprimé. Le collectif et les autres dossiers restent.") },
        }));
        return { ok: true };
      },
      attachReading: (threadId, file) => {
        if (!state.threads.some((item) => item.id === threadId)) return { ok: false, reason: t("Dossier introuvable.") };
        if (!file.text?.trim()) return { ok: false, reason: t("Rien à attacher.") };
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
              events: [...item.events, { at, label: tk("Document lu"), detail: t("{{name}} · {{v}} questions proposées. Moteur local.", {
                name: file.name,
                v: file.questions?.length ?? 0
              }) }],
            };
          }),
          notice: { tone: "ok", text: t(
            "Lecture attachée au dossier. Aucune question n’est encore posée au comité."
          ) },
        }));
        return { ok: true };
      },
      poseQuestion: (threadId, question) => {
        const asked = question.trim();
        if (asked.length < 8) return { ok: false, reason: t("Choisissez une question de la liste.") };
        if (!state.threads.some((item) => item.id === threadId)) return { ok: false, reason: t("Dossier introuvable.") };
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
              events: [...item.events, { at, label: tk("Question posée au comité"), detail: asked }],
            };
          }),
          notice: { tone: "ok", text: t(
            "Le comité instruit cette question. La lecture du document reste dans le dossier."
          ) },
        }));
        return { ok: true };
      },
      replyClarification: (threadId, reply) => {
        const text = reply.trim();
        if (text.length < 12) {
          notify(t("La réponse est encore trop courte pour relancer le collectif."), "warn");
          return;
        }
        setState((current) => ({
          ...current,
          threads: current.threads.map((thread) => {
            if (thread.id !== threadId) return thread;
            const at = stamp();
            return {
              ...thread,
              question: t("{{question}} — précision : {{text}}", {
                question: thread.question,
                text
              }),
              humanReply: text,
              status: "running",
              stage: "eprouver",
              questions: [],
              contributions: [],
              progress: { done: 0, total: thread.agentIds.length },
              updatedAt: at,
              events: [...thread.events, { at, label: tk("Précision reçue"), detail: t("Même collectif, même dossier, historique conservé.") }],
            };
          }),
        }));
      },
      arbitrate: (threadId, action, note) => {
        if (state.role !== "comex") {
          return { ok: false, reason: t("Rôle COMEX ou admin requis. L’action n’est pas envoyée.") };
        }
        if (action === "override" && note.trim().length < 12) {
          return { ok: false, reason: t("Une dérogation au veto exige une justification.") };
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
                events: [...thread.events, { at, label: tk("Réévaluation demandée"), detail: note.trim() || t("Même collectif, nouvel instruction.") }],
              };
            }
            const stage = action === "accept" && thread.verdict === "GO" ? "realiser" : "projeter";
            const label =
              action === "accept" ? t("Consensus accepté") : action === "conditions" ? t("Passé sous conditions") : t("Veto levé par dérogation");
            return {
              ...thread,
              status: "resolved",
              stage,
              updatedAt: at,
              arbitration: { action, by: t("COMEX · Camille Renaud"), note: note.trim(), at },
              events: [...thread.events, { at, label: tk("Arbitrage"), detail: label }],
            };
          }),
          notice: { tone: "ok", text: t("Arbitrage enregistré dans le dossier. Le fil reste auditable.") },
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
              return { ...connector, lastTest: at, status: "not_configured", detail: t(
                "Test non lancé : autorisation d’admin impossible sans identifiants d’application côté serveur."
              ) };
            }
            if (connector.id === "discord") {
              return { ...connector, lastTest: at, status: "error", detail: t("users/@me · 401. Le jeton reste rejeté. Aucun secret affiché.") };
            }
            if (connector.id === "salesforce" && connector.status !== "connected") {
              return { ...connector, lastTest: at, status: "not_configured", detail: t("Test refusé : terminez l’onboarding avant de pinguer l’org.") };
            }
            if (connector.id === "salesforce") {
              return { ...connector, lastTest: at, status: "connected", enabled: true, detail: t("Ping org réussi. Aucun secret renvoyé au navigateur.") };
            }
            return { ...connector, lastTest: at, status: "connected", enabled: true, detail: t(
              "auth.test réussi à l’instant. Secret inchangé, non renvoyé au navigateur."
            ) };
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
        if (!current) return { ok: false, reason: t("Canal inconnu.") };
        if (id === "teams") return { ok: false, reason: t("Identifiants d’application absents côté serveur. Rien n’est enregistré.") };
        if (id === "salesforce" && connect && ["environment", "object", "stage", "direction", "writeback"].some((key) => !options[key])) {
          return { ok: false, reason: t(
            "Choisissez l’environnement, l’objet, l’étape, le sens et l’écriture du verdict."
          ) };
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
                detail: t(
                  "Org {{environment}}. {{object}} à l’étape {{stage}}. Verdict en {{v}}. Secret tenu côté serveur.",
                  {
                    environment: options.environment,
                    object: options.object,
                    stage: options.stage,
                    v: options.writeback === "task" ? t("tâche") : t("champ")
                  }
                ),
              };
            }
            return { ...connector, options: { ...connector.options, ...options } };
          }),
          notice: { tone: "ok", text: connect ? t("{{name}} est intégré.", {
            name: current.name
          }) : t("{{name}} est mis à jour.", {
            name: current.name
          }) },
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
              name: name.trim() || t("Clé sans nom"),
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
          notice: { tone: "ok", text: t("Ping signé HMAC accepté par le journal de livraison.") },
        }));
      },
      setDefaultProfile: (profile) => setState((current) => ({ ...current, defaultProfile: profile })),
      linkChat: (token) => {
        if (state.role !== "comex") return { ok: false, reason: t(
          "Seuls COMEX et admin peuvent arbitrer depuis le chat, donc lier un compte."
        ) };
        if (!token.trim().startsWith("link_")) return { ok: false, reason: t("Le jeton doit commencer par link_ et provenir du bot (15 minutes).") };
        setState((current) => ({
          ...current,
          notice: { tone: "ok", text: t(
            "Compte {{trim}} lié à {{WORKSPACE_EMAIL}}. L’arbitrage depuis le chat reste réservé au COMEX.",
            {
              trim: token.trim(),
              WORKSPACE_EMAIL
            }
          ) },
        }));
        return { ok: true };
      },
      resetDemo: () => {
        localStorage.removeItem(KEY);
        setState(seedState());
      },
      live: false,
      liveUser: null,
      syncing: false,
      refreshLive,
      workspace: EMPTY_WORKSPACE,
      memberRole: state.role === "comex" ? "comex" : "contributeur",
      permissions: PERMISSIONS[state.role === "comex" ? "comex" : "contributeur"],
      saveItem: async () => ({ ok: false, reason: t("Connectez-vous à l’API pour enregistrer.") }),
      deleteItem: async () => ({ ok: false, reason: t("Connectez-vous à l’API pour supprimer.") }),
    };
  }, [state, refreshLive]);

  const value = useMemo<Store>(() => {
    if (!liveData || !liveUser) return api;
    // Rôle réel : la fiche membre de l’espace prime sur le rôle du compte.
    // Sans fiche membre : comex/admin gardent leur rôle, les autres rôles du compte valent contributeur (comme l’API).
    const memberRole = (membership?.role ?? (["comex", "admin"].includes(liveUser.role) ? liveUser.role : "contributeur")) as MemberRole;
    const perms = membership?.permissions ?? PERMISSIONS[memberRole] ?? ["read"];
    const canRun = (): Result | null => (perms.includes("run") ? null : { ok: false, reason: t("Votre rôle (lecteur) ne permet pas de lancer ou relancer une mission.") });
    const role: Role = ["comex", "admin"].includes(memberRole) ? "comex" : "contributeur";
    const selected = liveData.collectives.some((c) => c.id === state.selectedCollectiveId)
      ? state.selectedCollectiveId
      : liveData.collectives[0]?.id ?? "";
    const view: AppState = { ...state, ...liveData, role, selectedCollectiveId: selected };
    const notify = (text: string, tone: "ok" | "warn" | "stop" = "ok") => setState((current) => ({ ...current, notice: { text, tone } }));
    const fail = (error: unknown) => notify((error as Error).message || t("Refusé"), "stop");
    const comexOnly = (): Result | null => (role === "comex" ? null : { ok: false, reason: t("Réservé aux rôles COMEX ou admin.") });
    const later = (): Result => ({ ok: false, reason: t("Pas encore disponible en mode connecté.") });
    const run = (promise: Promise<unknown>, ok?: string) => {
      promise.then(async () => { await refreshLive(); if (ok) notify(ok); }).catch(fail);
    };
    const saveAgent = (id: string | null, agent: Parameters<Store["updateAgent"]>[1]) => {
      const body = toApiAgent(agent);
      return id ? http.updateAgent(id, body) : http.createAgent({ ...body, agent_id: slugId(agent.name) });
    };
    return {
      ...api,
      state: view,
      live: true,
      liveUser,
      syncing,
      workspace,
      memberRole,
      permissions: perms,
      setRole: () => notify(t("En mode connecté, le rôle vient de votre compte."), "warn"),
      createAgent: (agent) => {
        const denied = comexOnly(); if (denied) return denied;
        if (agent.kind !== "metier") return later();
        if (!agent.name.trim() || !agent.mission.trim()) return { ok: false, reason: t("Nom et mission sont requis.") };
        run(saveAgent(null, agent), t("{{name}} est au registre.", { name: agent.name.trim() }));
        return { ok: true };
      },
      updateAgent: (id, agent) => {
        const denied = comexOnly(); if (denied) return denied;
        run(saveAgent(id, agent), t("{{name}} est mis à jour.", { name: agent.name.trim() }));
        return { ok: true };
      },
      setAgentEnabled: (agentId, enabled) => {
        const denied = comexOnly(); if (denied) return denied;
        run(http.updateAgent(agentId, { enabled }));
        return { ok: true };
      },
      createImpersonatorTeam: () => later(),
      createCollective: (input) => {
        if (!input.name.trim() || input.agentIds.length < 2) return { ok: false, reason: t("Nommez le collectif et choisissez au moins deux agents actifs.") };
        const promise = http.createSession({
          name: input.name.trim(), active_agents: input.agentIds,
          voting_threshold: votingToApi(input.voting), personality_simulation_enabled: input.personality,
        }).then((res) => setState((current) => ({ ...current, selectedCollectiveId: res.session.session_id })));
        run(promise, t("« {{name}} » est créé.", { name: input.name.trim() }));
        return { ok: true, id: "" };
      },
      addAgentToCollective: (collectiveId, agentId) => run(http.updateCollective(collectiveId, { add_agent_ids: [agentId] })),
      updateCollective: (id, patch) => {
        if (patch.name !== undefined || patch.voting !== undefined || patch.personality !== undefined) {
          return { ok: false, reason: t("Le nom et le mode de vote se fixent à la création en mode connecté.") };
        }
        if (patch.removeAgentId) run(http.updateCollective(id, { remove_agent_ids: [patch.removeAgentId] }), t("Agent retiré du collectif."));
        return { ok: true };
      },
      startMission: (draft) => {
        const denied = canRun();
        if (denied) { notify(denied.reason!, "stop"); return ""; }
        const collective = liveData.collectives.find((c) => c.id === draft.collectiveId) ?? liveData.collectives[0];
        const placeholder = uid("pending");
        const at = stamp();
        if (!collective) { notify(t("Créez d’abord un collectif."), "stop"); return placeholder; }
        const thread: Thread = {
          id: placeholder, question: draft.question.trim(), collectiveId: collective.id, status: "running",
          profile: draft.profile, provider: "serveur", useCase: draft.useCase, stage: "construire",
          agentIds: collective.agentIds, contributions: [], conditions: [], questions: [], evidence: draft.evidence,
          progress: { done: 0, total: Math.max(collective.agentIds.length, 1) }, createdAt: at, updatedAt: at,
          events: [{ at, label: tk("Mission lancée"), detail: tc(collective.name) }],
        };
        pending.current.set(placeholder, thread);
        setLiveData((current) => (current ? { ...current, threads: [thread, ...current.threads] } : current));
        const context = draft.evidence.map((e) => `${e.name}\n${e.text || e.summary || ""}`).join("\n\n").slice(0, 24000) || undefined;
        http.run(collective.id, { question: draft.question.trim(), profile: draft.profile, context })
          .then(async (res) => {
            pending.current.delete(placeholder);
            const realId = res.thread?.thread_id || res.thread_id;
            if (realId && window.location.hash.includes(placeholder)) {
              window.location.hash = window.location.hash.replace(placeholder, realId);
            }
            await refreshLive();
          })
          .catch((error) => { pending.current.delete(placeholder); void refreshLive(); fail(error); });
        return placeholder;
      },
      replyClarification: (threadId, reply) => {
        if (!reply.trim()) return;
        const denied = canRun(); if (denied) { notify(denied.reason!, "stop"); return; }
        run(http.reply(threadId, reply.trim()), t("Le collectif reprend l’instruction."));
      },
      poseQuestion: (threadId, question) => {
        if (!question.trim()) return { ok: false, reason: t("La question est vide.") };
        const denied = canRun(); if (denied) return denied;
        run(http.reply(threadId, question.trim()));
        return { ok: true };
      },
      arbitrate: (threadId, action, note) => {
        const denied = comexOnly(); if (denied) return denied;
        const body = action === "override" ? { action: "override_veto", justification: note, decision: "GO" }
          : action === "reevaluate" ? { action: "reevaluate", justification: note }
          : { action: "accept_consensus", justification: note, ...(action === "conditions" ? { decision: "CONDITIONAL_GO" } : {}) };
        if (action === "override" && !note.trim()) return { ok: false, reason: t("Une justification est requise pour lever un veto.") };
        const gated = liveData.threads.find((x) => x.id === threadId)?.gates;
        if (gated?.status === "blocked" && (action === "accept" || action === "conditions")) return { ok: false, reason: t("Une porte du projet est bloquée : demandez une réévaluation ou dérogez avec une justification.") };
        run(http.arbitrate(threadId, body), t("Arbitrage inscrit au journal."));
        return { ok: true };
      },
      addAgentToThread: () => later(),
      removeAgentFromThread: () => later(),
      deleteThread: () => later(),
      attachReading: () => later(),
      saveItem: async (kind, id, body) => {
        try {
          const res = id ? await http.updateItem(kind, id, body) : await http.createItem(kind, body);
          await refreshLive();
          return { ok: true, id: res.item.id };
        } catch (error) { return { ok: false, reason: (error as Error).message }; }
      },
      deleteItem: async (kind, id) => {
        try { await http.deleteItem(kind, id); await refreshLive(); return { ok: true }; }
        catch (error) { return { ok: false, reason: (error as Error).message }; }
      },
    };
  }, [api, liveData, liveUser, membership, state, syncing, workspace, refreshLive]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConsole() {
  const value = useContext(Ctx);
  if (!value) throw new Error(t("Console hors provider"));
  return value;
}
