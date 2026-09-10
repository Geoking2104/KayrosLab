import { authorById, authorCopy } from "./catalog";
import { handleOf } from "./mentions";
import type { Locale } from "./i18n";
import { translate, roomCopy } from "./i18n";
import type { SalonRoom } from "./types";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "\u0026amp;")
    .replaceAll("<", "\u0026lt;")
    .replaceAll(">", "\u0026gt;")
    .replaceAll('"', "\u0026quot;");
}

export function keepSeancePdf(room: SalonRoom, locale: Locale) {
  if (!room.turns.length) return false;
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
    translate(locale, key, vars);
  const authors = room.authorIds.map(authorById).filter((a): a is NonNullable<typeof a> => Boolean(a));
  const date = new Date().toLocaleDateString(locale === "en" ? "en-GB" : "fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const copy = roomCopy(room, locale);
  const mark = locale === "en" ? "“" : "« ";
  const end = locale === "en" ? "”" : " »";

  const cover = `
    <section class="leaf cover">
      <p class="kicker">Salon</p>
      <h1>${escapeHtml(copy.name)}</h1>
      <blockquote>${escapeHtml(copy.question)}</blockquote>
      <p class="meta">${escapeHtml(date)} · ${authors.length} · ${room.turns.length}</p>
    </section>`;

  const garde = `
    <section class="leaf garde">
      <p class="kicker">${escapeHtml(t("index.step3"))}</p>
      <h2>${escapeHtml(t("seated"))}</h2>
      <ol>
        ${authors
          .map(
            (author) => `<li>
              <strong>${escapeHtml(authorCopy(author, locale).name)}</strong>
              <span>@${escapeHtml(handleOf(author))} · ${escapeHtml(t(`kind.${author.kind}` as Parameters<typeof translate>[1]))}</span>
              <ul>${author.works
                .slice(0, 5)
                .map((w) => `<li>${escapeHtml(w.title)}</li>`)
                .join("")}</ul>
            </li>`,
          )
          .join("")}
      </ol>
    </section>`;

  const index = `
    <section class="leaf index">
      <p class="kicker">Index</p>
      <h2>${escapeHtml(t("pdf.keep"))}</h2>
      <ol>
        ${room.turns
          .map((turn, i) => {
            const who = authorById(turn.authorId);
            const name = turn.origin === "user" ? t("host") : (who ? authorCopy(who, locale).name : turn.authorId);
            const act = t(`act.${turn.act ?? "reponse"}` as Parameters<typeof translate>[1]);
            return `<li><span>${String(i + 1).padStart(2, "0")}</span> ${escapeHtml(name)} — ${escapeHtml(act)}</li>`;
          })
          .join("")}
      </ol>
    </section>`;

  const fil = `
    <section class="leaf fil">
      ${room.turns
        .map((turn) => {
          const who = authorById(turn.authorId);
          const name = turn.origin === "user" ? t("host") : (who ? authorCopy(who, locale).name : turn.authorId);
          const act = t(`act.${turn.act ?? "reponse"}` as Parameters<typeof translate>[1]);
          const cite = turn.citations[0]
            ? `<blockquote>${mark}${escapeHtml(turn.citations[0].text)}${end}<cite>${escapeHtml(turn.citations[0].work)}</cite></blockquote>`
            : "";
          return `<article>
            <header><strong>${escapeHtml(name)}</strong> <span>${escapeHtml(act)}</span></header>
            <p>${escapeHtml(turn.text)}</p>
            ${cite}
          </article>`;
        })
        .join("")}
    </section>`;

  const html = `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(copy.name)} — Salon</title>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --paper: #f4efe4;
      --ink: #2c2118;
      --muted: #6b5b4a;
      --accent: #7a2e24;
      --rule: #d9cbb8;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: var(--paper); color: var(--ink); font-family: "Source Sans 3", sans-serif; }
    .leaf { padding: 18mm 16mm; page-break-after: always; min-height: 100vh; }
    .kicker { letter-spacing: 0.16em; text-transform: uppercase; font-size: 0.72rem; color: var(--accent); font-weight: 600; }
    h1, h2 { font-family: Fraunces, serif; font-weight: 550; letter-spacing: -0.03em; }
    h1 { font-size: 3.2rem; max-width: 12ch; line-height: 1.1; }
    .cover blockquote { font-family: Fraunces, serif; font-size: 1.5rem; font-weight: 500; max-width: 28ch; line-height: 1.35; }
    .meta { color: var(--muted); }
    .garde li { margin: 0 0 1rem; }
    .garde span { display: block; color: var(--muted); font-size: 0.9rem; }
    .index li { display: grid; grid-template-columns: 2.2rem 1fr; gap: 0.75rem; padding: 0.35rem 0; border-bottom: 1px solid var(--rule); }
    article { padding: 1rem 0; border-bottom: 1px solid var(--rule); max-width: 58ch; }
    article header { color: var(--muted); font-size: 0.85rem; }
    article strong { color: var(--ink); margin-right: 0.6rem; }
    blockquote { font-family: Fraunces, serif; color: var(--muted); font-size: 0.95rem; }
    cite { display: block; font-style: normal; font-family: "Source Sans 3", sans-serif; font-size: 0.78rem; }
    @media print {
      .leaf { min-height: auto; padding: 0; }
      @page { size: A4; margin: 18mm 16mm; }
    }
  </style>
</head>
<body>${cover}${garde}${index}${fil}
<script>window.onload = () => { window.print(); };</script>
</body></html>`;

  const popup = window.open("", "_blank");
  if (!popup) return false;
  popup.document.write(html);
  popup.document.close();
  return true;
}
