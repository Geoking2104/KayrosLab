import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobotsTxt, robotsAllows, RobotsGuard, KAYROS_BOT_USER_AGENT, ROBOTS_LIMITS } from './robots-txt.mjs';
import { visitPublicSource, visitPublicSources, normalizePublicEvidence } from './public-sources.mjs';
import { CrystalPublicProfileFetcher } from './profile-enrichment.mjs';
import { checkPersonaRobots, visitPersonaUrls } from './persona-sources.mjs';
import { SourcePolicyError, getSourcePolicy } from './source-policy.mjs';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const allows = (txt, path) => robotsAllows(parseRobotsTxt(txt), path).allowed;

/** Réseau simulé : robots.txt par origine + pages ; journal des requêtes. */
function net(robotsByOrigin = {}, { page = '<title>Page</title><p>Texte public.</p>' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, ua: init.headers?.['user-agent'] });
    const u = new URL(url);
    if (u.pathname === '/robots.txt') {
      const r = robotsByOrigin[u.origin];
      if (r === undefined) return new Response('', { status: 404 });
      if (typeof r === 'function') return r(url, init);
      if (typeof r === 'number') return new Response('err', { status: r });
      return new Response(r, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
  };
  return { fetchImpl, calls };
}
const guard = (extra = {}) => new RobotsGuard({ lookup: publicLookup, ...extra });

test('parse RFC 9309 : Allow / Disallow, plus longue règle, égalité → Allow', () => {
  const txt = 'User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /tmp/\nAllow: /tmp/\n';
  assert.equal(allows(txt, '/'), true);
  assert.equal(allows(txt, '/private/x'), false);
  assert.equal(allows(txt, '/private/public/page'), true);
  assert.equal(allows(txt, '/tmp/a'), true, 'égalité de longueur → Allow');
  assert.equal(allows('User-agent: *\nDisallow:\n', '/x'), true, 'Disallow vide = rien d\'interdit');
  assert.equal(allows('User-agent: *\nDisallow: /\n', '/robots.txt'), true, '/robots.txt toujours permis');
  assert.equal(allows('Disallow: /\n', '/x'), true, 'règle hors groupe ignorée');
  assert.equal(allows('# rien\n', '/x'), true);
  assert.equal(allows('User-agent: *\nDisallow: /a?b=1\n', '/a?b=1'), false, 'requête comprise dans le chemin');
  assert.equal(allows('User-agent: *\nDisallow: /caf%c3%a9\n', '/caf%C3%A9/x'), false, 'encodage pourcent normalisé');
});

test('jokers * et ancre $', () => {
  const txt = 'User-agent: *\nDisallow: /*.pdf$\nDisallow: /team/*/private\nAllow: /team/$\n';
  assert.equal(allows(txt, '/docs/cv.pdf'), false);
  assert.equal(allows(txt, '/docs/cv.pdf?x=1'), true, '$ ancre la fin');
  assert.equal(allows(txt, '/docs/cv.pdfx'), true);
  assert.equal(allows(txt, '/team/alice/private/notes'), false);
  assert.equal(allows(txt, '/team/alice/public'), true);
  assert.equal(allows('User-agent: *\nDisallow: /\nAllow: /team/$\n', '/team/'), true);
  assert.equal(allows('User-agent: *\nDisallow: /\nAllow: /team/$\n', '/team/x'), false);
  assert.equal(allows('User-agent: *\nDisallow: /a.b(c)\n', '/a.b(c)'), false, 'caractères regex échappés');
  assert.equal(allows('User-agent: *\nDisallow: /a.b(c)\n', '/aXb(c)'), true);
});

test('groupe propre à KayrosLabBot prioritaire sur *, groupes fusionnés, casse ignorée', () => {
  const txt = 'User-agent: *\nDisallow: /\n\nUser-agent: kayroslabbot\nUser-agent: OtherBot\nAllow: /\nDisallow: /admin\n\nUser-agent: KayrosLabBot/1.0\nDisallow: /secret\nCrawl-delay: 2\n';
  const parsed = parseRobotsTxt(txt);
  const d = robotsAllows(parsed, '/equipe');
  assert.equal(d.allowed, true); assert.equal(d.group, 'KayrosLabBot'); assert.equal(d.crawlDelay, 2);
  assert.equal(robotsAllows(parsed, '/admin/x').allowed, false);
  assert.equal(robotsAllows(parsed, '/secret').allowed, false, 'deuxième groupe du même agent fusionné');
  assert.equal(robotsAllows(parsed, '/equipe', 'SomeBot').allowed, false, 'autres robots : groupe *');
  assert.equal(robotsAllows(parseRobotsTxt('User-agent: Googlebot\nDisallow: /\n'), '/x').allowed, true, 'aucun groupe applicable → permis');
});

test('garde : autorisé, interdit (trace + code), User-Agent identifiable avec URL de contact', async () => {
  const { fetchImpl, calls } = net({ 'https://site.example': 'User-agent: *\nDisallow: /prive\n' });
  const g = guard({ fetchImpl });
  const ok = await g.check('https://site.example/equipe');
  assert.equal(ok.allowed, true); assert.equal(ok.status, 200);
  const ko = await g.check('https://site.example/prive/x');
  assert.equal(ko.allowed, false); assert.equal(ko.code, 'robots_disallowed'); assert.match(ko.reason, /Disallow: \/prive/);
  assert.equal(calls.length, 1, 'un seul robots.txt par origine (cache)');
  assert.equal(calls[0].url, 'https://site.example/robots.txt');
  assert.equal(calls[0].ua, KAYROS_BOT_USER_AGENT);
  assert.match(KAYROS_BOT_USER_AGENT, /^KayrosLabBot\/1\.0 \(\+https:\/\/www\.kayroslab\.com\/\)$/);
});

test('robots.txt 404 / 401 → permis ; 500 / 503 / 429 → refus (fail closed)', async () => {
  for (const [status, expected] of [[404, true], [401, true], [403, true], [410, true], [500, false], [503, false], [429, false]]) {
    const { fetchImpl } = net({ 'https://s.example': status });
    const d = await guard({ fetchImpl }).check('https://s.example/a');
    assert.equal(d.allowed, expected, `HTTP ${status}`);
    if (!expected) { assert.equal(d.code, 'robots_disallowed'); assert.match(d.reason, /injoignable/); }
  }
});

test('robots.txt : délai dépassé, erreur réseau, DNS privé, trop de redirections → refus', async () => {
  const slow = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const t = await guard({ fetchImpl: slow, limits: { timeoutMs: 20 } }).check('https://s.example/a');
  assert.equal(t.allowed, false); assert.match(t.reason, /délai dépassé/);
  const err = await guard({ fetchImpl: async () => { throw new Error('ECONNRESET'); } }).check('https://s.example/a');
  assert.equal(err.allowed, false); assert.match(err.reason, /ECONNRESET/);
  let called = 0;
  const priv = await new RobotsGuard({ lookup: async () => [{ address: '10.0.0.2' }], fetchImpl: async () => { called += 1; return new Response(''); } }).check('https://s.example/a');
  assert.equal(priv.allowed, false); assert.equal(called, 0, 'aucune requête vers une IP privée');
  let n = 0;
  const loop = await guard({ fetchImpl: async () => { n += 1; return new Response(null, { status: 301, headers: { location: `https://s.example/r${n}` } }); } }).check('https://s.example/a');
  assert.equal(loop.allowed, false); assert.equal(n, ROBOTS_LIMITS.maxRedirects + 1);
  // Redirection suivie vers un robots.txt lisible.
  const redir = await guard({ fetchImpl: async (url) => (url.endsWith('/robots.txt') && url.startsWith('https://s.example') ? new Response(null, { status: 301, headers: { location: 'https://cdn.example/robots.txt' } }) : new Response('User-agent: *\nDisallow: /x\n', { status: 200 })) }).check('https://s.example/x');
  assert.equal(redir.allowed, false); assert.equal(redir.code, 'robots_disallowed');
});

test('robots.txt : taille plafonnée (500 Kio), règles lues jusqu\'au plafond', async () => {
  const body = `User-agent: *\nDisallow: /tot\n${'#'.repeat(600 * 1024)}\nDisallow: /tard\n`;
  const { fetchImpl } = net({ 'https://s.example': body });
  const g = guard({ fetchImpl });
  assert.equal((await g.check('https://s.example/tot')).allowed, false);
  assert.equal((await g.check('https://s.example/tard')).allowed, true, 'au-delà du plafond : ignoré');
});

test('cache par origine : TTL 24 h, échecs re-tentés après 10 min', async () => {
  let clock = 0;
  const { fetchImpl, calls } = net({ 'https://a.example': 'User-agent: *\nAllow: /\n', 'https://b.example': 503 });
  const g = guard({ fetchImpl, now: () => clock });
  await g.check('https://a.example/1'); await g.check('https://a.example/2');
  assert.equal((await g.check('https://a.example/3')).cached, true);
  assert.equal(calls.filter((c) => c.url.startsWith('https://a.example')).length, 1);
  clock = ROBOTS_LIMITS.ttlMs + 1;
  await g.check('https://a.example/4');
  assert.equal(calls.filter((c) => c.url.startsWith('https://a.example')).length, 2, 'expiré après 24 h');
  clock = 0; g.clear();
  await g.check('https://b.example/1'); await g.check('https://b.example/2');
  assert.equal(calls.filter((c) => c.url.startsWith('https://b.example')).length, 1);
  clock = ROBOTS_LIMITS.errorTtlMs + 1;
  await g.check('https://b.example/3');
  assert.equal(calls.filter((c) => c.url.startsWith('https://b.example')).length, 2, 'échec re-tenté après 10 min');
});

test('Crawl-delay : délai minimal entre deux requêtes vers la même origine ; au-delà du plafond → refus', async () => {
  let clock = 1_000_000; const sleeps = [];
  const { fetchImpl, calls } = net({ 'https://d.example': 'User-agent: KayrosLabBot\nCrawl-delay: 3\nAllow: /\n', 'https://slow.example': 'User-agent: *\nCrawl-delay: 60\n' });
  const g = guard({ fetchImpl, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
  const out = await visitPublicSources(['https://d.example/a', 'https://d.example/b', 'https://other.example/c'], { fetchImpl, lookup: publicLookup, robots: g });
  assert.deepEqual(out.map((r) => r.error), [null, null, null]);
  assert.deepEqual(sleeps, [3000], 'une attente de 3 s avant la 2e page du même hôte');
  assert.equal(out[1].robots.crawl_delay_s, 3);
  const s1 = await visitPublicSource('https://slow.example/a', { fetchImpl, lookup: publicLookup, robots: g });
  assert.equal(s1.error, null);
  const s2 = await visitPublicSource('https://slow.example/b', { fetchImpl, lookup: publicLookup, robots: g });
  assert.equal(s2.policy_code, 'robots_crawl_delay');
  assert.equal(calls.filter((c) => c.url === 'https://slow.example/b').length, 0, 'page non demandée');
});

test('visite : page interdite non demandée, refus tracé et conservé ; User-Agent KayrosLabBot sur la page', async () => {
  const { fetchImpl, calls } = net({ 'https://site.example': 'User-agent: *\nDisallow: /prive\n' });
  const g = guard({ fetchImpl });
  const out = await visitPublicSources(['https://site.example/prive/cv', 'https://site.example/equipe'], { fetchImpl, lookup: publicLookup, robots: g });
  assert.equal(out[0].policy_code, 'robots_disallowed');
  assert.match(out[0].error, /politique de collecte : robots_disallowed/);
  assert.equal(out[0].robots.allowed, false);
  assert.equal(out[0].skipped, undefined, 'un refus robots ne ferme pas le domaine');
  assert.equal(out[1].error, null); assert.equal(out[1].robots.allowed, true);
  assert.ok(!calls.some((c) => c.url === 'https://site.example/prive/cv'));
  assert.equal(calls.find((c) => c.url === 'https://site.example/equipe').ua, KAYROS_BOT_USER_AGENT);
  const kept = normalizePublicEvidence(out);
  assert.equal(kept[0].policy_code, 'robots_disallowed');
  assert.equal(kept[0].robots.rule, 'Disallow: /prive');
  // Redirection vers un autre hôte : robots.txt de la cible vérifié aussi.
  const hop = net({ 'https://a.example': 'User-agent: *\nAllow: /\n', 'https://b.example': 'User-agent: *\nDisallow: /\n' });
  const redirFetch = async (url, init) => (url === 'https://a.example/go' ? new Response(null, { status: 302, headers: { location: 'https://b.example/page' } }) : hop.fetchImpl(url, init));
  const r = await visitPublicSource('https://a.example/go', { fetchImpl: redirFetch, lookup: publicLookup, robots: guard({ fetchImpl: redirFetch }) });
  assert.equal(r.policy_code, 'robots_disallowed');
});

test('persona : checkPersonaRobots et visitPersonaUrls refusent avant la visite ; GitHub (API) non concerné', async () => {
  const { fetchImpl } = net({ 'https://exemple.fr': 'User-agent: *\nDisallow: /blog\n' });
  const g = guard({ fetchImpl });
  const plan = await checkPersonaRobots(['https://exemple.fr/equipe', 'https://exemple.fr/blog/x', 'https://x.com/a', 'https://github.com/octocat'], { robots: g, env: {} });
  assert.deepEqual(plan.allowed.map((a) => a.url), ['https://exemple.fr/equipe', 'https://github.com/octocat']);
  assert.deepEqual(plan.refused.map((r) => [r.url, r.code]), [['https://x.com/a', 'mode_not_allowed'], ['https://exemple.fr/blog/x', 'robots_disallowed']]);
  const visited = [];
  const out = await visitPersonaUrls(['https://exemple.fr/blog/x', 'https://exemple.fr/equipe'], {
    robots: g, env: {}, visit: async (urls) => { visited.push(...urls); return urls.map((url) => ({ url, status: 200, title: 'T', excerpt: 'E', fetched_at: '2026-11-13T00:00:00Z' })); },
  });
  assert.deepEqual(visited, ['https://exemple.fr/equipe']);
  assert.equal(out[0].policy_code, 'robots_disallowed');
  assert.equal(out[0].robots.rule, 'Disallow: /blog');
  // Le registre déclare l'exigence.
  assert.equal(getSourcePolicy('web').modes.public_visit.conditions.requiresRobotsCompliance, true);
  assert.equal(getSourcePolicy('crystalknows').modes.public_visit.conditions.requiresRobotsCompliance, true);
  assert.equal(getSourcePolicy('github').modes.scrape.conditions.requiresRobotsCompliance, true);
});

test('CrystalKnows (page publique) : robots.txt respecté, refus en SourcePolicyError', async () => {
  const { fetchImpl, calls } = net({ 'https://www.crystalknows.com': 'User-agent: *\nDisallow: /p/\n' });
  const f = new CrystalPublicProfileFetcher({ fetchImpl, robots: guard({ fetchImpl }) });
  await assert.rejects(() => f.fetch('geoffroy2104'), (e) => e instanceof SourcePolicyError && e.code === 'robots_disallowed' && e.details.robots.allowed === false);
  assert.ok(!calls.some((c) => c.url.includes('/p/geoffroy2104')));
  const ok = net({ 'https://www.crystalknows.com': 'User-agent: *\nAllow: /\nDisallow: /app/register\n' });
  const page = await new CrystalPublicProfileFetcher({ fetchImpl: ok.fetchImpl, robots: guard({ fetchImpl: ok.fetchImpl }) }).fetch('geoffroy2104');
  assert.equal(page.robots.allowed, true);
  assert.equal(ok.calls.at(-1).ua, KAYROS_BOT_USER_AGENT);
});
