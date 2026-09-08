import { useEffect, useState } from "react";
import { STAGES } from "@/lib/kayros/engine";
import { currentIdea, useKayros } from "@/lib/kayros/store";
import type { StageId, StatusId, TechnicalScores } from "@/lib/kayros/types";
import { Field, InlineEdit, Kicker, Panel, Pill, ScoreRing, t } from "./bits";

const STATUS_SAFE: StatusId[] = [
  "nouveau",
  "en_revue",
  "discussion",
  "en_developpement",
  "termine",
  "non_poursuivi",
  "consideration_future",
  "en_pause",
];

export function Inspector() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const locale = useKayros((s) => s.locale);
  const idea = useKayros(currentIdea);
  const updateIdea = useKayros((s) => s.updateIdea);
  const updateIdeaKi = useKayros((s) => s.updateIdeaKi);
  const setIdeaStage = useKayros((s) => s.setIdeaStage);
  const setIdeaStatus = useKayros((s) => s.setIdeaStatus);
  if (!idea || !ready) return null;

  const tech = idea.ki.technical;
  function setTech(key: keyof TechnicalScores, value: number) {
    updateIdeaKi(idea.id, { ...tech, [key]: value });
  }

  return (
    <aside className="flex w-full flex-col gap-3 lg:w-80 lg:shrink-0">
      <Panel>
        <Kicker>{t(locale, "Inspecteur · tout éditable", "Inspector · fully editable")}</Kicker>
        <InlineEdit
          value={idea.title}
          onChange={(title) => updateIdea(idea.id, { title })}
          className="mt-2 font-display text-xl"
        />
        <InlineEdit
          value={idea.brief}
          onChange={(brief) => updateIdea(idea.id, { brief })}
          multiline
          className="mt-2 text-sm"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill tone="accent">{idea.stage}</Pill>
          <Pill>{idea.status}</Pill>
          <Pill tone="positive">KI {idea.ki.global.toFixed(1)}</Pill>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Field label={t(locale, "Étape", "Stage")}>
            <select
              value={idea.stage}
              onChange={(e) => setIdeaStage(idea.id, e.target.value as StageId)}
              className="h-9 rounded-md border border-line bg-paper px-2 text-sm text-ink"
              suppressHydrationWarning
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={idea.status}
              onChange={(e) => setIdeaStatus(idea.id, e.target.value as StatusId)}
              className="h-9 rounded-md border border-line bg-paper px-2 text-sm text-ink"
              suppressHydrationWarning
            >
              {STATUS_SAFE.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t(locale, "Contraintes · une par ligne", "Constraints · one per line")}>
          <InlineEdit
            value={idea.constraints.join("\n")}
            onChange={(v) =>
              updateIdea(idea.id, {
                constraints: v.split("\n").map((x) => x.trim()).filter(Boolean),
              })
            }
            multiline
          />
        </Field>
      </Panel>

      <Panel>
        <div className="flex items-center justify-between">
          <Kicker>KI technique → stratégique</Kicker>
          <ScoreRing value={idea.ki.global} label="KI" />
        </div>
        <div className="mt-2 grid gap-2">
          {(Object.keys(tech) as (keyof TechnicalScores)[]).map((k) => (
            <label key={k} className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-muted">
              <span>{k}</span>
              <span className="tabular text-ink">{tech[k].toFixed(1)}</span>
              <input
                type="range"
                min={0}
                max={10}
                step={0.1}
                value={tech[k]}
                onChange={(e) => setTech(k, Number(e.target.value))}
                className="col-span-2 accent-accent"
                suppressHydrationWarning
              />
            </label>
          ))}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {Object.entries(idea.ki.strategic).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-t border-line py-1">
              <dt className="text-muted">{k}</dt>
              <dd className="tabular text-ink">{v.toFixed(1)}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </aside>
  );
}
