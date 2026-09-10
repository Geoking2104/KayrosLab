import { useState } from "react";
import { ingestPublicWork, searchPublicWorks } from "@/lib/salon/gutenberg";
import { useT } from "@/lib/salon/i18n";
import { ingestLocalFile } from "@/lib/salon/pdf";
import type { LiteraryWork, Passage } from "@/lib/salon/types";

export function WorkIngest({
  onAdd,
}: {
  onAdd: (work: LiteraryWork, passages: Passage[]) => void;
}) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ id: number; title: string; authors: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    setError("");
    setBusy(true);
    try {
      const found = await searchPublicWorks({ data: query });
      setHits(found);
    } catch {
      setError(t("books.error"));
    } finally {
      setBusy(false);
    }
  }

  async function pick(id: number, title: string) {
    setBusy(true);
    setError("");
    try {
      const result = await ingestPublicWork({ data: { id, title } });
      if (!result.ok) {
        setError(t("books.error"));
        return;
      }
      onAdd(result.work, result.passages);
      setHits([]);
      setQuery("");
    } catch {
      setError(t("books.error"));
    } finally {
      setBusy(false);
    }
  }

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setError("");
    try {
      for (const file of [...list]) {
        const result = await ingestLocalFile(file);
        if (!result.ok) {
          setError(t("books.error"));
          continue;
        }
        onAdd(result.work, result.passages);
      }
    } catch {
      setError(t("books.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="salon-ingest">
      <p className="salon-kicker">{t("books.add")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label>
          {t("books.search")}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("books.search.ph")}
          />
        </label>
        <button className="salon-btn ghost" type="submit" disabled={busy || query.trim().length < 2}>
          {t("books.search")}
        </button>
      </form>
      {hits.length > 0 && (
        <ul className="salon-suggest">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button type="button" onClick={() => void pick(hit.id, hit.title)} disabled={busy}>
                {hit.title}
                <span>{hit.authors}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>
        {t("books.pdf")}
        <input
          type="file"
          accept="application/pdf,text/plain,.txt,.md,.text,application/epub+zip"
          multiple
          onChange={(e) => {
            void onFiles(e.target.files);
            e.target.value = "";
          }}
          disabled={busy}
        />
      </label>
      <p className="salon-engine">{t("books.files")}</p>
      {busy ? <p className="salon-busy">{t("books.busy")}</p> : null}
      {error ? <p className="salon-form-error">{error}</p> : null}
    </div>
  );
}
