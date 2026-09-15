# KayrosLab — Style guide & handover

Everything visual on the site comes from **two files** plus the logo assets.

| File | Role |
|---|---|
| `tokens.css` | **Single source of truth**: colors, fonts, type scale, spacing, radii, shadows, motion. |
| `site.css` | Shared layer consuming the tokens: base type/colors, logo lockup, buttons, links, focus ring. |
| `assets/logo-*.svg`, `assets/favicon*.png`, `assets/og-image.png` | Brand assets. |

Load order on **every** page (last wins):

```html
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="./tokens.css">
<!-- page-specific stylesheet (e.g. studio.css) -->
<link rel="stylesheet" href="./site.css">
<link rel="icon" href="./assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="./assets/apple-touch-icon.png">
<meta name="theme-color" content="#050c12">
```

## Change the brand color in one place

Edit **one line** in `tokens.css`:

```css
--color-accent: oklch(79% 0.14 205);   /* cyan — change this */
--color-accent-strong: ...;            /* hover shade */
--color-focus: ...;                    /* focus ring (keep ≥ 3:1 vs paper) */
```

Every page, the buttons, links and the focus ring follow automatically. No page holds a raw hex.

## Build a new page in the new style

1. Copy the head block above.
2. Use semantic HTML; the base layer already styles `body`, headings (`--font-display`), `code` (`--font-mono`) and links (`--color-accent`).
3. Compose with tokens, never literals:
   - surfaces: `background: var(--color-surface); border: var(--rule-hair) solid var(--color-rule); border-radius: var(--radius-md);`
   - text: `color: var(--color-ink)` / `var(--color-muted)`
   - rhythm: `padding: var(--space-lg); gap: var(--space-md);`
4. Actions use the shared button classes:

```html
<a class="button button--primary" href="#">Primary</a>
<a class="button" href="#">Secondary</a>
<a class="button button--ghost" href="#">Ghost</a>
<button class="button" disabled>Disabled</button>
<button class="button" data-state="loading">Loading…</button>
```

5. Logo lockup:

```html
<a class="brand" href="/">
  <img src="./assets/logo-mark.svg" alt="" width="60" height="60">
  <span class="brand__name">KayrosLab</span>
</a>
```

## Rules

- No raw hex, no `rgb()`, no foreign font names in page CSS — use `var(--…)`.
- Standalone/print documents (whitepapers, livrets) keep their own layout but must load `tokens.css` + `site.css`; the shared layer enforces the console fonts (`!important`) and palette.
- Keyboard focus is always visible (2px `--color-focus` ring).
- Body text contrast ≥ WCAG AA on `--color-paper`.

## Verification (latest run)

- Responsive sweep `scripts/overflow-shot.ps1`: **57/57 renders ok, 0 horizontal overflow** (19 pages × 375/834/1440). Detector validated with a positive control (intentional overflow flagged).
- Contrast (WCAG): ink/paper 17.1, muted/paper 7.7, accent‑ink/accent 9.9, accent/paper 10.7, danger 7.4, success 10.4, warning 11.2 — all ≥ AA.
- Palette/font sweep: **0** legacy hexes, **0** foreign font families across the 19 pages.
- Screenshots: `DELIVERY/screenshots/{before,after,after-tablet,after-mobile}` (76) + `reference-console-1440.png`.

## Regenerate assets / re-apply

- Brand PNGs: `powershell -File scripts/make-brand-png.ps1`
- Re-apply the restyle pass (idempotent): `node scripts/restyle-site.mjs`
- Screenshots: `powershell -File scripts/shoot.ps1 -Label after -Width 1440`
