// KayrosLab — Demo : le Planner LLM genere un vrai plan via Ollama (local souverain).
// Usage : node core/planner-ollama-demo.mjs [model] ["objectif"]
import { createEngine } from './index.mjs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const model = process.argv[2] || 'llama3.2';
const goal =
  process.argv[3] ||
  "Lancer une offre d'abonnement B2B pour notre outil d'analyse strategique";

const eng = createEngine({ sovereignty: 'local', model });

console.log('=== KayrosLab · Planner LLM (Ollama) ===');
console.log('Modele    :', model);
console.log('Objectif  :', goal);
console.log('');

const t0 = Date.now();
const plan = await eng.orchestrator.plan(goal, { ideaId: 'demo', sovereignty: 'local', model });
const ms = Date.now() - t0;

console.log('generatedBy :', plan.generatedBy, `(${ms} ms)`);
console.log('etapes      :', plan.steps.length);
console.log('');
for (const s of plan.steps) {
  console.log(`  ${s.id}  [${s.agent}]  ${s.description}`);
}
console.log('');
if (plan.generatedBy === 'llm') {
  console.log('OK : plan genere par le LLM (JSON valide, agents valides, Synthesizer en dernier attendu).');
} else {
  console.log('REPLI : le LLM n a pas renvoye de JSON exploitable -> plan deterministe de secours.');
}

// Ecrit un resultat structure, independant du streaming shell (fiable pour lecture differee).
const out = { model, ms, generatedBy: plan.generatedBy, steps: plan.steps };
writeFileSync(join(tmpdir(), `kayros_result_${model.replace(/[^\w.-]/g, '_')}.json`), JSON.stringify(out, null, 2));
console.log('RESULT_FILE_WRITTEN');
