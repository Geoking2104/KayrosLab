import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { allAuthors, authorById, authorCopy, buildPersona, passagesFor } from "@/lib/salon/catalog";
import { planRound } from "@/lib/salon/flows";
import { useT, roomCopy, type MsgKey } from "@/lib/salon/i18n";
import { handleOf, insertMention, parseMentions, suggestMentions } from "@/lib/salon/mentions";
import { speakAsAuthor } from "@/lib/salon/speak";
import { useSalon } from "@/lib/salon/store";
import type { LiteraryAuthor, SpeechAct } from "@/lib/salon/types";
import { keepSeancePdf } from "@/lib/salon/seancePdf";
import { retrieveMemory } from "@/lib/salon/wasm";
import { SalonChrome } from "./Chrome";
import { CreateAuthor } from "./CreateAuthor";

function Avatar({ author, locale, size = 48 }: { author: LiteraryAuthor; locale: "fr" | "en"; size?: number }) {
  const copy = authorCopy(author, locale);
  return (
    <span className="salon-avatar" data-kind={author.kind} style={{ width: size, height: size }}>
      {author.avatar ? <img src={author.avatar} alt={copy.name} width={size} height={size} /> : <em>{author.monogram}</em>}
    </span>
  );
}

export function Seance({ circleId }: { circleId: string }) {
  const { t, locale } = useT();
  const rooms = useSalon((s) => s.rooms);
  const room = rooms.find((r) => r.id === circleId);
  const addTurn = useSalon((s) => s.addTurn);
  const inviteAuthor = useSalon((s) => s.inviteAuthor);
  const dismissAuthor = useSalon((s) => s.dismissAuthor);
  const patches = useSalon((s) => s.patches);
  const customs = useSalon((s) => s.customs);
  const hydrated = useSalon((s) => s.hydrated);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  function labelOf(id: string) {
    if (id === "user") return t("to.host");
    if (id === "table") return t("to.table");
    const who = authorById(id);
    return who ? authorCopy(who, locale).name : id;
  }

  function clock(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString(locale === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  const seated = (room?.authorIds ?? []).map(authorById).filter((a): a is LiteraryAuthor => Boolean(a));
  const suggestions = useMemo(
    () => suggestMentions(draft, room?.authorIds ?? [], patches),
    [draft, room?.authorIds, patches],
  );
  const guests = useMemo(() => {
    const have = new Set(room?.authorIds ?? []);
    return allAuthors().filter((author) => !have.has(author.id));
  }, [room?.authorIds, customs]);

  async function runRound(query: string, lastId: string | null, mode: "ask" | "talk", mentions: string[], table: boolean) {
    if (!room) return;
    setError("");
    const latest = useSalon.getState().rooms.find((r) => r.id === room.id) ?? room;
    const recent = latest.turns.filter((t) => t.origin === "agent").map((t) => t.authorId);
    const moves = (
      await planRound({
        seated: latest.authorIds,
        last: lastId,
        recent,
        query,
        mentions,
        table,
        mode,
        patches,
      })
    ).filter((m) => m.id !== "user");
    const history = latest.turns.map((turn) => {
      const who = authorById(turn.authorId);
      return {
        name: turn.authorId === "user" ? t("host.short") : who ? authorCopy(who, locale).name : turn.authorId,
        text: turn.text,
      };
    });
    let previous = query;
    let pending: string | null = null;
    for (const move of moves) {
      const author = authorById(move.id);
      if (!author) continue;
      setBusy(authorCopy(author, locale).name);
      const retrieveQuery =
        pending === "elenchus" || move.act === "objection" ? `${previous} ${latest.question}` : query;
      const passages = passagesFor(move.id, patches[move.id]?.workTitles);
      const memory = await retrieveMemory(retrieveQuery, passages);
      const cited = memory.hits
        .map((hit) => passages.find((p) => p.id === hit.id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .slice(0, 3);
      const spoken = await speakAsAuthor({
        data: {
          authorId: move.id,
          question: latest.question,
          history,
          passages: cited.map((p) => ({ work: p.work, text: p.text })),
          act: move.act === "objection" ? "objection" : "reponse",
          toName: labelOf(move.to),
          toward: move.to === "user" ? "user" : "author",
          figure: move.figure,
          method: move.method,
          answering: pending ?? undefined,
          patch: patches[move.id],
          persona: buildPersona(author, patches[move.id]),
        },
      });
      const text = spoken.text?.trim();
      if (!text) {
        setError(spoken.error || t("no.voice"));
        continue;
      }
      addTurn(room.id, {
        authorId: move.id,
        text,
        citations: cited.map((p) => ({ work: p.work, text: p.text.slice(0, 220) })),
        origin: "agent",
        grounded: spoken.grounded,
        act: move.act as SpeechAct,
        to: move.to,
      });
      history.push({ name: authorCopy(author, locale).name, text });
      previous = text;
      pending = move.method === "elenchus" ? "elenchus" : null;
    }
    setBusy(null);
  }

  async function onAsk() {
    if (!room || busy) return;
    const text = draft.trim();
    if (text.length < 2) return;
    const parsed = parseMentions(text, room.authorIds, patches);
    addTurn(room.id, {
      authorId: "user",
      text,
      citations: [],
      origin: "user",
      grounded: false,
      act: "adresse",
      to: parsed.ids[0] ?? "table",
    });
    setDraft("");
    await runRound(text, "user", "ask", parsed.ids, parsed.table);
  }

  async function onLetTalk() {
    if (!room || busy) return;
    const last = room.turns.at(-1);
    const query = last?.text || room.question;
    await runRound(query, last?.origin === "agent" ? last.authorId : "user", "talk", [], true);
  }

  if (!hydrated) {
    return (
      <SalonChrome current="seance">
        <main className="salon-stage">
          <p>{t("opening")}</p>
        </main>
      </SalonChrome>
    );
  }

  if (!room) {
    return (
      <SalonChrome current="seance">
        <main className="salon-stage">
          <Link to="/salon" className="salon-back">
            {t("back.circles")}
          </Link>
          <h1>{t("missing.salon")}</h1>
        </main>
      </SalonChrome>
    );
  }

  const seatedCopy = roomCopy(room, locale);

  return (
    <SalonChrome current="seance">
      <main className="salon-stage salon-channel">
        <aside className="salon-channels" aria-label={t("circles")}>
          <p className="salon-kicker">{t("circles")}</p>
          <ul>
            {rooms.map((item) => {
              const copy = roomCopy(item, locale);
              return (
              <li key={item.id}>
                <Link to="/salon/$circleId" params={{ circleId: item.id }} aria-current={item.id === room.id ? "page" : undefined}>
                  <em>{copy.name}</em>
                  <span>{t("n.seated", { n: item.authorIds.length })}</span>
                </Link>
              </li>
              );
            })}
          </ul>
          <Link to="/salon" className="salon-back">
            {t("open.circle")}
          </Link>
        </aside>

        <section className="salon-stream">
          <header className="salon-protocol">
            <h1>{seatedCopy.name}</h1>
            <p>{seatedCopy.question}</p>
            <p className="salon-how">{t("circle.how.short")}</p>
          </header>
          {room.turns.length === 0 && (
            <p className="salon-empty">
              {t("empty")}
            </p>
          )}
          <ol className="salon-messages">
            {room.turns.map((turn) => {
              const author = turn.origin === "agent" ? authorById(turn.authorId) : null;
              const who = author ? authorCopy(author, locale).name : t("host");
              const mark = locale === "en" ? "“" : "« ";
              const end = locale === "en" ? "”" : " »";
              return (
                <li key={turn.id} className={turn.origin === "user" ? "salon-msg is-invited" : "salon-msg"}>
                  {author ? <Avatar author={author} locale={locale} size={40} /> : <span className="salon-avatar salon-host">H</span>}
                  <div>
                    <header>
                      <strong>{who}</strong>
                      {author ? <span className="salon-handle">@{handleOf(author, patches[author.id])}</span> : null}
                      <span>
                        {t(`act.${turn.act ?? "reponse"}` as MsgKey)} · {t("act.to")} {labelOf(turn.to ?? "table")}
                      </span>
                      {turn.createdAt ? <time>{clock(turn.createdAt)}</time> : null}
                    </header>
                    <p>{turn.text}</p>
                    {turn.citations[0] ? (
                      <blockquote className="salon-cite">
                        {mark}{turn.citations[0].text}{end}
                        <cite>{turn.citations[0].work}</cite>
                      </blockquote>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          {busy ? <p className="salon-busy">{t("writing", { name: busy })}</p> : null}
          {error ? <p className="salon-form-error">{error}</p> : null}
          <form
            className="salon-compose"
            onSubmit={(event) => {
              event.preventDefault();
              void onAsk();
            }}
          >
            {suggestions.length > 0 && (
              <ul className="salon-suggest" role="listbox">
                {suggestions.map((author) => (
                  <li key={author.id}>
                    <button
                      type="button"
                      onClick={() => setDraft(insertMention(draft, author, patches[author.id]))}
                    >
                      @{handleOf(author, patches[author.id])}
                      <span>{authorCopy(author, locale).name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label>
              {t("msg")}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={800}
                placeholder="@voltaire l’optimisme n’est-il qu’une politesse ?"
              />
            </label>
            <div className="row">
              <button className="salon-btn" type="submit" disabled={Boolean(busy) || draft.trim().length < 2}>
                {t("send")}
              </button>
              <button className="salon-btn ghost" type="button" disabled={Boolean(busy)} onClick={() => void onLetTalk()}>
                {t("talk")}
              </button>
              <button
                className="salon-btn ghost"
                type="button"
                disabled={room.turns.length === 0}
                onClick={() => keepSeancePdf(room, locale)}
              >
                {t("pdf.keep")}
              </button>
            </div>
          </form>
        </section>

        <aside className="salon-people" aria-label={t("seated")}>
          <p className="salon-kicker">{t("at.table", { n: seated.length })}</p>
          <ul className="salon-roster">
            {seated.map((author) => {
              const copy = authorCopy(author, locale);
              return (
              <li key={author.id}>
                <button
                  type="button"
                  className="salon-addr-pick"
                  onClick={() => setDraft(insertMention(draft, author, patches[author.id]))}
                >
                  <Avatar author={author} locale={locale} size={40} />
                  <div>
                    <strong>{copy.name}</strong>
                    <span>
                      @{handleOf(author, patches[author.id])} · {t(`kind.${author.kind}` as MsgKey)}
                    </span>
                  </div>
                </button>
                <div className="salon-roster-actions">
                  <Link to="/salon/agents/$authorId" params={{ authorId: author.id }}>
                    {t("fiche")}
                  </Link>
                  {room.authorIds.length > 2 ? (
                    <button
                      type="button"
                      className="salon-dismiss"
                      onClick={() => dismissAuthor(room.id, author.id)}
                      aria-label={`${t("out")} ${copy.name}`}
                    >
                      {t("out")}
                    </button>
                  ) : null}
                </div>
              </li>
            );
            })}
          </ul>
          {seated.map((author) => {
            const copy = authorCopy(author, locale);
            return (
            <details key={author.id} className="salon-engine-card">
              <summary>
                {copy.name} — {t("works.count", { n: author.works_count })}
              </summary>
              <p>{copy.blurb}</p>
              <ol className="salon-books">
                {author.works.slice(0, 5).map((work) => (
                  <li key={work.url}>{work.title}</li>
                ))}
              </ol>
            </details>
            );
          })}
          <div className="salon-invite">
              {creating ? (
                <CreateAuthor
                  seat
                  onCreated={(id) => {
                    inviteAuthor(room.id, id);
                    setCreating(false);
                  }}
                  onCancel={() => setCreating(false)}
                />
              ) : (
                <>
                  <label>
                    {t("invite")}
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) {
                          inviteAuthor(room.id, e.target.value);
                          e.target.value = "";
                        }
                      }}
                    >
                      <option value="">{t("invite.choose")}</option>
                      {guests.map((author) => (
                        <option key={author.id} value={author.id}>
                          @{handleOf(author, patches[author.id])} — {authorCopy(author, locale).name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="salon-btn ghost" type="button" onClick={() => setCreating(true)}>
                    {t("invite.create")}
                  </button>
                </>
              )}
            </div>
          <p className="salon-engine">{t("flows", { n: allAuthors().length })}</p>
        </aside>
      </main>
    </SalonChrome>
  );
}
