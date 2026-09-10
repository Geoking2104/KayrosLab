# Salon

Salon is not a Slack room, not a console tab, and not a chat channel.

It is a **literary and philosophical reading circle**: one passage, named roles,
turns that must answer each other, and a minute. Nobody votes. The verdict is
**tenir**, **relire**, or **laisser** — never GO / NO-GO.

KayrosLab keeps the governed decision committee in the **console**. Salon is a
**separate service**, linked from the main site footer.

Live on GitHub Pages after merge: [kayroslab.com/salon/](https://www.kayroslab.com/salon/).

> **Do not merge this (or the kanban workbench) over `frontend/console-app`.**
> Production console stays where it is.

---

## Hallmark stamp

Emitted before any screen:

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

Pre-emit: P5 H5 E4 S5 R5 V5. Paper, not dashboard. Paired fonts (Fraunces + Source Sans 3). One hue. Four-point space. Ease-out. Asymmetric hero. Restraint: no purple gradient, no Inter-both, no icon-tile cards, no AI-nav.

---

## Roles, kinds, verdicts

**Roles.** `hote` · `lecteur` · `objecteur` · `secretaire` · `invite`

**Kinds.** `lecture` → `objection` → `defense` → `concession` → `synthese` → `minute`

**Verdicts.** `tenir` | `relire` | `laisser`

An objection without a place in the text (`« »` / `" "` / `p.` / `§` / `fr.` / `fragment` + number) is marked *sans lieu*. The protocol still advances; fidelity drops.

If the circle has no `invite`, the engine skips concession and asks the host for a synthesis.

---

## Rust owns the protocol

Canonical engine: [`crates/salon-core`](../crates/salon-core).

```bash
cargo test --manifest-path crates/salon-core/Cargo.toml
# wasm32 (optional)
cargo build --manifest-path crates/salon-core/Cargo.toml \
  --release --target wasm32-unknown-unknown
```

`evaluate()` is covered by four host tests (empty session, objection after lecture, *tenir* with polyphony + minute, *relire* without citations).

### WASM ABI (`salon_core.wasm`)

Compiled `cdylib`, no JS glue. Linear memory, C exports:

| Export | Contract |
|---|---|
| `salon_heap() -> i32` | Pointer to a 48 KiB HEAP |
| `salon_out_off() -> i32` | `24576` — output region |
| `salon_eval(in_len: i32) -> i32` | Lit UTF-8 JSON en `HEAP[0 .. in_len]`, écrit `u32` LE + JSON à `HEAP[OUT_OFF]`, **retourne le pointeur absolu** `heap + OUT_OFF` |

Le chargeur JS **ne doit pas** traiter la valeur de retour comme un décalage dans la mémoire linéaire. Il lit toujours :

```
outPtr = salon_heap() + salon_out_off()
len    = u32 LE at outPtr
json   = bytes at outPtr+4 .. outPtr+4+len
```

Une sonde (cercle vide → `lecteur` / `lecture`) s’exécute à l’instanciation. Si elle échoue, l’UI n’affiche pas « Rust ».

Input:

```json
{
  "members": [{ "role": "lecteur" }],
  "turns": [{ "role": "lecteur", "kind": "lecture", "text": "…", "has_citation": true }]
}
```

Output: `polyphony`, `tension`, `fidelity`, `closure`, `next_kind`, `next_role`, `verdict`, `note`.

The static site (`backend/web/public/salon/`) instantiates `./salon_core.wasm` and falls back to the same rules in JavaScript if WASM cannot load.

---

## What this is not

- Not `frontend/console-app` rooms (those remain Slack / Teams / Discord decision channels).
- Not Sales Oracle. Not Auteurs. Both stay out of the console product surface of this change.
- Not a Fastify service and not an account. Circles persist in `localStorage` (`kayros-salon-v1`) on the public site.

---

## Repository map

| Path | Role |
|---|---|
| `crates/salon-core/` | Protocol crate (source + `Cargo.lock`; never commit `target/`) |
| `backend/web/public/salon/` | GitHub Pages app at `/salon/` (foyer, séance, CSS, WASM) |
| `docs/SALON.md` | This note |
| `index.html` / `index.fr.html` | Footer link `<a href="/salon/">Salon</a>` |
| `.github/workflows/deploy-positionning-pages.yml` | Copies `backend/web/public/salon/` → `deploy/salon/` |

Pages assemble step must copy Salon. A footer without that copy is a 404.
