import { useMemo, useState } from "react";
import { authorById, authorCopy } from "@/lib/salon/catalog";
import { handleOf } from "@/lib/salon/mentions";
import { useSalon } from "@/lib/salon/store";
import type { Locale } from "@/lib/salon/i18n";
import { weightedLength } from "@/lib/salon/x/compress";
import { fluxT, stanceLabel } from "@/lib/salon/x/copy";
import { copyText, draftFrom, openIntent, publishViaApi, textOf } from "@/lib/salon/x/publish";
import { rememberDraft } from "@/lib/salon/x/journal";
import { canApiReply } from "@/lib/salon/x/oauth";
import type { GabaritX, PostSource, PropositionX, XBinding } from "@/lib/salon/x/types";

export function CarteProposition({
  prop,
  post,
  binding,
  locale,
}: {
  prop: PropositionX;
  post: PostSource;
  binding: XBinding | null;
  locale: Locale;
}) {
  const patches = useSalon((s) => s.patches);
  const author = authorById(prop.authorId);
  const [gabarit, setGabarit] = useState<GabaritX>("court");
  const [text, setText] = useState(prop.court);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const apiOk = canApiReply(binding, post.mentionedHandles);

  const name = author ? authorCopy(author, locale).name : prop.authorId;
  const handle = author ? handleOf(author, patches[author.id]) : prop.authorId;
  const weight = useMemo(() => weightedLength(text), [text]);

  function switchGabarit(next: GabaritX) {
    setGabarit(next);
    setText(textOf(prop, next));
  }

  async function onCopy() {
    await copyText(text);
    rememberDraft(draftFrom(prop, gabarit, text, "copied"));
    setNote(fluxT(locale, "copied"));
  }

  function onIntent() {
    openIntent(text, post);
    rememberDraft(draftFrom(prop, gabarit, text, "intent"));
  }

  async function onPublish() {
    setBusy(true);
    setNote("");
    try {
      const out = await publishViaApi({ binding, post, text, proposition: prop });
      rememberDraft(draftFrom(prop, gabarit, text, "published", out.tweetId));
      setNote(out.tweetId);
    } catch (err) {
      setNote(err instanceof Error ? err.message : fluxT(locale, "error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`flux-card is-${prop.stance}`}>
      <header>
        {author?.avatar ? <img src={author.avatar} alt="" width={40} height={40} /> : <em>{author?.monogram ?? "?"}</em>}
        <div>
          <strong>{name}</strong>
          <span>@{handle}</span>
        </div>
        <b>{stanceLabel(locale, prop.stance)}</b>
      </header>
      <p className="flux-prise">{prop.prise}</p>
      <p className="flux-pills">
        {prop.grounded ? <span>{fluxT(locale, "grounded")}</span> : null}
        {prop.weakMemory ? <span className="is-warn">{fluxT(locale, "fragile")}</span> : null}
        {prop.work ? <span>{prop.work}</span> : null}
        {text !== textOf(prop, gabarit) ? <span>{fluxT(locale, "edited")}</span> : null}
      </p>
      <div className="flux-tabs" role="tablist">
        <button type="button" className={gabarit === "court" ? "is-on" : undefined} onClick={() => switchGabarit("court")}>
          {fluxT(locale, "court")}
        </button>
        <button type="button" className={gabarit === "long" ? "is-on" : undefined} onClick={() => switchGabarit("long")}>
          {fluxT(locale, "long")}
        </button>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={gabarit === "court" ? 5 : 10} />
      <p className="flux-count">{fluxT(locale, "chars", { n: weight })}</p>
      <div className="flux-actions">
        <button type="button" className="salon-btn" onClick={() => void onCopy()}>
          {fluxT(locale, "copy")}
        </button>
        <button type="button" className="salon-btn ghost" onClick={onIntent}>
          {fluxT(locale, "intent")}
        </button>
        <button type="button" className="salon-btn ghost" disabled={!apiOk || busy} onClick={() => void onPublish()} title={apiOk ? undefined : fluxT(locale, "publishOff")}>
          {fluxT(locale, "publish")}
        </button>
      </div>
      {note ? <p className="flux-note">{note}</p> : null}
    </article>
  );
}
