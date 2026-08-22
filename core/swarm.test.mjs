import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentRegistry,
  SwarmService,
  aggregateSwarmConsensus,
  applyRulePatchToDefinition,
  compileEffectiveAgentContext,
  normalizeAgentAnalysis,
  renderSwarmDossierMarkdown,
  resolveEffectiveRules,
} from './swarm.mjs';
import { SpecializedDecisionAgent } from './agents/specialized-agent.mjs';

const cybersec = {
  agent_id: 'custom_cybersec_lead',
  role_name: 'Lead Cybersecurity & Penetration Auditor',
  department: 'Information Security',
  seniority: 'executive',
  primary_focus: 'Evaluate vulnerability vectors, encryption protocols, and zero-trust alignment.',
  veto_power: true,
  rule_configuration: {
    system_proposed_rules: [
      { rule_id: 'RULE_SEC_01', rule_text: 'Enforce end-to-end encryption.', status: 'active' },
      { rule_id: 'RULE_SEC_02', rule_text: 'Require a third-party penetration test.', status: 'active' },
    ],
    user_added_rules: [
      { rule_id: 'USR_SEC_SOC2', rule_text: 'Enforce SOC2 Type II checks on cloud dependencies.' },
      { rule_id: 'USR_SEC_REST', rule_text: 'Block unencrypted REST APIs.' },
    ],
    user_modified_rules: [],
  },
};

test('AgentRegistry creates a tenant-scoped user-defined agent', () => {
  const registry = new AgentRegistry();
  const created = registry.create(cybersec, { tenantId: 'acme' });
  assert.equal(created.agent_type, 'user_defined');
  assert.equal(created.veto_power, true);
  assert.equal(registry.get('custom_cybersec_lead', { tenantId: 'other' }), null);
});

test('three-layer rule engine disables, replaces and extends system rules', () => {
  const registry = new AgentRegistry();
  const updated = registry.updateRules('cfo', {
    disabled_rules: ['RULE_CFO_02'],
    modified_rules: { RULE_CFO_01: 'Apply P10/P50/P90 only above EUR 100k.' },
    added_rules: ['Factor carbon-credit offsets into gross margin.'],
  });
  const effective = resolveEffectiveRules(updated);
  assert.equal(effective.some((r) => r.rule_id === 'RULE_CFO_02'), false);
  assert.equal(effective.find((r) => r.rule_id === 'RULE_CFO_01').origin, 'user_modified');
  assert.match(compileEffectiveAgentContext(updated), /carbon-credit/);
});

test('configuration overrides are validated without mutating the registry', () => {
  const registry = new AgentRegistry();
  const base = registry.get('legal_counsel');
  const effective = applyRulePatchToDefinition(base, {
    disabled_rules: ['RULE_LEG_03'],
    modified_rules: { RULE_LEG_02: 'Audit commercial open-source risk only.' },
  });
  assert.equal(resolveEffectiveRules(effective).some((r) => r.rule_id === 'RULE_LEG_03'), false);
  assert.equal(resolveEffectiveRules(base).some((r) => r.rule_id === 'RULE_LEG_03'), true);
});

test('explicit agent veto blocks every threshold and remains human-arbitrated', () => {
  const analyses = [
    { agent_id: 'cfo', verdict: 'GO', veto_power: false, seniority: 'executive' },
    { agent_id: 'custom_cybersec_lead', verdict: 'NO_GO', veto_power: true, seniority: 'executive', primary_reason: 'unencrypted API' },
    { agent_id: 'cto', verdict: 'GO', veto_power: false, seniority: 'executive' },
  ];
  for (const threshold of ['unanimous', 'majority', 'veto_power_csuite']) {
    const result = aggregateSwarmConsensus(analyses, threshold);
    assert.equal(result.verdict, 'NO_GO');
    assert.equal(result.veto.agent_id, 'custom_cybersec_lead');
    assert.equal(result.requires_human_arbitration, true);
  }
});

test('unparseable output is downgraded to CONDITIONAL_GO', () => {
  const normalized = normalizeAgentAnalysis('A narrative with no formal decision.', { agent_id: 'cfo' });
  assert.equal(normalized.verdict, 'CONDITIONAL_GO');
  assert.match(normalized.unverified_assumptions[0], /parsable formal verdict/);
});

test('built-in agent becomes a personality-enriched hybrid with consent', async () => {
  const service = new SwarmService();
  const assigned = service.assignPersonality('cfo', {
    assigned_name: 'Jean Dupont', disc_type: 'DC', behavioral_archetype: 'Skeptic',
    skepticism_factor: 'High', core_motivators: ['Fiscal discipline'],
    communication_style: { tone: 'Direct', communication_directives: ['Lead with hard numbers'] },
    consent_confirmed: true,
    profile_sources: [{ source: 'manual', import_mode: 'manual', consent_confirmed: true, fields: ['disc_type'] }],
  });
  assert.equal(assigned.agent_type, 'hybrid_modified');
  assert.equal(assigned.base_agent_id, 'cfo');

  const config = service.createConfiguration({
    swarm_id: 'persona_audit', swarm_name: 'Persona audit', active_agents: ['cfo'],
    voting_threshold: 'unanimous', personality_simulation_enabled: true,
  });
  const run = await service.run(config.swarm_id, { question: 'Invest?', agentResults: {
    cfo: {
      verdict: 'CONDITIONAL_GO', primary_reason: 'Payback evidence is incomplete.',
      simulated_stakeholder_feedback: 'Show me the downside case before I approve.',
      strengths_opportunities: [], critical_risks: ['Slow payback'], metrics: [],
      required_mitigations: ['Provide P10/P50/P90.'], unverified_assumptions: [],
    },
  } });
  assert.equal(run.analyses[0].assigned_human, 'Jean Dupont');
  assert.equal(run.analyses[0].disc_type, 'DC');
  assert.match(renderSwarmDossierMarkdown(run), /Simulated Stakeholder Reaction/);
  assert.match(renderSwarmDossierMarkdown(run), /Jean Dupont/);
});

test('personality-enabled configuration refuses profile data without consent', () => {
  const service = new SwarmService();
  assert.throws(() => service.createConfiguration({
    swarm_id: 'no_consent', swarm_name: 'No consent', active_agents: ['cfo'],
    voting_threshold: 'majority', personality_simulation_enabled: true,
    agent_rule_overrides: {
      cfo: { assigned_human: 'Private Person', disc_type: 'D' },
    },
  }), /consentement/);
});

test('v6 compact override accepts supplied LinkedIn/Crystal Markdown links', async () => {
  const service = new SwarmService();
  const config = service.createConfiguration({
    swarm_id: 'compact_persona', swarm_name: 'Compact persona', active_agents: ['cfo'],
    voting_threshold: 'unanimous', personality_simulation_enabled: true,
    agent_rule_overrides: { cfo: {
      assigned_human: 'Jean Dupont (CFO)', disc_type: 'DC', consent_confirmed: true,
      linkedin_profile: '[LinkedIn](https://linkedin.com/in/jeandupont-cfo)',
      crystalknows_url: '[Crystal](https://www.crystalknows.com/p/jeandupont)',
      modified_rules: { RULE_CFO_01: 'Model OPEX above EUR 50k.' },
    } },
  });
  const run = await service.run(config.swarm_id, { question: 'Launch?', agentResults: {
    cfo: { verdict: 'GO', primary_reason: 'Evidence accepted.', simulated_stakeholder_feedback: 'Proceed.', metrics: [] },
  } });
  assert.equal(run.analyses[0].assigned_human, 'Jean Dupont (CFO)');
  assert.equal(run.analyses[0].agent_type, 'hybrid_modified');
  assert.equal(run.analyses[0].disc_type, 'DC');
});

test('personality prompt uses behavioral directives without leaking source URLs', async () => {
  let request;
  const agent = new SpecializedDecisionAgent({
    definition: {
      agent_id: 'cfo', role_name: 'CFO', department: 'Finance', seniority: 'executive',
      primary_focus: 'ROI', veto_power: false,
      human_profile: {
        assigned_name: 'Jean Dupont', disc_type: 'DC', consent_confirmed: true,
        linkedin_url: 'https://www.linkedin.com/in/jeandupont-cfo',
        communication_style: { tone: 'Direct', decision_triggers: ['Hard evidence'] },
      },
    },
    effectiveContext: '- test rule', personalityEnabled: true,
    llm: { complete: async (req) => { request = req; return { text: '{"verdict":"GO"}' }; } },
  });
  await agent.executeDecision({ question: 'Launch?' });
  const system = request.messages.find((m) => m.role === 'system').content;
  assert.match(system, /Assigned stakeholder: Jean Dupont/);
  assert.match(system, /Decision triggers: Hard evidence/);
  assert.doesNotMatch(system, /linkedin\.com/);
  assert.match(system, /not a factual identity claim/);
});

test('SwarmService runs attached scenario, renders dossier and enforces override justification', async () => {
  const service = new SwarmService();
  service.registry.create(cybersec);
  const config = service.createConfiguration({
    swarm_id: 'enterprise_launch', swarm_name: 'Enterprise SaaS Launch Audit',
    active_agents: ['cfo', 'cto', 'legal_counsel', 'custom_cybersec_lead'],
    voting_threshold: 'majority',
    agent_rule_overrides: {
      cfo: { disabled_rules: ['RULE_CFO_02'], added_rules: ['Cap seed budget at EUR 200,000.'] },
    },
  });
  const go = (reason) => ({ verdict: 'GO', primary_reason: reason, strengths_opportunities: ['viable'], critical_risks: [], metrics: [], required_mitigations: [], unverified_assumptions: [] });
  const run = await service.run(config.swarm_id, {
    question: 'Should we launch?',
    agentResults: {
      cfo: { ...go('budget controlled'), verdict: 'CONDITIONAL_GO', required_mitigations: ['Cap budget.'] },
      cto: go('architecture scales'),
      legal_counsel: { ...go('documentation pending'), verdict: 'CONDITIONAL_GO', required_mitigations: ['Finalize AI Act dossier.'] },
      custom_cybersec_lead: { ...go('unencrypted API'), verdict: 'NO_GO', critical_risks: ['SOC2 violation'], required_mitigations: ['Enforce mTLS.'] },
    },
  });
  assert.equal(run.consensus.verdict, 'NO_GO');
  assert.equal(run.status, 'pending_human_arbitration');
  assert.match(renderSwarmDossierMarkdown(run), /Enterprise SaaS Launch Audit/);
  assert.throws(() => service.arbitrate(run.run_id, { action: 'override_veto', by: 'ceo', decision: 'GO' }), /justification/);
  const arbitrated = service.arbitrate(run.run_id, { action: 'override_veto', by: 'ceo', decision: 'GO', justification: 'Accepted temporary risk with mTLS gate.' });
  assert.equal(arbitrated.status, 'overridden_human');
  assert.equal(arbitrated.human_decision.verdict, 'GO');
});
