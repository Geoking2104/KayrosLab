# Salon

Salon is not a Slack room, not a console tab, and not a chat channel.

It is a **literary and philosophical circle**. A circle is a table. You
bring authors in — twenty-eight already, or a new one, provided they have
five public-domain works. Each is a guest: an @, a memory, a voice. You
speak in the thread. `@voltaire` calls him; he answers from his books.
Another objects. Plato, if present, questions before concluding. The floor
turns; everyone listens.

KayrosLab keeps the governed decision committee in the **console**. Salon is a
**separate service**, linked from the main site footer.

Live on GitHub Pages after merge: [kayroslab.com/salon/](https://www.kayroslab.com/salon/).

> **Do not merge this over `frontend/console-app`.**
> Production console stays where it is.

---

## Hallmark stamp

| Axis | Choice |
|---|---|
| Genre | editorial |
| Macrostructure | Specimen |
| Theme | Newsprint |
| Tone | intimate-rigorous |
| Anchor | oxblood (`oklch(42% 0.12 25)`) |
| Nav | N6 masthead |
| Footer | Ft5 statement |
| Hierarchy | H1 typographic |

Paper, not dashboard. Fraunces + Source Sans 3. One hue.

---

## What a circle is

A circle is a table.

1. You name it.
2. You pose a question.
3. You seat guests — from the 28 preloaded authors, or a new one.
4. You speak in the thread. `@voltaire` calls him; he answers from *Candide*.
   Another objects. Plato, if seated, questions before he concludes.

**Invite** (`Convier`) seats them. **Save as PDF** keeps the sitting:
cover, title page of authors, index, then the thread.

---

## Authors

Each author has:

- a handle (`@voltaire`)
- a personality summary
- at least five parsed works in memory (deterministic voice)
- a method, and an optional table instruction

You may add works to any author (Project Gutenberg, PDF, TXT).

You may add an author. Five public-domain works, or the personality will be too thin:
the voice will speak short, and repeat.

---

## Layout in this repository

| Path | What |
|---|---|
| `salon/index.html` | Playable specimen (GitHub Pages `/salon/`) |
| `salon/avatars/` | Author portraits |
| `salon/salon_core.wasm` | Rust floor / retrieval |
| `salon/src/` | React engine (fiches, cercle, i18n, ingest, PDF) |
| `crates/salon-core/` | Rust crate (`salon_eval`) |
| `backend/web/public/salon/` | Mirror for the static host |

---

## i18n

Interface: FR · EN. Books stay in the language they were written in.
