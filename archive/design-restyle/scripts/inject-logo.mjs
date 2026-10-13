import { readFileSync, writeFileSync } from 'node:fs';
const files = ['index.html', 'index.fr.html', 'validation-proposition.html', 'kayroslab-complete-with-ai-agents.html'];
const img = '<img class="brand__mark" src="./assets/logo-mark.svg" alt="" width="34" height="34">';
let n = 0;
for (const f of files) {
  let h = readFileSync(f, 'utf8');
  const before = h;
  h = h.replace(/<a([^>]*class="[^"]*\b(?:wordmark|brand)\b[^"]*"[^>]*)>(\s*)KayrosLab\s*<\/a>/g,
    (m, attrs, ws) => (m.includes('brand__mark') ? m : `<a${attrs}>${ws}${img}KayrosLab</a>`));
  if (h !== before) { writeFileSync(f, h); n++; }
}
console.log(`logo injected in ${n} pages`);
