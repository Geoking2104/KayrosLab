import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AgentPatch, LiteraryAuthor, LiteraryWork, Passage, SalonRoom, SalonTurn } from "./types";
import type { Locale } from "./i18n";
import { mergeSalonState, type SalonSnapshot, type SalonUser } from "./sso";

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export const SEED_ROOMS: SalonRoom[] = [
  {
    id: "lumieres",
    name: "Lumières",
    question: "Que reste-t-il de la liberté une fois qu’on a tout expliqué ?",
    authorIds: ["voltaire", "rousseau", "montaigne"],
    turns: [],
  },
  {
    id: "pouvoir",
    name: "Le pouvoir tel qu’il est",
    question: "Faut-il paraître vertueux pour gouverner, ou seulement l’être ?",
    authorIds: ["machiavel", "marcaurele", "suntzu"],
    turns: [],
  },
  {
    id: "academie",
    name: "Académie",
    question: "Qu’est-ce qu’une chose juste, si le plus fort l’appelle ainsi ?",
    authorIds: ["platon", "aristote", "montaigne"],
    turns: [],
  },
];

interface SalonState {
  rooms: SalonRoom[];
  hydrated: boolean;
  setHydrated: (v: boolean) => void;
  addTurn: (roomId: string, turn: Omit<SalonTurn, "id" | "createdAt">) => void;
  createRoom: (input: { name: string; question: string; authorIds: string[] }) => string;
  inviteAuthor: (roomId: string, authorId: string) => void;
  dismissAuthor: (roomId: string, authorId: string) => void;
  patches: Record<string, AgentPatch>;
  patchAgent: (authorId: string, patch: AgentPatch) => void;
  resetAgent: (authorId: string) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  customs: LiteraryAuthor[];
  extraWorks: Record<string, LiteraryWork[]>;
  extraPassages: Record<string, Passage[]>;
  addCustomAuthor: (author: LiteraryAuthor, passages: Passage[]) => void;
  addWork: (authorId: string, work: LiteraryWork, passages: Passage[]) => void;
  user: SalonUser | null;
  setUser: (user: SalonUser | null) => void;
  applyRemote: (incoming: SalonSnapshot) => void;
  snapshot: () => SalonSnapshot;
}

function withSeeds(rooms: SalonRoom[]) {
  const have = new Set(rooms.map((r) => r.id));
  const missing = SEED_ROOMS.filter((s) => !have.has(s.id));
  return [...missing, ...rooms];
}

export const useSalon = create<SalonState>()(
  persist(
    (set, get) => ({
      rooms: SEED_ROOMS,
      patches: {},
      locale: "fr",
      customs: [],
      extraWorks: {},
      extraPassages: {},
      hydrated: false,
      user: null,
      setUser: (user) => set({ user }),
      setHydrated: (v) => set({ hydrated: v }),
      addTurn: (roomId, turn) => {
        const next: SalonTurn = {
          ...turn,
          id: uid("t"),
          createdAt: new Date().toISOString(),
        };
        set({
          rooms: get().rooms.map((room) =>
            room.id === roomId ? { ...room, turns: [...room.turns, next] } : room,
          ),
        });
      },
      createRoom: (input) => {
        const id = uid("salon");
        const room: SalonRoom = {
          id,
          name: input.name.trim() || "Salon",
          question: input.question.trim(),
          authorIds: input.authorIds,
          turns: [],
        };
        set({ rooms: [room, ...get().rooms] });
        return id;
      },
      inviteAuthor: (roomId, authorId) => {
        set({
          rooms: get().rooms.map((room) => {
            if (room.id !== roomId) return room;
            if (room.authorIds.includes(authorId)) return room;
            return { ...room, authorIds: [...room.authorIds, authorId] };
          }),
        });
      },
      dismissAuthor: (roomId, authorId) => {
        set({
          rooms: get().rooms.map((room) => {
            if (room.id !== roomId || room.authorIds.length <= 2) return room;
            return { ...room, authorIds: room.authorIds.filter((id) => id !== authorId) };
          }),
        });
      },
      patchAgent: (authorId, patch) => {
        const current = get().patches[authorId] ?? {};
        set({
          patches: {
            ...get().patches,
            [authorId]: { ...current, ...patch },
          },
        });
      },
      resetAgent: (authorId) => {
        const next = { ...get().patches };
        delete next[authorId];
        set({ patches: next });
      },
      setLocale: (locale) => set({ locale }),
      addCustomAuthor: (author, passages) => {
        const extraPassages = {
          ...get().extraPassages,
          [author.id]: [...(get().extraPassages[author.id] ?? []), ...passages],
        };
        set({
          customs: [...get().customs.filter((a) => a.id !== author.id), author],
          extraPassages,
        });
      },
      addWork: (authorId, work, passages) => {
        const current = get().extraWorks[authorId] ?? [];
        if (current.some((w) => w.title === work.title)) return;
        const extraWorks = { ...get().extraWorks, [authorId]: [...current, work] };
        const extraPassages = {
          ...get().extraPassages,
          [authorId]: [...(get().extraPassages[authorId] ?? []), ...passages],
        };
        const customs = get().customs.map((author) =>
          author.id === authorId
            ? { ...author, works: [...author.works, work], works_count: author.works.length + 1 }
            : author,
        );
        set({ extraWorks, extraPassages, customs });
      },
      snapshot: () => {
        const s = get();
        return {
          version: 1,
          locale: s.locale,
          rooms: s.rooms,
          patches: s.patches,
          customs: s.customs,
          extraWorks: s.extraWorks,
          extraPassages: s.extraPassages,
        };
      },
      applyRemote: (incoming) => {
        const merged = mergeSalonState(incoming, get().snapshot());
        set({
          rooms: withSeeds(merged.rooms ?? []),
          patches: merged.patches ?? {},
          locale: merged.locale ?? get().locale,
          customs: merged.customs ?? [],
          extraWorks: merged.extraWorks ?? {},
          extraPassages: merged.extraPassages ?? {},
        });
      },
    }),
    {
      name: "kayros-salon-v2",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({
        rooms: s.rooms,
        patches: s.patches,
        locale: s.locale,
        customs: s.customs,
        extraWorks: s.extraWorks,
        extraPassages: s.extraPassages,
      }),
      merge: (persisted, current) => {
        const incoming = persisted as {
          rooms?: SalonRoom[];
          patches?: Record<string, AgentPatch>;
          locale?: Locale;
          customs?: LiteraryAuthor[];
          extraWorks?: Record<string, LiteraryWork[]>;
          extraPassages?: Record<string, Passage[]>;
        } | undefined;
        const rooms = incoming?.rooms ?? current.rooms;
        return {
          ...current,
          rooms: withSeeds(rooms),
          patches: { ...current.patches, ...(incoming?.patches ?? {}) },
          locale: incoming?.locale ?? current.locale,
          customs: incoming?.customs ?? current.customs,
          extraWorks: { ...current.extraWorks, ...(incoming?.extraWorks ?? {}) },
          extraPassages: { ...current.extraPassages, ...(incoming?.extraPassages ?? {}) },
        };
      },
    },
  ),
);
