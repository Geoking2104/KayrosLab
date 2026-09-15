import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { allAuthors, LITERARY_KINDS, authorCopy, searchAuthors } from "@/lib/salon/catalog";
import { useT, roomCopy, type MsgKey } from "@/lib/salon/i18n";
import { useSalon } from "@/lib/salon/store";
import type { LiteraryAuthor, SalonRoom } from "@/lib/salon/types";
import { SalonChrome } from "./Chrome";

function Avatar({ author, locale }: { author: LiteraryAuthor; locale: "fr" | "en" }) {
  const copy = authorCopy(author, locale);
  return (
    <span className="salon-avatar" data-kind={author.kind}>
      {author.avatar ? (
        <img src={author.avatar} alt={copy.name} width={72} height={72} />
      ) : (
        <em>{author.monogram}</em>
      )}
    </span>
  );
}

function roomHasContent(room: SalonRoom) {
  if (room.turns.length > 0) return true;
  if (room.id === "lumieres") return true;
  return !["academie", "pouvoir"].includes(room.id);
}

const PEAU = {
  fr: {
    kicker: "Mode d’emploi du salon",
    title: "Ils prennent la peau de leurs ouvrages.",
    lead: "Trois gestes, un seul objet : faire parler les livres à table, et penser avec eux — non à leur place.",
    steps: [
      {
        n: "I",
        title: "Convier",
        body: "Vous dressez la table. Un nom, une question, deux voix au moins. L’auteur n’entre pas comme une opinion : il porte cinq œuvres.",
        goal: "Objectif — constituer un cercle.",
      },
      {
        n: "II",
        title: "Adresser",
        body: "Vous parlez dans le fil. @voltaire l’appelle. La mention n’est pas un étiquetage : c’est une révérence qui désigne le convive.",
        goal: "Objectif — poser une question à un ouvrage vivant.",
      },
      {
        n: "III",
        title: "Écouter",
        body: "Ils prennent la peau de leurs livres. L’un répond, l’autre objecte. « Laisser le salon parler » : la parole tourne sans vous.",
        goal: "Objectif — les entendre se répondre, puis retenir la séance.",
      },
    ],
  },
  en: {
    kicker: "How the salon works",
    title: "They put on the skin of their works.",
    lead: "Three gestures, one aim: let the books speak at table, and think with them — not in their place.",
    steps: [
      {
        n: "I",
        title: "Invite",
        body: "You set the table. A name, a question, two voices at least. An author does not enter as an opinion: they carry five works.",
        goal: "Aim — constitute a circle.",
      },
      {
        n: "II",
        title: "Address",
        body: "You speak in the thread. @voltaire calls him. The mention is not a tag: it is a courtesy that names the guest.",
        goal: "Aim — put a question to a living work.",
      },
      {
        n: "III",
        title: "Listen",
        body: "They put on the skin of their books. One answers, another objects. “Let the salon speak”: the floor turns without you.",
        goal: "Aim — hear them answer one another, then keep the sitting.",
      },
    ],
  },
} as const;

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
  const listed = rooms.filter(roomHasContent);
  const peau = PEAU[locale];

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

        <section className="peau-steps" aria-labelledby="peau-titre">
          <p className="salon-kicker">{peau.kicker}</p>
          <h2 id="peau-titre">{peau.title}</h2>
          <p>{peau.lead}</p>
          <ol className="peau-plates">
            {peau.steps.map((step) => (
              <li key={step.n}>
                <span className="n">{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                <em>{step.goal}</em>
              </li>
            ))}
          </ol>
        </section>

        {listed.length > 0 && (
          <div className="salon-index">
            {listed.map((room, index) => {
              const copy = roomCopy(room, locale);
              return (
              <Link key={room.id} to="/salon/$circleId" params={{ circleId: room.id }}>
                <span className="n">{String(index + 1).padStart(2, "0")}</span>
                <em>{copy.name}</em>
                <span className="meta">
                  {room.authorIds
                    .map((id) => {
                      const author = allAuthors().find((a) => a.id === id);
                      return author ? authorCopy(author, locale).name : null;
                    })
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <p>{copy.question}</p>
              </Link>
              );
            })}
          </div>
        )}

        <section className="salon-create" aria-labelledby="ouvrir">
          <h2 id="ouvrir">{t("index.open")}</h2>
          <form onSubmit={onCreate}>
            <label>
              {t("index.step1")}
              <input key={locale + "-name"} name="name" defaultValue={t("circle.lumieres")} required maxLength={80} />
            </label>
            <label>
              {t("index.step2")}
              <textarea
                key={locale + "-q"}
                name="question"
                required
                maxLength={400}
                defaultValue={t("index.question.sample")}
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
                      <input type="checkbox" checked={on} onChange={() => toggle(author.id)} />
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
                  <Avatar author={author} locale={locale} />
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
