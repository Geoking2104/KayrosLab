import { readdirSync, writeFileSync } from 'node:fs';
const pages = readdirSync('DELIVERY/screenshots/after').filter((f) => f.endsWith('-1440.png')).map((f) => f.replace('-1440.png', ''));
const rows = pages.map((p) => `      <article class="card">
        <h3>${p}.html</h3>
        <div class="pair">
          <figure><img loading="lazy" src="./screenshots/before/${p}-1440.png" alt="${p} before"><figcaption>Before · 1440px</figcaption></figure>
          <figure><img loading="lazy" src="./screenshots/after/${p}-1440.png" alt="${p} after"><figcaption>After · 1440px</figcaption></figure>
        </div>
        <div class="pair">
          <figure><img loading="lazy" src="./screenshots/after-tablet/${p}-834.png" alt="${p} tablet"><figcaption>After · 834px</figcaption></figure>
          <figure class="mobile"><img loading="lazy" src="./screenshots/after-mobile/${p}-375.png" alt="${p} mobile"><figcaption>After · 375px</figcaption></figure>
        </div>
        <p><a href="../${p}.html">Open page</a> · <a href="../${p}.html" target="_blank" rel="noreferrer">live build</a></p>
      </article>`).join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KayrosLab — Site restyle · before / after</title>
<link rel="stylesheet" href="../tokens.css">
<link rel="stylesheet" href="../site.css">
<style>
  .grid { display: grid; gap: var(--space-lg); }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); }
  figure { margin: 0; }
  figure img { width: 100%; height: auto; border: var(--rule-hair) solid var(--color-rule); border-radius: var(--radius-sm); display: block; }
  figcaption { color: var(--color-muted); font-size: var(--text-xs); margin-top: var(--space-2xs); }
  .mobile img { max-width: 320px; }
  @media (max-width: 760px) { .pair { grid-template-columns: 1fr; } }
  .swatches { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: var(--space-sm); }
  .sw { border: var(--rule-hair) solid var(--color-rule); border-radius: var(--radius-sm); overflow: hidden; font-size: var(--text-xs); }
  .sw i { display: block; height: 3.5rem; }
  .sw span { display: block; padding: var(--space-2xs); color: var(--color-muted); }
</style>
</head>
<body>
  <header class="frame" style="padding-block: var(--space-xl);">
    <a class="brand" href="./index.html"><img src="../assets/logo-mark.svg" alt="" width="56" height="56"><span class="brand__name">KayrosLab</span></a>
    <h1 style="margin-top: var(--space-lg);">Site restyle — console design language</h1>
    <p style="color: var(--color-muted); max-width: 60ch;">Every public page now consumes the console reference tokens (${pages.length} pages). Before is the previous build; after is the restyle. Evidence captured with headless Chrome at 1440, 834 and 375px (57 renders), 0 horizontal overflow.</p>
    <p><a class="button button--primary" href="../index.html">View homepage</a> <a class="button" href="./STYLE-GUIDE.md">Style guide</a> <a class="button button--ghost" href="./DESIGN-RESTYLE-AUDIT.md">Audit</a></p>
  </header>
  <main class="frame grid">
    <section class="card">
      <h2>Palette (from the console)</h2>
      <div class="swatches">
        ${['paper', 'surface', 'surface-raised', 'rule', 'rule-strong', 'muted', 'ink', 'accent', 'accent-ink', 'focus', 'danger', 'warning', 'success'].map((t) => `<div class="sw"><i style="background: var(--color-${t})"></i><span>--color-${t}</span></div>`).join('\n        ')}
      </div>
      <h2 style="margin-top: var(--space-lg);">Buttons</h2>
      <p><a class="button button--primary">Primary</a> <a class="button">Secondary</a> <a class="button button--ghost">Ghost</a> <button class="button" disabled>Disabled</button> <button class="button" data-state="loading">Loading…</button></p>
    </section>
${rows}
  </main>
  <footer class="frame" style="padding-block: var(--space-xl); color: var(--color-muted);">Generated for the KayrosLab restyle handover.</footer>
</body>
</html>
`;
writeFileSync('DELIVERY/index.html', html);
console.log(`gallery written for ${pages.length} pages`);
