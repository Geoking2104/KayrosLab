import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/kayros/types";
import { useKayros } from "@/lib/kayros/store";

export function t(locale: Locale, fr: string, en: string) {
  return locale === "fr" ? fr : en;
}

export function InlineEdit({
  value,
  onChange,
  className,
  multiline,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const edit = useKayros((s) => s.editEverything);
  const hydrated = useKayros((s) => s.hydrated);
  if (!edit || !hydrated) return <span className={className}>{value || placeholder}</span>;
  if (multiline) {
    return (
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        rows={3}
        suppressHydrationWarning
        className={cn(
          "w-full resize-y rounded-md border border-line bg-paper px-2 py-1.5 text-ink outline-none focus:border-accent",
          className,
        )}
      />
    );
  }
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      suppressHydrationWarning
      className={cn(
        "w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-inherit outline-none hover:border-line focus:border-accent",
        className,
      )}
    />
  );
}

export function Pill({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "positive" | "warning" | "danger";
}) {
  const map = {
    muted: "bg-raised text-muted border-line",
    accent: "bg-accent/15 text-accent border-accent/30",
    positive: "bg-positive/15 text-positive border-positive/30",
    warning: "bg-warning/15 text-warning border-warning/30",
    danger: "bg-danger/15 text-danger border-danger/30",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-micro font-medium tracking-wide", map[tone])}>
      {children}
    </span>
  );
}

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface p-4 md:p-5", className)}>
      {children}
    </section>
  );
}

export function Kicker({ children }: { children: React.ReactNode }) {
  return <p className="text-micro uppercase tracking-[0.18em] text-faint">{children}</p>;
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1 text-xs text-muted">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function ScoreRing({ value, label }: { value: number; label: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(10, value)) / 10;
  return (
    <div className="relative grid size-24 place-items-center">
      <svg viewBox="0 0 80 80" className="size-24 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="currentColor" className="text-line" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="currentColor"
          className="text-accent"
          strokeWidth="6"
          strokeDasharray={`${c * pct} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-lg tabular leading-none">{value.toFixed(1)}</div>
        <div className="text-micro text-muted">{label}</div>
      </div>
    </div>
  );
}
