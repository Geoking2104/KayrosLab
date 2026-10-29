import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import type { ThreadStatus, Verdict } from "@/lib/console/model";
import { STATUS_LABEL, VERDICT_LABEL } from "@/lib/console/model";
import { t } from "@/lib/i18n";

export function ProgressBar({
  done,
  total,
  label = t("Tâches"),
  active = false,
}: {
  done: number;
  total: number;
  label?: string;
  active?: boolean;
}) {
  const safeTotal = Math.max(total, 1);
  const value = Math.min(Math.max(done, 0), safeTotal);
  const moving = active && value < safeTotal;
  const ratio = Math.round(((value + (moving ? 0.45 : 0)) / safeTotal) * 100);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span>{label}</span>
        <span>{value}/{safeTotal}</span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={safeTotal}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.min(ratio, 100)}%` }} />
      </div>
    </div>
  );
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] px-4 py-2 text-sm font-semibold transition-[background-color,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45",
        variant === "primary" && "bg-accent text-accent-ink shadow-cta hover:bg-accent-strong",
        variant === "secondary" && "border border-line bg-surface text-ink shadow-none hover:bg-paper",
        variant === "ghost" && "text-ink-soft shadow-none hover:bg-paper-2 hover:text-ink",
        variant === "danger" && "border border-line bg-stop-soft text-stop shadow-none",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-relaxed text-muted">{hint}</span> : null}
    </label>
  );
}

export const controlClass =
  "min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/15";

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(controlClass, "min-h-28 py-3 leading-relaxed", props.className)} />;
}

export function StatusPill({ status }: { status: ThreadStatus }) {
  const tone =
    status === "awaiting_arbitration"
      ? "bg-hold-soft text-hold"
      : status === "needs_clarification"
        ? "bg-info-soft text-info"
        : status === "resolved"
          ? "bg-go-soft text-go"
          : status === "failed"
            ? "bg-stop-soft text-stop"
            : "bg-paper-2 text-ink-soft";
  return <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide", tone)}>{STATUS_LABEL[status]}</span>;
}

export function VerdictPill({ verdict }: { verdict?: Verdict }) {
  if (!verdict) return null;
  const tone = verdict === "GO" ? "bg-go-soft text-go" : verdict === "NO_GO" ? "bg-stop-soft text-stop" : "bg-hold-soft text-hold";
  return <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide", tone)}>{VERDICT_LABEL[verdict]}</span>;
}

export function Panel({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <section style={style} className={cn("rounded-2xl border border-line bg-surface p-4 shadow-card md:p-5", className)}>{children}</section>;
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface px-5 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Section repliable : l’état ouvert/fermé est mémorisé par clé dans le navigateur. */
export function Section({ id, title, summary, actions, defaultOpen = true, children }: { id: string; title: string; summary?: ReactNode; actions?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const key = `kayroslab.section.${id}`;
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(key); return v == null ? defaultOpen : v === "1"; } catch { return defaultOpen; }
  });
  const toggle = () => setOpen((current) => {
    try { localStorage.setItem(key, current ? "0" : "1"); } catch { /* stockage indisponible */ }
    return !current;
  });
  return (
    <section className="rounded-2xl border border-line bg-surface shadow-card" data-section={id} data-open={open ? "1" : "0"}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 md:px-5">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={`section-${id}`} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown size={16} aria-hidden="true" className={cn("shrink-0 text-muted transition-transform", open ? "" : "-rotate-90")} />
          <span className="text-sm font-semibold text-ink">{title}</span>
          {!open && summary ? <span className="truncate text-xs text-muted">{summary}</span> : null}
        </button>
        {open && actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {open ? <div id={`section-${id}`} className="border-t border-line px-4 py-4 md:px-5">{children}</div> : null}
    </section>
  );
}
