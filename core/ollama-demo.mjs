// Démo : le cœur « LLM gouverné » de KayrosLab branché sur un vrai Ollama local.
//
// Prérequis (sur TA machine, pas dans le bac à sable) :
//   1. Ollama lancé (il l'est déjà : http://localhost:11434)
//   2. Un modèle installé, ex :  ollama pull llama3.2
//
// Lancer :  node core/ollama-demo.mjs [modele]
//   ex :    node core/ollama-demo.mjs llama3.2
//
// Ce script fait de VRAIS appels LLM (un par étape de l'orchestrateur),
// puis passe par un gate de gouvernance (mode strict) auto-validé pour la démo.

import { createEngine } from './index.mjs';

const model = process.argv[2] || 'llama3.2';
const eng = createEngine({ sovereignty: 'local', model });

// 0. Vérifier les modèles installés
const models = await eng.llm.providers.ollama.listModels();
if (!models.length) {
  console.error('Aucun modèle Ollama installé. Lance :  ollama pull ' + model);
  process.exit(1);
}
console.log('Modèles Ollama disponibles :', models.join(', '));
console.log('Modèle utilisé :', model, '\n');

// 1. PLAN
const goal = "Évalue le risque réglementaire d'un pack batteries seconde-vie commercialisé en Europe";
const plan = await eng.orchestrator.plan(goal, { ideaId: 'demo-ollama' });
console.log('OBJECTIF :', goal, '\n' + '─'.repeat(70));

// 2. RUN gouverné (Plan-and-Solve + ReAct), mode strict
for await (const ev of eng.orchestrator.run(plan, { governance: 'strict', sovereignty: 'local' })) {
  if (ev.type === 'trace') {
    console.log(`\n[${ev.agent}]  (${ev.tokens.in}→${ev.tokens.out} tokens)`);
    console.log(String(ev.observation).slice(0, 400));
  } else if (ev.type === 'gate') {
    console.log(`\n⛩️  GATE « ${ev.gateType} » — validation humaine requise (défaut strict).`);
    eng.governance.resolve(ev.gateId, { decision: 'approve', by: 'demo', role: 'comex' });
    console.log('   → approuvé par un censeur (rôle comex).');
  } else if (ev.type === 'final') {
    console.log('\n' + '─'.repeat(70));
    console.log(`✅ FINAL [${ev.status}] ${ev.answer ?? ev.message ?? ''}`);
  } else if (ev.type === 'halt') {
    console.log(`\n⛔ HALT (${ev.reason})`);
  }
}
