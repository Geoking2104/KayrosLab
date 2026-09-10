import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { allAuthors, LITERARY_KINDS, authorCopy, searchAuthors } from "@/lib/salon/catalog";
import { useT, type MsgKey } from "@/lib/salon/i18n";
import { useSalon } from "@/lib/salon/store";
import type { LiteraryAuthor } from "@/lib/salon/types";
import { SalonChrome } from "./Chrome";

function Avatar({ author }: { author: LiteraryAuthor }) {
  return (
    <span className="salon-avatar" data-kind={author.kind}>
      {author.avatar ? (
        <img src={author.avatar} alt="" width={72} height={72} />
      ) : (
        <em>{author.monogram}</em>
      )}
    </span>
  );
}

export function Foyer() {
  const { t, guests, locale } = useT();
  const rooms = useSalon((s) => s.rooms);
  const createRoom = useSalon((s) => s.createRoom);
  const navigate = useNavigate();
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>(["voltaire", "rousseau", "montaigne"]);
  const [error, setError] = useState("");
  const authors = useMemo(() => searchAuthors(query, kind), [query, kind]);

  function toggle(id: string) {
    setPicked((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      return [...current, id];
    });
  }

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (picked.length < 2) {
      setError(t("index.needTwo"));
      return;
    }
    const data = new FormData(event.currentTarget);
    const id = createRoom({
      name: String(data.get("name") || "Salon"),
      question: String(data.get("question") || ""),
      authorIds: picked,
    });
    void navigate({ to: "/salon/$circleId", params: { circleId: id } });
  }

  return (
    <SalonChrome current="foyer">
      <main className="salon-stage">
        <section className="salon-hero">
          <p className="salon-kicker">{t("hero.kicker")}</p>
          <h1>{t("hero.title")}</h1>
          <p>{t("circle.what", { n: allAuthors().length })}</p>
          <p>{t("circle.how")}</p>
        </section>

        {rooms.length > 0 && (
          <div className="salon-index">
            {rooms.map((room, index) => (
              <Link key={room.id} to="/salon/$circleId" params={{ circleId: room.id }}>
                <span className="n">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <em>{room.name}</em>
                  <p>{room.question}</p>
                </div>
                <span className="meta">
                  {room.authorIds
                    .map((id) => allAuthors().find((a) => a.id === id)?.name)
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
            ))}
          </div>
        )}

        <section className="salon-create" aria-labelledby="ouvrir">
          <h2 id="ouvrir">{t("index.open")}</h2>
          <form onSubmit={onCreate}>
            <label>
              {t("index.step1")}
              <input name="name" defaultValue="Lumières" required maxLength={80} />
            </label>
            <label>
              {t("index.step2")}
              <textarea
                name="question"
                required
                maxLength={400}
                defaultValue="Que reste-t-il de la liberté une fois qu’on a tout expliqué ?"
              />
            </label>
            <p className="salon-kicker">{t("index.step3")}</p>
            <p className="salon-picked">
              {guests(picked.length)} — {t("index.pick")}
            </p>
            <ul className="salon-guest-pick">
              {allAuthors().map((author) => {
                const on = picked.includes(author.id);
                const copy = authorCopy(author, locale);
                return (
                  <li key={author.id}>
                    <label title={copy.name}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(author.id)}
                      />
                      <span>{copy.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {error ? <p className="salon-form-error">{error}</p> : null}
            <button className="salon-btn" type="submit">
              {t("index.enter")}
            </button>
          </form>
        </section>

        <section className="salon-library" aria-labelledby="auteurs">
          <div className="salon-lib-head">
            <h2 id="auteurs">{t("agents.title")}</h2>
            <div className="salon-filters">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("agents.search")}
                aria-label={t("agents.search")}
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
              const copy = authorCopy(author, locale);
              return (
              <li key={author.id} className={picked.includes(author.id) ? "is-on" : undefined}>
                <div className="salon-author-head">
                  <Avatar author={author} />
                  <span>
                    <strong>{copy.name}</strong>
                    <small>
                      {t(`kind.${author.kind}` as MsgKey)} · {copy.era}
                    </small>
                  </span>
                </div>
                <p>{copy.blurb}</p>
                <ol>
                  {author.works.slice(0, 5).map((work) => (
                    <li key={work.url}>{work.title}</li>
                  ))}
                </ol>
                <Link to="/salon/agents/$authorId" params={{ authorId: author.id }} className="salon-back">
                  {t("agents.configure")}
                </Link>
              </li>
            );
            })}
          </ul>
        </section>
      </main>
    </SalonChrome>
  );
}
