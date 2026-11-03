import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { api, type PersonaTool } from "@/lib/console/api";

/**
 * Outils autorisés d’une persona, choisis dans le registre (GET /v1/console/persona-tools).
 * Les outils non assignables (écriture, hors politique d’espace) sont affichés désactivés.
 * La validation finale reste serveur (validatePersonaTools + assertToolAllowed).
 */
export function PersonaToolPicker({ value, onChange, disabled = false, load = () => api.personaTools().then((r) => r.tools) }: {
  value: string[]; onChange: (next: string[]) => void; disabled?: boolean; load?: () => Promise<PersonaTool[]>;
}) {
  const [catalog, setCatalog] = useState<PersonaTool[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let on = true; load().then((s) => on && setCatalog(s), (e) => on && setError(String(e?.message || e))); return () => { on = false; }; }, []);
  if (error) return <p className="text-sm text-muted">{t("Outils indisponibles : {{error}}", { error })}</p>;
  if (!catalog) return <p className="text-sm text-muted">{t("Chargement…")}</p>;
  return (
    <fieldset className="grid gap-1 rounded-lg border border-line p-3 text-sm" disabled={disabled}>
      <legend className="px-1 font-medium">{t("Outils autorisés")}</legend>
      {catalog.map((tool) => (
        <label key={tool.name} className="flex items-start gap-2">
          <input type="checkbox" disabled={!tool.assignable} checked={value.includes(tool.name)}
            onChange={(e) => onChange(e.target.checked ? [...value, tool.name] : value.filter((x) => x !== tool.name))} />
          <span><span>{tool.name}</span>{tool.gate ? ` · ${t("porte humaine")}` : ""}<span className="text-muted"> — {tool.description}{tool.reason ? ` (${tool.reason})` : ""}</span></span>
        </label>
      ))}
    </fieldset>
  );
}
