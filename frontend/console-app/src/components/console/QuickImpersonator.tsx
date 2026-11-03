import { useState } from "react";
import { t, tc } from "@/lib/i18n";
import { GUARDRAILS, parsePublicSources, type AgentKind } from "@/lib/console/model";
import { PERSONA_TEMPLATES, type PersonaTemplate } from "@/lib/console/persona-templates";
import { Button, Field, Panel, TextArea, controlClass } from "./ui";

export type QuickImpersonatorInput = {
  name: string;
  role: string;
  department: string;
  mission: string;
  kind: AgentKind;
  veto: boolean;
  enabled: boolean;
  consented: boolean;
  simulation: boolean;
  clues: string;
  publicSources?: string[];
  purpose?: PersonaTemplate["purpose"];
};

/**
 * « Impersonator rapide » : nom, fonction, source, indices. La source « public » (données
 * publiques uniquement) exige au moins une URL et se passe de consentement ; toute autre source
 * exige le consentement explicite. Les cinq garde-fous, le veto et l’arbitrage humain s’appliquent
 * à l’identique : la validation finale reste celle du serveur (POST /v1/console/impersonators).
 */
export function QuickImpersonator({
  onCreate,
  onClose,
  templates = PERSONA_TEMPLATES,
}: {
  onCreate: (agent: QuickImpersonatorInput) => { ok: boolean; reason?: string };
  onClose: () => void;
  templates?: PersonaTemplate[];
}) {
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [source, setSource] = useState<"public" | "manual">("public");
  const [urls, setUrls] = useState("");
  const [consent, setConsent] = useState(false);
  const [clues, setClues] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState("");
  const template = templates.find((tpl) => tpl.id === templateId) ?? null;

  function applyTemplate(id: string) {
    setTemplateId(id);
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    setRole(tpl.role);
    setClues(tpl.clues.join("\n"));
  }

  function save() {
    if (!name.trim()) return setError(t("Le nom est requis."));
    const { urls: sources, invalid } = parsePublicSources(urls);
    if (source === "public") {
      if (invalid.length) return setError(t("URL invalide : {{url}}", { url: invalid[0] }));
      if (!sources.length) return setError(t("Ajoutez au moins une URL publique (http ou https)."));
    } else if (!consent) {
      return setError(t("Consentement explicite requis avant d’enregistrer un profil personnifié."));
    }
    if (!ack) return setError(t("Prenez connaissance des cinq garde-fous."));
    const result = onCreate({
      name: name.trim(),
      role: role.trim() || t("Persona simulée"),
      department: template?.department || "Simulation",
      mission: template?.mission || "",
      kind: "impersonator",
      veto: template ? template.veto : true,
      enabled: true,
      consented: source === "manual" && consent,
      simulation: true,
      clues: clues.trim(),
      publicSources: source === "public" ? sources : undefined,
      purpose: template?.purpose,
    });
    if (!result.ok) setError(result.reason ?? t("Refusé"));
    else onClose();
  }

  return (
    <Panel>
      <h2 className="text-sm font-medium">{t("Impersonator rapide")}</h2>
      <p className="mt-1 text-sm text-muted">{t(
        "Nom, fonction, source, indices. Le profil s’enrichit ensuite depuis la fiche."
      )}</p>
      <div className="mt-4 grid gap-3">
        {templates.length ? (
          <Field label={t("Modèle (optionnel)")}>
            <select aria-label={t("Modèle (optionnel)")} className={controlClass} value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">{t("Aucun")}</option>
              {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.title}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label={t("Nom")}>
          <input aria-label={t("Nom")} className={controlClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("Fonction")}>
          <input aria-label={t("Fonction")} className={controlClass} value={role} onChange={(e) => setRole(e.target.value)} />
        </Field>
        <Field label={t("Source")}>
          <select aria-label={t("Source")} className={controlClass} value={source} onChange={(e) => setSource(e.target.value as "public" | "manual")}>
            <option value="public">{t("Données publiques")}</option>
            <option value="manual">{t("Indices manuels (consentement requis)")}</option>
          </select>
        </Field>
        {source === "public" ? (
          <Field label={t("URLs publiques")} hint={t("Une par ligne. Elles sont conservées comme sources ; elles ne sont pas visitées.")}>
            <TextArea aria-label={t("URLs publiques")} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://" />
          </Field>
        ) : (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{t("La personne a donné son consentement explicite.")}</span>
          </label>
        )}
        <Field label={t("Indices")}>
          <TextArea aria-label={t("Indices")} value={clues} onChange={(e) => setClues(e.target.value)} />
        </Field>
        <div className="rounded-lg border border-line p-3 text-sm">
          <p className="font-medium">{t("Garde-fous appliqués")}</p>
          <ul className="mt-1 list-disc pl-5 text-ink-soft">
            {GUARDRAILS.map((g) => <li key={g}>{tc(g)}</li>)}
          </ul>
          <label className="mt-2 flex items-start gap-2">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>{t("J’ai pris connaissance des cinq garde-fous.")}</span>
          </label>
        </div>
        {error ? <p role="alert" className="text-sm text-stop">{error}</p> : null}
        <div className="flex gap-2">
          <Button onClick={save}>{t("Créer la persona")}</Button>
          <Button variant="ghost" onClick={onClose}>{t("Annuler")}</Button>
        </div>
      </div>
    </Panel>
  );
}
