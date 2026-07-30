#!/usr/bin/env node
// Quant-aware local engine probe — real Ollama if up, soft-fallback otherwise.
// Usage: node core/quant-ollama-demo.mjs [model] ["goal"]

import { createEngine, collect } from './index.mjs';

const model = process.argv[2] || 'llama3.2';
const goal = process.argv[3] || 'Évaluer une offre B2B batteries seconde vie';

const eng = createEngine({
  sovereignty: 'local',
  model,
  quant: 'q4_K_M',
  roleQuant: { Planner: 'q5_K_M', Critic: 'q5_K_M', Synthesizer: 'q5_K_M' },
  syncAvailableQuants: true,
});

console.log('— quant guidance (cold) —');
console.log('  global:', eng.quantGuidance.global?.quant, eng.quantGuidance.global?.tier);
console.log('  resolvedDefaultModel:', eng.quantGuidance.resolvedDefaultModel);
console.log('  Planner.preferredModel:', eng.agents.Planner?.preferredModel);

const synced = await eng.syncAvailableQuants;
console.log('— after syncAvailableQuants —');
console.log('  availableQuants:', synced?.availableQuants || eng.quantGuidance.availableQuants);
console.log('  resolvedDefaultModel:', eng.quantGuidance.resolvedDefaultModel);
console.log('  Planner.preferredModel:', eng.agents.Planner?.preferredModel);

const plan = await eng.orchestrator.plan(goal, {
  ideaId: 'demo-quant',
  sovereignty: 'local',
});
console.log('— plan —', plan.generatedBy, plan.steps?.map((s) => s.agent).join(' → '));
if (plan.quant) console.log('  plan.quant.modelUsed:', plan.quant.modelUsed || plan.quant.snapshot?.resolvedDefaultModel);

const events = await collect(eng.orchestrator.run(plan, {
  governance: 'auto',
  sovereignty: 'local',
  autoDistill: true,
  distillMinFacts: 2,
}));

for (const ev of events) {
  if (ev.type === 'start') {
    console.log('[start]', ev.quant?.resolvedDefaultModel || '', 'agents:', Object.keys(ev.quant?.byAgent || {}).length);
  } else if (ev.type === 'trace') {
    const q = ev.quant?.modelUsed || ev.quant?.agent?.quant || '';
    console.log(`[trace] ${ev.agent} quant=${q}`);
  } else if (ev.type === 'distill') {
    console.log('[distill]', ev.count, ev.titles);
  } else if (ev.type === 'degraded') {
    console.log('[degraded]', ev);
  } else if (ev.type === 'final') {
    console.log('[final]', ev.status);
  } else {
    console.log(`[${ev.type}]`);
  }
}

if (eng.layered) {
  const canvas = eng.layered.getWorkingCanvas('demo-quant', { includeOffloaded: true });
  console.log('— L0 canvas stats —', canvas.stats);
}

console.log('done.');
