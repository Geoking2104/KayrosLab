import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE_POLICIES, SOURCE_POLICY_VERSION, COLLECTION_MODES, listSources, getSourcePolicy,
  assertCollectionAllowed, evaluateCollection, isSourceEnabled, termsVersionOf, SourcePolicyError,
} from './source-policy.mjs';

const refused = (args, code) => {
  const out = evaluateCollection(args);
  assert.equal(out.allowed, false, JSON.stringify(out));
  assert.equal(out.code, code);
  assert.ok(out.error.length > 10, 'message explicite');
  return out;
};

test('registre figé, versionné : sources de signaux et sources persona', () => {
  assert.equal(SOURCE_POLICY_VERSION, '2026-11-13');
  assert.deepEqual(COLLECTION_MODES, ['api', 'scrape', 'public_visit', 'import', 'none']);
  assert.deepEqual(listSources().sort(), ['crystalknows', 'discord', 'github', 'gmail', 'import', 'linkedin', 'manual', 'outlook', 'reddit', 'user_text', 'web', 'x']);
  assert.ok(Object.isFrozen(SOURCE_POLICIES));
  assert.ok(Object.isFrozen(SOURCE_POLICIES.github.modes.scrape.conditions));
  assert.throws(() => { SOURCE_POLICIES.reddit.personProfiling = true; }, TypeError);
  assert.equal(SOURCE_POLICIES.reddit.personProfiling, false);
  assert.equal(SOURCE_POLICIES.discord.personProfiling, false);
});

test('chaque source déclare modes, conditions, date de vérification et usage', () => {
  const urls = {
    github: 'https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies',
    x: 'https://x.com/en/tos',
    reddit: 'https://redditinc.com/policies/user-agreement',
    import: null,
    linkedin: 'https://www.linkedin.com/legal/user-agreement',
    crystalknows: 'https://www.crystalknows.com/tos',
    gmail: 'https://developers.google.com/terms/api-services-user-data-policy',
    outlook: 'https://learn.microsoft.com/en-us/legal/microsoft-apis/terms-of-use',
    discord: 'https://discord.com/terms',
    user_text: null, manual: null, web: null,
  };
  for (const id of listSources()) {
    const p = getSourcePolicy(id);
    assert.equal(p.termsUrl, urls[id], id);
    assert.match(p.termsVerifiedAt, /^2026-11-1[23]$/);
    assert.equal(typeof p.personProfiling, 'boolean');
    assert.equal(typeof p.topicSignals, 'boolean');
    for (const mode of COLLECTION_MODES) assert.equal(typeof p.modes[mode]?.allowed, 'boolean', `${id}.${mode}`);
  }
  assert.equal(termsVersionOf(getSourcePolicy('github')), 'github@2026-11-12');
});

test('refus par défaut : source inconnue, mode inconnu ou "none"', () => {
  refused({ source: 'facebook', mode: 'api', env: {} }, 'unknown_source');
  refused({ source: '', mode: 'api', env: {} }, 'unknown_source');
  refused({ source: 'github', mode: 'crawl', env: {} }, 'unknown_mode');
  refused({ source: 'github', mode: 'none', env: {} }, 'mode_not_allowed');
  assert.throws(() => getSourcePolicy('facebook'), (e) => e instanceof SourcePolicyError && e.code === 'unknown_source');
});

test('github : API préférée, signaux de sujet seulement', () => {
  const ok = assertCollectionAllowed({ source: 'github', mode: 'api', scope: 'repositories', env: {} });
  assert.equal(ok.allowed, true);
  assert.equal(ok.termsVersion, 'github@2026-11-12');
  assert.equal(ok.rateLimit.maxRequestsPerDecision, 10);
  assert.equal(getSourcePolicy('github').preferredMode, 'api');
  // Profilage : périmètre persona obligatoire (profile, repos, readme), jamais les périmètres de sujet.
  refused({ source: 'github', mode: 'api', purpose: 'person_profiling', env: {} }, 'scope_not_allowed');
  refused({ source: 'github', mode: 'api', purpose: 'person_profiling', scope: 'repositories', env: {} }, 'scope_not_allowed');
  assert.equal(assertCollectionAllowed({ source: 'github', mode: 'api', purpose: 'person_profiling', scope: 'profile', env: {} }).allowed, true);
  refused({ source: 'github', mode: 'api', scope: 'users', env: {} }, 'scope_not_allowed');
  refused({ source: 'github', mode: 'import', env: {} }, 'mode_not_allowed');
});

test('github scrape : public, agrégé, robots.txt, rythme lent, jamais de profilage', () => {
  const ok = assertCollectionAllowed({ source: 'github', mode: 'scrape', scope: 'topics', env: {} });
  assert.deepEqual({ ...ok.conditions }, { publicOnly: true, aggregatedOnly: true, respectRobotsTxt: true, noPersonalDataResale: true, minDelayMs: 10000 });
  refused({ source: 'github', mode: 'scrape', purpose: 'person_profiling', scope: 'repositories', env: {} }, 'purpose_not_allowed');
  refused({ source: 'github', mode: 'scrape', scope: 'users', env: {} }, 'scope_not_allowed');
});

test('x : API seulement, désactivée sans X_API_BEARER_TOKEN', () => {
  refused({ source: 'x', mode: 'api', env: {} }, 'source_disabled');
  refused({ source: 'x', mode: 'scrape', env: { X_API_BEARER_TOKEN: 't' } }, 'mode_not_allowed');
  assert.equal(isSourceEnabled('x', {}), false);
  assert.equal(assertCollectionAllowed({ source: 'x', mode: 'api', env: { X_API_BEARER_TOKEN: 't' } }).allowed, true);
  refused({ source: 'x', mode: 'api', purpose: 'person_profiling', scope: 'profile', env: {} }, 'source_disabled');
  assert.equal(assertCollectionAllowed({ source: 'x', mode: 'api', purpose: 'person_profiling', scope: 'posts', env: { X_API_BEARER_TOKEN: 't' } }).allowed, true);
  // Nom historique lu par l'enrichissement persona.
  assert.equal(isSourceEnabled('x', { X_BEARER_TOKEN: 't' }), true);
});

test('reddit : API seulement, désactivée sans accord commercial', () => {
  refused({ source: 'reddit', mode: 'api', env: {} }, 'source_disabled');
  refused({ source: 'reddit', mode: 'api', env: { KAYROS_REDDIT_COMMERCIAL_AGREEMENT: 'off' } }, 'source_disabled');
  refused({ source: 'reddit', mode: 'scrape', env: { KAYROS_REDDIT_COMMERCIAL_AGREEMENT: 'signed' } }, 'mode_not_allowed');
  assert.equal(assertCollectionAllowed({ source: 'reddit', mode: 'api', env: { KAYROS_REDDIT_COMMERCIAL_AGREEMENT: 'signed' } }).allowed, true);
});

test('import : JSON/CSV uniquement, mode import', () => {
  const ok = assertCollectionAllowed({ source: 'import', mode: 'import', scope: 'signals', env: {} });
  assert.equal(ok.termsUrl, null);
  assert.deepEqual([...getSourcePolicy('import').modes.import.formats], ['json', 'csv']);
  refused({ source: 'import', mode: 'api', env: {} }, 'mode_not_allowed');
  refused({ source: 'import', mode: 'scrape', env: {} }, 'mode_not_allowed');
});
