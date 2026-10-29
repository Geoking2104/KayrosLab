import { useEffect, useState } from "react";
import {
  Bot,
  Building2,
  Library,
  FolderOpen,
  Inbox,
  Plug,
  Scale,
  Users,
  X,
} from "lucide-react";
import { ConsoleProvider, useConsole } from "@/lib/console/store";
import { PAGE_FROM_HASH, WORKSPACE_EMAIL, WORKSPACE_NAME, type Page } from "@/lib/console/model";
import { cn } from "@/lib/cn";
import { Today } from "./Today";
import { Dossiers } from "./Dossiers";
import { Collectifs } from "./Collectifs";
import { Agents } from "./Agents";
import { Connexions } from "./Connexions";
import { Espace } from "./Espace";
import { Instruct } from "./Instruct";
import { Workbench } from "./Workbench";
import { Demo } from "./Demo";
import { Societe } from "./Societe";
import { Bibliotheque } from "./Bibliotheque";
import { LANGS, setLanguage, t, useLang, type Lang } from "@/lib/i18n";

const NAV: { id: Page; label: string; short: string; icon: typeof Inbox; soft: string; ink: string }[] = [
  { id: "societe", get label() { return t("Société"); }, get short() { return t("Société"); }, icon: Building2, soft: "bg-accent-soft", ink: "text-accent" },
  { id: "overview", get label() { return t("Aujourd’hui"); }, get short() { return t("Jour"); }, icon: Inbox, soft: "bg-accent-soft", ink: "text-accent" },
  { id: "dossiers", get label() { return t("Dossiers"); }, get short() { return t("Dossiers"); }, icon: FolderOpen, soft: "bg-teal-soft", ink: "text-teal" },
  { id: "collectifs", get label() { return t("Collectifs"); }, get short() { return t("Équipes"); }, icon: Users, soft: "bg-hold-soft", ink: "text-hold" },
  { id: "agents", get label() { return t("Agents"); }, get short() { return t("Agents"); }, icon: Bot, soft: "bg-violet-soft", ink: "text-violet" },
  { id: "bibliotheque", get label() { return t("Bibliothèque"); }, get short() { return t("Biblio"); }, icon: Library, soft: "bg-teal-soft", ink: "text-teal" },
  { id: "connexions", get label() { return t("Connexions"); }, get short() { return t("Liens"); }, icon: Plug, soft: "bg-go-soft", ink: "text-go" },
];

export function go(page: Page, extra?: string | { thread?: string; agent?: string; dossier?: string }) {
  let hash: string = page;
  if (typeof extra === "string") hash = `${page}?thread=${encodeURIComponent(extra)}`;
  else if (extra) {
    const params = new URLSearchParams();
    if (extra.thread) params.set("thread", extra.thread);
    if (extra.agent) params.set("agent", extra.agent);
    if (extra.dossier) params.set("dossier", extra.dossier);
    const query = params.toString();
    if (query) hash = `${page}?${query}`;
  }
  if (window.location.hash.replace(/^#/, "") !== hash) window.location.hash = hash;
}

function readLocation() {
  if (typeof window === "undefined") return { page: "overview" as Page, thread: "", agent: "", dossier: "", legacy: "overview" };
  const raw = window.location.hash.replace(/^#/, "");
  const [path, query = ""] = raw.split("?");
  const page = PAGE_FROM_HASH[path || "societe"] ?? "societe";
  const params = new URLSearchParams(query);
  return { page, thread: params.get("thread") ?? "", agent: params.get("agent") ?? "", dossier: params.get("dossier") ?? "", legacy: path };
}

export function ConsoleApp() {
  const lang = useLang();
  return (
    <ConsoleProvider>
      <Frame key={lang} />
    </ConsoleProvider>
  );
}

function Frame() {
  const { state, clearNotice, setRole, live, liveUser } = useConsole();
  const [loc, setLoc] = useState({ page: "overview" as Page, thread: "", agent: "", dossier: "", legacy: "overview" });

  useEffect(() => {
    const sync = () => setLoc(readLocation());
    sync();
    window.addEventListener("hashchange", sync);
    if (!window.location.hash) window.location.hash = "societe";
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const page = loc.page;
  const waiting = state.threads.filter((thread) => thread.status === "awaiting_arbitration" || thread.status === "needs_clarification").length;

  return (
    <div className="min-h-screen bg-paper text-ink md:grid md:grid-cols-[232px_1fr]">
      <aside className="hidden border-r border-line bg-surface md:flex md:flex-col">
        <a href="#overview" className="flex items-center gap-2.5 px-4 py-4">
          <Mark />
          <span>
            <span className="block text-[15px] font-semibold leading-tight tracking-[-0.02em] text-ink">KayrosLab</span>
            <span className="block text-[11px] font-medium tracking-wide text-muted">Console</span>
          </span>
        </a>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-sm font-medium",
                  active ? cn(item.soft, "text-ink") : "text-ink-soft hover:bg-paper",
                )}
              >
                <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", item.ink, active ? "bg-white" : item.soft)}>
                  <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                </span>
                {item.label}
                {item.id === "dossiers" && waiting > 0 ? (
                  <span className="ml-auto min-w-5 rounded-md bg-white px-1.5 text-center text-[11px] font-semibold tabular-nums text-ink">{waiting}</span>
                ) : null}
              </a>
            );
          })}
        </nav>
        <div className="border-t border-line p-3">
          <a href="#espace" className={cn("flex items-center gap-2.5 rounded-xl px-2 py-2", page === "espace" ? "bg-accent-soft" : "hover:bg-paper")}>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold text-white">{initials(WORKSPACE_NAME)}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{WORKSPACE_NAME}</span>
              <span className="block truncate text-[11px] text-muted">{WORKSPACE_EMAIL}</span>
            </span>
          </a>
          {live ? (
            <p className="rounded-md bg-go-soft px-2 py-1 text-xs text-go" data-testid="live-badge">{t("Connecté à l’API · {{v}}", { v: liveUser?.email ?? "" })}</p>
          ) : (
            <RoleSwitch role={state.role} onChange={setRole} />
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white/85 px-4 py-2.5 backdrop-blur md:px-8">
          <span className="md:hidden">
            <Mark />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight text-ink">
              {page === "instruire" ? t("Instruire une décision") : page === "workbench" ? "Workbench" : page === "demo" ? t("Démo publique") : NAV.find((item) => item.id === page)?.label ?? t("Espace")}
            </p>
            <p className="truncate text-[11px] text-muted">{t("Verdict consultatif jusqu’à l’arbitrage humain")}</p>
          </div>
          {!live ? <span className="rounded-md bg-hold-soft px-2 py-1 text-[11px] text-hold">{t("Mode démo")}</span> : null}
          <LangSwitch />
          {page !== "instruire" ? (
            <a href="#instruire" className="inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-accent px-3 text-sm font-semibold text-white shadow-cta hover:bg-accent-strong md:px-3.5">
              <Scale size={15} aria-hidden="true" />
              <span className="hidden sm:inline">{t("Instruire une décision")}</span>
              <span className="sm:hidden">{t("Instruire")}</span>
            </a>
          ) : (
            <a href="#overview" className="inline-flex min-h-10 items-center rounded-[10px] border border-line bg-white px-3 text-sm font-semibold text-ink">{t("Fermer")}</a>
          )}
        </header>

        {state.notice ? (
          <div className={cn("mx-4 mt-4 flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm md:mx-8", state.notice.tone === "stop" ? "border-line bg-stop-soft text-stop" : state.notice.tone === "warn" ? "border-line bg-hold-soft text-hold" : "border-line bg-accent-soft text-ink")} role="status">
            <p>{state.notice.text}</p>
            <button type="button" aria-label={t("Fermer le message")} onClick={clearNotice} className="rounded-lg p-1">
              <X size={16} />
            </button>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-28 md:px-8 md:pb-10">
          {page === "societe" && <Societe />}
          {page === "bibliotheque" && <Bibliotheque />}
          {page === "overview" && <Today />}
          {page === "dossiers" && <Dossiers threadId={loc.thread} />}
          {page === "collectifs" && <Collectifs />}
          {page === "agents" && <Agents agentId={loc.agent} dossierId={loc.dossier} />}
          {page === "connexions" && <Connexions legacy={loc.legacy} />}
          {page === "espace" && <Espace />}
          {page === "instruire" && <Instruct />}
          {page === "workbench" && <Workbench />}
          {page === "demo" && <Demo />}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 backdrop-blur md:hidden" aria-label={t("Navigation")}>
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = page === item.id;
          return (
            <a key={item.id} href={`#${item.id}`} aria-current={active ? "page" : undefined} className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 border-t-2 text-[11px] font-medium", active ? cn(item.ink, "border-current") : "border-transparent text-muted")}>
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" className={active ? item.ink : "text-muted"} />
              {item.short}
            </a>
          );
        })}
      </nav>
    </div>
  );
}

function LangSwitch() {
  const lang = useLang();
  return (
    <div className="grid grid-cols-2 gap-0.5 rounded-lg border border-line bg-paper p-0.5" role="group" aria-label={t("Langue de la console")}>
      {LANGS.map((item: Lang) => (
        <button
          key={item}
          type="button"
          lang={item}
          onClick={() => void setLanguage(item)}
          aria-pressed={lang === item}
          title={item === "en" ? "English" : "Français"}
          className={cn("min-h-8 min-w-9 rounded-md px-1.5 text-xs font-semibold uppercase", lang === item ? "bg-surface text-ink shadow-card" : "text-muted")}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function Mark() {
  return <img src={`${import.meta.env.BASE_URL}logo-kayroslab.png`} alt="" width={28} height={28} className="h-7 w-7 rounded-[7px]" />;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function RoleSwitch({ role, onChange }: { role: "contributeur" | "comex"; onChange: (role: "contributeur" | "comex") => void }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-paper p-1" role="group" aria-label={t("Rôle de l’espace")}>
      {(
        [
          ["contributeur", t("Contrib.")],
          ["comex", "COMEX"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn("min-h-9 rounded-md text-xs font-semibold", role === id ? "bg-surface text-ink shadow-card" : "text-muted")}
          aria-pressed={role === id}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
