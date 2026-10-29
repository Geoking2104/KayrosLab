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

import { conformVoice, scoreVoice, speakWithModel } from './impersonator-voice.mjs';
const dProfile = { consent_confirmed: true, disc_type: 'D', descriptif: { source: 'crystalknows_public', disc_type: 'D', sections: { emails: ['Write 3 sentences or less'] } }, profile_sources: [{ source: 'crystalknows', import_mode: 'public_profile_page', consent_confirmed: true }] };

test('scoreVoice : une réplique D courte et étiquetée passe, un pavé neutre échoue', () => {
  assert.ok(scoreVoice('Simulation — Quel gain pour nous, et quand ? Je décide vendredi.', dProfile).score >= 0.9);
  const bad = scoreVoice('Il serait intéressant de considérer plusieurs perspectives. Une. Deux. Trois. Quatre.', dProfile);
  assert.ok(bad.score < 0.6, JSON.stringify(bad));
});

test('conformVoice étiquette et coupe à la longueur de la persona', () => {
  assert.equal(conformVoice('Un. Deux. Trois. Quatre.', dProfile), 'Simulation — Un. Deux. Trois.');
});

test('speakWithModel : chemin modèle réel retenu quand la voix est fidèle', async () => {
  const prompts = [];
  const llm = { complete: async (req) => { prompts.push(req.messages[0].content); return { text: 'Quel gain, et quand ? Je tranche vite. Mon délai : un mois. Ensuite on verra.', provider: 'mistral' }; } };
  const out = await speakWithModel(llm, dProfile, 'offre premium');
  assert.equal(out.source, 'model');
  assert.equal(out.model_provider, 'mistral');
  assert.match(out.message, /^Simulation — Quel gain/);
  assert.equal(out.score.sentences, 3);
  assert.match(prompts[0], /VOIX DE LA PERSONA/);
  assert.match(prompts[0], /offre premium/);
});

test('speakWithModel : repli déterministe si mock, erreur ou voix infidèle', async () => {
  assert.equal((await speakWithModel(null, dProfile, 'x')).source, 'deterministic');
  assert.equal((await speakWithModel({ complete: async () => ({ text: 'x', provider: 'mock' }) }, dProfile, 'x')).source, 'deterministic');
  const err = await speakWithModel({ complete: async () => { throw new Error('429'); } }, dProfile, 'x');
  assert.equal(err.source, 'deterministic'); assert.match(err.model_error, /429/);
  const weak = await speakWithModel({ complete: async () => ({ text: 'We should consider several perspectives. According to Gartner Q3 2025, 12 % of firms do this. It is complex. The market is large.', provider: 'mistral' }) }, dProfile, 'x');
  assert.equal(weak.source, 'deterministic'); assert.ok(weak.rejected);
  assert.match(weak.message, /quel gain/);
  assert.equal(weak.rejected.score.checks.french, false);
  assert.equal(weak.rejected.score.checks.no_invented_figures, false);
});

test('scoreVoice : chiffres repris de l’idée tolérés, chiffres inventés pénalisés', () => {
  const ok = scoreVoice('Simulation — À 99 €, quel gain pour nous ?', dProfile, { idea: 'Offre à 99 €' });
  assert.equal(ok.checks.no_invented_figures, true);
  const bad = scoreVoice('Simulation — Je vise 30 % de marge, quel gain ?', dProfile, { idea: 'Offre à 99 €' });
  assert.equal(bad.checks.no_invented_figures, false);
});
