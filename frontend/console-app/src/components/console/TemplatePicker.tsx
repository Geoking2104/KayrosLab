import { t } from "@/lib/i18n";
import { PERSONA_TEMPLATES, type PersonaTemplate } from "@/lib/console/persona-templates";
import { Button, Panel } from "./ui";

/** « Partir d’un modèle » : liste les archétypes anonymes de personas/catalog/. */
export function TemplatePicker({
  templates = PERSONA_TEMPLATES,
  onPick,
  onClose,
}: {
  templates?: PersonaTemplate[];
  onPick: (template: PersonaTemplate) => void;
  onClose: () => void;
}) {
  return (
    <Panel>
      <h2 className="text-sm font-medium">{t("Partir d’un modèle")}</h2>
      <p className="mt-1 text-sm text-muted">{t(
        "Archétypes anonymes. Le modèle pré-remplit la fiche ; le nom, la source et le consentement restent à saisir."
      )}</p>
      {templates.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => onPick(tpl)}
              className="rounded-xl border border-line px-3 py-3 text-left"
            >
              <span className="text-sm font-medium">{tpl.title}</span>
              <span className="mt-1 block text-sm text-ink-soft">{tpl.description}</span>
              <span className="mt-1 block text-xs text-muted">{tpl.role}{tpl.veto ? t(" · droit de veto") : ""}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">{t("Aucun modèle disponible.")}</p>
      )}
      <Button className="mt-3" variant="ghost" onClick={onClose}>{t("Annuler")}</Button>
    </Panel>
  );
}
