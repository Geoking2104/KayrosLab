# KayrosLab Console and hybrid collaboration rooms

This architecture adopts the useful collaboration patterns of agent workspaces — rooms, agent presence, one execution slot per room and a shared activity stream — without copying third-party console code.

## Product model

```text
Tenant
  ├─ Hybrid agent registry (rules + optional consented human profile)
  ├─ Swarm configurations
  └─ Collaboration rooms
       ├─ Slack channel
       ├─ Discord channel
       ├─ Microsoft Teams conversation
       └─ Console-only room
            ↓
       HybridAgentGateway
            ↓
       Governed swarm run
            ↓
       Human arbitration
```

A **room** is the stable product boundary. It binds one external channel to one governed swarm configuration. Incoming platform events are normalized, deduplicated and serialized inside that room before agents run. The same activity is exposed to the web console.

## Runtime guarantees

- Tenant isolation on room lookup, agent registry and swarm execution.
- One active execution slot per room; later messages queue behind the current run.
- Platform-message idempotency to absorb webhook retries.
- `mention_only` and `always` room modes.
- Human arbitration remains mandatory after every collective verdict.
- Hybrid personality data still requires explicit consent through the existing swarm APIs.
- Slack signatures, Discord signatures and Teams Bot Framework tokens remain verified by the existing adapters before dispatch.

## API

Authenticated console endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/console/overview` | User, agent, connector, room and activity summary |
| `GET` | `/v1/console/rooms` | List tenant rooms |
| `POST` | `/v1/console/rooms` | Bind a room to an existing or newly created swarm |
| `GET` | `/v1/console/activity` | Read the ordered collaboration stream |
| `POST` | `/v1/console/rooms/:roomId/messages` | Run a test mission from the console |

Platform endpoints:

| Platform | Endpoint | Event |
|---|---|---|
| Slack | `POST /v1/connectors/slack/events` | `app_mention` and direct `message` |
| Discord | `POST /v1/connectors/discord/interactive` | `/kayros question:<text>` |
| Teams | `POST /v1/connectors/teams/interactive` | Bot Framework `message` activity |

## Platform setup

### Slack

Set `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`. Point the app Event Subscriptions request URL to `/v1/connectors/slack/events`, subscribe to `app_mention` and the message scopes needed for direct messages, then invite the bot to the channel. The room's `external_room_id` is the Slack channel ID.

### Discord

Set `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN` and `DISCORD_PUBLIC_KEY`. Register a `/kayros` application command with a required string option named `question`, and use `/v1/connectors/discord/interactive` as the interactions endpoint. The room's `external_room_id` is the Discord channel ID.

### Microsoft Teams

Set `TEAMS_APP_ID` and `TEAMS_BOT_PASSWORD`. Configure the Bot Framework messaging endpoint as `/v1/connectors/teams/interactive`. The room's `external_room_id` is the Bot Framework conversation ID.

## Console build

```bash
cd frontend/console-app
npm install
npm run build
```

Vite writes the production app to `backend/web/public/console`, so the existing Express website serves it at `/console/`. During development, `npm run dev` proxies `/v1` to `http://localhost:8787`.

## Multi-instance PostgreSQL deployment

When `DATABASE_URL` is configured, every backend node shares the hybrid agent registry, swarm configurations and runs, collaboration rooms, ordered activity stream and webhook claims. PostgreSQL advisory locks serialize agent execution per room across processes. A five-minute message lease lets another node retry work after a crashed worker while completed platform messages remain idempotent.

Use the same database and connector secrets on every instance:

```dotenv
DATABASE_URL=postgres://kayros:secret@postgres.internal:5432/kayroslab
KAYROS_REQUIRE_POSTGRES=true
KAYROS_PG_POOL_MAX=10
KAYROS_COLLAB_MESSAGE_LEASE_SECONDS=300
```

The schema is idempotently applied at startup. If production credentials cannot run DDL, apply `core/sql/schema.sql` with a migration role before deployment. Size `KAYROS_PG_POOL_MAX` so the sum of all instance pools stays below the server connection limit.

Deploy at least two identical instances behind the load balancer, then point Slack, Discord and Teams webhooks to the balanced URL. Sticky sessions are not required. Verify `/health`: `persistence` must equal `postgres` and `multiInstanceReady` must be `true`. With `KAYROS_REQUIRE_POSTGRES=true`, a node fails fast instead of serving isolated in-memory state when PostgreSQL is unavailable.
