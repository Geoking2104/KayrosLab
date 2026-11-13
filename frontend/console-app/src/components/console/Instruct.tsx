import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Gavel,
  Lightbulb,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useConsole } from "@/lib/console/store";
import { tokenStore } from "@/lib/console/api";
import {
  USE_CASES,
  votingLabel,
  type Evidence,
  type Profile,
  type UseCase,
} from "@/lib/console/model";
import {
  CONTEXT_LIMIT,
  emptyDecisionDraft,
  evidenceLength,
  readDecisionDraft,
  type DecisionDraft,
} from "@/lib/console/decision-draft";
import { readableText } from "@/lib/console/read";
import { cn } from "@/lib/cn";
import { Button, Empty, Field, Panel, TextArea, controlClass } from "./ui";
import { go } from "./Shell";
import { SessionBriefs } from "./Briefs";
import { t, tc } from "@/lib/i18n";

export function Instruct() {
  const { live, liveUser, refreshLive } = useConsole();
  if (tokenStore.get() && !live)
    return (
      <Empty
        title={t("Connexion à votre espace")}
        body={t(
          "Vos comités et vos habilitations doivent être chargés avant de préparer une décision réelle.",
        )}
        action={
          <>
            <Button onClick={() => void refreshLive()}>{t("Réessayer")}</Button>
            <Button variant="secondary" onClick={() => go("connexions")}>
              {t("Connexions")}
            </Button>
          </>
        }
      />
    );
  const scope = live
    ? `live:${liveUser?.tenantId ?? ""}:${liveUser?.id}`
    : "demo";
  return (
    <DecisionWizard
      key={scope}
      storageKey={`kayroslab.decision-draft.v1:${scope}`}
    />
  );
}

function DecisionWizard({ storageKey }: { storageKey: string }) {
  const { state, startMission, live, permissions } = useConsole();
  const [draft, setDraft] = useState(() =>
    readDecisionDraft(
      storageKey,
      emptyDecisionDraft(state.selectedCollectiveId, live ? "fast" : "demo"),
    ),
  );
  const [sourceName, setSourceName] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [acceptedPolicy, setAcceptedPolicy] = useState("");
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const submitted = useRef(false);
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (submitted.current) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [draft, storageKey]);
  const collective = state.collectives.find((c) => c.id === draft.collectiveId);
  const agents = state.agents.filter(
    (a) => collective?.agentIds.includes(a.id) && a.enabled,
  );
  const policy = JSON.stringify([
    collective?.id,
    collective?.voting,
    collective?.personality,
    agents.map((a) => [a.id, a.veto, a.settings?.provider, a.settings?.model]),
  ]);
  const canRun = permissions.includes("run");
  const readyQuestion = draft.question.trim().split(/\s+/).length >= 6;
  const readyCommittee = Boolean(collective && agents.length >= 2);
  const readyContext = evidenceLength(draft) <= CONTEXT_LIMIT;
  const reviewed = acceptedPolicy === policy;
  const patch = (value: Partial<DecisionDraft>) =>
    setDraft((current) => ({ ...current, ...value }));
  function move(step: number) {
    setError("");
    patch({ step });
    requestAnimationFrame(() => heading.current?.focus());
  }
  const steps = [
    {
      title: t("Décision"),
      icon: Lightbulb,
      hint: t("Quel choix faut-il éclairer ?"),
    },
    {
      title: t("Contexte"),
      icon: FileText,
      hint: t("Sur quels faits travailler ?"),
    },
    {
      title: t("Comité"),
      icon: Users,
      hint: t("Quels points de vue confronter ?"),
    },
    {
      title: t("Gouvernance"),
      icon: ShieldCheck,
      hint: t("Qui peut décider, selon quelles règles ?"),
    },
    {
      title: t("Relecture"),
      icon: Check,
      hint: t("Tout est prêt pour l’instruction ?"),
    },
  ];
  const step = steps[draft.step];
  const mayContinue =
    draft.step === 0
      ? readyQuestion
      : draft.step === 1
        ? readyContext
        : draft.step === 2
          ? readyCommittee
          : reviewed;
  function addEvidence(name: string, text: string) {
    const parsed = readableText(text);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    const item: Evidence = {
      name: name.trim().slice(0, 160) || t("Note de contexte"),
      type: "text",
      text: parsed.text,
    };
    const next = { ...draft, evidence: [...draft.evidence, item] };
    if (next.evidence.length > 6 || evidenceLength(next) > CONTEXT_LIMIT) {
      setError(
        t(
          "Limite atteinte : six sources et 22 000 caractères de contexte au total.",
        ),
      );
      return;
    }
    patch({ evidence: next.evidence });
    setSourceName("");
    setSourceText("");
    setError("");
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name) || file.size > 80_000) {
      setError(
        t(
          "Ajoutez un fichier .txt ou .md de moins de 80 Ko, ou collez un extrait.",
        ),
      );
      return;
    }
    try {
      addEvidence(file.name, await file.text());
    } catch {
      setError(
        t("Le fichier n’a pas pu être lu. Réessayez ou collez son contenu."),
      );
    }
  }
  function launch() {
    if (
      submitting.current ||
      !canRun ||
      !readyQuestion ||
      !readyContext ||
      !readyCommittee ||
      !reviewed
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const briefing = [
      draft.goal && `${t("Résultat attendu")} : ${draft.goal}`,
      draft.deadline && `${t("Échéance")} : ${draft.deadline}`,
      draft.context,
    ]
      .filter(Boolean)
      .join("\n\n");
    const evidence = [
      ...(briefing
        ? [{ name: t("Cadrage de la décision"), type: "text", text: briefing }]
        : []),
      ...draft.evidence,
    ];
    startMission({
      question: draft.question,
      collectiveId: collective!.id,
      profile: live ? draft.profile : "demo",
      useCase: draft.useCase,
      evidence,
      onSettled: (result) => {
        if (result.ok && result.id) {
          submitted.current = true;
          try {
            sessionStorage.removeItem(storageKey);
          } catch {
            /* the run is accepted even if storage is unavailable */
          }
          if (mounted.current) go("dossiers", result.id);
        } else if (mounted.current) {
          submitting.current = false;
          setBusy(false);
          setError(
            result.reason ||
              t(
                "Le lancement n’a pas été confirmé. Votre brouillon est conservé.",
              ),
          );
        }
      },
    });
  }
  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{t("NOUVELLE DÉCISION")}</p>
          <h1 className="page-title">
            {t("Un comité bien préparé commence ici.")}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {t(
              "Un cadrage clair, des avis contradictoires, une décision humaine.",
            )}
          </p>
        </div>
        <a
          href="#overview"
          className="text-xs text-muted underline underline-offset-4"
        >
          {t("Reprendre plus tard")}
        </a>
      </div>
      <ol className="journey-steps" aria-label={t("Étapes de préparation")}>
        {steps.map((item, index) => (
          <li key={item.title}>
            <button
              type="button"
              disabled={busy || index > draft.step}
              onClick={() => move(index)}
              aria-current={draft.step === index ? "step" : undefined}
              className={cn(
                "journey-step",
                draft.step === index && "is-current",
                index < draft.step && "is-done",
              )}
            >
              <span className="step-number">
                {index < draft.step ? <Check size={14} /> : index + 1}
              </span>
              <span>{item.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
        <Panel className="min-w-0 md:p-7">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
              <step.icon size={20} />
            </span>
            <div>
              <p className="text-xs text-muted">
                {t("Étape {{current}} sur {{total}}", {
                  current: draft.step + 1,
                  total: steps.length,
                })}
              </p>
              <h2
                ref={heading}
                tabIndex={-1}
                className="mt-1 text-lg outline-none"
              >
                {step.hint}
              </h2>
            </div>
          </div>
          {!canRun && (
            <p className="mb-4 rounded-lg bg-info-soft p-3 text-sm text-info">
              {t(
                "Votre accès est en lecture seule. Vous pouvez consulter les dossiers et préparer votre comité.",
              )}
            </p>
          )}
          {draft.step === 0 && (
            <div className="grid gap-5">
              <Field
                label={t("La décision à prendre")}
                hint={t(
                  "Décrivez le choix, les options et ce qui rend la décision importante. Au moins six mots.",
                )}
              >
                <TextArea
                  autoFocus
                  value={draft.question}
                  maxLength={2000}
                  onChange={(e) => patch({ question: e.target.value })}
                  placeholder={t(
                    "Faut-il lancer ce projet maintenant, et à quelles conditions ?",
                  )}
                />
              </Field>
              <div>
                <p className="mb-2 text-xs text-muted">
                  {t("Partir d’un exemple")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    {
                      label: t("Lancement de projet"),
                      value: t(
                        "Faut-il lancer ce projet maintenant, et à quelles conditions ?",
                      ),
                      useCase: "comex_decision" as const,
                    },
                    {
                      label: t("Décision commerciale"),
                      value: t(
                        "Devons-nous accepter la remise de 15 % demandée par ce client ?",
                      ),
                      useCase: "negotiation" as const,
                    },
                  ].map((sample) => (
                    <button
                      key={sample.useCase}
                      className="rounded-lg border border-line px-3 py-2 text-xs hover:bg-paper"
                      onClick={() =>
                        patch({
                          question: sample.value,
                          useCase: sample.useCase,
                        })
                      }
                    >
                      {sample.label}
                    </button>
                  ))}
                </div>
              </div>
              <Field
                label={t("Résultat attendu")}
                hint={t(
                  "La question à laquelle le comité devra avoir répondu.",
                )}
              >
                <input
                  className={controlClass}
                  maxLength={1000}
                  value={draft.goal}
                  onChange={(e) => patch({ goal: e.target.value })}
                  placeholder={t(
                    "Par exemple : choisir une option et préciser ses conditions de réussite.",
                  )}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("Nature de la décision")}>
                  <select
                    className={controlClass}
                    value={draft.useCase}
                    onChange={(e) =>
                      patch({ useCase: e.target.value as UseCase })
                    }
                  >
                    {USE_CASES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={t("Échéance souhaitée")}
                  hint={t(
                    "Repère pour l’instruction ; aucun rappel n’est programmé.",
                  )}
                >
                  <input
                    type="date"
                    className={controlClass}
                    value={draft.deadline}
                    onChange={(e) => patch({ deadline: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          )}
          {draft.step === 1 && (
            <div className="grid gap-4">
              <Field
                label={t("Contexte et contraintes")}
                hint={t(
                  "Distinguez faits établis, hypothèses, options et critères de réussite.",
                )}
              >
                <TextArea
                  maxLength={8000}
                  value={draft.context}
                  onChange={(e) => patch({ context: e.target.value })}
                />
              </Field>
              <div className="rounded-xl border border-line p-4">
                <p className="mb-3 text-sm font-medium">
                  {t("Ajouter une source")}
                </p>
                <div className="grid gap-3">
                  <Field label={t("Titre et provenance")}>
                    <input
                      className={controlClass}
                      value={sourceName}
                      maxLength={160}
                      onChange={(e) => setSourceName(e.target.value)}
                      placeholder={t("Compte rendu du comité · auteur · date")}
                    />
                  </Field>
                  <Field label={t("Texte de la source")}>
                    <TextArea
                      value={sourceText}
                      maxLength={22000}
                      onChange={(e) => setSourceText(e.target.value)}
                      placeholder={t(
                        "Collez un extrait utile à cette décision.",
                      )}
                    />
                  </Field>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => addEvidence(sourceName, sourceText)}
                      disabled={
                        !sourceText.trim() || draft.evidence.length >= 6
                      }
                    >
                      {t("Ajouter au dossier")}
                    </Button>
                    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-accent focus-within:ring-2 focus-within:ring-accent">
                      <Upload size={15} />
                      {t("Importer un texte")}
                      <input
                        aria-label={t("Importer un texte")}
                        type="file"
                        accept=".txt,.md,text/plain,text/markdown"
                        className="sr-only"
                        onChange={(e) => {
                          void upload(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted">
                {t(
                  "Les textes ajoutés seront envoyés au moteur configuré lors du lancement. Les PDF et les liens seuls ne sont pas analysés ici.",
                )}
              </p>
              <ul className="grid gap-2">
                {draft.evidence.map((source, index) => (
                  <li
                    key={index}
                    className="flex items-center gap-2 rounded-lg bg-paper p-3 text-sm"
                  >
                    <FileText size={15} className="shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 truncate">
                      {source.name}
                    </span>
                    <button
                      onClick={() =>
                        patch({
                          evidence: draft.evidence.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                      aria-label={t("Retirer {{name}}", { name: source.name })}
                      className="grid size-9 place-items-center rounded-lg hover:bg-stop-soft"
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
              {!draft.evidence.length && (
                <p className="rounded-lg bg-hold-soft p-3 text-xs text-hold">
                  {t(
                    "Aucune source ajoutée. L’instruction pourra commencer, mais le comité devra expliciter ses incertitudes.",
                  )}
                </p>
              )}
              <p className="text-xs text-muted">
                {t("{{count}} / 22 000 caractères de contexte", {
                  count: evidenceLength(draft),
                })}
              </p>
            </div>
          )}
          {draft.step === 2 && (
            <div className="grid gap-4">
              <p className="text-sm text-muted">
                {t(
                  "Un comité réunit des agents IA. Les membres humains de votre espace conservent les droits d’arbitrage.",
                )}
              </p>
              {!state.collectives.length ? (
                <Empty
                  title={t("Votre premier comité reste à créer")}
                  body={t(
                    "Ajoutez au moins deux agents actifs avec des missions complémentaires, puis reprenez ce brouillon.",
                  )}
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => go("collectifs")}
                    >
                      {t("Créer un collectif")}
                    </Button>
                  }
                />
              ) : (
                <fieldset className="grid gap-2">
                  <legend className="mb-2 text-sm font-medium">
                    {t("Comité chargé de l’instruction")}
                  </legend>
                  {state.collectives.map((item) => (
                    <label
                      key={item.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-4",
                        draft.collectiveId === item.id
                          ? "border-accent bg-accent-soft"
                          : "border-line",
                      )}
                    >
                      <input
                        type="radio"
                        name="committee"
                        className="mt-1 accent-accent"
                        checked={draft.collectiveId === item.id}
                        onChange={() => {
                          patch({ collectiveId: item.id });
                          setAcceptedPolicy("");
                        }}
                      />
                      <span>
                        <span className="block text-sm font-semibold">
                          {tc(item.name)}
                        </span>
                        <span className="mt-1 block text-xs text-muted">
                          {t("{{count}} agents", {
                            count: item.agentIds.filter((id) =>
                              state.agents.some(
                                (a) => a.id === id && a.enabled,
                              ),
                            ).length,
                          })}{" "}
                          · {votingLabel(item.voting)}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {collective && (
                <ul className="divide-y divide-line">
                  {agents.map((agent) => (
                    <li key={agent.id} className="flex gap-3 py-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-paper text-xs font-semibold">
                        {tc(agent.name).slice(0, 1)}
                      </span>
                      <div>
                        <p className="text-sm font-medium">
                          {tc(agent.name)}{" "}
                          {agent.veto && (
                            <span className="ml-1 text-xs text-hold">
                              {t("Droit de veto")}
                            </span>
                          )}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {tc(agent.mission)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {collective && agents.length < 2 && (
                <p role="alert" className="text-sm text-hold">
                  {t(
                    "Au moins deux agents actifs sont requis pour confronter les avis.",
                  )}
                </p>
              )}
              {collective && live && (
                <details>
                  <summary className="cursor-pointer py-2 text-sm text-accent">
                    {t("Consignes avancées du comité")}
                  </summary>
                  <SessionBriefs sessionId={collective.id} />
                </details>
              )}
              <a
                className="text-sm text-accent underline underline-offset-4"
                href="#collectifs"
              >
                {t("Gérer les comités et revenir au brouillon")}
              </a>
            </div>
          )}
          {draft.step === 3 && (
            <div className="grid gap-4">
              <div className="rounded-xl border border-line p-4">
                <p className="text-xs text-muted">
                  {t("Règle du comité sélectionné")}
                </p>
                <p className="mt-1 font-semibold">
                  {collective
                    ? votingLabel(collective.voting)
                    : t("Aucun comité sélectionné")}
                </p>
                <p className="mt-2 text-sm text-muted">
                  {t(
                    "Cette règle est celle du comité enregistré. Pour la modifier, ouvrez sa configuration.",
                  )}
                </p>
              </div>
              <div className="flex gap-3 rounded-xl bg-accent-soft p-4">
                <Gavel size={20} className="shrink-0 text-accent" />
                <div>
                  <h3 className="text-sm">
                    {t("Arbitrage humain obligatoire")}
                  </h3>
                  <p className="mt-2 text-sm text-muted">
                    {t(
                      "Seuls les membres COMEX ou administrateurs habilités peuvent arbitrer. Un veto ou une porte bloquée exige une revue explicite.",
                    )}
                  </p>
                </div>
              </div>
              <a
                href="#membres"
                className="w-fit text-sm text-accent underline underline-offset-4"
              >
                {t("Vérifier les membres et leurs habilitations")}
              </a>
              {live ? (
                <Field
                  label={t("Profondeur de l’instruction")}
                  hint={t(
                    "Le fournisseur et le modèle dépendent de la configuration du serveur et des agents.",
                  )}
                >
                  <select
                    className={controlClass}
                    value={draft.profile}
                    onChange={(e) =>
                      patch({ profile: e.target.value as Profile })
                    }
                  >
                    <option value="fast">{t("Rapide")}</option>
                    <option value="deep">{t("Approfondi")}</option>
                    <option value="demo">{t("Démo")}</option>
                  </select>
                </Field>
              ) : (
                <p className="text-sm text-muted">
                  {t("Mode démo : réponses simulées, aucun appel à un modèle.")}
                </p>
              )}
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-4 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-accent"
                  checked={reviewed}
                  onChange={(e) =>
                    setAcceptedPolicy(e.target.checked ? policy : "")
                  }
                />
                <span>
                  {t(
                    "J’ai vérifié le comité et ses règles. Je comprends que son avis reste consultatif jusqu’à l’arbitrage humain.",
                  )}
                </span>
              </label>
            </div>
          )}
          {draft.step === 4 && (
            <div className="grid gap-5">
              <div>
                <p className="text-xs text-muted">{t("Question soumise")}</p>
                <p className="mt-2 text-base font-medium leading-7">
                  {draft.question}
                </p>
              </div>
              <dl className="grid gap-4 rounded-xl bg-paper p-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted">{t("Comité")}</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {tc(collective?.name) || t("Aucun comité sélectionné")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t("Gouvernance")}</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {collective && votingLabel(collective.voting)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">
                    {t("Sources ajoutées")}
                  </dt>
                  <dd className="mt-1 text-sm font-medium">
                    {draft.evidence.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t("Exécution")}</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {!live || draft.profile === "demo"
                      ? t("Démo")
                      : draft.profile === "deep"
                        ? t("Approfondi")
                        : t("Rapide")}
                  </dd>
                </div>
              </dl>
              {draft.context && (
                <div>
                  <p className="text-xs text-muted">
                    {t("Contexte et contraintes")}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    {draft.context}
                  </p>
                </div>
              )}
              <p className="text-sm text-muted">
                {t(
                  "Le lancement transmet votre question et le contexte au comité. Vous suivrez ensuite les avis, les objections et les demandes de précision dans le même dossier.",
                )}
              </p>
              {!reviewed && (
                <Button variant="secondary" onClick={() => move(3)}>
                  {t("Vérifier à nouveau la gouvernance")}
                </Button>
              )}
              {!readyCommittee && (
                <Button variant="secondary" onClick={() => move(2)}>
                  {t("Vérifier à nouveau le comité")}
                </Button>
              )}
              {!draft.evidence.length && (
                <p className="rounded-lg bg-hold-soft p-3 text-xs text-hold">
                  {t(
                    "Aucune source ajoutée. L’instruction pourra commencer, mais le comité devra expliciter ses incertitudes.",
                  )}
                </p>
              )}
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-stop-soft p-3 text-sm text-stop"
            >
              {error}
            </p>
          )}
          <div className="mt-7 flex flex-wrap justify-between gap-3 border-t border-line pt-5">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                draft.step > 0 ? move(draft.step - 1) : go("overview")
              }
            >
              <ArrowLeft size={15} />
              {t("Retour")}
            </Button>
            {draft.step < 4 ? (
              <Button
                disabled={!mayContinue || busy}
                onClick={() => move(draft.step + 1)}
              >
                {t("Continuer")}
                <ArrowRight size={15} />
              </Button>
            ) : (
              <Button
                disabled={
                  busy ||
                  !canRun ||
                  !readyQuestion ||
                  !readyContext ||
                  !readyCommittee ||
                  !reviewed
                }
                onClick={launch}
              >
                {busy ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Sparkles size={16} />
                )}
                {busy ? t("Lancement en cours…") : t("Lancer l’instruction")}
              </Button>
            )}
          </div>
        </Panel>
        <aside className="grid gap-4">
          <Panel>
            <p className="eyebrow">{t("VOTRE FIL CONDUCTEUR")}</p>
            <h2 className="mt-3 text-base">
              {t("L’IA prépare. Vous décidez.")}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              {draft.step === 0
                ? t(
                    "Une bonne question rend les options comparables. Précisez l’engagement, l’échéance et le critère qui fera la différence.",
                  )
                : draft.step === 1
                  ? t(
                      "Le comité travaille avec le contexte fourni. Une source manquante doit rester une incertitude, jamais devenir un fait inventé.",
                    )
                  : draft.step === 2
                    ? t(
                        "Cherchez des avis complémentaires : finance, juridique, technique ou marché. Les désaccords rendent les risques visibles.",
                      )
                    : t(
                        "Un consensus IA est une recommandation. L’acceptation, les conditions et les dérogations relèvent de vos membres habilités.",
                      )}
            </p>
          </Panel>
          <p className="px-1 text-xs leading-5 text-muted" role="status">
            {storageError
              ? t(
                  "Le navigateur ne peut pas conserver le brouillon. Gardez cet écran ouvert.",
                )
              : t(
                  "Brouillon conservé dans cet onglet, pour ce compte. Il est effacé après un lancement confirmé.",
                )}
          </p>
          <button
            className="w-fit px-1 text-xs text-muted underline underline-offset-4"
            disabled={busy}
            onClick={() => {
              patch(
                emptyDecisionDraft(
                  state.selectedCollectiveId,
                  live ? "fast" : "demo",
                ),
              );
              setAcceptedPolicy("");
              setSourceName("");
              setSourceText("");
              setError("");
            }}
          >
            {t("Effacer le brouillon")}
          </button>
        </aside>
      </div>
    </div>
  );
}
