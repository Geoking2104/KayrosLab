# KayrosLab — Restyle to the console design language

- Reference (single source of truth): **https://www.kayroslab.com/console/** — the agent harness console.
- Reference baseline capture: [`screenshots/reference-console-1440.png`](./screenshots/reference-console-1440.png) (public entry of the console).
- Responsive verification: `DELIVERY/overflow-report.json` — **57/57 renders** (19 pages × 375 / 834 / 1440 px), **0 horizontal overflow**. Detector validated by a positive control (an intentionally overflowing block was flagged: 1827 probe pixels).
- Screenshots: `screenshots/before` (19 @1440), `screenshots/after` (19 @1440), `screenshots/after-tablet` (19 @834), `screenshots/after-mobile` (19 @375).

Goal: roll the console's stylesheet, fonts, colors, logo and buttons across the whole public website,
with **one token file** driving every page.

- Tokens (one source): [`tokens.css`](../tokens.css)
- Shared layer: [`site.css`](../site.css)
- Logo assets: [`assets/logo-*.svg`](../assets), `assets/favicon.svg`, `assets/favicon-32.png`, `assets/apple-touch-icon.png`, `assets/icon-512.png`, `assets/og-image.png`
- Handover: [`STYLE-GUIDE.md`](./STYLE-GUIDE.md)

---

## 1. Reference audit — visual tokens measured on the console

### 1.1 Color (console palette, exact `oklch`, with sRGB equivalents)

| Token | oklch | ≈ hex | Role |
|---|---|---|---|
| `--color-paper` | `oklch(15% 0.018 242)` | `#050c12` | page background |
| `--color-surface` | `oklch(19% 0.02 242)` | `#0c151c` | cards, panels |
| `--color-surface-raised` | `oklch(23% 0.022 242)` | `#141e26` | raised rows |
| `--color-rule` | `oklch(33% 0.024 242)` | `#2b3741` | borders, dividers |
| `--color-rule-strong` | `oklch(46% 0.035 242)` | `#475b6a` | strong borders |
| `--color-muted` | `oklch(71% 0.025 242)` | `#94a4b0` | secondary text |
| `--color-ink` | `oklch(95% 0.012 220)` | `#e6f1f4` | primary text |
| `--color-accent` | `oklch(79% 0.14 205)` | `#00d3e5` | brand accent (cyan) |
| `--color-accent-ink` | `oklch(19% 0.04 220)` | `#001820` | text on accent |
| `--color-focus` | `oklch(82% 0.16 205)` | `#00e0f5` | focus ring |
| `--color-danger` | `oklch(72% 0.16 25)` | `#f97770` | errors |
| `--color-warning` | `oklch(82% 0.13 83)` | `#edbc58` | warnings |
| `--color-success` | `oklch(78% 0.14 155)` | `#63d18f` | success |

Contrast: `--color-ink` on `--color-paper` ≈ 15:1 (AAA); `--color-muted` on paper ≈ 7:1 (AA/AAA for large). Body text passes WCAG AA.

### 1.2 Typography (console)

| Token | Family | Usage |
|---|---|---|
| `--font-display` | **Space Grotesk** (600/700) | headings, wordmark, eyebrows |
| `--font-body` | **IBM Plex Sans** (400/500/600) | body, UI, buttons |
| `--font-mono` | **Fira Code** (400/500) | code, metrics |

Type scale: `xs .72` · `sm .84` · `base 1` · `md 1.18` · `lg 1.45` · `xl 1.9` · display `clamp(2rem,4vw,3.8rem)`.
Headings: letter-spacing `-0.02em`, tight display rhythm.

### 1.3 Space, radii, motion

- Spacing scale: `3xs .125` · `2xs .25` · `xs .5` · `sm .75` · `md 1` · `lg 1.5` · `xl 2.5` · `2xl 4` · `3xl 6` (rem).
- Radii: `sm .45` · `md .75` · `pill 999` (px-based radii are avoided).
- Motion: `ease-out cubic-bezier(.16,1,.3,1)`; durations `micro 120ms` · `short 220ms` · `long 420ms`.

### 1.4 Logo

- Mark: rounded square (`rx 12/64`), fill `#15191d`, glyph **K** in `#f2f0e9`.
- Lockup: mark + "KayrosLab" in Space Grotesk 700, letter-spacing `-0.04em`.
- Clear space: ≥ 0.25 × mark height on all sides. Minimum size: 24 px (mark), 96 px (lockup).
- Light/dark variants: `logo-mark.svg` (on dark), `logo-mark-light.svg` (on light surfaces).
- Favicon: `favicon.svg` (+ `favicon-32.png`, `apple-touch-icon.png` 180, `icon-512.png`).

### 1.5 Buttons (console action system)

| State | Primary | Secondary / ghost |
|---|---|---|
| base | accent bg, accent-ink text, radius `sm`, border accent | transparent bg, rule-strong border, ink text |
| hover | accent-strong bg | accent border + accent-soft bg, accent text |
| active | `translateY(1px)` | same |
| focus-visible | 2px `--color-focus` ring, offset 2px | same |
| disabled | `opacity .5`, `pointer-events none` | same |
| loading | `cursor wait`, `opacity .8` | same |

---

## 2. Migration mapping (legacy → console)

Pages that were already token-driven (`index`, `index.fr`, `arbitrage`, `cycle-timeline`, `ontology-*`,
`portfolio-*`, `kayroslab-complete-*`) were restyled by changing values in `tokens.css` only.
Standalone documents (whitepapers, livrets, `validation-proposition`) carried hard-coded hexes and
foreign fonts; they were rewritten to the console equivalents:

| Legacy | Console | Role |
|---|---|---|
| `#050d1a` / `#0a1628` | `#050c12` / `#0c151c` | backgrounds |
| `#0f172a` | `#141e26` | raised |
| `#f9fafb` / `#e2e8f0` / `#d1d5db` | `#e6f1f4` / `#c9d6da` | text |
| `#9ca3af` / `#94a3b8` / `#6b7280` | `#94a4b0` / `#7f8e99` | muted |
| `#4b5563` / `#334155` / `#475569` | `#2b3741` / `#3c4b56` | rules |
| `#2fb9a8` (teal) | `#00d3e5` | accent |
| `#34d399` | `#63d18f` | success |
| `#f59e0b` / `#fbbf24` | `#edbc58` | warning |
| `#ef4444` / `#fb7185` | `#f97770` | danger |
| blue / violet accents | `#00d3e5` / `#00b4c4` | unified to accent |
| `Outfit` / `Tomorrow` | `var(--font-display)` | display |
| `Plus Jakarta Sans` / `Geist` | `var(--font-body)` | body |
| `JetBrains Mono` | `var(--font-mono)` | mono |

Light-tint chips (e.g. `#e0f2fe`) were mapped to dark console tints so paired dark text
(also remapped) keeps AA contrast.

---

## 3. Page inventory

All 19 in-scope pages updated. Evidence: `DELIVERY/screenshots/{before,after,after-mobile}/`.

| Page | Tokens+site.css | Fonts | Palette | Logo/favicon |
|---|---|---|---|---|
| index.html | ✔ | ✔ | ✔ | ✔ |
| index.fr.html | ✔ | ✔ | ✔ | ✔ |
| 404.html | ✔ | ✔ | ✔ | ✔ |
| arbitrage.html | ✔ | ✔ | ✔ | ✔ |
| cycle-timeline.html | ✔ | ✔ | ✔ | ✔ |
| kayroslab-complete-with-ai-agents.html | ✔ | ✔ | ✔ | ✔ |
| livret-blanc-ecouter.html | ✔ | ✔ | ✔ | ✔ |
| livret-blanc-hackathon.html | ✔ | ✔ | ✔ | ✔ |
| livret-blanc-kayroslab.html | ✔ | ✔ | ✔ | ✔ |
| livret-blanc-positionner.html | ✔ | ✔ | ✔ | ✔ |
| ontology-explorer.html | ✔ | ✔ | ✔ | ✔ |
| ontology-panel.html | ✔ | ✔ | ✔ | ✔ |
| portfolio-board.html | ✔ | ✔ | ✔ | ✔ |
| portfolio-dormant.html | ✔ | ✔ | ✔ | ✔ |
| validation-proposition.html | ✔ | ✔ | ✔ | ✔ |
| whitepaper-hackathon.html | ✔ | ✔ | ✔ | ✔ |
| whitepaper-kayroslab.html | ✔ | ✔ | ✔ | ✔ |
| whitepaper-listen.html | ✔ | ✔ | ✔ | ✔ |
| whitepaper-position.html | ✔ | ✔ | ✔ | ✔ |

Console (reference) is a separate build (`frontend/console-app`) and keeps its own copy of the tokens.
