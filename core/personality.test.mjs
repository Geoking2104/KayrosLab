import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CrystalKnowsProfileAdapter,
  normalizeDiscType,
  profileFromDiscType,
  LinkedInSelfProfileAdapter,
  ProfileImportService,
  mergeHumanProfiles,
  normalizeProfileUrl,
  profileFromCrystalData,
  profileFromLinkedInData,
} from './personality.mjs';

test('profile URLs accept supplied Markdown links but reject scraping targets', () => {
  assert.equal(
    normalizeProfileUrl('linkedin', '[profile](https://linkedin.com/in/jeandupont-cfo?trk=x)'),
    'https://www.linkedin.com/in/jeandupont-cfo',
  );
  assert.throws(() => normalizeProfileUrl('linkedin', 'https://example.com/person'), /linkedin.com/);
  assert.throws(() => normalizeProfileUrl('crystalknows', 'http://www.crystalknows.com/p/x'), /HTTPS/);
});

test('LinkedIn import stays professional and never invents behavioral traits', () => {
  const profile = profileFromLinkedInData({
    id: 'li-1', localizedFirstName: 'Jean', localizedLastName: 'Dupont',
    localizedHeadline: 'CFO at Example', vanityName: 'jeandupont-cfo',
  }, { imported_by: 'user-1' });
  assert.equal(profile.assigned_name, 'Jean Dupont');
  assert.equal(profile.professional_context.headline, 'CFO at Example');
  assert.equal(profile.disc_type, undefined);
  assert.equal(profile.profile_sources[0].source, 'linkedin');
});

test('Crystal import maps documented DISC and communication fields', () => {
  const profile = profileFromCrystalData({ data: {
    first_name: 'Jean', last_name: 'Dupont', url: 'https://www.crystalknows.com/p/jean', verified: true,
    personalities: { disc_type: 'DC', archetype: 'Skeptic', enneagram_type: '6' },
    content: {
      motivation: { phrase: ['Risk minimization'] },
      drainer: { phrase: ['Unproven projections'] },
      communication: { phrase: ['Lead with hard numbers'] },
      recommendations: { do: ['Be direct'], dont: ['Do not use buzzwords'] },
    },
  } });
  assert.equal(profile.disc_type, 'DC');
  assert.equal(profile.behavioral_archetype, 'Skeptic');
  assert.deepEqual(profile.communication_style.stress_triggers, ['Unproven projections']);
  assert.equal(profile.profile_sources[0].verified, true);
});

test('profile import requires consent and merges LinkedIn + Crystal provenance', async () => {
  const service = new ProfileImportService();
  await assert.rejects(() => service.importProfile({ source: 'linkedin', profile_data: {}, consent_confirmed: false }), /consentement/);
  const linkedin = await service.importProfile({
    source: 'linkedin', consent_confirmed: true,
    profile_data: { localizedFirstName: 'Sarah', localizedLastName: 'Jenkins', vanityName: 'sarahjenkins-finance' },
  });
  const crystal = await service.importProfile({
    source: 'crystalknows', consent_confirmed: true, linkedin_url: linkedin.linkedin_url,
    profile_data: { data: { first_name: 'Sarah', last_name: 'Jenkins', url: 'https://app.crystalknows.com/p/sarahjenkins', personalities: { disc_type: 'Di' } } },
  });
  const merged = mergeHumanProfiles(linkedin, crystal);
  assert.equal(merged.assigned_name, 'Sarah Jenkins');
  assert.equal(merged.disc_type, 'Di');
  assert.deepEqual(merged.profile_sources.map((s) => s.source), ['linkedin', 'crystalknows']);
});

test('official adapters call only documented endpoints and LinkedIn rejects another member', async () => {
  let crystalUrl = '';
  const crystal = new CrystalKnowsProfileAdapter({
    apiToken: 'secret', apiVersion: 'v1',
    fetchImpl: async (url, opts) => {
      crystalUrl = String(url);
      assert.equal(opts.headers.Authorization, 'Bearer secret');
      return { ok: true, json: async () => ({ data: { first_name: 'A', last_name: 'B', personalities: { disc_type: 'C' } } }) };
    },
  });
  await crystal.importProfile({ linkedin_url: 'https://linkedin.com/in/a-b' });
  assert.match(crystalUrl, /\/v1\/profiles\?linkedin_url=/);

  const linkedin = new LinkedInSelfProfileAdapter({
    accessToken: 'li-secret',
    fetchImpl: async (url, opts) => {
      assert.equal(String(url), 'https://api.linkedin.com/v2/me');
      assert.equal(opts.headers.Authorization, 'Bearer li-secret');
      return { ok: true, json: async () => ({ localizedFirstName: 'A', localizedLastName: 'B', vanityName: 'a-b' }) };
    },
  });
  await assert.rejects(
    () => linkedin.importProfile({ profile_url: 'https://linkedin.com/in/someone-else' }),
    /membre authentifié/,
  );
});

// Forme réelle de l'API Data v4 (https://api.crystalknows.com/v4/swagger).
const crystalV4Profile = {
  id: 'p_123', first_name: 'Paul', last_name: 'Jones', photo_url: 'https://cdn.crystalknows.com/p.jpg',
  url: 'https://www.crystalknows.com/p/pjones', verified: true,
  personalities: {
    disc_type: 'Dc', archetype: 'Architect', disc_intensity: 3, enneagram_type: 8, myers_briggs_type: 'ENTJ',
    overview: 'Paul is direct and analytical.',
    behavioral_traits: { dominance: 81, expressiveness: 40, leniency: 22, pace: 70, pragmatism: 64, risk_aversion: 35, skepticism: 78, social: 30 },
  },
  content: {
    motivation: [{ phrases: ['Winning'] }, { phrases: ['Autonomy'] }],
    drainer: { phrases: ['Long meetings'] },
    meeting: { phrases: ['Keep it short'] },
    working_together: { phrases: ['Bring data'] },
    recommendations: [{ dos: ['Be concise'], dont: ['Ramble'] }],
    profile: { overview: ['Results first.'] },
    qualities: ['decisive'],
  },
};

test('Crystal v4 : traits, motivations et recommandations sont projetés sur le profil', () => {
  const profile = profileFromCrystalData({ data: crystalV4Profile });
  assert.equal(profile.assigned_name, 'Paul Jones');
  assert.equal(profile.disc_type, 'Dc');
  assert.equal(profile.enneagram_type, '8');
  assert.equal(profile.avatar_url, 'https://cdn.crystalknows.com/p.jpg');
  assert.equal(profile.behavioral_traits.skepticism, 78);
  assert.match(profile.skepticism_factor, /élevé \(78\/100\)/);
  assert.deepEqual(profile.core_motivators, ['Winning', 'Autonomy']);
  assert.deepEqual(profile.communication_style.stress_triggers, ['Long meetings']);
  assert.deepEqual(profile.communication_style.objection_patterns, ['Ramble']);
  assert.ok(profile.communication_style.communication_directives.includes('Be concise'));
  assert.ok(profile.profile_summary.includes('Results first.'));
  assert.equal(profile.profile_sources[0].external_profile_id, 'p_123');
});

test('adaptateur Crystal v4 : GET /v4/profile puis contenu gratuit, erreurs documentées', async () => {
  const calls = [];
  const crystal = new CrystalKnowsProfileAdapter({
    apiToken: 'secret',
    fetchImpl: async (url, opts) => {
      calls.push(String(url));
      assert.equal(opts.headers.Authorization, 'Bearer secret');
      if (String(url).includes('/v4/content/profile/p_123')) return { ok: true, json: async () => crystalV4Profile.content };
      return { ok: true, json: async () => ({ data: { ...crystalV4Profile, content: undefined } }) };
    },
  });
  const profile = await crystal.importProfile({ email: 'pjones@crystalknows.com' });
  assert.match(calls[0], /^https:\/\/api\.crystalknows\.com\/v4\/profile\?email=pjones%40crystalknows\.com$/);
  assert.match(calls[1], /\/v4\/content\/profile\/p_123$/);
  assert.deepEqual(profile.core_motivators, ['Winning', 'Autonomy']);

  const missing = new CrystalKnowsProfileAdapter({ apiToken: 't', fetchImpl: async () => ({ ok: false, status: 402, json: async () => ({ error: 'out of credits' }) }) });
  await assert.rejects(() => missing.importProfile({ full_name: 'A B', company_name: 'X' }), /crédits API épuisés/);
  await assert.rejects(() => new CrystalKnowsProfileAdapter({}).importProfile({ email: 'a@b.c' }), /token serveur non configuré/);
});

test('adaptateur Crystal v4 : prédiction asynchrone opt-in sur un profil inconnu', async () => {
  const calls = [];
  const crystal = new CrystalKnowsProfileAdapter({
    apiToken: 't', allowPredictions: true, sleep: async () => {},
    fetchImpl: async (url, opts = {}) => {
      calls.push(`${opts.method || 'GET'} ${new URL(String(url)).pathname}`);
      const path = new URL(String(url)).pathname;
      if (path === '/v4/profile') return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
      if (path === '/v4/predictions') { assert.equal(JSON.parse(opts.body).query.name, 'Paul Jones'); return { ok: true, json: async () => ({ job_id: 'job1', status: 'queued' }) }; }
      return { ok: true, json: async () => ({ job_id: 'job1', status: 'completed', result: { state: 'found', profile: crystalV4Profile } }) };
    },
  });
  const profile = await crystal.importProfile({ full_name: 'Paul Jones', company_name: 'Crystal' });
  assert.equal(profile.disc_type, 'Dc');
  assert.deepEqual(calls, ['GET /v4/profile', 'POST /v4/predictions', 'GET /v4/predictions/job1']);
});

test('saisie DISC : type normalisé et style de communication de départ', () => {
  assert.equal(normalizeDiscType('d/c'), 'Dc');
  assert.equal(normalizeDiscType('xyz'), null);
  const profile = profileFromDiscType('SC', { assigned_name: 'Claire' });
  assert.equal(profile.disc_type, 'Sc');
  assert.equal(profile.behavioral_archetype, 'Stabilité / Conformité');
  assert.match(profile.communication_style.tone, /calme/);
  assert.equal(profile.consent_confirmed, true);
  assert.throws(() => profileFromDiscType('Z'), /DISC invalide/);
});
