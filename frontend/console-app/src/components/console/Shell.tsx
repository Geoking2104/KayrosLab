import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Building2,
  ChevronRight,
  CircleHelp,
  FolderKanban,
  FolderOpen,
  Gavel,
  Home,
  Library,
  Menu,
  Plus,
  Settings,
  Users,
  X,
} from "lucide-react";
import { ConsoleProvider, useConsole } from "@/lib/console/store";
import {
  PAGE_FROM_HASH,
  WORKSPACE_NAME,
  type Page,
} from "@/lib/console/model";
import { tokenStore } from "@/lib/console/api";
import { cn } from "@/lib/cn";
import { Today } from "./Today";
import { Dossier, Dossiers } from "./Dossiers";
import { Projets } from "./Projets";
import { Membres } from "./Membres";
import { MEMBER_ROLES } from "@/lib/console/roles";
import { Collectifs } from "./Collectifs";
import { Agents } from "./Agents";
import { Connexions } from "./Connexions";
import { Espace } from "./Espace";
import { Instruct } from "./Instruct";
import { Workbench } from "./Workbench";
import { Demo } from "./Demo";
import { Societe } from "./Societe";
import { Bibliotheque } from "./Bibliotheque";
import { DecisionGuide } from "./DecisionGuide";
import { LANGS, setLanguage, t, useLang, type Lang } from "@/lib/i18n";

const NAV = [
  { id: "overview", label: () => t("Aujourd’hui"), icon: Home, group: 0 },
  { id: "dossiers", label: () => t("Décisions"), icon: FolderOpen, group: 0 },
  { id: "arbitrages", label: () => t("Arbitrages"), icon: Gavel, group: 0 },
  {
    id: "collectifs",
    label: () => t("Comités et agents"),
    icon: Users,
    group: 0,
  },
  {
    id: "bibliotheque",
    label: () => t("Sources et savoirs"),
    icon: Library,
    group: 0,
  },
  {
    id: "projets",
    label: () => t("Projets et parcours"),
    icon: FolderKanban,
    group: 1,
  },
  { id: "societe", label: () => t("Organisation"), icon: Building2, group: 1 },
  { id: "reglages", label: () => t("Réglages"), icon: Settings, group: 1 },
] satisfies {
  id: Page;
  label: () => string;
  icon: typeof Home;
  group: number;
}[];
const SECTION: Partial<Record<Page, Page>> = {
  overview: "overview",
  societe: "societe",
  projets: "projets",
  dossiers: "dossiers",
  arbitrages: "arbitrages",
  bibliotheque: "bibliotheque",
  agents: "collectifs",
  collectifs: "collectifs",
  reglages: "reglages",
  connexions: "reglages",
  espace: "reglages",
  membres: "reglages",
};
const TABS: Partial<Record<Page, { id: Page; label: () => string }[]>> = {
  collectifs: [
    { id: "collectifs", label: () => t("Comités") },
    { id: "agents", label: () => t("Agents") },
  ],
  reglages: [
    { id: "connexions", label: () => t("Connexions") },
    { id: "membres", label: () => t("Membres") },
    { id: "espace", label: () => t("Espace") },
  ],
};

export function go(
  page: Page,
  extra?: string | { thread?: string; agent?: string; dossier?: string },
) {
  let hash: string = page;
  if (typeof extra === "string")
    hash = `${page}?thread=${encodeURIComponent(extra)}`;
  else if (extra) {
    const params = new URLSearchParams();
    if (extra.thread) params.set("thread", extra.thread);
    if (extra.agent) params.set("agent", extra.agent);
    if (extra.dossier) params.set("dossier", extra.dossier);
    const query = params.toString();
    if (query) hash = `${page}?${query}`;
  }
  if (window.location.hash.replace(/^#/, "") !== hash)
    window.location.hash = hash;
}
function readLocation() {
  const raw = window.location.hash.replace(/^#/, "");
  const [path, query = ""] = raw.split("?");
  const page = PAGE_FROM_HASH[path || "overview"] ?? "overview";
  const params = new URLSearchParams(query);
  return {
    page,
    thread: params.get("thread") ?? "",
    agent: params.get("agent") ?? "",
    dossier: params.get("dossier") ?? "",
    legacy: path,
  };
}
export function ConsoleApp() {
  useLang();
  return (
    <ConsoleProvider>
      <Frame />
    </ConsoleProvider>
  );
}
function Frame() {
  const {
    state,
    clearNotice,
    setRole,
    live,
    liveUser,
    memberRole,
    permissions,
  } = useConsole();
  const [loc, setLoc] = useState(readLocation);
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const sync = () => {
      setLoc(readLocation());
      setMenu(false);
    };
    window.addEventListener("hashchange", sync);
    if (!window.location.hash) window.location.hash = "overview";
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menu) {
        setMenu(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menu]);
  const page = loc.page;
  const waiting = state.threads.filter(
    (thread) => thread.status === "awaiting_arbitration",
  ).length;
  const title =
    page === "instruire"
      ? t("Instruire une décision")
      : page === "guide"
        ? t("Prise en main")
        : page === "workbench"
          ? t("Parcours avancés et graphes")
          : page === "demo"
            ? t("Démo publique")
            : (NAV.find((item) => item.id === SECTION[page])?.label() ??
              t("Espace"));
  return (
    <div className="console-frame">
      <a
        href="#console-main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("console-main")?.focus();
        }}
        className="skip-link"
      >
        {t("Aller au contenu")}
      </a>
      <aside
        id="console-navigation"
        className={cn("console-sidebar", menu && "is-open")}
      >
        <a href="#overview" className="flex items-center gap-3 px-5 py-6">
          <Mark />
          <span className="text-base font-semibold tracking-tight">
            KayrosLab
            <span className="block text-[11px] font-normal text-muted">
              {t("Décisions éclairées")}
            </span>
          </span>
        </a>
        {permissions.includes("run") && (
          <a
            href="#instruire"
            className="mx-3 mb-5 flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-medium text-white hover:bg-accent-strong"
          >
            <Plus size={16} />
            {t("Nouvelle décision")}
          </a>
        )}
        <nav className="flex-1 px-3" aria-label={t("Navigation")}>
          {[0, 1].map((group) => (
            <div key={group} className="mb-6">
              <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                {group === 0
                  ? t("Piloter les décisions")
                  : t("Organiser l’espace")}
              </p>
              {NAV.filter((item) => item.group === group).map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  aria-current={SECTION[page] === item.id ? "page" : undefined}
                  className={cn(
                    "nav-link",
                    SECTION[page] === item.id && "is-active",
                  )}
                >
                  <item.icon size={17} strokeWidth={1.7} />
                  <span>{item.label()}</span>
                  {item.id === "arbitrages" && waiting > 0 && (
                    <span className="ml-auto rounded bg-surface px-1.5 text-[10px] tabular-nums">
                      {waiting}
                    </span>
                  )}
                </a>
              ))}
            </div>
          ))}
          <a
            href="#guide"
            className={cn("nav-link", page === "guide" && "is-active")}
            aria-current={page === "guide" ? "page" : undefined}
          >
            <CircleHelp size={17} />
            {t("Prise en main")}
          </a>
        </nav>
        <div className="border-t border-line p-3">
          <a
            href="#espace"
            className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-paper"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
              {initials(liveUser?.email ?? WORKSPACE_NAME)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold">
                {live ? liveUser?.email : WORKSPACE_NAME}
              </span>
              <span className="block text-[11px] text-muted">
                {live ? t("Espace connecté") : t("Espace de démonstration")}
              </span>
            </span>
          </a>
          {live ? (
            <>
              <p
                className="truncate rounded-md bg-go-soft px-2 py-1 text-[11px] text-go"
                data-testid="live-badge"
              >
                {t("Connecté à l’API · {{v}}", { v: liveUser?.email ?? "" })}
              </p>
              <a
                href="#membres"
                className="mt-2 block px-2 text-[11px] text-muted"
                data-testid="member-role"
              >
                {t("Rôle : {{v}}", {
                  v:
                    MEMBER_ROLES.find((r) => r.id === memberRole)?.label ??
                    memberRole,
                })}
              </a>
            </>
          ) : (
            <DemoMember role={state.role} onChange={setRole} />
          )}
        </div>
      </aside>
      <div className="min-w-0">
        <header className="console-header">
          <button
            ref={menuButton}
            type="button"
            onClick={() => setMenu(!menu)}
            aria-controls="console-navigation"
            aria-expanded={menu}
            aria-label={t("Ouvrir la navigation")}
            className="grid size-10 shrink-0 place-items-center rounded-lg hover:bg-paper lg:hidden"
          >
            {menu ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            <span className="hidden text-muted sm:inline">{t("Console")}</span>
            <ChevronRight size={14} className="hidden text-muted sm:block" />
            <span className="truncate font-medium">{title}</span>
          </div>
          {!live && (
            <span className="hidden rounded bg-hold-soft px-2 py-1 text-[11px] text-hold sm:inline">
              {tokenStore.get() ? t("Connexion en cours") : t("Mode démo")}
            </span>
          )}
          <a
            href="#guide"
            aria-label={t("Prise en main")}
            className="grid size-9 place-items-center rounded-lg text-muted hover:bg-paper"
          >
            <BookOpen size={17} />
          </a>
          <LangSwitch />
        </header>
        {state.notice && (
          <div
            className={cn(
              "mx-4 mt-4 flex items-start justify-between gap-3 rounded-lg border border-line px-4 py-3 text-sm md:mx-8",
              state.notice.tone === "stop"
                ? "bg-stop-soft text-stop"
                : state.notice.tone === "warn"
                  ? "bg-hold-soft text-hold"
                  : "bg-accent-soft",
            )}
            role="status"
          >
            <p>{state.notice.text}</p>
            <button
              type="button"
              aria-label={t("Fermer le message")}
              onClick={clearNotice}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <main
          id="console-main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1440px] px-4 py-6 outline-none md:px-8 md:py-8"
        >
          {SECTION[page] && TABS[SECTION[page]!] && (
            <nav
              className="mb-6 flex gap-1 border-b border-line"
              aria-label={t("Sous-sections")}
            >
              {TABS[SECTION[page]!]!.map((tab) => (
                <a
                  key={tab.id}
                  href={`#${tab.id}`}
                  aria-current={
                    tab.id === page ||
                    (page === "reglages" && tab.id === "connexions")
                      ? "page"
                      : undefined
                  }
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2 text-sm",
                    tab.id === page ||
                      (page === "reglages" && tab.id === "connexions")
                      ? "border-accent font-medium text-accent"
                      : "border-transparent text-muted",
                  )}
                >
                  {tab.label()}
                </a>
              ))}
            </nav>
          )}
          {page === "overview" && <Today />}
          {page === "arbitrages" && <Today key="approvals" approvals />}
          {page === "guide" && <DecisionGuide />}
          {page === "societe" && <Societe />}
          {page === "projets" && <Projets />}
          {page === "bibliotheque" && <Bibliotheque />}
          {page === "dossiers" && <Dossiers threadId="" />}
          {page === "collectifs" && <Collectifs />}
          {page === "agents" && (
            <Agents agentId={loc.agent} dossierId={loc.dossier} />
          )}
          {(page === "connexions" || page === "reglages") && (
            <Connexions legacy={loc.legacy} />
          )}
          {page === "espace" && <Espace />}
          {page === "membres" && <Membres />}
          {page === "instruire" && <Instruct />}
          {page === "workbench" && <Workbench />}
          {page === "demo" && <Demo />}
        </main>
      </div>
      {loc.thread && (
        <DossierPanel threadId={loc.thread} onClose={() => go(page)} />
      )}
    </div>
  );
}

function DossierPanel({
  threadId,
  onClose,
}: {
  threadId: string;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const getFocusable = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0);
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const nodes = getFocusable();
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (!first) {
          e.preventDefault();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === panel.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <aside
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("Dossier")}
        data-testid="dossier-panel"
        className="relative h-full w-full max-w-4xl overflow-y-auto border-l border-line bg-paper px-4 pb-6 pt-14 shadow-xl outline-none md:px-6"
      >
        <button
          type="button"
          aria-label={t("Fermer le dossier")}
          onClick={onClose}
          className="absolute right-3 top-3 grid size-9 place-items-center rounded-lg border border-line bg-surface"
        >
          <X size={18} />
        </button>
        <Dossier key={threadId} threadId={threadId} />
      </aside>
    </div>
  );
}

function LangSwitch() {
  const lang = useLang();
  return (
    <div
      className="grid grid-cols-2 gap-0.5 rounded-lg border border-line bg-paper p-0.5"
      role="group"
      aria-label={t("Langue de la console")}
    >
      {LANGS.map((item: Lang) => (
        <button
          key={item}
          type="button"
          lang={item}
          onClick={() => void setLanguage(item)}
          aria-pressed={lang === item}
          title={item === "en" ? "English" : "Français"}
          className={cn(
            "min-h-8 min-w-9 rounded-md px-1.5 text-xs font-semibold uppercase",
            lang === item ? "bg-surface text-ink shadow-card" : "text-muted",
          )}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function Mark() {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo-kayroslab.png`}
      alt=""
      width={28}
      height={28}
      className="h-7 w-7 rounded-[7px]"
    />
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

// Mode démo : on choisit un membre fictif de l’espace ; son rôle fixe les droits.
const DEMO_MEMBERS = [
  { id: "comex", name: "Camille Renaud", role: "comex" as const },
  { id: "contributeur", name: "Sam Martin", role: "contributeur" as const },
];

function DemoMember({
  role,
  onChange,
}: {
  role: "contributeur" | "comex";
  onChange: (role: "contributeur" | "comex") => void;
}) {
  return (
    <label className="mt-2 grid gap-1 text-[11px] text-muted">
      {t("Membre de démo")}
      <select
        aria-label={t("Membre de démo")}
        className="min-h-8 rounded-lg border border-line bg-paper px-2 text-xs text-ink"
        value={role}
        onChange={(e) => onChange(e.target.value as "contributeur" | "comex")}
      >
        {DEMO_MEMBERS.map((m) => (
          <option key={m.id} value={m.role}>
            {m.name} · {MEMBER_ROLES.find((r) => r.id === m.role)?.label}
          </option>
        ))}
      </select>
    </label>
  );
}
