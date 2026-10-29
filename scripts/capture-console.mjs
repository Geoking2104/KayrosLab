// Captures de la console (thème clair) pour le README et le site, via Chrome DevTools Protocol.
// À lancer contre une pile locale (backend en LLM_PROVIDER=mock + `npx vite` dans
// frontend/console-app) avec des données de démonstration fictives :
//   CHROME=google-chrome UI=http://127.0.0.1:4174/console/ TOKEN_FILE=/tmp/demo-token LANG_UI=en OUT=./raw node scripts/capture-console.mjs
//   (Node 22+ ; sous Node 20, ajouter --experimental-websocket)
// La console lit son jeton et sa langue dans localStorage ; aucun identifiant réel n'est requis.
// Les PNG bruts sont ensuite convertis en WebP dans assets/ et backend/web/public/assets/.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CHROME = process.env.CHROME || 'google-chrome';
const PORT = Number(process.env.CDP_PORT || 9666);
const UI = process.env.UI || 'http://127.0.0.1:4174/console/';
const LANG_UI = process.env.LANG_UI || 'en';
const OUT = process.env.OUT || './raw-console-shots';
const token = readFileSync(process.env.TOKEN_FILE || '/tmp/demo-token', 'utf8').trim();
const TOKEN_KEY = 'kayroslab.console.token';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/kayros-cdp-${PORT}`, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 50 && !targets; i += 1) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let seq = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

async function open(hash, { width, height, scale }) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  await send('Page.navigate', { url: UI }); await sleep(800);
  await evaluate(`localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(token)}); localStorage.setItem('kayroslab.lang', ${JSON.stringify(LANG_UI)}); 1`);
  await send('Page.navigate', { url: `${UI}?v=${Date.now()}#${hash}` }); await sleep(3000);
}
async function clickText(match) {
  const ok = await evaluate(`(() => { const all = [...document.querySelectorAll('button, a, [role=button], h1, h2, h3, h4, p, span')].filter((x) => x.textContent.includes(${JSON.stringify(match)})); const b = all[all.length - 1]; if (b) b.click(); return !!b; })()`);
  await sleep(2500);
  return ok;
}
async function shoot(name, { width, height, full = false }) {
  const h = full ? await evaluate('document.documentElement.scrollHeight') : height;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, clip: { x: 0, y: 0, width, height: h, scale: 1 } });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
  console.log('wrote', name, `${width}x${h}`);
}

const slot = { width: 1440, height: 900, scale: 2 };
await open('overview', slot); await shoot('console-overview', slot);
await open('dossiers', slot); await shoot('console-dossiers', slot);
if (process.env.DOSSIER) { await clickText(process.env.DOSSIER); await shoot('console-dossier', { ...slot, full: true }); }
await open('collectifs', slot); await shoot('console-collectifs', slot);
await open('agents', slot); await shoot('console-agents', slot);
await open('connexions', slot); await shoot('console-connexions', slot);
await open('instruire', slot); await shoot('console-instruire', slot);

ws.close(); child.kill('SIGKILL'); process.exit(0);
