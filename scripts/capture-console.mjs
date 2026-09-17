// Real console captures via Chrome DevTools Protocol against the local stack.
// Logs in by writing the console token into sessionStorage on the dev origin,
// then screenshots the impersonator swarm pages (dossier + session panel).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9666;
const UI = 'http://127.0.0.1:4299/console/';
const OUT = 'C:/Users/geoff/.openclaw-autoclaw/workspace/KayrosLab/assets';
const token = readFileSync(process.env.TEMP + '/kayros-token.txt', 'utf8').trim();
const TOKEN_KEY = 'kayros\u2026oken';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.env.TEMP}/kayros-cdp`, '--window-size=1440,1250', 'about:blank'], { stdio: 'ignore' });

async function up() { for (let i = 0; i < 40; i += 1) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return true; } catch { /* wait */ } await sleep(200); } return false; }
if (!(await up())) { console.error('chrome unavailable'); process.exit(1); }
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const pageTarget = targets.find((t) => t.type === 'page');
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
function send(method, params = {}) { const id = ++seq; return new Promise((resolve) => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); }); }

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1250, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: UI });
await sleep(2500);
const set = await send('Runtime.evaluate', { expression: `sessionStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(token)}); 'set'`, returnByValue: true });
console.log('token set:', set.result?.result?.value);
console.log('shell?', (await send('Runtime.evaluate', { expression: "!!document.querySelector('.app-shell')", returnByValue: true })).result?.result?.value);

// 1) Decision dossier produced by the impersonator swarm.
await send('Page.navigate', { url: `${UI}?v=activity#activity` });
await sleep(4000);
console.log('shell?', (await send('Runtime.evaluate', { expression: "!!document.querySelector('.app-shell')", returnByValue: true })).result?.result?.value);
const clicked = await send('Runtime.evaluate', { expression: `(function(){var b=document.querySelectorAll('.decision-list button');if(b.length){b[0].click();return 'clicked '+b.length;}return 'none';})()`, returnByValue: true });
console.log('dossier:', clicked.result?.result?.value);
await sleep(3500);
let shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${OUT}/console-impersonator-swarm.png`, Buffer.from(shot.result.data, 'base64'));
console.log('wrote console-impersonator-swarm.png');

// 2) Sessions panel: the persona collective and its executions.
await send('Page.navigate', { url: `${UI}?v=panel#sessions` });
await sleep(4000);
shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${OUT}/console-impersonator-panel.png`, Buffer.from(shot.result.data, 'base64'));
console.log('wrote console-impersonator-panel.png');

// 3) Agents register: impersonator filter with portraits/monograms.
await send('Page.navigate', { url: `${UI}?v=agents#agents` });
await sleep(3500);
await send('Runtime.evaluate', { expression: `(function(){var b=[...document.querySelectorAll('.so-filters .text-button')].find(function(x){return x.textContent.indexOf('Impersonator')>=0;});if(b){b.click();return 'ok';}return 'no';})()`, returnByValue: true });
await sleep(1200);
shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${OUT}/console-impersonator-agents.png`, Buffer.from(shot.result.data, 'base64'));
console.log('wrote console-impersonator-agents.png');

ws.close();
child.kill('SIGKILL');
process.exit(0);
