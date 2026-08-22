import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CrystalKnowsProfileAdapter,
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
    apiToken: 'secret',
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
