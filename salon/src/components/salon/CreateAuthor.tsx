import { useState } from "react";
import { cleanHandle } from "@/lib/salon/agents";
import { LITERARY_KINDS } from "@/lib/salon/catalog";
import { useT, type MsgKey } from "@/lib/salon/i18n";
import { useSalon } from "@/lib/salon/store";
import type { LiteraryAuthor, LiteraryKind, LiteraryWork, Passage } from "@/lib/salon/types";
import { WorkIngest } from "./WorkIngest";

function slug(name: string) {
  return cleanHandle(
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-zA-Z0-9]+/g, "_"),
  );
}

function monogram(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export function CreateAuthor({
  onCreated,
  onCancel,
  seat = false,
}: {
  onCreated: (id: string) => void;
  onCancel: () => void;
  seat?: boolean;
}) {
  const { t } = useT();
  const addCustomAuthor = useSalon((s) => s.addCustomAuthor);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<LiteraryKind>("philosophe");
  const [era, setEra] = useState("");
  const [blurb, setBlurb] = useState("");
  const [works, setWorks] = useState<LiteraryWork[]>([]);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [error, setError] = useState("");

  function save() {
    if (works.length < 5) {
      setError(t("create.needFive"));
      return;
    }
    const id = slug(name) || `auteur_${Date.now().toString(36)}`;
    const author: LiteraryAuthor = {
      id,
      name: name.trim(),
      kind,
      lang: "fr",
      era: era.trim() || "—",
      blurb: blurb.trim(),
      wikipedia: "",
      avatar: null,
      monogram: monogram(name),
      works,
      works_count: works.length,
      terms: [...new Set(passages.flatMap((p) => p.terms))].slice(0, 16),
      stats: { words: passages.reduce((n, p) => n + p.text.split(/\s+/).length, 0), distinct: 0 },
      sample: passages[0]?.text.slice(0, 240) ?? "",
    };
    addCustomAuthor(author, passages);
    onCreated(id);
  }

  return (
    <form
      className="salon-create"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <h2>{t("create.title")}</h2>
      <label>
        {t("create.name")}
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      </label>
      <label>
        {t("agents.kind")}
        <select value={kind} onChange={(e) => setKind(e.target.value as LiteraryKind)}>
          {LITERARY_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}` as MsgKey)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("create.era")}
        <input value={era} onChange={(e) => setEra(e.target.value)} maxLength={80} />
      </label>
      <label>
        {t("blurb")}
        <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={400} />
      </label>
      <p className={works.length < 5 ? "salon-form-error" : "salon-picked"}>
        {t("books.kept", { n: works.length })}
        {works.length < 5 ? ` ${t("create.depth")}` : ` ${t("create.depth.ok")}`}
      </p>
      <ol className="salon-books">
        {works.map((work) => (
          <li key={work.url}>{work.title}</li>
        ))}
      </ol>
      <WorkIngest
        onAdd={(work, more) => {
          if (works.some((w) => w.title === work.title)) return;
          setWorks((current) => [...current, work]);
          setPassages((current) => [...current, ...more]);
        }}
      />
      {error ? <p className="salon-form-error">{error}</p> : null}
      <div className="row">
        <button className="salon-btn" type="submit" disabled={!name.trim()}>
          {seat ? t("create.save") : t("create.record")}
        </button>
        <button className="salon-btn ghost" type="button" onClick={onCancel}>
          {t("create.cancel")}
        </button>
      </div>
    </form>
  );
}
