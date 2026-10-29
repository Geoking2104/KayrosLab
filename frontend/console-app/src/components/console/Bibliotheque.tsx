import { useState } from "react";
import { useConsole } from "@/lib/console/store";
import type { ContextSource, Skill } from "@/lib/console/live";
import { Button, Empty, Field, Panel, TextArea, controlClass } from "./ui";
import { go } from "./Shell";
import { cn } from "@/lib/cn";
import { t, tc } from "@/lib/i18n";

type Tab = "skills" | "contexts";
type Draft = { id: string | null; name: string; description: string; instructions: string; tools: string; kind: ContextSource["kind"]; content: string; url: string; agent_ids: string[]; session_ids: string[] };

const EMPTY: Draft = { id: null, name: "", description: "", instructions: "", tools: "", kind: "note", content: "", url: "", agent_ids: [], session_ids: [] };
const KIND_LABEL: Record<ContextSource["kind"], string> = {
  get note() { return t("Note"); },
  get document() { return t("Document"); },
  get url() { return t("Lien"); },
  get policy() { return t("Politique interne"); },
};

/** Bibliothèque : skills et sources de contexte rattachables aux agents et aux collectifs. */
export function Bibliotheque() {
  const { live, state, workspace, saveItem, deleteItem } = useConsole();
  const [tab, setTab] = useState<Tab>("skills");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");

  if (!live) {
    return (
      <Empty
        title={t("Bibliothèque")}
        body={t("Skills et sources de contexte sont enregistrés côté API et rattachés aux agents et aux collectifs. Connectez-vous depuis Connexions.")}
        action={<Button onClick={() => go("connexions")}>{t("Se connecter à l’API")}</Button>}
      />
    );
  }

  const items: (Skill | ContextSource)[] = tab === "skills" ? workspace.skills : workspace.contexts;
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));
  const edit = (item: Skill | ContextSource) => setDraft({
    ...EMPTY, ...item, id: item.id,
    tools: "tools" in item ? item.tools.join("\n") : "",
  } as Draft);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) { setError(t("Le nom est requis.")); return; }
    const common = { name: draft.name.trim(), agent_ids: draft.agent_ids, session_ids: draft.session_ids };
    const body = tab === "skills"
      ? { ...common, description: draft.description.trim(), instructions: draft.instructions.trim(), tools: draft.tools.split("\n").map((x) => x.trim()).filter(Boolean) }
      : { ...common, kind: draft.kind, content: draft.content, url: draft.url.trim() };
    const res = await saveItem(tab, draft.id, body);
    if (!res.ok) setError(res.reason ?? t("Refusé")); else { setDraft(null); setError(""); }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2" role="tablist">
        {(["skills", "contexts"] as Tab[]).map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => { setTab(id); setDraft(null); }}
            className={cn("rounded-md px-3 py-1.5 text-sm", tab === id ? "bg-accent-soft font-medium" : "text-ink-soft hover:bg-paper")}>
            {id === "skills" ? t("Skills") : t("Sources de contexte")}
          </button>
        ))}
        <Button className="ml-auto" onClick={() => setDraft({ ...EMPTY })}>{tab === "skills" ? t("Nouveau skill") : t("Nouvelle source")}</Button>
      </div>

      {draft ? (
        <Panel>
          <div className="grid gap-3">
            <Field label={t("Nom")}><input className={controlClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            {tab === "skills" ? (
              <>
                <Field label={t("Description")}><input className={controlClass} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
                <Field label={t("Instructions")} hint={t("Ce que l’agent sait faire avec ce skill. Injecté dans son contexte.")}><TextArea value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} /></Field>
                <Field label={t("Outils")} hint={t("Un identifiant d’outil par ligne.")}><TextArea value={draft.tools} onChange={(e) => setDraft({ ...draft, tools: e.target.value })} /></Field>
              </>
            ) : (
              <>
                <Field label={t("Type")}>
                  <select className={controlClass} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ContextSource["kind"] })}>
                    {(Object.keys(KIND_LABEL) as ContextSource["kind"][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                </Field>
                {draft.kind === "url" ? <Field label={t("Adresse")}><input className={controlClass} value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} /></Field> : null}
                <Field label={t("Contenu")} hint={t("Texte transmis aux agents (20 000 caractères maximum).")}><TextArea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} /></Field>
              </>
            )}
            <fieldset>
              <legend className="text-sm font-medium">{t("Rattacher à des agents")}</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                {state.agents.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4" checked={draft.agent_ids.includes(a.id)} onChange={(e) => setDraft({ ...draft, agent_ids: toggle(draft.agent_ids, a.id, e.target.checked) })} />
                    {tc(a.name)}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium">{t("Rattacher à des collectifs")}</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                {state.collectives.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4" checked={draft.session_ids.includes(c.id)} onChange={(e) => setDraft({ ...draft, session_ids: toggle(draft.session_ids, c.id, e.target.checked) })} />
                    {tc(c.name)}
                  </label>
                ))}
              </div>
            </fieldset>
            {error ? <p className="text-sm text-stop" role="alert">{error}</p> : null}
            <div className="flex gap-2">
              <Button onClick={save}>{t("Enregistrer")}</Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>{t("Annuler")}</Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {!items.length && !draft ? (
        <Empty title={tab === "skills" ? t("Aucun skill") : t("Aucune source de contexte")} body={t("Ajoutez-en un, puis rattachez-le à un agent ou à un collectif.")} />
      ) : null}
      {items.map((item) => (
        <Panel key={item.id}>
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-medium">{item.name}</h3>
            {"kind" in item ? <span className="text-xs text-muted">{KIND_LABEL[item.kind]}</span> : null}
            <span className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => edit(item)}>{t("Modifier")}</Button>
              <Button variant="danger" onClick={async () => { const res = await deleteItem(tab, item.id); if (!res.ok) setError(res.reason ?? ""); }}>{t("Supprimer")}</Button>
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">{"instructions" in item ? item.description || item.instructions : item.content.slice(0, 240)}</p>
          <p className="mt-2 text-xs text-muted">
            {t("Agents : {{a}} · Collectifs : {{c}}", {
              a: item.agent_ids.map((id) => tc(state.agents.find((x) => x.id === id)?.name) || id).join(", ") || "—",
              c: item.session_ids.map((id) => tc(state.collectives.find((x) => x.id === id)?.name) || id).join(", ") || "—",
            })}
          </p>
        </Panel>
      ))}
    </div>
  );
}
