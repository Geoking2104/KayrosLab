import { useState } from "react";
import { useConsole } from "@/lib/console/store";
import type { ContextSource, Skill, SkillTag } from "@/lib/console/live";
import { api } from "@/lib/console/api";
import { Button, Empty, Field, Panel, Section, TextArea, controlClass } from "./ui";
import { formatWhen } from "@/lib/console/model";
import { go } from "./Shell";
import { cn } from "@/lib/cn";
import { ContextComposer, StatusBadge, type ComposerValue } from "./ContextComposer";
import { t, tc } from "@/lib/i18n";

type Tab = "skills" | "contexts";
type Draft = { id: string | null; name: string; description: string; instructions: string; tools: string; kind: ContextSource["kind"]; content: string; url: string; agent_ids: string[]; session_ids: string[]; company_id: string; project_id: string; node_id: string; mode: "" | "rfp" | "interne"; raw_input: string; structured: Record<string, string>; status: "draft" | "validated"; tags: SkillTag[] };

const EMPTY: Draft = { id: null, name: "", description: "", instructions: "", tools: "", kind: "note", content: "", url: "", agent_ids: [], session_ids: [], company_id: "", project_id: "", node_id: "", mode: "", raw_input: "", structured: {}, status: "validated", tags: [] };

const SKILL_TEMPLATES: Record<SkillTag, string> = {
  rfp: "Objectif : répondre à un appel d’offres.\nEntrées : cahier des charges, critères d’évaluation, échéance.\nÉtapes : 1. extraire exigences et critères ; 2. vérifier l’éligibilité ; 3. rédiger la réponse point par point ; 4. lister risques et pièces manquantes.\nSortie : réponse structurée + matrice de conformité.",
  interne: "Objectif : traiter une demande interne.\nEntrées : demandeur, besoin, contraintes, délai.\nÉtapes : 1. reformuler le besoin ; 2. identifier les parties prenantes ; 3. proposer un plan d’action ; 4. signaler les décisions à prendre.\nSortie : note de synthèse actionnable.",
};
const KIND_LABEL: Record<ContextSource["kind"], string> = {
  get note() { return t("Note"); },
  get document() { return t("Document"); },
  get url() { return t("Lien"); },
  get policy() { return t("Politique interne"); },
};

/** Bibliothèque : skills et sources de contexte rattachables aux agents et aux collectifs. */
export function Bibliotheque() {
  const { live, state, workspace, saveItem, deleteItem, refreshLive } = useConsole();
  const [tab, setTab] = useState<Tab>("skills");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [skillBusy, setSkillBusy] = useState(false);
  const [tagFilter, setTagFilter] = useState<SkillTag | "">("");

  if (!live) {
    return (
      <Empty
        title={t("Bibliothèque")}
        body={t("Skills et sources de contexte sont enregistrés côté API et rattachés aux agents et aux collectifs. Connectez-vous depuis Connexions.")}
        action={<Button onClick={() => go("connexions")}>{t("Se connecter à l’API")}</Button>}
      />
    );
  }

  const items: (Skill | ContextSource)[] = tab === "skills" ? workspace.skills.filter((k) => !tagFilter || (k.tags ?? []).includes(tagFilter)) : workspace.contexts;
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));
  const edit = (item: Skill | ContextSource) => setDraft({
    ...EMPTY, ...item, id: item.id,
    tools: "tools" in item ? item.tools.join("\n") : "",
    tags: "tools" in item ? item.tags ?? [] : [],
  } as Draft);

  async function save(override?: Partial<Draft>) {
    if (!draft) return;
    const d = { ...draft, ...override };
    if (!draft.name.trim()) { setError(t("Le nom est requis.")); return; }
    const common = { name: d.name.trim(), agent_ids: d.agent_ids, session_ids: d.session_ids };
    const guided = d.mode ? { mode: d.mode, raw_input: d.raw_input, structured: d.structured } : {};
    const body = tab === "skills"
      ? { ...common, description: d.description.trim(), instructions: d.instructions.trim(), tools: d.tools.split("\n").map((x) => x.trim()).filter(Boolean), tags: d.tags }
      : { ...common, ...guided, status: d.mode ? d.status : "validated", kind: d.kind, content: d.content, url: d.url.trim(), company_id: d.company_id, project_id: d.project_id, node_id: d.project_id ? d.node_id : "" };
    const res = await saveItem(tab, draft.id, body);
    if (!res.ok) setError(res.reason ?? t("Refusé")); else { setDraft(null); setError(""); }
  }
  const composerValue = (d: Draft): ComposerValue => ({ mode: d.mode || "rfp", raw_input: d.raw_input, structured: d.structured, content: d.content }) as ComposerValue;
  const fromComposer = (v: ComposerValue) => ({ raw_input: v.raw_input, structured: v.structured, content: v.content });

  /** Reformule l’objectif du skill (optionnel) : la description proposée reste éditable. */
  async function rephraseSkill() {
    if (!draft) return;
    setSkillBusy(true);
    try {
      const r = await api.rephraseContext({ type: "skill", raw: [draft.description, draft.instructions].filter(Boolean).join("\n") });
      if (r.source === "model") setDraft({ ...draft, description: r.brief.slice(0, 2000) });
      else setError(t("Reformulation indisponible : votre brouillon est conservé, relisez-le avant de valider."));
    } catch { setError(t("Reformulation indisponible : votre brouillon est conservé, relisez-le avant de valider.")); }
    finally { setSkillBusy(false); }
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
                <div><Button variant="secondary" onClick={rephraseSkill} disabled={skillBusy || !(draft.description.trim() || draft.instructions.trim())}>{skillBusy ? t("Reformulation…") : t("Reformuler l’objectif du skill")}</Button></div>
                <fieldset className="flex flex-wrap items-center gap-3" data-testid="skill-tags">
                  <legend className="text-sm text-ink-soft">{t("Usage")}</legend>
                  {(["rfp", "interne"] as SkillTag[]).map((tag) => (
                    <span key={tag} className="flex items-center gap-2 text-sm">
                      <label className="flex items-center gap-1"><input type="checkbox" className="size-4" checked={draft.tags.includes(tag)} onChange={(e) => setDraft({ ...draft, tags: toggle(draft.tags, tag, e.target.checked) as SkillTag[] })} />{tag === "rfp" ? t("RFP") : t("Interne")}</label>
                      <Button variant="ghost" onClick={() => setDraft({ ...draft, tags: draft.tags.includes(tag) ? draft.tags : [...draft.tags, tag], instructions: draft.instructions.trim() ? draft.instructions : SKILL_TEMPLATES[tag] })}>{tag === "rfp" ? t("Modèle RFP") : t("Modèle interne")}</Button>
                    </span>
                  ))}
                </fieldset>
                <Field label={t("Instructions")} hint={t("Ce que l’agent sait faire avec ce skill. Injecté dans son contexte.")}><TextArea value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} /></Field>
                <Field label={t("Outils")} hint={t("Un identifiant d’outil par ligne.")}><TextArea value={draft.tools} onChange={(e) => setDraft({ ...draft, tools: e.target.value })} /></Field>
              </>
            ) : (
              <>
                <Field label={t("Saisie")} hint={t("Libre, ou guidée pour un RFP / AO ou un projet interne.")}>
                  <select aria-label={t("Saisie")} className={controlClass} value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as Draft["mode"], status: e.target.value ? "draft" : "validated" })}>
                    <option value="">{t("Libre")}</option>
                    <option value="rfp">{t("RFP / AO")}</option>
                    <option value="interne">{t("Projet interne")}</option>
                  </select>
                </Field>
                <Field label={t("Type")}>
                  <select className={controlClass} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ContextSource["kind"] })}>
                    {(Object.keys(KIND_LABEL) as ContextSource["kind"][]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                </Field>
                {draft.kind === "url" ? <Field label={t("Adresse")}><input className={controlClass} value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} /></Field> : null}
                <div className="grid gap-3 sm:grid-cols-3" data-testid="context-scope">
                  <Field label={t("Société")} hint={t("Hérité par tous ses projets.")}>
                    <select className={controlClass} value={draft.company_id} onChange={(e) => setDraft({ ...draft, company_id: e.target.value, project_id: "", node_id: "" })}>
                      <option value="">—</option>
                      {workspace.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t("Projet")} hint={t("Prime sur la société.")}>
                    <select className={controlClass} value={draft.project_id} onChange={(e) => {
                      const p = workspace.projects.find((x) => x.id === e.target.value);
                      setDraft({ ...draft, project_id: e.target.value, company_id: p?.company_id ?? draft.company_id, node_id: "" });
                    }}>
                      <option value="">—</option>
                      {workspace.projects.filter((p) => !draft.company_id || p.company_id === draft.company_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t("Nœud du graphe")} hint={t("Le plus précis : une étape du projet.")}>
                    <select className={controlClass} value={draft.node_id} disabled={!draft.project_id} onChange={(e) => setDraft({ ...draft, node_id: e.target.value })}>
                      <option value="">—</option>
                      {(workspace.projects.find((p) => p.id === draft.project_id)?.graph?.nodes ?? []).map((n) => <option key={n.id} value={n.id}>{n.label || n.id}</option>)}
                    </select>
                  </Field>
                </div>
                {draft.mode ? (
                  <ContextComposer mode={draft.mode} value={composerValue(draft)}
                    onChange={(v) => setDraft({ ...draft, ...fromComposer(v), status: "draft" })}
                    onValidate={(v) => void save({ ...fromComposer(v), status: "validated" })}
                    onSaveDraft={(v) => void save({ ...fromComposer(v), status: "draft" })} />
                ) : (
                  <Field label={t("Contenu")} hint={t("Texte transmis aux agents (20 000 caractères maximum).")}><TextArea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} /></Field>
                )}
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
              {tab === "contexts" && draft.mode ? null : <Button onClick={() => void save()}>{t("Enregistrer")}</Button>}
              <Button variant="ghost" onClick={() => setDraft(null)}>{t("Annuler")}</Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {tab === "skills" && workspace.skills.length ? (
        <div className="flex gap-2" data-testid="skill-filter">
          {([["", t("Tous")], ["rfp", t("RFP")], ["interne", t("Interne")]] as [SkillTag | "", string][]).map(([v, label]) => (
            <Button key={v || "all"} variant={tagFilter === v ? "primary" : "ghost"} onClick={() => setTagFilter(v)}>{label}</Button>
          ))}
        </div>
      ) : null}
      {!items.length && !draft ? (
        <Empty title={tab === "skills" ? t("Aucun skill") : t("Aucune source de contexte")} body={t("Ajoutez-en un, puis rattachez-le à un agent ou à un collectif.")} />
      ) : null}
      {items.map((item) => (
        <Panel key={item.id}>
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-medium">{item.name}</h3>
            {"instructions" in item ? (item.tags ?? []).map((tag) => <span key={tag} className="rounded bg-accent-soft px-1.5 text-[11px] font-semibold" data-testid="skill-tag">{tag === "rfp" ? t("RFP") : t("Interne")}</span>) : null}
            {"instructions" in item ? <span className="rounded bg-paper-2 px-1.5 text-[11px] font-semibold" data-testid="skill-version">v{item.version ?? 1}</span> : null}
            {"kind" in item && (item.node_id || item.project_id || item.company_id) ? (
              <span className="rounded bg-accent-soft px-1.5 text-[11px]">{item.node_id ? t("Nœud {{v}}", { v: item.node_id }) : item.project_id ? t("Projet : {{v}}", { v: workspace.projects.find((p) => p.id === item.project_id)?.name ?? item.project_id }) : t("Société : {{v}}", { v: workspace.companies.find((c) => c.id === item.company_id)?.name ?? item.company_id })}</span>
            ) : null}
            {"kind" in item ? <span className="text-xs text-muted">{KIND_LABEL[item.kind]}</span> : null}
            {"kind" in item && item.mode ? <span className="rounded bg-paper-2 px-1.5 text-[11px]">{item.mode === "rfp" ? t("RFP / AO") : t("Projet interne")}</span> : null}
            {"kind" in item && (item.mode || item.status === "draft") ? <StatusBadge status={item.status} /> : null}
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
          {"instructions" in item && item.versions?.length ? (
            <div className="mt-3">
              <Section id={`skill-versions-${item.id}`} title={t("Historique des versions")} summary={t("{{n}} versions antérieures", { n: item.versions.length })} defaultOpen={false}>
                <ul className="grid gap-2">
                  {[...item.versions].reverse().map((v) => (
                    <li key={v.version} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">v{v.version}</span>
                      <span className="text-xs text-muted">{formatWhen(v.at)}{v.by ? ` · ${v.by}` : ""}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-soft" title={v.instructions}>{v.instructions || v.description}</span>
                      <Button variant="secondary" onClick={async () => {
                        try { await api.restoreSkill(item.id, v.version); await refreshLive(); setError(""); } catch (e) { setError((e as Error).message); }
                      }}>{t("Restaurer v{{v}}", { v: v.version })}</Button>
                    </li>
                  ))}
                </ul>
              </Section>
            </div>
          ) : null}
        </Panel>
      ))}
    </div>
  );
}
