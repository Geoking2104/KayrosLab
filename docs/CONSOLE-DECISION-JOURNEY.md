# Decision-first console — information architecture

Updated: 2026-11-13. Scope: the React console in `frontend/console-app`.

## Product promise

**AI prepares and challenges. People decide.**

The primary object is a decision case: one question, the supplied context, a committee's opinions, objections, a human arbitration and its history. A project organizes multiple decisions and advanced workflows. A committee is a reusable configuration of AI agents; it is not a group of human approvers. Workspace members hold human permissions.

The entry point answers three questions: What needs my attention? What is missing? What happens next?

## Why the structure changes

The previous default screen started with company/API configuration. Its four navigation groups hid decisions under projects and committee composition under the library. The introductory checklist explained concepts without completing a real task. The launch form selected execution profiles before framing the decision and accepted document names without their contents.

The new experience starts with decisions, exposes arbitration directly, separates AI committees from human membership and postpones project graphs and runtime configuration. The shared shell and design tokens apply across existing console pages; the graph, persona designer, integrations and public API contracts are retained.

## Navigation and terminology

| French label | English label | Route | User question |
| --- | --- | --- | --- |
| Aujourd’hui | Today | `#overview` (default) | What needs attention next? |
| Décisions | Decisions | `#dossiers` | Where is the complete case? |
| Arbitrages | Approvals | `#arbitrages` | Which recommendations await a human decision? |
| Comités et agents | Committees & agents | `#collectifs`, `#agents` | Which perspectives and responsibilities are involved? |
| Sources et savoirs | Sources & knowledge | `#bibliotheque` | Which reusable context and skills inform the work? |
| Projets et parcours | Projects & workflows | `#projets` | How are several reviews coordinated? |
| Organisation | Organization | `#societe` | Which companies and projects make up the portfolio? |
| Réglages | Settings | `#reglages` | How are connections, members and workspace managed? |
| Prise en main | Getting started | `#guide` | How do I prepare my first decision? |

“Manage decisions” contains the first five entries; “Organize workspace” contains the next three. Getting started is always available. Each entry has a different Lucide icon. The mobile menu provides the same destinations as the desktop sidebar.

Existing hashes and case deep links continue to work. `#home` and `#accueil` alias the home; `#approvals` aliases arbitration; `#onboarding` aliases the preparation flow. Routing does not encode user content in query parameters.

The prominent action is **Prepare a decision / Préparer une décision**. Advanced document analysis remains available as a disclosure in the case registry, alongside the existing workflow editor.

## First-use journey

A new visitor can explore a clearly labelled demo without credentials. Real work starts after connecting the existing workspace through Settings → Connections. With a saved token, the preparation flow waits for actual workspace data; it does not silently create a demo decision while authentication is loading.

The guide explains the overall four-part journey: frame, gather evidence, compare perspectives, arbitrate. The task itself uses five preparation steps:

| Step | Information collected | Completion rule | Assistance |
| --- | --- | --- | --- |
| 1. Decision | Question, expected outcome, type, optional target date | At least six words in the question | Editable project/commercial examples and guidance on making options comparable |
| 2. Context | Facts, assumptions, constraints and source excerpts | Context fits the declared size limit | Explicit separation of facts and hypotheses; missing-source notice |
| 3. Committee | Existing committee, active agents, missions and veto holders | At least two active agents in the selected committee | Complementary perspectives explained; direct link to configure a missing committee |
| 4. Governance | Read-only committee voting rule, human permissions, execution depth | Explicit acknowledgement of the current committee configuration | AI opinion versus human decision; link to check member permissions |
| 5. Review | Question, context, source count, committee, rule, execution mode | All previous checks still pass and caller has `run` permission | Clear description of what is transmitted and what happens next |

A date is briefing context, not a scheduled reminder. The wizard does not assign legal authority or fabricate a named approver. Existing membership and server policy remain authoritative.

### Draft behaviour

- Drafts survive navigation, reload and language changes within the same browser tab.
- Browser session storage is scoped to tenant and user; demo uses a separate key. User-authored content remains verbatim across languages.
- Drafts are not server-synced, encrypted by the application or guaranteed to survive closing the tab. Storage failure is visible and leaves the current form usable.
- Invalid schemas and oversized stored contexts are discarded safely.
- Governance acknowledgement is deliberately not restored from storage. Returning to a review after a remount requires checking governance again.
- A change to the selected committee, active agent identities, veto flags, model/provider settings or voting rule invalidates its acknowledgement.
- One explicit launch is allowed while a request is pending. The draft is cleared only after a server-confirmed case identifier; failed launches retain the question and source text.
- Clearing a draft resets the fields and any unattached source text. There is no background model call while editing.

### Source handling

The flow accepts pasted text and `.txt`/`.md` files below 80 KB. It supports up to six source excerpts and budgets 22,000 characters for the combined briefing and source text, leaving room below the existing API adapter's 24,000-character context limit. Oversized content is rejected instead of silently truncated by the wizard.

The source title/provenance is supplied by the user. The application does not certify provenance. PDFs, OCR and URL crawling are not part of this flow; a filename or link is not presented as analysed content. The launch sends actual text to the existing `sessions/:id/run` endpoint. The existing backend stores and processes the run; the onboarding does not introduce a separate evidence store or claim source-level citation verification. The gateway now stores `source_context` in the existing thread JSON payload, exposes it immediately and preserves it in both synchronous and asynchronous clarifications. Older cases fall back to their initial run context. The console displays that combined context as one item, with the supplied source titles inside it; it does not invent a document count. No database migration is required.

## Returning-user experience

The home derives all counters and rows from the console store (API records in connected mode; labelled sample records in demo). There are no invented activity numbers, confidence scores or performance trends.

| State | Next action | Behaviour |
| --- | --- | --- |
| Open case with blocked gate | Examine the block | Prioritized above other cases; existing gate policy still controls arbitration |
| Clarification required | Provide clarification | Open the same case and its outstanding question |
| Awaiting arbitration | Prepare my arbitration / Read before the committee | Wording follows the member's permission |
| Failed | Investigate the failure | Visible in the active queue and the failure filter |
| Running | Follow the review | Show existing progress and polling updates |
| Resolved | Read the decision | Available in the recorded-decisions filter and case registry |

The approvals route starts filtered to cases awaiting arbitration. Status cards, status selection and text search allow users to change scope without starting a mission. Case links open a side panel over the originating page. The panel has an accessible name, Escape dismissal, keyboard focus containment, scroll locking and focus return.

The case header shows a readable five-part status rail (framing, context, AI opinions, arbitration, recorded decision). The detailed eight-stage internal cycle remains available in a disclosure. A next-action explanation precedes opinions, arbitration and audit sections. Source context is inspectable, and the advanced document workbench is collapsed so it does not obscure the committee’s results.

## Roles and governance

| Role | Preparation | Run | Human arbitration | Administration |
| --- | --- | --- | --- | --- |
| Reader | Can inspect the flow locally | Disabled | Read only | Existing server policy |
| Contributor | Draft, add context, select committee | Allowed by membership | Read before committee; cannot arbitrate | Existing server policy |
| COMEX | Full preparation | Allowed by membership | Accept, condition, reassess, justified veto override | Existing permissions |
| Admin | Full preparation | Allowed by membership | Same arbitration capabilities | Members, connections and workspace |

The UI consumes `permissions` from the existing store. It is not an authorization boundary. Existing backend RBAC, tenant isolation, gate checks and audit logic remain in place. No onboarding checkbox bypasses a server gate, and no AI output is automatically accepted as a human decision.

## How Eve informs this implementation

References reviewed on 2026-11-13:

- [Eve repository and README](https://github.com/vercel/eve/tree/main): agents with inspectable instructions, tools, skills, channels and schedules.
- [Human-in-the-loop tools](https://github.com/vercel/eve/blob/main/docs/tools/human-in-the-loop.md): explicit questions and approvals, pause/resume, interaction identity.
- [Multi-tenant approvals](https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-approvals.md): tenant policy, responder authorization, rechecking permissions and idempotency.

| Eve principle | KayrosLab application |
| --- | --- |
| Durable conversation and work context | Preserve a single decision case through instruction, clarification and arbitration |
| Ask before guessing | Surface clarification and missing context as a distinct state |
| Explicit human approval | Separate advisory AI consensus from member arbitration |
| Inspectable tools and skills | Keep committee agents, source library and configuration discoverable behind the main task |
| Tenant-aware policy | Read existing workspace membership and keep draft scopes separate |
| Same work through multiple channels | Preserve the existing console, Slack, Teams and Discord backend paths |

This change applies Eve's interaction and architecture patterns. It **does not install the Eve runtime**, migrate existing sessions to Eve, add a new chat model, or implement Eve's event protocol. The AI review remains the existing KayrosLab engine. A future runtime adapter would need a versioned mapping for session identity, authenticated responders, durable approvals, idempotency, cancellation and tenant boundaries, with integration tests before rollout.

## Visual system based on Nuxt UI

References: [Nuxt UI dashboard theme](https://ui.nuxt.com/theme?view=dashboard), [theme dashboard source](https://github.com/nuxt/ui/blob/v4/docs/app/components/theme-studio/view/ThemeStudioViewDashboard.vue), [official templates](https://ui.nuxt.com/templates).

The implementation uses React and Tailwind already in the repository. Nuxt UI's Vue components are not imported into React. It adopts the reference's sidebar/header/content structure, neutral surfaces, thin borders, semantic status badges, compact controls and restrained accent usage. The CSS is authored for KayrosLab rather than copied from the Nuxt theme application.

| Token/behaviour | Value |
| --- | --- |
| Canvas / surface | Slate 50 (`#f8fafc`) / white |
| Text / secondary text | Slate 900 / Slate 700 |
| Secondary labels / borders | Slate 500 / Slate 200 |
| Primary action / hover | Emerald 700 / Emerald 800, white labels |
| Advisory approval / failure | Amber / red with explicit text, not color alone |
| Sidebar | 240 px on desktop; disclosure navigation below 1024 px |
| Main content | Up to 1440 px; secondary guide column at wide widths |
| Forms | Labelled inputs, visible focus, native controls, large action targets |
| Typography | Public Sans when available; local system font fallback without a new external request |
| Language | Full EN/FR interface parity; authored content preserved |
| Motion | Reduced-motion preference respected |

## Validation and rollout

Automated coverage includes the complete live launch path with mock API acceptance, API failure and retained drafts, no duplicate submission, reader permissions, account/tenant draft separation, schema/size validation, translations, legacy routes and the existing graph/persona/integration tests. Build and typechecking use the existing console toolchain. A browser walkthrough checks the demo journey and visual layout.

Validation for this revision:

- Console typecheck and production build: passed. Vite still reports the existing single-bundle size warning (about 810 KB uncompressed).
- Console suite: 107 tests passed across 18 files.
- Core engine suite: 793 tests passed; 14 tests skipped by the existing suite; no failures.
- Console deployment/link compatibility suite: 5 tests passed.
- Browser: walked the five-step demo through case creation; checked the English and French dashboard and onboarding. Screenshots are in `assets/readme/console-decision-home-{en,fr}.jpg` and `assets/readme/console-onboarding-{en,fr}.jpg`.
- A real authenticated model run, human arbitration in the deployed environment and a mobile-device walkthrough remain deployment acceptance checks.

Deployment remains the repository's existing workflow. This branch is reviewable as a PR; it does not change production credentials, infrastructure or database schemas, and it retains the existing AI engine. The old hashes are kept, and rollback is a code revert. Confirm a real authenticated run and human arbitration in the deployment environment before declaring production acceptance; local tests use demo or mocked API responses.
