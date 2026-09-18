import { useEffect, useMemo, useState, type FormEvent } from "react";
import { authorById, authorCopy } from "@/lib/salon/catalog";
import { useT, roomCopy } from "@/lib/salon/i18n";
import { handleOf } from "@/lib/salon/mentions";
import { startSalonSso } from "@/lib/salon/sso";
import { useSalon } from "@/lib/salon/store";
import { SalonChrome } from "./Chrome";
import { CarteProposition } from "./CarteProposition";
import "./flux.css";
import { fluxT } from "@/lib/salon/x/copy";
import { ingestPost, isMediaOnly } from "@/lib/salon/x/ingest";
import { loadJournal, rememberPost, rememberProps } from "@/lib/salon/x/journal";
import { consumeXCallback, fetchXBinding, startXOauth, unlinkX } from "@/lib/salon/x/oauth";
import { MAX_AUTHORS_X, speakForX } from "@/lib/salon/x/speak-x";
import { extractThese, theseReady } from "@/lib/salon/x/thesis";
import { STANCES } from "@/lib/salon/x/stance";
import type { PostSource, PropositionX, TheseSource, XBinding } from "@/lib/salon/x/types";

export function FluxX({ circleId }: { circleId?: string }) {
  const { locale } = useT();
  const t = (key: Parameters<typeof fluxT>[1], vars?: Record<string, string | number>) => fluxT(locale, key, vars);
  const user = useSalon((s) => s.user);
  const hydrated = useSalon((s) => s.hydrated);
  const rooms = useSalon((s) => s.rooms);
  const patches = useSalon((s) => s.patches);
  const room = rooms.find((r) => r.id === circleId) ?? rooms[0];

  const [url, setUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [handle, setHandle] = useState("");
  const [post, setPost] = useState<PostSource | null>(null);
  const [these, setThese] = useState<TheseSource | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [props, setProps] = useState<PropositionX[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [binding, setBinding] = useState<XBinding | null>(null);
  const [warn, setWarn] = useState("");

  useEffect(() => {
    if (!room) return;
    const remembered = loadJournal().lastAuthors[room.id];
    setPicked((remembered?.length ? remembered : room.authorIds).slice(0, MAX_AUTHORS_X));
  }, [room?.id, room?.authorIds]);

  useEffect(() => {
    let cancelled = false;
    void consumeXCallback()
      .then((b) => fetchXBinding().then((live) => live ?? b))
      .then((b) => {
        if (!cancelled) setBinding(b);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const seated = useMemo(
    () => (room?.authorIds ?? []).map(authorById).filter((a): a is NonNullable<typeof a> => Boolean(a)),
    [room?.authorIds],
  );

  function toggle(id: string) {
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_AUTHORS_X) return cur;
      return [...cur, id];
    });
  }

  async function onLoad(event: FormEvent) {
    event.preventDefault();
    setError("");
    setWarn("");
    try {
      const out = await ingestPost({ urlOrId: url, pastedText: pasted, pastedHandle: handle });
      setPost(out.post);
      const next = extractThese(out.post);
      setThese(next);
      rememberPost(out.post, next);
      if (out.warning) setWarn(out.warning);
      if (out.post.handle) setHandle(out.post.handle);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    }
  }

  async function onGenerate() {
    if (!room || !post || !these || !theseReady(these)) {
      setError(t("theseNeed"));
      return;
    }
    setError("");
    setProps([]);
    const authors = picked.slice(0, MAX_AUTHORS_X);
    const collected: PropositionX[] = [];
    for (const authorId of authors) {
      const who = authorById(authorId);
      setBusy(who ? authorCopy(who, locale).name : authorId);
      for (const stance of STANCES) {
        try {
          const card = await speakForX(
            { authorId, circleId: room.id, post, these: these.text, stance },
            { locale, patch: patches[authorId] },
          );
          collected.push(card);
          setProps([...collected]);
        } catch (err) {
          setError(err instanceof Error ? err.message : t("error"));
        }
      }
    }
    rememberProps(collected);
    setBusy("");
  }

  if (!hydrated) {
    return (
      <SalonChrome current="flux">
        <main className="salon-stage">
          <p>{t("generating")}</p>
        </main>
      </SalonChrome>
    );
  }

  if (!user) {
    return (
      <SalonChrome current="flux">
        <main className="salon-stage flux-gate">
          <p className="salon-kicker">{t("kicker")}</p>
          <h1>{t("title")}</h1>
          <p>{t("needSso")}</p>
          <button className="salon-btn" type="button" onClick={() => void startSalonSso()}>
            {t("enter")}
          </button>
        </main>
      </SalonChrome>
    );
  }

  const copyRoom = room ? roomCopy(room, locale) : null;

  return (
    <SalonChrome current="flux">
      <main className="salon-stage flux-desk">
        <header className="flux-hero">
          <p className="salon-kicker">{t("kicker")}</p>
          <h1>{t("title")}</h1>
          <p>{t("lead")}</p>
          <p className="flux-account">
            {binding?.handle ? t("linked", { handle: binding.handle.replace(/^@/, "") }) : null}
            {binding?.handle ? (
              <button type="button" className="salon-btn ghost" onClick={() => void unlinkX().then(() => setBinding(null))}>
                {t("unlink")}
              </button>
            ) : (
              <button type="button" className="salon-btn ghost" onClick={() => void startXOauth("read")}>
                {t("linkX")}
              </button>
            )}
            {binding?.handle && !binding.scopes.includes("tweet.write") ? (
              <button type="button" className="salon-btn ghost" onClick={() => void startXOauth("write")}>
                {t("writeScope")}
              </button>
            ) : null}
          </p>
        </header>

        <div className="flux-grid">
          <section className="flux-source">
            {copyRoom ? (
              <p className="salon-kicker">
                {t("circle")} · {copyRoom.name}
              </p>
            ) : null}
            <form onSubmit={(e) => void onLoad(e)}>
              <label>
                {t("url")}
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("urlPh")} />
              </label>
              <label>
                {t("handle")}
                <input value={handle} onChange={(e) => setHandle(e.target.value)} />
              </label>
              <label>
                {t("paste")}
                <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={t("pastePh")} rows={5} />
              </label>
              <button className="salon-btn" type="submit">
                {t("load")}
              </button>
            </form>
            {warn ? <p className="flux-note">{warn}</p> : null}
            {post ? (
              <blockquote className="flux-post">
                <header>
                  @{post.handle || "…"} · {t("source")} {post.source}
                </header>
                <p>{post.text || "—"}</p>
              </blockquote>
            ) : (
              <p className="salon-empty">{t("empty")}</p>
            )}
            {these ? (
              <label>
                {t("these")}
                <textarea
                  value={these.text}
                  onChange={(e) => setThese({ ...these, text: e.target.value, edited: true, model: "hote" })}
                  rows={3}
                />
                <small>{t("theseHelp")}</small>
              </label>
            ) : null}
            {post && isMediaOnly(post.text) && !theseReady(these ?? { postId: post.id, text: "", edited: false, model: "extractif" }) ? (
              <p className="salon-form-error">{t("theseNeed")}</p>
            ) : null}

            <p className="salon-kicker">{t("authors")}</p>
            <ul className="flux-authors">
              {seated.map((author) => {
                const on = picked.includes(author.id);
                const copy = authorCopy(author, locale);
                return (
                  <li key={author.id}>
                    <label>
                      <input type="checkbox" checked={on} onChange={() => toggle(author.id)} />
                      <span>
                        {copy.name} <em>@{handleOf(author, patches[author.id])}</em>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <button
              className="salon-btn"
              type="button"
              disabled={Boolean(busy) || !post || picked.length === 0}
              onClick={() => void onGenerate()}
            >
              {busy ? t("generating") : t("generate")}
            </button>
            {busy ? <p className="salon-busy">{busy}</p> : null}
            {error ? <p className="salon-form-error">{error}</p> : null}
          </section>

          <section className="flux-cards" aria-live="polite">
            {props.map((prop) => (
              <CarteProposition key={prop.id} prop={prop} post={post!} binding={binding} locale={locale} />
            ))}
          </section>
        </div>
      </main>
    </SalonChrome>
  );
}
