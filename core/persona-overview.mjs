// KayrosLab — Page persona en lecture seule (P6).
//
// Agrège, sans rien écrire, ce que l'on sait d'une persona : activité (runs auxquels elle a
// participé), vetos émis, décisions humaines (decisionsTimeline de core/arbitrage.mjs) et mémoire
// (base publique visitée, profil, derniers motifs). Pure : les runs viennent du SwarmService.

import { decisionsTimeline } from './arbitrage.mjs';

const HUMAN_TO_DECISION = { approved_human: 'GO', rejected_human: 'NO_GO', conditional_human: 'CONDITIONAL_GO', overridden_human: 'OVERRIDE', reevaluation_requested: 'REEVALUATE' };

export function buildPersonaOverview(agent, runs = [], { limit = 50 } = {}) {
  if (!agent?.agent_id) throw new Error('persona introuvable');
  const id = agent.agent_id;
  const mine = (Array.isArray(runs) ? runs : [])
    .map((run) => ({ run, analysis: (run?.analyses || []).find((a) => a.agent_id === id) }))
    .filter((x) => x.analysis)
    .sort((a, b) => String(b.run.created_at).localeCompare(String(a.run.created_at)));
  const activity = mine.slice(0, limit).map(({ run, analysis }) => ({
    run_id: run.run_id, swarm_id: run.swarm_id ?? null, question: String(run.question || '').slice(0, 300),
    verdict: analysis.verdict, primary_reason: analysis.primary_reason ?? null,
    consensus: run.consensus?.verdict ?? null, status: run.status ?? null, at: run.created_at ?? null,
  }));
  const vetoes = mine.filter(({ analysis }) => analysis.verdict === 'NO_GO' && analysis.veto_power)
    .slice(0, limit).map(({ run, analysis }) => ({ run_id: run.run_id, question: String(run.question || '').slice(0, 300), reason: analysis.primary_reason ?? null, at: run.created_at ?? null, human_decision: run.human_decision ?? null }));
  const decisions = decisionsTimeline({ decisions: mine.filter(({ run }) => run.human_decision).map(({ run }, i) => ({
    seq: i + 1, decision: HUMAN_TO_DECISION[run.status] || run.human_decision.action, by: run.human_decision.by,
    reason: run.human_decision.justification || '', run_id: run.run_id, ts: run.human_decision.decided_at,
  })) }).slice(0, limit);
  const meta = agent.metadata || {};
  const imp = meta.impersonator || agent.impersonator || {};
  return {
    read_only: true,
    persona: {
      agent_id: id, display_name: agent.display_name ?? null, role_name: agent.role_name ?? null, department: agent.department ?? null,
      veto_power: !!agent.veto_power, status: agent.status ?? null, tools: agent.tools || [],
      skills: (meta.skills || []).map((s) => ({ id: s.id ?? null, name: s.name })),
      source: imp.source ?? null, consent_confirmed: imp.consent_confirmed !== false,
    },
    activity, vetoes, decisionsTimeline: decisions,
    memory: {
      public_sources: imp.public_sources || [],
      public_evidence: (imp.public_evidence || meta.public_evidence || []).map((e) => ({ url: e.url, status: e.status ?? null, title: e.title ?? null, excerpt: e.excerpt ?? null, fetched_at: e.fetched_at ?? null, sha256: e.sha256 ?? null })),
      profile_summary: agent.behavioral_profile?.profile_summary || agent.human_profile?.profile_summary || [],
      recent_reasons: activity.map((a) => a.primary_reason).filter(Boolean).slice(0, 10),
    },
    counts: { runs: mine.length, vetoes: vetoes.length, decisions: decisions.length },
  };
}
