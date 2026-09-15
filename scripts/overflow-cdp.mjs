// Real responsive/overflow measurement via Chrome DevTools Protocol.
// For each page and viewport width: set device metrics, then read scrollWidth vs
// clientWidth and list any element wider than the viewport. Writes DELIVERY/overflow-report.json
import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const widths = [375, 834, 1440];
const pages = readdirSync('.').filter((f) => f.endsWith('.html'));
const ROOT = process.cwd().replace(/\\/g, '/');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpport(port, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try { const res = await fetch(`http://127.0.0.1:${port}/json/version`); if (res.ok) return true; } catch { /* not up yet */ }
    await sleep(150);
  }
  return false;
}

async function evaluate(ws, expression, id) {
  return new Promise((resolve) => {
    const onMsg = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', onMsg); resolve(m); } };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
}

const report = {};
for (const page of pages) {
  report[page] = {};
  for (const w of widths) {
    const port = 9333;
    const child = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${ROOT}/.cdp_${w}`, `--window-size=${w},900`, `file:///${ROOT}/${page}`], { stdio: 'ignore' });
    try {
      if (!(await cdpport(port))) { report[page][w] = 'chrome-unavailable'; continue; }
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page1 = targets.find((t) => t.type === 'page' && (t.url || '').includes(page)) || targets.find((t) => t.type === 'page');
      const ws = new WebSocket(page1.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
      await new Promise((resolve) => {
        const on = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) { ws.removeEventListener('message', on); resolve(m); } };
        ws.addEventListener('message', on);
        ws.send(JSON.stringify({ id: 1, method: 'Emulation.setDeviceMetricsOverride', params: { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 700 } }));
      });
      await sleep(600);
      const expr = `(function(){var d=document.documentElement;var over=[];var all=document.querySelectorAll('body *');for(var i=0;i<all.length;i++){var r=all[i].getBoundingClientRect();if(r.width>d.clientWidth+1&&r.height>0){var c=(typeof all[i].className==='string')?all[i].className.split(' ')[0]:'';over.push(all[i].tagName.toLowerCase()+(c?'.'+c:'')+'@'+Math.round(r.width));if(over.length>5)break;}}return JSON.stringify({sw:d.scrollWidth,cw:d.clientWidth,over:over});})()`;
      const res = await evaluate(ws, expr, 3);
      report[page][w] = res?.result?.result?.value ? JSON.parse(res.result.result.value) : 'error';
      ws.close();
    } catch (e) {
      report[page][w] = `error:${e.message}`;
    } finally {
      child.kill('SIGKILL');
      await sleep(200);
    }
  }
}
writeFileSync('DELIVERY/overflow-report.json', JSON.stringify(report, null, 2));
let bad = 0;
for (const [p, byW] of Object.entries(report)) {
  const issues = Object.entries(byW).filter(([, v]) => v && typeof v === 'object' && v.sw > v.cw + 1);
  if (issues.length) { bad += 1; console.log(`OVERFLOW ${p}: ${issues.map(([w, v]) => `${w}-> sw${v.sw}/cw${v.cw} [${(v.over || []).join(' ')}]`).join(' ; ')}`); }
}
console.log(`pages with horizontal overflow: ${bad}/${pages.length}`);
