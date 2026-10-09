// Captures de la console (thème clair) pour le site, via Chrome DevTools Protocol.
// À lancer contre une pile locale avec des données de démonstration fictives :
//   CHROME=google-chrome UI=http://127.0.0.1:4302/console/ TOKEN_FILE=/tmp/demo-token OUT=./raw node scripts/capture-console.mjs
//   (Node 22+ ; sous Node 20, ajouter --experimental-websocket)
// La console lit son jeton dans sessionStorage ; aucun identifiant réel n'est requis.
// Les PNG bruts sont ensuite convertis en WebP dans assets/ et backend/web/public/assets/.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CHROME = process.env.CHROME || 'google-chrome';
const PORT = Number(process.env.CDP_PORT || 9666);
const UI = process.env.UI || 'http://127.0.0.1:4302/console/';
const OUT = process.env.OUT || './raw-console-shots';
const token = readFileSync(process.env.TOKEN_FILE || '/tmp/demo-token', 'utf8').trim();
const TOKEN_KEY = 'kayros\u2026oken';
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
  await evaluate(`sessionStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(token)}); 1`);
  await send('Page.navigate', { url: `${UI}?v=${Date.now()}#${hash}` }); await sleep(3000);
}
async function openThread(match) {
  await evaluate(`(() => { const b = [...document.querySelectorAll('.decision-list button')].find((x) => x.textContent.includes(${JSON.stringify(match)})); if (b) b.click(); return !!b; })()`);
  await sleep(2500);
}
async function shoot(name, { width, height, full = false }) {
  const h = full ? await evaluate('document.documentElement.scrollHeight') : height;
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, clip: { x: 0, y: 0, width, height: h, scale: 1 } });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot.result.data, 'base64'));
  console.log('wrote', name, `${width}x${h}`);
}

const slot = { width: 1300, height: 812, scale: 2 };
await open('overview', slot); await shoot('console-overview', slot);
await open('sessions', slot); await shoot('console-harness', slot);
await open('agents', slot); await shoot('console-agents', slot);
const tall = { width: 1300, height: 900, scale: 1.5 };
await open('activity', tall); await openThread('maintenance prédictive'); await shoot('console-dossier', { ...tall, full: true });
const panel = { width: 1440, height: 1250, scale: 2 };
await open('activity', panel); await openThread('hausse de prix'); await shoot('console-impersonator-swarm', panel);

ws.close(); child.kill('SIGKILL'); process.exit(0);
