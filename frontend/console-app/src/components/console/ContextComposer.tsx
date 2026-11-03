import { useState } from "react";
import { api, type RephraseResult } from "@/lib/console/api";
import { Button, Field, TextArea, controlClass } from "./ui";
import { t } from "@/lib/i18n";

export type GuidedMode = "rfp" | "interne";
/** Champs guidés (miroir de core/context-rephrase.mjs). */
export const GUIDED_FIELDS: Record<GuidedMode, { key: string; label: () => string }[]> = {
  rfp: [
    { key: "demande_client", label: () => t("Demande initiale du client") },
    { key: "contexte_interne", label: () => t("Contexte interne") },
    { key: "contexte_client", label: () => t("Contexte côté client") },
    { key: "equipe_decision", label: () => t("Équipe qui décide") },
  ],
  interne: [
    { key: "perimetre", label: () => t("Périmètre") },
    { key: "contexte_societe", label: () => t("Contexte société") },
    { key: "contexte_projet", label: () => t("Contexte projet") },
    { key: "competences", label: () => t("Compétences disponibles") },
  ],
};

export interface ComposerValue { mode: GuidedMode; raw_input: string; structured: Record<string, string>; content: string }

/** Badge brouillon / validé d’une source de contexte. */
export function StatusBadge({ status }: { status?: "draft" | "validated" }) {
  if (status === "draft") return <span className="rounded bg-hold-soft px-1.5 text-[11px] font-semibold text-hold" data-testid="context-status">{t("Brouillon")}</span>;
  return <span className="rounded bg-go-soft px-1.5 text-[11px] font-semibold text-go" data-testid="context-status">{t("Validé")}</span>;
}

/**
 * Saisie guidée (RFP / AO ou projet interne) : texte libre + champs, puis
 * « Reformuler / confirmer la compréhension ». Le brief reformulé reste éditable ;
 * seule la version validée devient la source de contexte injectée.
 */
export function ContextComposer({ mode, value, onChange, onValidate, onSaveDraft }: {
  mode: GuidedMode; value: ComposerValue; onChange: (v: ComposerValue) => void;
  onValidate: (v: ComposerValue) => void; onSaveDraft: (v: ComposerValue) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RephraseResult | null>(null);
  const [notice, setNotice] = useState("");
  const set = (patch: Partial<ComposerValue>) => onChange({ ...value, ...patch, mode });

  async function rephrase() {
    setBusy(true); setNotice("");
    try {
      const r = await api.rephraseContext({ type: mode, raw: value.raw_input, fields: value.structured });
      setResult(r);
      set({ structured: { ...value.structured, ...r.structured }, content: r.brief });
      if (r.source === "draft") setNotice(t("Reformulation indisponible : votre brouillon est conservé, relisez-le avant de valider."));
    } catch (e) {
      setNotice(t("Reformulation indisponible : votre brouillon est conservé, relisez-le avant de valider."));
      void e;
    } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-3" data-testid="context-composer">
      <Field label={t("Saisie libre")} hint={t("Collez ou tapez le contexte tel quel : e-mail, cahier des charges, notes.")}>
        <TextArea aria-label={t("Saisie libre")} value={value.raw_input} onChange={(e) => set({ raw_input: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {GUIDED_FIELDS[mode].map((f) => (
          <Field key={f.key} label={f.label()}>
            <TextArea aria-label={f.label()} value={value.structured[f.key] ?? ""} onChange={(e) => set({ structured: { ...value.structured, [f.key]: e.target.value } })} />
          </Field>
        ))}
      </div>
      <div><Button variant="secondary" onClick={rephrase} disabled={busy || (!value.raw_input.trim() && !Object.values(value.structured).some((v) => v?.trim()))}>{busy ? t("Reformulation…") : t("Reformuler / confirmer la compréhension")}</Button></div>
      {notice ? <p className="text-sm text-hold" role="status">{notice}</p> : null}
      <Field label={t("Compréhension à valider")} hint={t("Corrigez librement : c’est ce texte qui sera transmis aux agents une fois validé.")}>
        <TextArea aria-label={t("Compréhension à valider")} value={value.content} onChange={(e) => set({ content: e.target.value })} />
      </Field>
      {result?.questions?.length ? (
        <ul className="list-disc pl-5 text-sm text-ink-soft" data-testid="rephrase-questions">{result.questions.map((q) => <li key={q}>{q}</li>)}</ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onValidate({ ...value, mode })} disabled={!value.content.trim()}>{t("Valider cette compréhension")}</Button>
        <Button variant="ghost" onClick={() => onSaveDraft({ ...value, mode })}>{t("Garder en brouillon")}</Button>
      </div>
    </div>
  );
}
