// KayrosLab — second pass: move the whole site from the dark console theme to the
// SLDS light foundation. Maps the dark palette hexes to SLDS values, switches the
// webfont to Inter (open substitute for Salesforce Sans) and updates theme-color.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap';

const MAP = {
  '#050c12': '#f3f2f2', '#0c151c': '#ffffff', '#141e26': '#fafaf9',
  '#2b3741': '#c9c9c9', '#3c4b56': '#939393', '#475b6a': '#747474',
  '#94a4b0': '#706e6b', '#7f8e99': '#5c5c5c', '#c9d6da': '#3e3e3c',
  '#e6f1f4': '#181818', '#00d3e5': '#0176d3', '#00b4c4': '#014486', '#001820': '#ffffff',
  '#63d18f': '#2e844a', '#edbc58': '#fe9339', '#f97770': '#ea001e',
  '#2a2114': '#fef1e9', '#12241a': '#ebf7ee', '#0d2027': '#eaf5fe', '#2a1616': '#fdeeee',
  '#15191d': '#0176d3', '#f2f0e9': '#ffffff',
};
const RGBA = [['0,211,229', '1,118,211'], ['0, 211, 229', '1, 118, 211']];

const files = readdirSync('.').filter((f) => f.endsWith('.html'));
const changed = [];
for (const file of files) {
  let html = readFileSync(file, 'utf8');
  const before = html;
  html = html.replace(/<link[^>]*href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*"[^>]*>/gi, (m) => m.replace(/href="[^"]*"/, `href="${FONT_HREF}"`));
  html = html.replace(/#[0-9a-fA-F]{6}\b/g, (h) => MAP[h.toLowerCase()] || h);
  for (const [from, to] of RGBA) html = html.split(from).join(to);
  html = html.replace(/(<meta name="theme-color" content=")[^"]*(")/gi, `$1#f3f2f2$2`);
  if (html !== before) { writeFileSync(file, html); changed.push(file); }
}
console.log(`light pass: ${changed.length} files`);
