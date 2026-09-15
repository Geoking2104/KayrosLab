# KayrosLab Console harness and governed sessions

> La spécification de production V2 (agents administrables, coffre connecteurs et fils de décision) se trouve dans [PRODUCTION-CONSOLE-V2.md](./PRODUCTION-CONSOLE-V2.md).

La console est un **harness d'agents** : un poste de travail qui compose des collectifs, exécute des missions gouvernées et conserve chaque dossier sous arbitrage humain. Elle emprunte le vocabulaire d'un harness d'agents (agents, outils, collectif, session, mission, étapes, arbitrage) et s'appuie sur le runtime gouverné de KayrosLab. Elle ne dépend d'aucune application d'interface dérivée : le produit de conversation séparé possède ses propres surfaces.

## Product model

```text
Tenant
  ├─ Agent registry (rules + optional consented human profile)
  ├─ Swarm configurations (collectives)
  └─ Harness sessions
       └─ stable collective (agent rosters + voting threshold)
            ↓
       Governed mission (one step per agent + consensus)
            ↓
       Durable dossier + decision thread
            ↓
       Human arbitration
```

A **session** is the stable product boundary of the console. It binds one governed collective to one durable execution log. Each mission appends an ordered dossier to that session; the same log is exposed through the web console.

## Runtime guarantees

- Tenant isolation on session lookup, agent registry and swarm execution.
- One active execution slot per session; later missions queue behind the current run.
- Ordered, idempotent execution events for every mission.
- Human arbitration remains mandatory after every collective verdict.
- Consented hybrid personality data is still mediated by the existing swarm APIs.

## API

Authenticated console endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/console/overview` | User, agent, connector, session and activity summary |
| `GET` | `/v1/console/sessions` | List tenant harness sessions |
| `POST` | `/v1/console/sessions` | Open a session bound to an existing or newly created collective |
| `GET` | `/v1/console/sessions/:sessionId` | Session detail with its executions and activity log |
| `PATCH` | `/v1/console/sessions/:sessionId/collective` | Add or remove agents from the active collective |
| `POST` | `/v1/console/sessions/:sessionId/run` | Run a governed mission from the console |
| `GET` | `/v1/console/activity` | Read the ordered execution stream |
| `GET` | `/v1/console/threads/:threadId` | Durable decision thread |
| `POST` | `/v1/console/threads/:threadId/arbitrate` | Human arbitration |

Connectors expose the external channel credentials trusted by the platform. The console stores and
tests them; binding a channel to a collective belongs to the separate conversational application.

## Console build

```bash
cd frontend/console-app
npm install
npm run build
```

Vite writes the production app to `backend/web/public/console`, so the existing Express website serves it at `/console/`. During development, `npm run dev` proxies `/v1` to `http://localhost:8787`.

## Multi-instance PostgreSQL deployment

When `DATABASE_URL` is configured, every backend node shares the hybrid agent registry, swarm configurations and runs, the harness session store and the ordered execution stream. PostgreSQL advisory locks serialize agent execution per session across processes. A five-minute lease lets another node retry work after a crashed worker while completed missions remain idempotent.

Use the same database and connector secrets on every instance:

```dotenv
DATABASE_URL=postgres://kayros:***@postgres.internal:5432/kayroslab
KAYROS_REQUIRE_POSTGRES=true
KAYROS_PG_POOL_MAX=10
KAYROS_COLLAB_MESSAGE_LEASE_SECONDS=300
```

The schema is idempotently applied at startup. If production credentials cannot run DDL, apply `core/sql/schema.sql` with a migration role before deployment. Size `KAYROS_PG_POOL_MAX` so the sum of all instance pools stays below the server connection limit.

Deploy at least two identical instances behind the load balancer. Verify `/health`: `persistence` must equal `postgres` and `multiInstanceReady` must be `true`. With `KAYROS_REQUIRE_POSTGRES=true`, a node fails fast instead of serving isolated in-memory state when PostgreSQL is unavailable.
