# KayrosLab — Site design foundation (SLDS light)

Reference: **Salesforce Lightning Design System — Patterns**
<https://www.lightningdesignsystem.com/2e1ef8501/p/355656-patterns>
SLDS Color: "the foundational colors are white and light grays, with dark grays and dark blue to
create contrast for text and interactive elements."

Supersedes the earlier dark console pass. The whole public website now runs on a **light SLDS
foundation** with one token source.

- Tokens (single source): [`tokens.css`](../tokens.css)
- Shared layer (SLDS patterns): [`site.css`](../site.css)
- Logo: [`assets/logo-kayroslab.png`](../assets/logo-kayroslab.png) + `favicon-32.png`, `apple-touch-icon.png`, `icon-512.png`, `og-image.png`
- Handover: [`STYLE-GUIDE.md`](./STYLE-GUIDE.md)

## 1. Token audit (SLDS light)

| Token | Value | SLDS role |
|---|---|---|
| `--color-paper` | `#f3f2f2` | page background (gray 1) |
| `--color-surface` | `#ffffff` | cards / panels |
| `--color-surface-raised` | `#fafaf9` | subtle fills |
| `--color-rule` | `#c9c9c9` | border |
| `--color-rule-strong` | `#747474` | strong border |
| `--color-muted` | `#706e6b` | weak text |
| `--color-ink` | `#181818` | default text |
| `--color-ink-deep` | `#032d60` | dark-blue headings |
| `--color-accent` | `#0176d3` | brand / action (fills) |
| `--color-link` | `#0b5cab` | link & label text on light (AA) |
| `--color-accent-strong` | `#014486` | brand hover |
| `--color-accent-soft` | `#eaf5fe` | brand tint |
| `--color-focus` | `#0176d3` | focus ring |
| `--color-success` | `#2e844a` | success |
| `--color-warning` | `#fe9339` | warning |
| `--color-danger` | `#ea001e` | error |
| `--radius-sm/-md` | `0.25rem` | SLDS border radius |
| `--shadow-card` | `0 2px 2px 0 rgb(0 0 0 / .05)` | SLDS elevation |
| spacing | 4px grid (`--space-xs .5rem … --space-3xl 4.5rem`) | SLDS spacing |
| `--font-body/-display` | Salesforce Sans → **Inter** (open substitute) + system stack | SLDS type |
| `--font-mono` | Fira Code | code |

SLDS 2 global styling hooks are exposed as aliases: `--slds-g-color-brand-base-50`,
`--slds-g-spacing-1..8`, `--slds-g-radius-border-1/2`.

## 2. Patterns implemented in `site.css`

- **Page header** — title + actions strip with a hairline rule.
- **Card** — white surface, `#c9c9c9` border, `0.25rem` radius, SLDS elevation.
- **Button** — neutral (white/`#0176d3`), brand (primary), ghost/link, destructive; hover/focus/
  active/disabled/loading; 2rem min-height, 0.8125rem, `0.25rem` radius, visible focus ring.
- **Tag / badge**, **Table** (zebra rows, uppercase header on gray).

## 3. Migration (dark → light)

| Dark (previous pass) | SLDS light |
|---|---|
| `#050c12` | `#f3f2f2` |
| `#0c151c` | `#ffffff` |
| `#141e26` | `#fafaf9` |
| `#2b3741` / `#3c4b56` / `#475b6a` | `#c9c9c9` / `#939393` / `#747474` |
| `#e6f1f4` | `#181818` |
| `#94a4b0` / `#7f8e99` / `#c9d6da` | `#706e6b` / `#5c5c5c` / `#3e3e3c` |
| `#00d3e5` / `#00b4c4` / `#001820` | `#0176d3` / `#014486` / `#ffffff` |
| `#63d18f` / `#edbc58` / `#f97770` | `#2e844a` / `#fe9339` / `#ea001e` |
| Space Grotesk / IBM Plex Sans | Inter (SLDS stack) |

## 4. Logo

New mark adopted from the client-supplied artwork: a blue rounded-square app tile
(`≈#0a7ae0`) with a white custom **K** whose stem is a cloud. 1:1. Applied as the header
lockup, back-cover slot, favicon (PNG), apple-touch icon, 512 app icon and OG image.

## 5. Verification

- Responsive sweep (`scripts/overflow-shot.ps1`): **57/57 renders ok, 0 horizontal overflow**
  (19 pages × 375 / 834 / 1440), detector validated by a positive control.
- Palette sweep: **0** dark-palette hexes, **0** legacy font families left in the 19 pages.
- Contrast: ink `#181818` on paper `#f3f2f2` = **15.89:1** (AAA); muted `#706e6b` = **4.55:1** (AA);
  white on brand `#0176d3` = **4.63:1** (AA); link text `#0b5cab` on paper = **6.00:1** (AA+).
- Screenshots: `screenshots/{before-original,before,after,after-tablet,after-mobile}` + `reference-console-1440.png`.

## 6. Page inventory (19/19 updated)

index · index.fr · 404 · arbitrage · cycle-timeline · kayroslab-complete-with-ai-agents ·
livret-blanc-{ecouter,hackathon,kayroslab,positionner} · ontology-{explorer,panel} ·
portfolio-{board,dormant} · validation-proposition · whitepaper-{hackathon,kayroslab,listen,position}
