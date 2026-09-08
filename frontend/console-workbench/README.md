# Console workbench — tableau d'abord

Playable KayrosLab console. This is **not** the production Fastify UI in
[`frontend/console-app`](../console-app). It is the board-first workbench:
ideas as cards, a 5-minute setup, an inbox for human gates.

Production console (`/console/` on kayroslab.com) stays the operational
surface: channels, collectives, durable threads. This workbench is the UX
contract to port there.

## Why it exists

The previous console dumped 15 product surfaces in the rail (Matrice, Cycle,
Portfolio, Mémoire, Portes, Novelty, Positioner, Essaims, Oracle, Forecast,
Connecteurs, MCP, Studio, Specs, Résultat). Unusable.

Inspired by [Multica](https://github.com/multica-ai/multica) **UX only**:

- Kanban as home
- Three-step first run
- Inbox when an agent needs a human, not at every trace
- Slim sidebar

KayrosLab is **not** Multica. Multica drives coding-agent CLIs on your
machine. KayrosLab governs a strategic cycle: vote instructs, veto decides,
every forecast is labelled `SIMULATION`.

## Mapping

| Multica | KayrosLab |
|---|---|
| Sign in | Name the workspace (local tenant) |
| Connect a computer | Compose a swarm (roles + veto) |
| Create an agent | Registry of system / hybrid agents |
| Assign an issue | File an idea, run the cycle |
| Board | À traiter → En cycle → À arbitrer → Mesuré |
| Inbox + review | Inbox + human gate |
| `multica setup` | This workbench; prod = Fastify + Ollama |

Full guide: [`docs/CONSOLE-WORKBENCH.md`](../../docs/CONSOLE-WORKBENCH.md).

## Surfaces

Primary rail: **Tableau · Inbox · Essaims · Guide**.

Atelier (collapsed): Matrice, Cycle, Mémoire, Novelty, Positioner, Oracle,
Forecast, Portes, Statuts, Résultat.

Système (collapsed): Connecteurs, MCP, Studio, Specs.

`C` creates an idea. Primary action is always one of: Lancer le cycle /
Ouvrir la porte / Voir le résultat.

## Engine

Client-side deterministic engine in `src/lib/kayros/`:

- 8-step cycle (Recueillir → Réaliser) + KPI loop back to Écouter
- KI (6 technical → 5 strategic), novelty 0.40 / 0.40 / 0.20
- Swarm consensus: `majority` | `unanimous` | `veto_power_csuite`
- Persist key `kayros-console-v4` (localStorage)
- Optional user-initiated grok-4.5 for collisions (capped)

Stage and status stay orthogonal. Simulations stay labelled.

## Source map

```
src/components/console/   Board, Guide, Inbox (WorkViews), Shell, Inspector, swarms
src/lib/kayros/           types, engine, seed, store, specs, board lanes
src/styles.css            Kayros tokens (cyan, not purple)
```

Do not merge this tree over `frontend/console-app`. Port the UX (board,
inbox, 5-minute guide, slim nav) into the production console instead.
