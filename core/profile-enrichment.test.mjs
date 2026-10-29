import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  crystalPublicUrl, parseCrystalPublicPage, profileFromCrystalPublic, CrystalPublicProfileFetcher,
  parseCsv, profileFromLinkedInExport, cleanEmailBody, analyseWritingStyle, estimateDiscFromStyle,
  profileFromEmails, postsFromXArchive, profileFromXPosts, XProfileAdapter, buildEnrichedProfile,
} from './profile-enrichment.mjs';

const html = readFileSync(new URL('./fixtures/crystal-public-geoffroy2104.html', import.meta.url), 'utf8');

test('crystalPublicUrl accepte seulement /p/<slug> en https', () => {
  assert.equal(crystalPublicUrl('geoffroy2104').url, 'https://www.crystalknows.com/p/geoffroy2104');
  assert.equal(crystalPublicUrl('https://crystalknows.com/p/geoffroy2104/').slug, 'geoffroy2104');
  assert.throws(() => crystalPublicUrl('https://www.crystalknows.com/app/profile/x'), /page publique/);
  assert.throws(() => crystalPublicUrl('https://evil.com/p/geoffroy2104'), /page publique/);
  assert.throws(() => crystalPublicUrl('http://www.crystalknows.com/p/a'), /page publique/);
});

test('parseCrystalPublicPage lit le payload Next.js', () => {
  const p = parseCrystalPublicPage(html);
  assert.equal(p.discType, 'D');
  assert.equal(p.discArchetype, 'Captain');
  assert.throws(() => parseCrystalPublicPage('<html></html>'), /aucun profil public/);
});

test('profileFromCrystalPublic reconstruit la fiche Crystal', () => {
  const p = profileFromCrystalPublic(html, { imported_by: 'op@x' });
  assert.equal(p.assigned_name, 'Geoffroy de La Tournelle');
  assert.equal(p.disc_type, 'D');
  assert.equal(p.behavioral_archetype, 'Captain');
  assert.equal(p.descriptif.disc_degrees, 128);
  assert.equal(p.descriptif.source, 'crystalknows_public');
  assert.deepEqual(p.descriptif.qualities, ['Assertive', 'Independent', 'Decisive']);
  assert.ok(p.descriptif.sections.emails.includes('Write 3 sentences or less'));
  assert.ok(p.descriptif.sections.working_together.length > 0);
  assert.ok(p.descriptif.sections.do.length > 0, 'do/dont complétés par le modèle DISC');
  assert.equal(p.profile_sources[0].import_mode, 'public_profile_page');
  assert.equal(p.crystalknows_report_url, 'https://www.crystalknows.com/p/geoffroy2104');
});

test('CrystalPublicProfileFetcher : URL unique, sans cookie, erreur sur HTTP', async () => {
  const calls = [];
  const fetcher = new CrystalPublicProfileFetcher({ fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => html }; } });
  const r = await fetcher.fetch('https://crystalknows.com/p/geoffroy2104');
  assert.equal(calls[0].url, 'https://www.crystalknows.com/p/geoffroy2104');
  assert.equal(calls[0].init.headers.cookie, undefined);
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.ok(r.html.includes('__next_f'));
  const ko = new CrystalPublicProfileFetcher({ fetchImpl: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(() => ko.fetch('nobody'), /HTTP 404/);
});

test('export LinkedIn : CSV officiels', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","z ""q"""\n'), [{ a: 'x, y', b: 'z "q"' }]);
  const p = profileFromLinkedInExport({
    'Profile.csv': 'First Name,Last Name,Headline,Summary,Geo Location\nGeoffroy,de La Tournelle,CEO KayrosLab,"Bâtit des agents, vite.",Paris\n',
    'Positions.csv': 'Company Name,Title,Started On,Finished On\nKayrosLab,CEO,Jan 2024,\nAcme,COO,2019,2023\n',
    'Skills.csv': 'Name\nStratégie\nIA\n',
  });
  assert.equal(p.assigned_name, 'Geoffroy de La Tournelle');
  assert.equal(p.professional_context.current_role, 'CEO');
  assert.equal(p.professional_context.company, 'KayrosLab');
  assert.deepEqual(p.professional_context.skills, ['Stratégie', 'IA']);
  assert.equal(p.profile_sources[0].import_mode, 'data_export');
  assert.throws(() => profileFromLinkedInExport({}), /export vide/);
});

const mails = [
  { from: 'Geoffroy <g@k.fr>', body: 'On part sur l’option B. Envoie-moi le devis demain.\n\nLe lun. 3 a écrit :\n> long message' },
  { from: 'g@k.fr', body: 'Valide le budget. Go.\n--\nGeoffroy' },
  { from: 'g@k.fr', body: 'Fais court. On décide vendredi.' },
  { from: 'autre@x.fr', body: 'Bonjour, je pense que peut-être nous pourrions envisager une autre approche si possible.' },
];

test('e-mails : seuls ceux de la personne, sans citation ni signature', () => {
  assert.equal(cleanEmailBody('Ok.\n> cité\nSent from my phone\nreste'), 'Ok.');
  const r = profileFromEmails(mails, { author: 'g@k.fr' });
  assert.equal(r.corpus.length, 3);
  assert.ok(!r.corpus.join(' ').includes('long message'));
  assert.ok(r.style.avg_sentence_words < 8);
  assert.equal(r.profile.profile_sources[0].source, 'email');
  assert.throws(() => profileFromEmails(mails, { author: 'personne@x' }), /aucun message/);
});

test('estimation DISC depuis un style direct et court', () => {
  const s = analyseWritingStyle(mails.slice(0, 3).map((m) => cleanEmailBody(m.body)));
  const e = estimateDiscFromStyle(s);
  assert.equal(e.disc_type[0], 'D');
  assert.ok(e.confidence <= 0.6);
  assert.equal(estimateDiscFromStyle(analyseWritingStyle(['un'])), null);
});

test('X : archive tweets.js et API officielle', async () => {
  const archive = 'window.YTD.tweets.part0 = [{"tweet":{"full_text":"On livre vendredi. Point."}},{"tweet":{"full_text":"RT @a: bruit"}},{"tweet":{"full_text":"@bob Fais simple. https://t.co/x"}}]';
  assert.deepEqual(postsFromXArchive(archive), ['On livre vendredi. Point.', 'Fais simple.']);
  const r = profileFromXPosts(['Go.', 'On tranche.'], { username: 'geoffroy', bio: 'CEO' });
  assert.equal(r.profile.profile_sources[0].source_url, 'https://x.com/geoffroy');
  await assert.rejects(() => new XProfileAdapter({ bearerToken: '' }).fetchProfile('geoffroy'), /X_BEARER_TOKEN absent/);
  const urls = [];
  const api = new XProfileAdapter({ bearerToken: 't', fetchImpl: async (url) => { urls.push(url); return { ok: true, json: async () => (url.includes('/tweets') ? { data: [{ text: 'Go.' }] } : { data: { id: '42', name: 'G', description: 'bio' } }) }; } });
  const p = await api.fetchProfile('@geoffroy');
  assert.deepEqual(p.posts, ['Go.']);
  assert.ok(urls[0].startsWith('https://api.x.com/2/users/by/username/geoffroy'));
  assert.ok(urls[1].includes('exclude=retweets,replies'));
});

test('buildEnrichedProfile : Crystal prime, style observé ajouté aux e-mails', () => {
  const email = profileFromEmails(mails, { author: 'g@k.fr' });
  const r = buildEnrichedProfile({ crystal: profileFromCrystalPublic(html), email, linkedin: profileFromLinkedInExport({ 'Profile.csv': 'First Name,Last Name\nG,T\n' }) });
  assert.equal(r.profile.disc_type, 'D');
  assert.equal(r.profile.assigned_name, 'Geoffroy de La Tournelle');
  assert.ok(r.profile.descriptif.sections.emails.some((s) => s.startsWith('Observé')));
  assert.deepEqual(r.evidence.map((e) => e.source), ['linkedin', 'email', 'crystalknows']);
  assert.equal(r.estimate, null);
});

test('buildEnrichedProfile sans Crystal : DISC estimé et marqué', () => {
  const r = buildEnrichedProfile({ assigned_name: 'G', email: profileFromEmails(mails, { author: 'g@k.fr' }) });
  assert.equal(r.profile.disc_type[0], 'D');
  assert.equal(r.profile.descriptif.source, 'enriched');
  assert.match(r.profile.descriptif.overview, /Estimation/);
  assert.equal(r.evidence.at(-1).source, 'estimate');
  assert.throws(() => buildEnrichedProfile({}), /aucune source/);
});
