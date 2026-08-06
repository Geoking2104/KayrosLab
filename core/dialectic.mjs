// KayrosLab — Dialectical contest (P1).
import { tagEpistemic, tagAgentOutput, aggregateEpistemic } from './epistemic.mjs';

export function asOption(input, idx = 0) {
  if (!input) return { id: `opt-${idx}`, claim: '', source: 'unknown' };
  if (typeof input === 'string') return { id: `opt-${idx}`, claim: input, source: 'text' };
  return {
    id: input.id || `opt-${idx}`,
    claim: input.claim || input.summary || input.proposal || input.output || input.text || '',
    source: input.source || input.agent || 'agent',
    meta: input.meta || input,
    novelty: input.novelty,
    axis: input.axis,
  };
}

export function heuristicAttack(option, world = {}) {
  const claim = option.claim || '';
  const attacks = [
    { id: 'a-evidence', type: 'evidence_gap', severity: 0.6, text: `Insufficient grounded evidence that "${clip(claim, 80)}" survives contact with real buyers/regulators.` },
    { id: 'a-competitor', type: 'competition', severity: world.degraded ? 0.7 : 0.5, text: world.competitorCount ? `At least ${world.competitorCount} nearby players may absorb the value proposition before scale.` : 'Competitive landscape is weakly observed — copy risk is under-specified.' },
    { id: 'a-execution', type: 'execution', severity: 0.55, text: 'Execution depends on scarce skills / partners not proven in packet.' },
  ];
  if (/ai|llm|model|data/i.test(claim)) {
    attacks.push({ id: 'a-reg', type: 'regulation', severity: 0.65, text: 'Data/AI compliance (residency, opacity, liability) can block go-to-market.' });
  }
  if (option.novelty != null && option.novelty < 0.35) {
    attacks.push({ id: 'a-novelty', type: 'novelty', severity: 0.7, text: 'Low novelty score: idea may be incremental vs alternatives already killed or known.' });
  }
  return {
    optionId: option.id, attacks, attacker: 'heuristic-redteam',
    epistemic: tagEpistemic(attacks.map((a) => a.text).join(' '), { level: 'inferred', source: 'agent', sourceId: 'RedTeam', kind: 'risk' }),
  };
}

export function heuristicRebut(option, attackResult = {}) {
  const rebuttals = (attackResult.attacks || []).map((a) => {
    let text = 'Acknowledged; requires pilot evidence.';
    if (a.type === 'competition') text = 'Differentiation may hold if scope is narrow and speed-to-pilot is high; still unproven.';
    else if (a.type === 'regulation') text = 'Scope can start in low-sensitivity data domains; legal design needed before scale.';
    else if (a.type === 'novelty') text = 'Incremental can be acceptable if ROI is clear; not a pure novelty bet.';
    else if (a.type === 'evidence_gap') text = 'Propose a falsifying pilot KPI within 30–60 days.';
    return { attackId: a.id, type: a.type, text, residualSeverity: Math.max(0.15, (a.severity || 0.5) * 0.7) };
  });
  return {
    optionId: option.id, rebuttals, defender: 'heuristic-builder',
    epistemic: tagEpistemic(rebuttals.map((r) => r.text).join(' '), { level: 'hypothesized', source: 'agent', sourceId: 'Builder', kind: 'claim' }),
  };
}

export async function attackOption(option, opts = {}) {
  const opt = asOption(option);
  if (opts.attacker && typeof opts.attacker.execute === 'function') {
    try {
      const res = await opts.attacker.execute(`Attack this strategic option. List concrete failure modes with severity.\n\nOPTION:\n${opt.claim}`, opts);
      return {
        optionId: opt.id,
        attacks: parseAttackList(res.output || res.text || ''),
        attacker: opts.attacker.name || 'RedTeam', raw: res.output, degraded: res.degraded || null,
        epistemic: tagAgentOutput(opts.attacker.name || 'RedTeam', res.output, { degraded: res.degraded }),
      };
    } catch { /* fall through */ }
  }
  return heuristicAttack(opt, opts.world || {});
}

export async function rebutOption(option, attackResult, opts = {}) {
  const opt = asOption(option);
  if (opts.defender && typeof opts.defender.execute === 'function') {
    try {
      const attackText = (attackResult.attacks || []).map((a) => `- ${a.text}`).join('\n');
      const res = await opts.defender.execute(`Rebut these attacks briefly. Keep residual risks honest.\n\nOPTION:\n${opt.claim}\n\nATTACKS:\n${attackText}`, opts);
      return {
        optionId: opt.id,
        rebuttals: parseRebutList(res.output || res.text || '', attackResult.attacks || []),
        defender: opts.defender.name || 'Builder', raw: res.output, degraded: res.degraded || null,
        epistemic: tagAgentOutput(opts.defender.name || 'Builder', res.output, { degraded: res.degraded }),
      };
    } catch { /* fall through */ }
  }
  return heuristicRebut(opt, attackResult);
}

function parseAttackList(text) {
  const lines = String(text).split(/\n+/).map((l) => l.replace(/^\s*[-*•\d.]+\s*/, '').trim()).filter((l) => l.length > 15);
  if (!lines.length) return heuristicAttack(asOption(text)).attacks;
  return lines.slice(0, 8).map((t, i) => ({ id: `a-llm-${i}`, type: 'llm', severity: 0.55, text: t.slice(0, 280) }));
}

function parseRebutList(text, attacks) {
  const lines = String(text).split(/\n+/).map((l) => l.replace(/^\s*[-*•\d.]+\s*/, '').trim()).filter((l) => l.length > 10);
  return (attacks || []).map((a, i) => ({
    attackId: a.id, type: a.type,
    text: lines[i] || lines[0] || 'Partial acknowledgment; residual risk remains.',
    residualSeverity: Math.max(0.2, (a.severity || 0.5) * 0.75),
  }));
}

export function scoreSurvival(option, attackResult, rebutResult) {
  const attacks = attackResult?.attacks || [];
  const rebuttals = rebutResult?.rebuttals || [];
  if (!attacks.length) return { optionId: option.id, survival: 0.5, residualRisk: 0.5, kill: false, reasons: ['no_attacks'] };
  let residual = 0;
  const scoredAttacks = [];
  for (const a of attacks) {
    const reb = rebuttals.find((r) => r.attackId === a.id);
    const sev = reb?.residualSeverity != null ? reb.residualSeverity : (a.severity ?? 0.6);
    residual += sev;
    scoredAttacks.push({ code: a.type || 'attack', text: a.text, residualSeverity: sev });
  }
  residual /= attacks.length;
  scoredAttacks.sort((a, b) => b.residualSeverity - a.residualSeverity);
  const reasons = [];
  for (const s of scoredAttacks) {
    if (s.residualSeverity >= 0.4 || reasons.length === 0) reasons.push(s);
  }
  const survival = Math.max(0, Math.min(1, 1 - residual));
  return {
    optionId: option.id,
    survival: +survival.toFixed(4),
    residualRisk: +residual.toFixed(4),
    kill: survival < 0.35,
    reasons,
    novelty: option.novelty,
  };
}

export async function contestOption(option, opts = {}) {
  const opt = asOption(option);
  const rounds = opts.rounds ?? 1;
  let attackResult = null, rebutResult = null, survival = null;
  for (let r = 0; r < rounds; r++) {
    attackResult = await attackOption(opt, opts);
    rebutResult = await rebutOption(opt, attackResult, opts);
    survival = scoreSurvival(opt, attackResult, rebutResult);
  }
  return {
    option: opt, attack: attackResult, rebut: rebutResult, survival,
    killed: !!survival?.kill,
    killReason: survival?.kill
      ? { code: 'failed_dialectic', reasons: survival.reasons, residualRisk: survival.residualRisk }
      : null,
  };
}

export async function runTournament(options = [], opts = {}) {
  const list = options.map((o, i) => asOption(o, i));
  const results = [];
  for (const opt of list) results.push(await contestOption(opt, opts));
  const ranked = [...results].sort((a, b) => (b.survival?.survival ?? 0) - (a.survival?.survival ?? 0));
  const maxSurvivors = opts.maxSurvivors ?? Math.max(1, Math.ceil(list.length / 2));
  const survivors = [], killed = [];
  for (const r of ranked) {
    if (r.killed || survivors.length >= maxSurvivors) {
      killed.push({
        id: r.option.id, summary: r.option.claim,
        killReason: r.killReason || { code: 'tournament_cut', survival: r.survival?.survival },
        survival: r.survival,
      });
    } else {
      survivors.push({
        id: r.option.id, summary: r.option.claim,
        survival: r.survival?.survival, residualRisk: r.survival?.residualRisk,
        novelty: r.option.novelty, axis: r.option.axis,
        contest: { attacks: r.attack?.attacks?.length || 0, residualReasons: r.survival?.reasons || [] },
      });
    }
  }
  const residualRisks = killed.flatMap((k) => (k.killReason?.reasons || []).map((x) => x.text || x.code)).filter(Boolean).slice(0, 12);
  return {
    survivors, killed, results: ranked, residualRisks,
    stats: { input: list.length, survivorCount: survivors.length, killedCount: killed.length, bestSurvival: survivors[0]?.survival ?? null },
    epistemic: aggregateEpistemic(ranked.map((r) => r.attack?.epistemic).filter(Boolean)),
  };
}

export function packetFieldsFromContest({ noveltyResult, tournamentResult } = {}) {
  const survivingOptions = tournamentResult?.survivors
    || noveltyResult?.survivors?.map((s) => ({ id: s.id, summary: s.proposal || s.text, novelty: s.novelty }))
    || [];
  const killedOptions = [
    ...(noveltyResult?.killed || []).map((k) => ({ id: k.id, summary: k.proposal || k.text, killReason: k.killReason })),
    ...(tournamentResult?.killed || []),
  ];
  return { survivingOptions, killedOptions, residualRisks: tournamentResult?.residualRisks || [] };
}

function clip(s, n) {
  const t = String(s || '');
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}
