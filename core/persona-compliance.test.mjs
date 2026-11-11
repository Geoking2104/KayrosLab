import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSONA_COMPLIANCE_RULES_VERSION, describeProfileSources, detectSpecialCategories, excludeSpecialCategoryItems, flagOn,
  mailboxEnrichEnabled, personaComplianceView, personaPublicModelEnabled, scanTextInputs, specialCategoryError,
  verificationLabel, verificationStatus,
} from './persona-compliance.mjs';

test('drapeaux : modèle public désactivé par défaut, boîte mail active sauf =off', () => {
  assert.equal(personaPublicModelEnabled({}), false);
  assert.equal(personaPublicModelEnabled({ KAYROS_PERSONA_PUBLIC_MODEL: 'off' }), false);
  for (const v of ['1', 'true', 'ON', 'yes']) assert.equal(personaPublicModelEnabled({ KAYROS_PERSONA_PUBLIC_MODEL: v }), true, v);
  assert.equal(mailboxEnrichEnabled({}), true);
  assert.equal(mailboxEnrichEnabled({ KAYROS_MAILBOX_ENRICH: 'on' }), true);
  assert.equal(mailboxEnrichEnabled({ KAYROS_MAILBOX_ENRICH: ' OFF ' }), false);
  assert.equal(flagOn(undefined), false);
});

test('filtre art. 9 : catégories détectées en français et en anglais, accents compris', () => {
  assert.deepEqual(detectSpecialCategories('Elle va à l’église le dimanche'), ['religion']);
  assert.deepEqual(detectSpecialCategories('Je suis syndiqué à la CGT'), ['trade_union']);
  assert.deepEqual(detectSpecialCategories('He was diagnosed last spring'), ['health']);
  assert.deepEqual(detectSpecialCategories('orientation sexuelle'), ['sex_life_orientation']);
  assert.deepEqual(detectSpecialCategories('test ADN demandé'), ['genetic_biometric']);
  assert.deepEqual(detectSpecialCategories('Je vote pour le parti X ; ma grossesse avance'), ['health', 'political_opinion']);
});

test('filtre art. 9 : pas de faux positif sur le vocabulaire d’affaires courant', () => {
  for (const s of ['L’ADN de l’entreprise', 'Diagnostic financier Q3', 'chambre syndicale du secteur', 'handicap concurrentiel',
    'Envoyez-moi le chiffre avant vendredi', 'génétique des marchés', 'Union des industries', '']) {
    assert.deepEqual(detectSpecialCategories(s), [], s);
  }
});

test('scanTextInputs : renvoie champ, index et catégories, jamais le texte', () => {
  const out = scanTextInputs({ emails: ['Go lundi.', { subject: 's', body: 'Mon arrêt maladie se termine' }], x_posts: ['Chiffre ?'], x_archive: null });
  assert.equal(out.blocked, true);
  assert.deepEqual(out.findings, [{ field: 'emails', index: 1, categories: ['health'] }]);
  const err = specialCategoryError(out.findings);
  assert.equal(err.code, 'special_category_data');
  assert.ok(!JSON.stringify(err).includes('maladie'), 'aucun extrait renvoyé');
  assert.deepEqual(scanTextInputs({ emails: ['Go.'], linkedin_export: { 'Profile.csv': 'CEO, Lyon' } }), { blocked: false, findings: [] });
});

test('excludeSpecialCategoryItems : écarte et compte', () => {
  assert.deepEqual(excludeSpecialCategoryItems(['On tranche vite.', 'Fier de mon syndicat', { text: 'Go lundi.' }]), { kept: ['On tranche vite.', { text: 'Go lundi.' }], excluded: 1 });
});

test('statut Estimé / Vérifié par la personne : vérifié seulement si la personne l’a fait', () => {
  assert.equal(verificationStatus(null), 'estimated');
  assert.equal(verificationStatus({ profile_sources: [{ source: 'crystalknows', verified: null }, { source: 'x' }] }), 'estimated');
  assert.equal(verificationStatus({ profile_sources: [{ source: 'crystalknows', verified: true }] }), 'verified');
  assert.equal(verificationLabel('estimated'), 'Simulation · Estimé');
  assert.equal(verificationLabel('verified'), 'Simulation · Vérifié par la personne');
});

test('vue de conformité : base légale, statut, sources (sans contenu) ; null hors impersonator', () => {
  const agent = {
    agent_id: 'p1',
    human_profile: { avatar_url: 'https://avatars.example/p.png', profile_sources: [
      { source: 'crystalknows', source_url: 'https://www.crystalknows.com/p/x', import_mode: 'public_profile_page', imported_at: '2026-11-11T10:00:00Z' },
      { source: 'email', source_url: 'mailto:secret@x.fr', import_mode: 'pasted' },
    ] },
    metadata: { impersonator: { public_sources: ['https://exemple.fr/equipe', 'https://exemple.fr/blog'], public_evidence: [{ url: 'https://exemple.fr/equipe', fetched_at: '2026-11-11T10:01:00Z', title: 'Équipe' }, { url: 'https://exemple.fr/blog', error: 'HTTP 404' }] } },
  };
  const v = personaComplianceView(agent);
  assert.equal(v.rules_version, PERSONA_COMPLIANCE_RULES_VERSION);
  assert.equal(v.legal_basis, 'legitimate_interest');
  assert.equal(v.controller, 'tenant');
  assert.equal(v.verification_status, 'estimated');
  assert.equal(v.label, 'Simulation · Estimé');
  assert.equal(v.portrait_url, 'https://avatars.example/p.png');
  assert.deepEqual(v.profile_sources.map((s) => s.type), ['crystalknows', 'email', 'web', 'web']);
  assert.equal(v.profile_sources[1].url, null, 'aucune adresse de texte fourni exposée');
  assert.equal(v.profile_sources[2].visited, true);
  assert.equal(v.profile_sources[3].visited, false);
  assert.ok(!('confidence' in v) && !JSON.stringify(v).includes('%'), 'aucun taux de précision');
  assert.equal(personaComplianceView({ agent_id: 'cfo', human_profile: {} }), null);
  assert.deepEqual(describeProfileSources({}), []);
});
