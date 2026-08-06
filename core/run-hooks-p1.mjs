// P1 hooks for orchestrator.run — novelty control + dialectic (opt-in).
import { runTournament, packetFieldsFromContest } from './dialectic.mjs';
import { runNoveltyControl, optionsFromNoveltyResult } from './novelty-controller.mjs';

export async function runP1Hooks({ plan, opts, agentOutputs, contextBlock, agents, memory }) {
  const events = [];
  let survivingOptions = opts.survivingOptions || null;
  let killedOptions = opts.killedOptions || null;
  let residualRisks = opts.residualRisks || null;

  if (opts.noveltyControl && Array.isArray(opts.collisions) && opts.collisions.length) {
    try {
      const nov = await runNoveltyControl(opts.collisions, {
        embeddings: opts.embeddings || memory?.embeddings || null,
        inputText: plan.goal,
        memoryHits: opts.memoryHits || [],
        maxRounds: opts.noveltyMaxRounds ?? 2,
        minMedianNovelty: opts.minMedianNovelty ?? 0.35,
        generateMore: opts.generateMore || null,
      });
      events.push({
        type: 'novelty_control',
        ideaId: plan.ideaId,
        stats: nov.stats,
        rounds: nov.rounds,
        survivors: nov.survivors.length,
        killed: nov.killed.length,
        ts: new Date().toISOString(),
      });
      const mapped = optionsFromNoveltyResult(nov);
      survivingOptions = mapped.survivingOptions;
      killedOptions = mapped.killedOptions;
    } catch { /* soft */ }
  }

  if (opts.dialectic === true || opts.dialectic === 'agents') {
    try {
      const seeds = (survivingOptions && survivingOptions.length)
        ? survivingOptions
        : agentOutputs
          .filter((o) => /bisoci|builder|scenario|position/i.test(o.agent || ''))
          .map((o, i) => ({ id: `ao-${i}`, claim: String(o.output || '').slice(0, 400), agent: o.agent }));
      if (seeds.length) {
        const tour = await runTournament(seeds.slice(0, opts.dialecticMaxOptions ?? 5), {
          maxSurvivors: opts.dialecticMaxSurvivors ?? 2,
          world: opts._lastPositionning || {},
          attacker: opts.dialectic === 'agents' ? agents?.RedTeam : null,
          defender: opts.dialectic === 'agents' ? agents?.Critic : null,
          goal: plan.goal,
          context: contextBlock,
          provider: opts.provider,
          sovereignty: opts.sovereignty,
        });
        events.push({
          type: 'dialectic',
          ideaId: plan.ideaId,
          stats: tour.stats,
          survivors: tour.survivors,
          killed: tour.killed.map((k) => ({ id: k.id, killReason: k.killReason })),
          ts: new Date().toISOString(),
        });
        const fields = packetFieldsFromContest({ tournamentResult: tour });
        survivingOptions = fields.survivingOptions;
        killedOptions = [...(killedOptions || []), ...fields.killedOptions];
        residualRisks = fields.residualRisks;
      }
    } catch { /* soft */ }
  }

  return { events, survivingOptions, killedOptions, residualRisks };
}
