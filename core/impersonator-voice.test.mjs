import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { profileConfidence, personaVoice, voiceContext, speakAs, ESTIMATE_CONFIDENCE_CAP } from './impersonator-voice.mjs';
import { buildEnrichedProfile, profileFromCrystalPublic, profileFromEmails } from './profile-enrichment.mjs';
import { profileFromDiscType } from './personality.mjs';
import { impersonatorAgentDefinition, impersonatorContext } from './impersonator.mjs';

const html = readFileSync(new URL('./fixtures/crystal-public-geoffroy2104.html', import.meta.url), 'utf8');
const crystal = profileFromCrystalPublic(html);
const mails = ['Go. On tranche vendredi.', 'Envoie le devis.', 'Valide le budget. Fais court.'].map((body) => ({ from: 'g@k.fr', body }));

test('confiance : CrystalKnows réel vs estimation plafonnée vs DISC saisi', () => {
  const c = profileConfidence(crystal);
  assert.equal(c.kind, 'crystalknows');
  assert.equal(c.confidence, null);
  assert.match(c.label, /CrystalKnows \(page publique\)/);
  const est = profileConfidence(buildEnrichedProfile({ email: profileFromEmails(mails, { author: 'g@k.fr' }) }).profile);
  assert.equal(est.kind, 'estimate');
  assert.ok(est.confidence <= ESTIMATE_CONFIDENCE_CAP);
  assert.match(est.label, /pas une fiche CrystalKnows/);
  assert.doesNotMatch(est.label, /^CrystalKnows/);
  assert.equal(profileConfidence(profileFromDiscType('Sc')).kind, 'disc_template');
  assert.equal(profileConfidence({}).kind, 'none');
});

test('voix : registre DISC, consignes d’écriture, angles morts', () => {
  const v = personaVoice(crystal);
  assert.equal(v.disc, 'D');
  assert.equal(v.max_sentences, 3);
  assert.ok(v.speaks.includes('Write 3 sentences or less'));
  assert.ok(v.blindspots.length > 0);
  const ctx = voiceContext(crystal);
  assert.match(ctx, /VOIX DE LA PERSONA/);
  assert.match(ctx, /3 phrases maximum/);
  assert.match(ctx, /Angles morts/);
});

test('ainsi je parlerais : bref, direct, étiqueté Simulation', () => {
  const r = speakAs(crystal, 'Lancer une offre premium');
  assert.match(r.message, /^Simulation — /);
  assert.match(r.message, /Lancer une offre premium/);
  assert.ok(r.message.split(/(?<=[.?!])\s/).length <= 3);
  assert.match(r.message, /gain/);
  assert.match(speakAs(profileFromDiscType('C'), 'X').message, /données/);
});

test('contexte impersonator : la voix est injectée', () => {
  const def = impersonatorAgentDefinition({ impersonator: { persona_name: 'Geoffroy', source: 'enriched', consent_confirmed: true }, human_profile: crystal });
  assert.match(impersonatorContext(def), /VOIX DE LA PERSONA[\s\S]*provenance : CrystalKnows/);
});
