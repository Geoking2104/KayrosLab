import { useEffect, useState } from "react";
import {
  Bot,
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

const NAV: { id: Page; label: string; short: string; icon: typeof Inbox }[] = [
  { id: "overview", label: "Aujourd’hui", short: "Jour", icon: Inbox },
  { id: "dossiers", label: "Dossiers", short: "Dossiers", icon: FolderOpen },
  { id: "collectifs", label: "Collectifs", short: "Équipes", icon: Users },
  { id: "agents", label: "Agents", short: "Agents", icon: Bot },
  { id: "connexions", label: "Connexions", short: "Liens", icon: Plug },
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
  const page = PAGE_FROM_HASH[path || "overview"] ?? "overview";
  const params = new URLSearchParams(query);
  return { page, thread: params.get("thread") ?? "", agent: params.get("agent") ?? "", dossier: params.get("dossier") ?? "", legacy: path };
}

export function ConsoleApp() {
  return (
    <ConsoleProvider>
      <Frame />
    </ConsoleProvider>
  );
}

function Frame() {
  const { state, clearNotice, setRole } = useConsole();
  const [loc, setLoc] = useState({ page: "overview" as Page, thread: "", agent: "", dossier: "", legacy: "overview" });

  useEffect(() => {
    const sync = () => setLoc(readLocation());
    sync();
    window.addEventListener("hashchange", sync);
    if (!window.location.hash) window.location.hash = "overview";
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const page = loc.page;
  const waiting = state.threads.filter((thread) => thread.status === "awaiting_arbitration" || thread.status === "needs_clarification").length;

  return (
    <div className="min-h-screen bg-paper text-ink md:grid md:grid-cols-[240px_1fr]">
      <aside className="hidden border-r border-line bg-surface md:flex md:flex-col">
        <a href="#overview" className="flex items-center gap-3 px-4 py-5">
          <Mark />
          <span>
            <span className="block text-[17px] font-bold leading-tight tracking-[-0.02em]">KayrosLab</span>
            <span className="block text-xs text-muted">Console</span>
          </span>
        </a>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={cn("flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-sm font-semibold", active ? "bg-accent text-white shadow-cta" : "text-ink-soft hover:bg-paper")}
              >
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                {item.label}
                {item.id === "dossiers" && waiting > 0 ? (
                  <span className="ml-auto rounded-full bg-hold-soft px-2 py-0.5 text-xs font-medium text-hold">{waiting}</span>
                ) : null}
              </a>
            );
          })}
        </nav>
        <div className="border-t border-line p-3">
          <a href="#espace" className={cn("block rounded-2xl px-3 py-2", page === "espace" ? "bg-accent text-white" : "bg-paper text-ink")}>
            <span className="block text-sm font-semibold">{WORKSPACE_NAME}</span>
            <span className={cn("block truncate text-xs", page === "espace" ? "text-white/80" : "text-muted")}>{WORKSPACE_EMAIL}</span>
          </a>
          <RoleSwitch role={state.role} onChange={setRole} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white/90 px-4 py-3 backdrop-blur md:px-8">
          <span className="md:hidden">
            <Mark />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold tracking-tight text-ink md:text-base">
              {page === "instruire" ? "Instruire une décision" : page === "workbench" ? "Workbench" : page === "demo" ? "Démo publique" : NAV.find((item) => item.id === page)?.label ?? "Espace"}
            </p>
            <p className="truncate text-xs text-muted">Verdict consultatif jusqu’à l’arbitrage humain</p>
          </div>
          {page !== "instruire" ? (
            <a href="#instruire" className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-accent px-3 text-sm font-semibold text-white shadow-cta hover:bg-accent-strong md:px-4">
              <Scale size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Instruire une décision</span>
              <span className="sm:hidden">Instruire</span>
            </a>
          ) : (
            <a href="#overview" className="inline-flex min-h-11 items-center rounded-[10px] border border-line bg-white px-3 text-sm font-semibold text-ink">
              Fermer
            </a>
          )}
        </header>

        {state.notice ? (
          <div className={cn("mx-4 mt-4 flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm md:mx-8", state.notice.tone === "stop" ? "border-line bg-stop-soft text-stop" : state.notice.tone === "warn" ? "border-line bg-hold-soft text-hold" : "border-line bg-accent-soft text-ink")} role="status">
            <p>{state.notice.text}</p>
            <button type="button" aria-label="Fermer le message" onClick={clearNotice} className="rounded-lg p-1">
              <X size={16} />
            </button>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-28 md:px-8 md:pb-10">
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

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface md:hidden" aria-label="Navigation">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = page === item.id;
          return (
            <a key={item.id} href={`#${item.id}`} className={cn("flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-semibold", active ? "bg-accent-soft text-accent" : "text-muted")}>
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              {item.short}
            </a>
          );
        })}
      </nav>
    </div>
  );
}

function Mark() {
  return <img src={`${import.meta.env.BASE_URL}logo-kayroslab.png`} alt="" width={28} height={28} className="h-7 w-7 rounded-[7px]" />;
}

function RoleSwitch({ role, onChange }: { role: "contributeur" | "comex"; onChange: (role: "contributeur" | "comex") => void }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-paper p-1" role="group" aria-label="Rôle de l’espace">
      {(
        [
          ["contributeur", "Contrib."],
          ["comex", "COMEX"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn("min-h-10 rounded-md text-xs font-medium", role === id ? "bg-surface text-ink" : "text-muted")}
          aria-pressed={role === id}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
