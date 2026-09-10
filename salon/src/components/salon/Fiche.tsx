import { Link } from "@tanstack/react-router";
import { cleanHandle, resolveAuthor } from "@/lib/salon/agents";
import { authorById, authorCopy, passagesFor } from "@/lib/salon/catalog";
import { useT, type MsgKey } from "@/lib/salon/i18n";
import { useSalon } from "@/lib/salon/store";
import type { SpeechMethodPref } from "@/lib/salon/types";
import { SalonChrome } from "./Chrome";
import { WorkIngest } from "./WorkIngest";

export function Fiche({ authorId }: { authorId: string }) {
  const { t, locale } = useT();
  const base = authorById(authorId);
  const patch = useSalon((s) => s.patches[authorId]);
  const patchAgent = useSalon((s) => s.patchAgent);
  const resetAgent = useSalon((s) => s.resetAgent);
  const addWork = useSalon((s) => s.addWork);
  const rooms = useSalon((s) => s.rooms);
  const inviteAuthor = useSalon((s) => s.inviteAuthor);
  const dismissAuthor = useSalon((s) => s.dismissAuthor);
  const resolved = resolveAuthor(authorId, patch);

  if (!base || !resolved) {
    return (
      <SalonChrome current="agents">
        <main className="salon-stage">
          <Link to="/salon/agents" className="salon-back">
            {t("back.agents")}
          </Link>
          <h1>{t("agents.missing")}</h1>
        </main>
      </SalonChrome>
    );
  }

  const memory = passagesFor(authorId, resolved.workTitles);
  const methods: SpeechMethodPref[] = ["auto", "rhetorique", "elenchus"];
  const copy = authorCopy(base, locale);
  const blurbValue = patch?.blurb?.trim() ? resolved.blurb : copy.blurb;

  function toggleWork(title: string) {
    const current = resolved!.workTitles;
    const next = current.includes(title) ? current.filter((item) => item !== title) : [...current, title];
    if (next.length < 1) return;
    patchAgent(authorId, { workTitles: next });
  }

  return (
    <SalonChrome current="agents">
      <main className="salon-stage salon-fiche">
        <Link to="/salon/agents" className="salon-back">
          {t("back.agents")}
        </Link>
        <header className="salon-fiche-head">
          <span className="salon-avatar" data-kind={base.kind}>
            {base.avatar ? <img src={base.avatar} alt="" width={88} height={88} /> : <em>{base.monogram}</em>}
          </span>
          <div>
            <p className="salon-kicker">
              {t(`kind.${base.kind}` as MsgKey)} · {copy.era}
            </p>
            <h1>{copy.name}</h1>
            <p>{t("passages", { handle: resolved.handle, n: memory.length })}</p>
          </div>
        </header>

        <form
          className="salon-create"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <label>
            {t("handle")}
            <input
              value={resolved.handle}
              onChange={(e) => patchAgent(authorId, { handle: cleanHandle(e.target.value) || base.id })}
              maxLength={24}
              spellCheck={false}
            />
          </label>
          <label>
            {t("blurb")}
            <textarea
              value={blurbValue}
              onChange={(e) => patchAgent(authorId, { blurb: e.target.value })}
              maxLength={400}
            />
          </label>
          <fieldset className="salon-method">
            <legend>{t("method")}</legend>
            {methods.map((item) => (
              <label key={item}>
                <input
                  type="radio"
                  name="method"
                  checked={resolved.method === item}
                  onChange={() => patchAgent(authorId, { method: item })}
                />
                {t(`method.${item}`)}
              </label>
            ))}
          </fieldset>
          <label>
            {t("note")}
            <input
              value={resolved.note}
              onChange={(e) => patchAgent(authorId, { note: e.target.value })}
              maxLength={180}
              placeholder={t("note.ph")}
            />
          </label>
        </form>

        <section>
          <h2>{t("books")}</h2>
          <p className="salon-picked">
            {t("books.kept", { n: resolved.works_count })}
            {resolved.works_count < 5 ? t("books.short") : t("books.ok")}
          </p>
          <ul className="salon-work-toggle">
            {base.works.map((work) => {
              const on = resolved.workTitles.includes(work.title);
              return (
                <li key={work.url}>
                  <label>
                    <input type="checkbox" checked={on} onChange={() => toggleWork(work.title)} />
                    {work.title}
                  </label>
                </li>
              );
            })}
          </ul>
          <WorkIngest
            onAdd={(work, passages) => {
              addWork(authorId, work, passages);
              if (patch?.workTitles) {
                patchAgent(authorId, { workTitles: [...patch.workTitles, work.title] });
              }
            }}
          />
        </section>

        <section>
          <h2>{t("circles")}</h2>
          <ul className="salon-index">
            {rooms.map((room, index) => {
              const inRoom = room.authorIds.includes(authorId);
              return (
                <li key={room.id}>
                  <Link to="/salon/$circleId" params={{ circleId: room.id }}>
                    <span className="n">{String(index + 1).padStart(2, "0")}</span>
                    <em>{room.name}</em>
                    <p>{inRoom ? t("seated") : t("outside")}</p>
                  </Link>
                  {inRoom ? (
                    <button
                      type="button"
                      className="salon-dismiss"
                      onClick={() => dismissAuthor(room.id, authorId)}
                      disabled={room.authorIds.length <= 2}
                    >
                      {t("out")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="salon-btn ghost"
                      onClick={() => inviteAuthor(room.id, authorId)}
                    >
                      {t("in")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <p>
          <button type="button" className="salon-btn ghost" onClick={() => resetAgent(authorId)}>
            {t("reset")}
          </button>
        </p>
      </main>
    </SalonChrome>
  );
}
