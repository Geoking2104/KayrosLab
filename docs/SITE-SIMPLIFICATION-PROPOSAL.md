# KayrosLab website simplification proposal

Date: 2026-08-18

## Decision

Make the homepage sell one outcome: **rehearse a decision before the meeting**.

The current site contains strong product material, but it asks a first-time visitor to understand the platform, the eight-step methodology, the tooling, the orchestration model, the Sales Oracle, three deployment tiers, and the resource library in a single journey. The homepage should become a short commercial path; detailed product and technical material should remain available on dedicated pages.

## Primary audience and action

- Primary audience: executive sponsors, strategy leaders, innovation leaders, and enterprise sales leaders.
- Primary action: book or run a decision rehearsal.
- Secondary action: watch a short walkthrough or inspect a sample decision dossier.

## What to keep

- The promise of governed decision simulation with hybrid agents.
- The two concrete scenarios: executive committee decisions and buyer-committee/RFP rehearsals.
- The Sales Oracle visual and its direct language about vetoes and deal blockers.
- Governance, consent, source provenance, and the distinction between simulated and real stakeholder statements.
- A clear path to product, developer, security, and resource detail.

## What currently creates friction

1. **The hero has two competing stories.** The customer outcome is on the left, while the reference-prototype architecture panel draws attention toward implementation detail. The two primary-looking calls to action also make the next step less obvious.
2. **The eight-step model appears too early and at equal visual weight.** Eight dense cards explain the full methodology before the visitor has seen the strongest use cases or a concrete output.
3. **The strongest commercial proposition is buried.** “Your sales oracle knows where the deal can stop” is specific and memorable, but appears well below the general platform and process material.
4. **The offer mixes audiences.** A free standalone HTML workshop, sovereign deployment, and cloud subscription are useful options, but presenting all three together weakens the enterprise buying story and makes “Free” the dominant price signal.
5. **The top navigation exposes the whole information architecture.** Platform, Solutions, Resources, Company, Differentiation, and Offer create too many possible paths before the value proposition is understood.

## Proposed homepage

### 1. Header

Use five choices at most:

- Product
- Use cases
- Trust
- Resources
- **Book a simulation**

Keep the language switcher. Move Company and detailed Offer content to the footer or secondary pages.

### 2. Hero

Recommended headline:

> Rehearse the decision before the meeting.

Recommended supporting copy:

> Build a governed hybrid-agent twin of your executive or buying committee. Surface vetoes, objections, and missing evidence before they cost time or a deal.

Calls to action:

- Primary: **Run a decision rehearsal**
- Secondary: **See a sample decision dossier**

Replace the architecture panel with a concrete decision-dossier preview: likely vetoes, missing evidence, stakeholder map, and recommended actions.

### 3. Two use cases

Place the strongest use cases immediately after the hero.

**COMEX decision rehearsal**

- Impersonate authorized executive profiles with governed hybrid agents.
- Test strategic options before the real committee meets.
- Expose objections, dependencies, and decision criteria.

**Sales Oracle / RFP rehearsal**

- Recreate the customer's buying and veto committee from authorized sources.
- Stress-test the proposal against finance, security, legal, operations, and executive concerns.
- Strengthen the offer before it reaches the real buyer.

### 4. How it works in three steps

Compress the eight-step methodology into a homepage summary:

1. **Compose** — combine system agents, custom agents, and consented hybrid profiles.
2. **Simulate** — run structured challenges, objections, vetoes, and trade-offs.
3. **Decide** — receive a governed dossier with evidence gaps and recommended actions.

Link to the complete eight-step method on the Product page.

### 5. Show the output

Use one annotated product visual, not a catalogue of features. Show the decision dossier with four proof points:

- decision and stakeholder map;
- veto and objection heatmap;
- missing-evidence checklist;
- audit trail and human approval gates.

### 6. Trust and governance

Use a compact reassurance block:

- consented and authorized profiles;
- simulated statements clearly labelled;
- human approval gates;
- source provenance and auditability;
- sovereign or cloud deployment.

Link to the full security, privacy, and architecture material.

### 7. Final conversion

Use a single closing question:

> Which decision or deal do you need to rehearse?

Primary action: **Book a 30-minute simulation**.

## Content to move off the homepage

| Current material | Recommended destination |
| --- | --- |
| Full eight-step process | Product / Method |
| Detailed tool catalogue and dashboards | Product |
| Orchestration, agent architecture, MCP, and API access | Developers / Technology |
| Standalone HTML and deployment tiers | Developers / Deployment |
| Detailed differentiation matrix | Why KayrosLab |
| White papers and business cases | Resources |
| Company narrative | Company / footer |

## Accessibility and responsive checks

- Increase contrast for small muted supporting text, especially proof lines and captions.
- Reduce long paragraph line lengths and avoid eight narrow text columns.
- Keep visible keyboard focus on navigation, language controls, and calls to action.
- Verify semantic heading order, menu operation, focus management, and mobile reflow in implementation; screenshots alone do not confirm these behaviors.
- Ensure the decision-dossier visual has a concise text alternative and that key findings are not encoded by color alone.

## Delivery sequence

### Pass 1 — simplify without changing the visual identity

- Reorder the existing sections.
- Replace the hero prototype panel with the dossier preview.
- Promote the two use cases directly below the hero.
- Collapse eight steps to three and link to the full method.
- Reduce navigation and keep one primary call to action.
- Move technical and pricing detail to dedicated pages.

### Pass 2 — validate conversion and comprehension

- Test the current hero against “Rehearse the decision before the meeting.”
- Track primary-CTA clicks, dossier-preview engagement, and booked simulations.
- Run desktop and mobile accessibility checks, including keyboard navigation and contrast.
- Interview five target buyers and ask them to explain the product, audience, and next step after ten seconds on the homepage.

## Success criteria

- A first-time visitor can explain the product, the two main use cases, and the next action in under ten seconds.
- The homepage contains no more than seven primary content blocks.
- One call to action dominates each viewport.
- Technical depth remains available without interrupting the commercial narrative.
