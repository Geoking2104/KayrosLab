// KayrosLab — one-pass site restyle to the console design language.
// Applies, across every root *.html page:
//  - console webfonts (Space Grotesk / IBM Plex Sans / Fira Code)
//  - tokens.css (single source) + site.css (shared layer) links
//  - console logo favicon/OG metadata
//  - token-driven font families (quoted family names -> var(--font-*))
//  - palette mapping from legacy hexes to the console palette
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Fira+Code:wght@400;500&display=swap';

const PALETTE = {
  '#050d1a': '#050c12', '#0a1628': '#0c151c', '#0b1120': '#0c151c', '#0f172a': '#141e26', '#111827': '#141e26',
  '#f9fafb': '#e6f1f4', '#f8fafc': '#e6f1f4', '#ffffff': '#e6f1f4',
  '#e2e8f0': '#c9d6da', '#d1d5db': '#c9d6da', '#cbd5e1': '#c9d6da',
  '#9ca3af': '#94a4b0', '#94a3b8': '#94a4b0',
  '#6b7280': '#7f8e99', '#64748b': '#7f8e99',
  '#4b5563': '#2b3741', '#334155': '#2b3741', '#475569': '#3c4b56',
  '#2fb9a8': '#00d3e5',
  '#34d399': '#63d18f', '#22c55e': '#63d18f',
  '#f59e0b': '#edbc58', '#fbbf24': '#edbc58', '#f97316': '#edbc58', '#c2410c': '#edbc58', '#d97706': '#edbc58',
  '#ef4444': '#f97770', '#fb7185': '#f97770', '#dc2626': '#f97770',
  '#38bdf8': '#00d3e5', '#0ea5e9': '#00d3e5', '#06b6d4': '#00d3e5', '#0284c8': '#00b4c4', '#0369a1': '#00b4c4',
  '#a78bfa': '#00d3e5', '#8b5cf6': '#00d3e5', '#7c3aed': '#00b4c4', '#6d28d9': '#00b4c4',
  '#c4b098': '#94a4b0',
  '#fff7ed': '#2a2114', '#f0fdf4': '#12241a', '#e0f2fe': '#0d2027', '#bae6fd': '#0d2027', '#ddd6fe': '#0d2027', '#e9d5ff': '#0d2027', '#fef3c7': '#2a2114', '#fee2e2': '#2a1616',
};
const RGBA = [['47,185,168', '0,211,229'], ['47, 185, 168', '0, 211, 229'], ['196,176,152', '148,164,176'], ['196, 176, 152', '148, 164, 176']];

const HEAD_BLOCK = `  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${FONT_HREF}" rel="stylesheet">
  <link rel="stylesheet" href="./tokens.css">
  <link rel="stylesheet" href="./site.css">
  <link rel="icon" href="./assets/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="./assets/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="./assets/apple-touch-icon.png">
  <meta name="theme-color" content="#050c12">
  <meta property="og:image" content="https://www.kayroslab.com/assets/og-image.png">
`;

const files = readdirSync(root).filter((f) => f.endsWith('.html'));
const report = [];
for (const file of files) {
  let html = readFileSync(resolve(root, file), 'utf8');
  const before = html;

  // 1. Fonts link -> console families
  html = html.replace(/<link[^>]*href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*"[^>]*>/gi, (m) => m.replace(/href="[^"]*"/, `href="${FONT_HREF}"`));
  // 2. Font family names -> tokens
  html = html.replace(/'?Outfit'?/g, 'var(--font-display)')
    .replace(/'?Plus Jakarta Sans'?/g, 'var(--font-body)')
    .replace(/'?Tomorrow'?/g, 'var(--font-display)')
    .replace(/'?Geist'?/g, 'var(--font-body)')
    .replace(/'?JetBrains Mono'?/g, 'var(--font-mono)');
  // 3. Palette + rgba mapping
  html = html.replace(/#[0-9a-fA-F]{6}\b/g, (h) => PALETTE[h.toLowerCase()] || h);
  for (const [from, to] of RGBA) html = html.split(from).join(to);
  // 4. Ensure tokens.css + site.css + favicon block before </head>
  const hasTokens = /href="\.\/tokens\.css"/.test(html);
  const hasSite = /href="\.\/site\.css"/.test(html);
  if (!hasSite) {
    html = html.replace(/<\/head>/i, `${hasTokens ? '' : '  <link rel="stylesheet" href="./tokens.css">\n'}${HEAD_BLOCK}</head>`);
  }
  if (!/rel="icon"/.test(html)) {
    html = html.replace(/<\/head>/i, `  <link rel="icon" href="./assets/favicon.svg" type="image/svg+xml">\n  <link rel="apple-touch-icon" href="./assets/apple-touch-icon.png">\n</head>`);
  }

  if (html !== before) { writeFileSync(resolve(root, file), html); report.push(file); }
}
console.log(`restyled: ${report.length} files`);
console.log(report.join('\n'));
