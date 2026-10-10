import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DESCRIPTIF_SECTIONS, canonicalDisc, descriptifContext, descriptifFromCrystal, descriptifFromDisc, discWheelAngle, normalizeDescriptif,
} from './personality-descriptif.mjs';
import { agentAttributesFromProfile, profileFromCrystalData, profileFromDiscType } from './personality.mjs';
import { behavioralContext } from './swarm.mjs';

const live = async () => JSON.parse(await readFile(new URL('./fixtures/crystal-v4-profile-pjones.json', import.meta.url), 'utf8'));

test('descriptif : types DISC canoniques et position sur la roue', () => {
  assert.deepEqual(['dc', 'DI', 'sc', 'C', 'x'].map(canonicalDisc), ['Dc', 'DI', 'Sc', 'C', null]);
  assert.equal(discWheelAngle('D'), 315);
  assert.equal(discWheelAngle('I'), 45);
  assert.equal(discWheelAngle('C'), 225);
});

test('descriptif : modèle DISC complet, original et modifiable', () => {
  const d = descriptifFromDisc('Sc');
  assert.equal(d.source, 'disc_template');
  assert.equal(d.archetype, 'Soutien–Analyste');
  for (const section of DESCRIPTIF_SECTIONS) assert.ok(d.sections[section.id]?.length >= 3, section.id);
  assert.ok(d.traits.risk_aversion > 60 && d.traits.pace < 40);
  assert.equal(Object.keys(d.traits).length, 8);
});

test('descriptif : prérempli depuis la réponse Crystal v4 réelle, sections manquantes complétées', async () => {
  const d = descriptifFromCrystal(await live());
  assert.equal(d.source, 'crystalknows');
  assert.equal(d.disc_type, 'C');
  assert.equal(d.archetype, 'Analyst');
  assert.equal(d.disc_intensity, 81);
  assert.equal(d.traits.risk_aversion, 83);
  assert.ok(d.sections.building_trust.includes('Provide detailed feedback'));
  assert.ok(d.sections.dont.some((item) => /emotional/.test(item)));
  // « Par écrit » n'existe pas chez Crystal : complété par le modèle DISC C.
  assert.ok(d.sections.emails.length > 0);
  const profile = profileFromCrystalData(await live());
  assert.equal(profile.descriptif.disc_type, 'C');
  assert.equal(agentAttributesFromProfile(profile).behavioral_profile.descriptif.source, 'crystalknows');
});

test('descriptif : type DISC manuel → descriptif dans les attributs proposés', () => {
  const attrs = agentAttributesFromProfile(profileFromDiscType('Di', { assigned_name: 'Claire Martin' }));
  assert.equal(attrs.behavioral_profile.descriptif.disc_type, 'Di');
  assert.ok(attrs.behavioral_profile.descriptif.sections.communication.length >= 3);
});

test('descriptif : normalisation (bornes, sections inconnues retirées) et injection dans le contexte', () => {
  const d = normalizeDescriptif({ disc_type: 'c', traits: { pace: 140, skepticism: -3, foo: 3 }, sections: { communication: [' Chiffrer ', '', 'Chiffrer'], inconnu: ['x'] }, overview: 'Exigeant.' });
  assert.deepEqual(d.traits, { skepticism: 0, pace: 100 });
  assert.deepEqual(d.sections, { communication: ['Chiffrer'] });
  const ctx = descriptifContext(d);
  assert.match(ctx, /Descriptif de personnalité/);
  assert.match(ctx, /Comment lui parler : Chiffrer/);
  assert.match(ctx, /Posé ↔ Rapide : 100\/100/);
  const full = behavioralContext({ disc_type: 'C', descriptif: d });
  assert.match(full, /Profil DISC: C/);
  assert.match(full, /Vue d'ensemble : Exigeant\./);
  assert.doesNotMatch(full, /\[object Object\]/);
});

test('descriptif : intensité absente reste absente (pas 0)', () => {
  assert.equal(descriptifFromDisc('D').disc_intensity, undefined);
  assert.equal(normalizeDescriptif({ disc_type: 'D', disc_intensity: null }).disc_intensity, undefined);
});
