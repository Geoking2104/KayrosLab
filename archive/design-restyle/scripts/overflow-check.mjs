// Real overflow sweep: inject a probe into a temp copy of each page, render it in
// headless Chrome at several widths, and read back scrollWidth vs clientWidth + any
// element wider than the viewport. Writes DELIVERY/overflow-report.json
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const widths = [375, 834, 1440];
const pages = readdirSync('.').filter((f) => f.endsWith('.html'));
const probe = `<script>(function(){function run(){try{var d=document.documentElement;var over=[];var all=document.querySelectorAll('body *');for(var i=0;i<all.length;i++){var r=all[i].getBoundingClientRect();if(r.width>d.clientWidth+1&&r.height>0){var s=(all[i].className&&typeof all[i].className==='string')?all[i].className:all[i].tagName;over.push(all[i].tagName.toLowerCase()+'.'+String(s).split(' ')[0]+'@'+Math.round(r.width));if(over.length>6)break;}}document.title='OV='+d.scrollWidth+'|'+d.clientWidth+'|'+(over.join(','));}catch(e){document.title='OV=ERR';}}run();window.addEventListener('load',run);})();</script>`;

const report = {};
for (const page of pages) {
  const tmp = `.ov_${page}`;
  let html = readFileSync(page, 'utf8');
  html = html.replace(/<\/body>/i, `${probe}</body>`);
  writeFileSync(tmp, html);
  report[page] = {};
  for (const w of widths) {
    const profile = `.ov_profile_${w}`;
    let out = '';
    try {
      out = execFileSync(CHROME, [
        '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`,
        `--window-size=${w},900`, '--virtual-time-budget=2500', '--dump-dom',
        `file:///${process.cwd().replace(/\\/g, '/')}/${tmp}`,
      ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
    } catch (e) { out = String(e.stdout || ''); }
    const m = out.match(/<title>OV=([^<]*)<\/title>/);
    report[page][w] = m ? m[1] : 'n/a';
  }
  unlinkSync(tmp);
}
writeFileSync('DELIVERY/overflow-report.json', JSON.stringify(report, null, 2));
let bad = 0;
for (const [p, byW] of Object.entries(report)) {
  const issues = Object.entries(byW).filter(([, v]) => { const m = String(v).match(/^(\d+)\|(\d+)\|/); return m && Number(m[1]) > Number(m[2]) + 1; });
  if (issues.length) { bad++; console.log(`OVERFLOW ${p}: ${issues.map(([w, v]) => `${w}px -> ${v}`).join(' ; ')}`); }
}
console.log(`pages with overflow: ${bad}/${pages.length}`);
