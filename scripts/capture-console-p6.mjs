// Captures README de la console P1–P6 (Société, Projets + graphe, Bibliothèque, Membres) sur une API simulée.
// Données fictives. Usage : console servie par `npx vite --port 4174` dans frontend/console-app, puis
//   LANG_UI=en OUT=./raw node scripts/capture-console-p6.mjs   (Playwright + Chrome requis)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.CONSOLE_URL || 'http://localhost:4174/console/';
const OUT = process.env.OUT || './raw-console-shots';
const LANG = process.env.LANG_UI || 'en';
mkdirSync(OUT, { recursive: true });
const rules = { system_proposed_rules: [], user_added_rules: [] };
const agent = (agent_id, display_name, role_name, department, veto = false) => ({ agent_id, display_name, role_name, department, seniority: 'senior', primary_focus: '', mission: `${role_name} — instruit la décision depuis son mandat.`, instructions: '', constraints: [], tools: [], connectors: [], provider: 'mistral', model: 'mistral-large', veto_power: veto, enabled: true, metadata: {}, rule_configuration: rules });
const AGENTS = [agent('cfo', 'Claire Moreau', 'CFO', 'Finance', true), agent('cto', 'Hugo Lambert', 'CTO', 'Engineering'), agent('legal', 'Inès Garnier', 'Legal counsel', 'Legal', true), agent('sales', 'Marc Petit', 'Head of sales', 'Sales'), agent('buyer', 'Léa Roux', 'Senior buyer', 'Procurement')];
const SESSIONS = [
  { session_id: 'room_fin', name: 'Finance & legal committee', created_at: '2026-10-20T10:00:00Z', collective: { active_agents: ['cfo', 'legal'], voting_threshold: 'majority' } },
  { session_id: 'room_tech', name: 'Delivery committee', created_at: '2026-10-21T10:00:00Z', collective: { active_agents: ['cto', 'buyer'], voting_threshold: 'unanimity' } },
];
const now = Date.now(); const ago = (h) => new Date(now - h * 3600e3).toISOString();
const run = (verdict, ids) => ({ run: { configuration: { active_agents: ids }, consensus: { verdict }, analyses: ids.map((a, i) => ({ agent_id: a, verdict: i ? 'GO' : verdict, strengths_opportunities: ['Stable supplier'], critical_risks: ['Price drift above policy'], required_mitigations: ['Cap at +5 % with an exit clause'] })) } });
const THREADS0 = [
  { thread_id: 'thr_1', room_id: 'room_fin', session_id: 'room_fin', title: 'Renew the Helia contract at +8 %?', question: 'Renew the Helia contract at +8 %?', status: 'awaiting_arbitration', created_at: ago(5), updated_at: ago(1), verdict: 'GO_CONDITIONAL', tenant_id: 't' },
  { thread_id: 'thr_2', room_id: 'room_tech', session_id: 'room_tech', title: 'Migrate billing to the new platform in Q1?', question: 'Migrate billing to the new platform in Q1?', status: 'running', created_at: ago(2), updated_at: ago(0.2), tenant_id: 't' },
  { thread_id: 'thr_3', room_id: 'room_fin', session_id: 'room_fin', title: 'Open a Lyon office in 2027?', question: 'Open a Lyon office in 2027?', status: 'resolved', verdict: 'NO_GO', created_at: ago(50), updated_at: ago(30), tenant_id: 't' },
];
const THREADS = THREADS0.map((t) => ({ ...t, messages: t.verdict ? [{ role: 'agent', ...run(t.verdict === 'GO_CONDITIONAL' ? 'CONDITIONAL_GO' : t.verdict, t.room_id === 'room_fin' ? ['cfo', 'legal'] : ['cto', 'buyer']) }] : [], progress: t.status === 'running' ? { done: 1, total: 2 } : undefined }));
const graph = { nodes: [
  { id: 'q', type: 'question', label: 'Question', config: {} },
  { id: 'c1', type: 'collectif', label: 'Finance & legal', config: { session_id: 'room_fin', threshold: 'majority', veto: true } },
  { id: 'c2', type: 'collectif', label: 'Delivery', config: { session_id: 'room_tech', pause: true } },
  { id: 'g', type: 'porte', label: 'Veto gate', config: { veto: true, min_go: 60 } },
  { id: 'd', type: 'decision', label: 'Decision', config: {} }],
  edges: [{ from: 'q', to: 'c1' }, { from: 'q', to: 'c2' }, { from: 'c1', to: 'g' }, { from: 'g', to: 'd' }, { from: 'c2', to: 'd' }] };
const PROJECTS = [
  { id: 'prj_1', company_id: 'co_1', name: 'Helia renewal', goal: 'Secure supply for 2027 within budget', owner: 'Claire Moreau', status: 'active', due_date: '2026-11-30', session_ids: ['room_fin', 'room_tech'], thread_ids: ['thr_1', 'thr_2'], stakeholders: [{ name: 'Paul Moreau', role: 'decideur', title: 'CEO', email: 'paul@atelier.fr' }, { name: 'Board', role: 'informe', title: 'Board of directors', email: 'board@atelier.fr' }], graph },
  { id: 'prj_2', company_id: 'co_1', name: 'Billing migration', goal: 'One billing platform by Q2', owner: 'Hugo Lambert', status: 'active', due_date: '2027-03-31', session_ids: ['room_tech'], thread_ids: ['thr_2'], stakeholders: [], graph: { nodes: [], edges: [] } },
];
const SKILLS = [{ id: 'sk_1', name: 'TCO analysis', description: 'Total cost of ownership over 3 years', instructions: 'Compare 3-year TCO against the current contract.', tools: ['spreadsheet'], agent_ids: ['cfo', 'buyer'], session_ids: [], version: 3, versions: [] }, { id: 'sk_2', name: 'Contract red flags', description: 'Clauses to escalate to legal', instructions: 'List exit, liability and indexation clauses.', tools: [], agent_ids: ['legal'], session_ids: ['room_fin'], version: 2, versions: [] }];
const CONTEXTS = [{ id: 'ctx_1', kind: 'policy', name: 'Purchasing policy 2026', content: 'Any renewal above +5 % needs CFO approval.', url: '', agent_ids: [], session_ids: [], company_id: 'co_1' }, { id: 'ctx_2', kind: 'note', name: 'Helia history', content: 'Supplier since 2019, two late deliveries in 2026.', url: '', agent_ids: [], session_ids: [], project_id: 'prj_1' }];
const MEMBERS = [{ id: 'm1', email: 'claire@atelier.fr', name: 'Claire Moreau', role: 'comex', status: 'active' }, { id: 'm2', email: 'hugo@atelier.fr', name: 'Hugo Lambert', role: 'admin', status: 'active' }, { id: 'm3', email: 'lea@atelier.fr', name: 'Léa Roux', role: 'contributeur', status: 'active' }, { id: 'm4', email: 'audit@atelier.fr', name: 'External auditor', role: 'lecteur', status: 'invited', invite_status: 'sent' }];
const PIPE = { id: 'pl_1', project_id: 'prj_1', question: 'Renew the Helia contract at +8 %?', status: 'awaiting_approval', created_at: ago(3), steps: [{ node_id: 'c1', status: 'completed', verdict: 'CONDITIONAL_GO', deps: [] }, { node_id: 'c2', status: 'awaiting_approval', verdict: 'GO', deps: [] }, { node_id: 'd', status: 'pending', deps: ['c1', 'c2'] }] };
function respond(path, method) {
  if (path === '/v1/auth/me') return { user: { id: 'u1', email: 'claire@atelier.fr', role: 'comex' } };
  if (path === '/v1/console/members/me') return { email: 'claire@atelier.fr', role: 'admin', permissions: ['read', 'run', 'arbitrate', 'manage', 'members'], member: MEMBERS[0] };
  if (path === '/v1/console/agents') return { agents: AGENTS };
  if (path === '/v1/console/sessions') return { sessions: SESSIONS };
  if (path === '/v1/console/threads') return { threads: THREADS };
  if (path === '/v1/console/companies') return { companies: [{ id: 'co_1', name: 'Atelier Moreau', sector: 'Industrial supplies', description: 'Mid-size distributor, 240 people.' }] };
  if (path === '/v1/console/projects' && method === 'GET') return { projects: PROJECTS };
  const m = path.match(/^\/v1\/console\/projects\/(prj_\d)(\/.*)?$/);
  if (m && !m[2]) return { item: PROJECTS.find((p) => p.id === m[1]) };
  if (m && m[2] === '/context') return { layers: [{ level: 'societe', items: [CONTEXTS[0]] }, { level: 'projet', items: [CONTEXTS[1]] }], text: '' };
  if (m && m[2] === '/notifications') return { notifications: [] };
  if (m && m[2] === '/pipelines') return { pipelines: m[1] === 'prj_1' ? [PIPE] : [] };
  if (path === '/v1/console/dashboard') {
    const counts = (p) => Object.fromEntries(['awaiting_arbitration', 'running', 'resolved'].map((k) => [k, THREADS0.filter((t) => p.thread_ids.includes(t.thread_id) && t.status === k).length]));
    return { company: { id: 'co_1', name: 'Atelier Moreau', sector: 'Industrial supplies', description: 'Mid-size distributor, 240 people.' }, companies: [{ id: 'co_1', name: 'Atelier Moreau' }],
      widgets: { projects_active: 2, decisions: { awaiting_arbitration: 1, running: 1, needs_clarification: 0 }, sessions: 2, skills: 2, contexts: 2 },
      projects: PROJECTS.map((p) => ({ ...p, counts: counts(p), threads: THREADS0.filter((t) => p.thread_ids.includes(t.thread_id)).map((t) => ({ ...t, verdict: t.verdict === 'GO_CONDITIONAL' ? 'CONDITIONAL_GO' : t.verdict })) })) };
  }
  if (path === '/v1/console/mail/status') return { smtp: true, from: 'kayros@atelier.fr' };
  if (path === '/v1/console/skills') return { skills: SKILLS };
  if (path === '/v1/console/contexts') return { contexts: CONTEXTS };
  if (path === '/v1/console/members') return { members: MEMBERS };
  return null;
}
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/v1/**', async (route) => { const r = route.request(); const d = respond(new URL(r.url()).pathname, r.method()); await route.fulfill({ status: d ? 200 : 404, contentType: 'application/json', body: JSON.stringify(d || { error: 'unknown' }) }); });
await page.addInitScript((lang) => { localStorage.setItem('kayroslab.lang', lang); localStorage.setItem('kayroslab.console.token', 'demo'); }, LANG);
for (const [hash, name] of [['societe', 'console-company'], ['projets', 'console-project-graph'], ['bibliotheque', 'console-library'], ['membres', 'console-members']]) {
  await page.goto(`${BASE}#${hash}`); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('wrote', name);
}
await browser.close(); console.log(JSON.stringify({ errors }));
