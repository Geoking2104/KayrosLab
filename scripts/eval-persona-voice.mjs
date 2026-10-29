#!/usr/bin/env node
// Évalue la voix des personas avec un VRAI modèle (pas le repli déterministe).
// Usage : NVIDIA_API_KEY=… node scripts/eval-persona-voice.mjs   (NVIDIA_MODEL optionnel)
// Sortie : score de fidélité par persona × idée, part de répliques modèle retenues.
import { readFileSync } from 'node:fs';
import { OpenAICompatibleProvider } from '../core/kayros-llm.mjs';
import { profileFromCrystalPublic } from '../core/profile-enrichment.mjs';
import { profileFromCrystalData } from '../core/personality.mjs';
import { speakWithModel } from '../core/impersonator-voice.mjs';

if (!process.env.NVIDIA_API_KEY) { console.error('NVIDIA_API_KEY absent : évaluation impossible sans modèle réel.'); process.exit(2); }
const llm = new OpenAICompatibleProvider({
  id: 'nvidia', baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY, apiKeyEnv: 'NVIDIA_API_KEY',
  defaultModel: process.env.NVIDIA_MODEL || 'openai/gpt-oss-20b', maxTokens: 900, timeoutMs: 60000,
});
const fx = (f) => new URL(`../core/fixtures/${f}`, import.meta.url);
const personas = {
  'geoffroy2104 (D, page publique)': profileFromCrystalPublic(readFileSync(fx('crystal-public-geoffroy2104.html'), 'utf8')),
  'pjones (C, API v4)': profileFromCrystalData(JSON.parse(readFileSync(fx('crystal-v4-profile-pjones.json'), 'utf8')), { import_mode: 'api_v4' }),
};
const ideas = ['Lancer une offre premium à 99 €', 'Réorganiser l’équipe support en deux pôles', 'Repousser la sortie produit de trois mois'];
const rows = [];
for (const [name, profile] of Object.entries(personas)) {
  for (const idea of ideas) {
    const out = await speakWithModel(llm, profile, idea);
    rows.push({ persona: name, idea, source: out.source, score: out.score.score, message: out.message, rejected: out.rejected?.score?.score ?? null, error: out.model_error ?? null });
  }
}
for (const r of rows) console.log(`${r.source === 'model' ? '✔' : '↺'} [${r.score}] ${r.persona} · ${r.idea}\n   ${r.message}${r.rejected != null ? `\n   (réplique modèle rejetée : ${r.rejected})` : ''}${r.error ? `\n   (erreur : ${r.error})` : ''}`);
const kept = rows.filter((r) => r.source === 'model').length;
console.log(`\nRépliques modèle retenues : ${kept}/${rows.length} · score moyen ${(rows.reduce((s, r) => s + r.score, 0) / rows.length).toFixed(2)}`);
