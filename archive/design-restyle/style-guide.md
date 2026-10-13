# KayrosLab — Style guide & handover (SLDS light)

Everything visual comes from **two files** plus the logo assets.

| File | Role |
|---|---|
| `tokens.css` | **Single source of truth**: SLDS light colors, fonts, type scale, spacing (4px grid), radii, shadows, motion. |
| `site.css` | SLDS patterns consuming the tokens: base type, page header, card, buttons, tags, tables, logo lockup, focus ring. |
| `assets/logo-kayroslab.png` (+ `favicon-32.png`, `apple-touch-icon.png`, `icon-512.png`, `og-image.png`) | Brand assets. |

Load order on **every** page (last wins):

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="./tokens.css">
<!-- page-specific stylesheet (e.g. studio.css) -->
<link rel="stylesheet" href="./site.css">
<link rel="icon" href="./assets/logo-kayroslab.png" type="image/png">
<link rel="apple-touch-icon" href="./assets/apple-touch-icon.png">
<meta name="theme-color" content="#f3f2f2">
```

## Change the brand color in one place

Edit `tokens.css`:

```css
--color-accent: #0176d3;      /* brand blue — buttons, fills */
--color-accent-strong: #014486; /* hover */
--color-link: #0b5cab;        /* link text on light (keeps AA) */
--color-focus: #0176d3;       /* focus ring */
```

Every page, the buttons, links and focus ring follow. No page holds a raw hex.

## Build a new page

1. Copy the head block above.
2. Use semantic HTML; the base layer styles `body`, headings (dark-blue), `code`, links.
3. Compose with tokens (never literals):
   - surface: `background: var(--color-surface); border: var(--rule-hair) solid var(--color-rule); border-radius: var(--radius-md); box-shadow: var(--shadow-card);`
   - text: `color: var(--color-ink)` / `var(--color-muted)`; headings `var(--color-ink-deep)`
   - rhythm: `padding: var(--space-lg); gap: var(--space-md);`
4. Buttons (SLDS):

```html
<a class="button button--primary">Primary</a>
<a class="button">Neutral</a>
<a class="button button--ghost">Ghost</a>
<a class="button button--destructive">Delete</a>
<button class="button" disabled>Disabled</button>
<button class="button" data-state="loading">Loading…</button>
```

5. Logo lockup:

```html
<a class="brand" href="/">
  <img src="./assets/logo-kayroslab.png" alt="" width="34" height="34">
  <span class="brand__name">KayrosLab</span>
</a>
```

## Rules

- No raw hex, `rgb()`, or foreign font names in page CSS — use `var(--…)`.
- Standalone/print documents (whitepapers, livrets) keep their layout but must load `tokens.css` + `site.css`; the shared layer enforces the SLDS fonts (`!important`) and palette.
- Keyboard focus is always visible (2px `--color-focus` ring).
- Body text contrast ≥ WCAG AA on `--color-paper`.

## Verification (latest run)

- Responsive sweep: **57/57 renders ok, 0 horizontal overflow** (19 pages × 375/834/1440); detector validated by a positive control.
- Palette sweep: **0** dark-palette hexes and **0** legacy font families left.
- Contrast: ink/paper 15.89, muted/paper 4.55, white/brand 4.63, link/paper 6.00 — all ≥ AA.
- Screenshots: `DELIVERY/screenshots/{before-original,before,after,after-tablet,after-mobile}`.

## Regenerate assets / re-apply

- Icons + OG from the logo: `powershell -File scripts/make-brand-from-logo.ps1`
- Re-apply the light pass (idempotent): `node scripts/restyle-light.mjs`
- Screenshots: `powershell -File scripts/shoot.ps1 -Label after -Width 1440`
- Run as a local site: `python -m http.server 8099` then open `http://127.0.0.1:8099/`
