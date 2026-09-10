import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { resolveAuthor } from "@/lib/salon/agents";
import { LITERARY_KINDS, searchAuthors } from "@/lib/salon/catalog";
import { useT, type MsgKey } from "@/lib/salon/i18n";
import { useSalon } from "@/lib/salon/store";
import { CreateAuthor } from "./CreateAuthor";
import { SalonChrome } from "./Chrome";

export function Agents() {
  const { t } = useT();
  const patches = useSalon((s) => s.patches);
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const authors = useMemo(() => searchAuthors(query, kind), [query, kind]);

  return (
    <SalonChrome current="agents">
      <main className="salon-stage">
        <section className="salon-hero">
          <p className="salon-kicker">{t("agents.kicker")}</p>
          <h1>{t("agents.h1")}</h1>
          <p>{t("agents.lead")}</p>
        </section>
        {creating ? (
          <CreateAuthor onCreated={() => setCreating(false)} onCancel={() => setCreating(false)} />
        ) : (
          <p>
            <button className="salon-btn" type="button" onClick={() => setCreating(true)}>
              {t("create.add")}
            </button>
          </p>
        )}
        <div className="salon-lib-head">
          <h2>{t("agents.fiches")}</h2>
          <div className="salon-filters">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("agents.searchShort")}
              aria-label={t("agents.searchShort")}
            />
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t("agents.kind")}>
              <option value="">{t("agents.all")}</option>
              {LITERARY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}` as MsgKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <ul className="salon-authors">
          {authors.map((author) => {
            const resolved = resolveAuthor(author.id, patches[author.id]);
            if (!resolved) return null;
            const tuned = Boolean(patches[author.id]);
            return (
              <li key={author.id} className={tuned ? "is-on" : undefined}>
                <Link to="/salon/agents/$authorId" params={{ authorId: author.id }}>
                  <span className="salon-avatar" data-kind={author.kind}>
                    {author.avatar ? (
                      <img src={author.avatar} alt="" width={72} height={72} />
                    ) : (
                      <em>{author.monogram}</em>
                    )}
                  </span>
                  <span>
                    <strong>{author.name}</strong>
                    <small>
                      @{resolved.handle} · {t(`kind.${author.kind}` as MsgKey)} · {t(`method.${resolved.method}`)}
                    </small>
                  </span>
                </Link>
                <p>{resolved.blurb}</p>
                <ol>
                  {resolved.works.slice(0, 5).map((work) => (
                    <li key={work.url}>{work.title}</li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ul>
      </main>
    </SalonChrome>
  );
}
