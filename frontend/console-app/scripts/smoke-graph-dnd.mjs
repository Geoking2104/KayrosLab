// Test de fumée navigateur : glisser-déposer d'un nœud du graphe de projet.
// API simulée (page.route), console servie par `npx vite --port 4174`.
// Usage : CONSOLE_URL=http://localhost:4174/console/ node scripts/smoke-graph-dnd.mjs
// (Playwright et un Chrome requis ; CHROME=/usr/bin/google-chrome par défaut.)
import { chromium } from 'playwright';

const BASE = process.env.CONSOLE_URL || 'http://localhost:4174/console/';
const SESSION = { session_id: 'room_1', name: 'Comité achats', created_at: '2026-10-29T10:00:00Z', collective: { active_agents: ['achats'], voting_threshold: 'majority' } };
const AGENT = { agent_id: 'achats', display_name: 'Acheteur senior', role_name: 'Acheteur', department: 'Achats', seniority: 'senior', primary_focus: '', mission: '', instructions: '', constraints: [], tools: [], connectors: [], provider: 'mistral', model: 'm', veto_power: false, enabled: true, metadata: {}, rule_configuration: { system_proposed_rules: [], user_added_rules: [] } };
const project = { id: 'prj_1', company_id: 'co_1', name: 'Renouvellement Helia', goal: '', owner: '', status: 'active', due_date: '', session_ids: ['room_1'], thread_ids: [], stakeholders: [],
  graph: { nodes: [{ id: 'q', type: 'question', label: 'Question', config: {} }, { id: 'c', type: 'collectif', label: 'Finance', config: { session_id: 'room_1' } }, { id: 'd', type: 'decision', label: 'Décision', config: {} }], edges: [{ from: 'q', to: 'c' }, { from: 'c', to: 'd' }] } };
const saved = [];
function respond(path, method, body) {
  if (path === '/v1/auth/me') return { user: { id: 'u1', email: 'admin@atelier.fr', role: 'comex' } };
  if (path === '/v1/console/members/me') return { email: 'admin@atelier.fr', role: 'admin', permissions: ['read', 'run', 'arbitrate', 'manage', 'members'], member: null };
  if (path === '/v1/console/agents') return { agents: [AGENT] };
  if (path === '/v1/console/sessions') return { sessions: [SESSION] };
  if (path === '/v1/console/threads') return { threads: [] };
  if (path === '/v1/console/companies') return { companies: [{ id: 'co_1', name: 'Atelier', sector: '', description: '' }] };
  if (path === '/v1/console/projects' && method === 'GET') return { projects: [project] };
  if (path === '/v1/console/projects/prj_1' && method === 'PATCH') { saved.push(body); Object.assign(project, body); return { item: project }; }
  if (path === '/v1/console/projects/prj_1/context') return { layers: [], text: '' };
  if (path === '/v1/console/projects/prj_1/notifications') return { notifications: [] };
  if (path === '/v1/console/projects/prj_1/pipelines') return { pipelines: [] };
  if (path === '/v1/console/mail/status') return { smtp: true, from: null };
  if (['/v1/console/skills', '/v1/console/contexts', '/v1/console/members'].includes(path)) return { [path.split('/').pop()]: [] };
  return null;
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/v1/**', async (route) => {
  const req = route.request(); const url = new URL(req.url());
  const data = respond(url.pathname, req.method(), req.postData() ? JSON.parse(req.postData()) : undefined);
  await route.fulfill({ status: data ? 200 : 404, contentType: 'application/json', body: JSON.stringify(data || { error: 'inconnu' }) });
});
// Jeton et langue posés avant le chargement : la console démarre en mode connecté.
await page.addInitScript(() => { localStorage.setItem('kayroslab.lang', 'fr'); localStorage.setItem('kayroslab.console.token', 'tok'); });
await page.goto(`${BASE}#projets`);
await page.getByRole('button', { name: 'Modifier le graphe' }).click();
const node = page.locator('[data-node="c"]').first();
await node.waitFor();
const before = { x: Number(await node.getAttribute('data-x')), y: Number(await node.getAttribute('data-y')) };
const box = await node.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 80, { steps: 8 });
await page.mouse.up();
const after = { x: Number(await node.getAttribute('data-x')), y: Number(await node.getAttribute('data-y')) };
await page.getByRole('button', { name: 'Enregistrer le graphe' }).click();
await page.waitForTimeout(500);
const stored = saved.at(-1)?.graph?.nodes?.find((n) => n.id === 'c');
await page.screenshot({ path: process.env.SHOT || '/tmp/smoke-graph-dnd.png' });
await browser.close();
const ok = after.x > before.x && after.y > before.y && stored?.x === after.x && stored?.y === after.y && !errors.length;
console.log(JSON.stringify({ before, after, stored: stored ? { x: stored.x, y: stored.y } : null, errors, ok }));
process.exit(ok ? 0 : 1);
