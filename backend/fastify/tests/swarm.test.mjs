import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { bearer, buildTestApp, registerComex } from './test-helpers.mjs';

describe('backend specialized agent swarm', () => {
  let app; let ctx; let token;
  beforeEach(async () => {
    ({ app, ctx } = await buildTestApp());
    await registerComex(ctx);
    token = await bearer(ctx, 'comex@test.local', 'secret1234');
    ctx.engine.swarm.llm = {
      complete: async (req) => ({
        text: JSON.stringify(req.role === 'custom_cybersec_lead'
          ? {
            verdict: 'NO_GO', primary_reason: 'Unencrypted REST endpoint.',
            strengths_opportunities: [], critical_risks: ['SOC2 violation'], metrics: [],
            required_mitigations: ['Enforce mTLS.'], unverified_assumptions: [],
          }
          : {
            verdict: 'GO', primary_reason: 'No blocking issue in this department.',
            simulated_stakeholder_feedback: req.role === 'cfo' ? 'Show me the downside case first.' : '',
            strengths_opportunities: ['viable'], critical_risks: [], metrics: [],
            required_mitigations: [], unverified_assumptions: [],
          }),
        usage: { tokensIn: 1, tokensOut: 1 },
      }),
    };
  });
  afterEach(async () => { if (app) await app.close(); });

  it('creates, runs, renders and human-arbitrates a vetoed swarm', async () => {
    const auth = { authorization: `Bearer ${token}` };
    const agent = await app.inject({
      method: 'POST', url: '/v1/swarm/agents', headers: auth,
      payload: {
        agent_id: 'custom_cybersec_lead', role_name: 'Lead Cybersecurity Auditor',
        department: 'Information Security', seniority: 'executive', veto_power: true,
        primary_focus: 'Evaluate encryption and zero-trust alignment.',
        rule_configuration: {
          system_proposed_rules: [{ rule_id: 'RULE_SEC_01', rule_text: 'Enforce encryption.', status: 'active' }],
          user_added_rules: [{ rule_id: 'USR_SEC_01', rule_text: 'Block unencrypted REST APIs.' }],
        },
      },
    });
    assert.equal(agent.statusCode, 201, agent.body);

    const personality = await app.inject({
      method: 'POST', url: '/v1/swarm/agents/cfo/personality/import', headers: auth,
      payload: {
        consent_confirmed: true,
        imports: [
          {
            source: 'linkedin', profile_url: 'https://linkedin.com/in/sarahjenkins-finance',
            profile_data: { localizedFirstName: 'Sarah', localizedLastName: 'Jenkins', localizedHeadline: 'CFO', vanityName: 'sarahjenkins-finance' },
          },
          {
            source: 'crystalknows', linkedin_url: 'https://linkedin.com/in/sarahjenkins-finance',
            profile_data: { data: {
              first_name: 'Sarah', last_name: 'Jenkins', url: 'https://www.crystalknows.com/p/sarahjenkins',
              personalities: { disc_type: 'Di', archetype: 'Driver' },
              content: { communication: { phrase: ['Lead with ROI'] }, motivation: { phrase: ['Fast growth'] } },
            } },
          },
        ],
      },
    });
    assert.equal(personality.statusCode, 201, personality.body);
    assert.equal(personality.json().agent_type, 'hybrid_modified');
    assert.equal(personality.json().human_profile.disc_type, 'Di');

    const config = await app.inject({
      method: 'POST', url: '/v1/swarm/configurations', headers: auth,
      payload: {
        swarm_id: 'launch_audit', swarm_name: 'Launch Audit',
        active_agents: ['cfo', 'cto', 'custom_cybersec_lead'],
        voting_threshold: 'majority',
        personality_simulation_enabled: true,
        agent_rule_overrides: { cfo: { disabled_rules: ['RULE_CFO_02'] } },
      },
    });
    assert.equal(config.statusCode, 201, config.body);

    const executed = await app.inject({
      method: 'POST', url: '/v1/swarm/configurations/launch_audit/run', headers: auth,
      payload: { question: 'Should the service launch?', context: 'REST endpoint is not encrypted.' },
    });
    assert.equal(executed.statusCode, 202, executed.body);
    const run = executed.json();
    assert.equal(run.consensus.verdict, 'NO_GO');
    assert.equal(run.status, 'pending_human_arbitration');
    assert.equal(run.analyses.find((a) => a.agent_id === 'cfo').assigned_human, 'Sarah Jenkins');
    assert.equal(run.analyses.find((a) => a.agent_id === 'cfo').disc_type, 'Di');

    const dossier = await app.inject({ method: 'GET', url: `/v1/swarm/runs/${run.run_id}/dossier`, headers: auth });
    assert.equal(dossier.statusCode, 200, dossier.body);
    assert.match(dossier.body, /GO \/ NO-GO Decision Matrix/);
    assert.match(dossier.body, /Sarah Jenkins/);

    const arbitration = await app.inject({
      method: 'POST', url: `/v1/swarm/runs/${run.run_id}/arbitrate`, headers: auth,
      payload: { action: 'accept_consensus' },
    });
    assert.equal(arbitration.statusCode, 200, arbitration.body);
    assert.equal(arbitration.json().status, 'rejected_human');
  });
});
