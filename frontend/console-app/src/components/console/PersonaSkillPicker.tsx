import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { api, effectiveSkillToolsPreview, type PersonaSkill } from "@/lib/console/api";

/**
 * Choix des compétences (GET /v1/console/persona-skills) avec aperçu des outils effectifs :
 * outils des compétences ∩ allowlist de la persona. Une compétence n’élargit jamais les droits ;
 * la vérification finale reste serveur (assertToolAllowed).
 */
export function PersonaSkillPicker({ value, onChange, allowlist = [], load = () => api.personaSkills().then((r) => r.skills) }: {
  value: string[]; onChange: (next: string[]) => void; allowlist?: string[]; load?: () => Promise<PersonaSkill[]>;
}) {
  const [catalog, setCatalog] = useState<PersonaSkill[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let on = true; load().then((s) => on && setCatalog(s), (e) => on && setError(String(e?.message || e))); return () => { on = false; }; }, []);
  if (error) return <p className="text-sm text-muted">{t("Compétences indisponibles : {{error}}", { error })}</p>;
  if (!catalog) return <p className="text-sm text-muted">{t("Chargement…")}</p>;
  if (!catalog.length) return null;
  const preview = effectiveSkillToolsPreview(catalog, value, allowlist);
  return (
    <fieldset className="grid gap-1 rounded-lg border border-line p-3 text-sm">
      <legend className="px-1 font-medium">{t("Compétences")}</legend>
      {catalog.map((s) => (
        <label key={s.id} className="flex items-start gap-2">
          <input type="checkbox" checked={value.includes(s.id)} onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((x) => x !== s.id))} />
          <span>{s.name}{s.instructions ? <span className="text-muted"> — {s.instructions}</span> : null}</span>
        </label>
      ))}
      {value.length ? (
        <p className="mt-1 text-ink-soft" data-testid="effective-tools">
          {preview.granted.length
            ? t("Outils effectifs : {{tools}}", { tools: preview.granted.join(", ") })
            : t("Outils effectifs : aucun")}
          {preview.denied.length ? ` · ${t("Non accordés (hors permissions de la persona) : {{tools}}", { tools: preview.denied.join(", ") })}` : ""}
        </p>
      ) : null}
    </fieldset>
  );
}
