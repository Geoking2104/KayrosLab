# Impersonator agent — functional specification

Status: implemented in the console (`frontend/console-app`) and core (`core/impersonator.mjs`).
Scope: a **stakeholder-simulation agent** used to stress-test ("prove") an idea before it is
committed, by reconstructing how a real person would likely react from **authorised clues**.

Related: [`CONSOLE-HYBRID-AGENTS.md`](./CONSOLE-HYBRID-AGENTS.md), [`PRODUCTION-CONSOLE-V2.md`](./PRODUCTION-CONSOLE-V2.md).

---

## 1. Purpose

An **impersonator agent** is a specialised hybrid agent whose persona is rebuilt from clues about a
real stakeholder (LinkedIn profile, Crystal Knows report, an authorised export, or manual clues) and
added to a governed collective to **test an idea**: surface the objections, conditions and
decision triggers that stakeholder would likely raise.

It is a *simulation aid*. It never speaks for the person, never asserts private facts, and never
feeds a materially impactful decision about them.

## 2. Definitions

| Concept | Definition |
|---|---|
| **Hybrid agent** | An explicit agent (mission, rules, tools) optionally enriched with a consented human profile. |
| **Impersonator agent** | A hybrid agent that carries `metadata.impersonator` (persona identity + clue source + consent) and whose effective context includes persona-simulation guardrails. |
| **Clues** | Only the attributes actually supplied by the authorised source (DISC, archetype, motivators, tone, decision/stress triggers, objection patterns, directives, professional context). |
| **Idea test** | A governed swarm mission whose question is the idea under review (`purpose: idea_test`). |

## 3. Inputs (clue sources)

| Source | What is used | Notes |
|---|---|---|
| `linkedin` | Identity/professional context via the official LinkedIn Profile API (authenticated member) or user-supplied authorised export. | No scraping. Only the member's own profile through the standard API. |
| `crystalknows` | Crystal Profiles API lookup by LinkedIn URL or email (eligible plans) → DISC, archétype, motivateurs, triggers, objection patterns. | Server-side token only. |
| `export` | An authorised structured export (JSON) parsed client-side then sent as `profile_data`. | The user certifies the export is authorised. |
| `manual` | Free-text clues entered by the operator. | Lowest fidelity; still gated by consent + guardrails. |

## 4. Consent, legal and ethics (mandatory)

- `consent_confirmed: true` is required; without it the agent is rejected (HTTP 400).
- Optional `consent_reference` records where the consent is held.
- The persona is used **only** for collaboration/communication/idea-testing simulation. It must not be
  used for hiring, credit, insurance, housing, health or any materially impactful decision about the person.
- Outputs are always labelled as simulation; the guardrails forbid presenting simulated feedback as a real quotation.

## 5. Construction pipeline

```
clues source ──▶ profile import ──▶ persona (human_profile)
                        │
                        ├─▶ persona_clues digest (DISC, tone, triggers, objections…)
                        └─▶ guardrails (5 rules) ──▶ effective rules + context
                                                    │
                                          swarm mission (idea test)
```

1. `normalizeImpersonator()` validates name, source, purpose and consent.
2. The profile is imported through the existing consent-aware importer
   (`ProfileImportService` → `profileFromLinkedInData` / `profileFromCrystalData`).
3. `impersonatorAgentDefinition()` produces the agent definition (id `imposteur_<slug>`, mission
   "simuler la partie prenante pour éprouver une idée", `veto_power` on by default).
4. `resolveEffectiveRules()` appends the 5 guardrails with `origin: "impersonator"`;
   `compileEffectiveAgentContext()` appends the `PERSONA SIMULATION` block (clues digest).

## 6. Swarm integration

An impersonator agent is added to a **collective** (session) like any other agent, and priced into the
run:

- its analysis is a **simulated stakeholder verdict** (accord / objections / conditions) labelled « Simulation »;
- with `veto_power`, a negative simulated verdict blocks the consensus until a human arbitrates;
- `personality_simulation_enabled` must be true for the collective to use the persona; otherwise the
  agent still contributes but the persona context is not injected.
- The consensus/dossier remains consultative until human arbitration (unchanged governance).

## 7. Output contract

Each impersonator contribution must:

1. start with `Simulation` (label);
2. state the likely **position** (favourable / conditional / opposed);
3. list **objections** and the **conditions** that would unlock acceptance;
4. name the **decision triggers** and any **clue gaps** ("information not in the supplied clues");
5. never claim to be the person, and never cite private facts outside the clues.

## 8. Guardrails (compiled as effective rules)

| Rule id | Requirement |
|---|---|
| `IMP_01_LABEL` | Every contribution is labelled « Simulation ». |
| `IMP_02_NEVER_SPEAK_FOR` | Never claim to be the person, nor act/speak/decide in their name. |
| `IMP_03_CLUES_ONLY` | Use only supplied clues; invent no private fact; flag gaps. |
| `IMP_04_IDEA_TEST` | Usage limited to the declared purpose (idea test / objection rehearsal / pitch review). |
| `IMP_05_NO_MATERIAL_DECISION` | Never contribute to a materially impactful decision about the person. |

## 9. API

`POST /v1/console/impersonators` (auth; `comex`/`admin`)

```jsonc
{
  "name": "Camille Dubois",
  "role": "VP Procurement",
  "company": "Northwind",
  "source": "crystalknows",          // linkedin | crystalknows | export | manual
  "purpose": "idea_test",            // idea_test | objection_rehearsal | pitch_review
  "linkedin_url": "https://www.linkedin.com/in/…",
  "email": "camille@northwind.example",   // Crystal Knows alternative
  "report_url": "https://…crystalknows.com/…",
  "profile_data": { },               // when source=export (authorised JSON)
  "export_source": "crystalknows",   // linkedin | crystalknows (export only)
  "clues": ["décide vite", "exige des preuves chiffrées"],
  "veto_power": true,
  "consent_confirmed": true,
  "consent_reference": "consent-2026-09-17"
}
```

Response `201`:

```jsonc
{
  "agent": { "agent_id": "imposteur_camille_dubois", "effective_rules": [ /* incl. IMP_* */ ], "effective_context": "…PERSONA SIMULATION…" },
  "persona": { "disc": "D/C", "tone": "direct", "motivators": [], "...": "…" },
  "guardrails": [ { "rule_id": "IMP_01_LABEL", "rule_text": "…" }, "…" ],
  "enrichment_error": null            // non-null when the upstream profile API failed; the base persona remains usable
}
```

Related endpoints: `POST /v1/console/agents/:id/personality` (enrich an existing agent),
`PUT /v1/console/agents/:id/human-profile` (direct consented profile).

## 10. Console UX

Agents → **Ajouter un agent impersonator**:

1. identity (person / role / organisation);
2. clue source (LinkedIn / Crystal Knows / export / manual) + objective;
3. explicit consent checkbox (mandatory);
4. creation → **persona summary** (DISC, archétype, ton, motivateurs) + the applied **guardrails**;
5. the agent appears in the register (badge *persona*) and can be added to a session to run the idea test.

## 11. Limits / non-goals

- Not an identity claim and not a substitute for interviewing the real stakeholder.
- No scraping; only official APIs or user-supplied authorised exports.
- Fidelity is bounded by the clues supplied; gaps are reported, never invented.
- No materially impactful decision support about the person.

## 12. Acceptance tests

- `core/impersonator.test.mjs` (6): consent required, source validation, guardrail set, clue digest,
  context injection, non-impersonator agents untouched.
- `backend/fastify/tests/console-route.test.mjs`: creates an impersonator from manual clues and asserts
  the id, `metadata.impersonator`, 5 guardrails, `PERSONA SIMULATION` context and `impersonator` rules;
  rejects a request without consent (400).

## 13. Example — prove an idea

> Idea: *"We raise prices 12% next quarter."*
> Collective: CFO (veto), CTO, plus impersonator **Camille Dubois (VP Procurement, Northwind)**.
> Camille's contribution (simulation): opposed — expects a volume/commitment clause, wants a 90-day
> notice, rejects any change mid-contract; conditions: TCO proof, SLA guarantee, staged rollout.
> The human then arbitrates the consensus with those conditions attached.
